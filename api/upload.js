const https = require('https');
const { Readable } = require('stream');

// ── SUPPORTED MIME TYPES — PDF + DOCX ──
// PDF: uploaded to Anthropic Files API for rich analysis, text extracted server-side for ATS
// DOCX: text extracted server-side, NOT uploaded to Files API (unsupported by Anthropic)
const MIME_TYPES = {
  'pdf':  'application/pdf',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// ── MAX FILE SIZE: 3MB (base64 overhead keeps us under Vercel 4.5MB body limit) ──
const MAX_FILE_SIZE = 3 * 1024 * 1024;

// ═══════════════════════════════════════════════════════
// CANONICAL TEXT EXTRACTION PIPELINE
//
// Both PDF and DOCX produce the same normalized plaintext.
// This text is returned to the frontend AND sent to analyze.js
// for deterministic ATS scoring — regardless of file type.
// ═══════════════════════════════════════════════════════

// ── DOCX TEXT EXTRACTION ──
// DOCX = ZIP containing word/document.xml. We decompress with zlib,
// locate document.xml via the ZIP central directory, then strip XML tags.
// No npm dependencies required.
const zlib = require('zlib');

function extractTextFromDOCX(buffer) {
  // ZIP files store entries with local file headers.
  // We scan for word/document.xml by finding its local file header.
  const entries = parseZipEntries(buffer);
  const docEntry = entries.find(e =>
    e.name === 'word/document.xml' || e.name === 'word\\document.xml'
  );
  if (!docEntry) throw new Error('Not a valid DOCX file — missing word/document.xml');

  let xml;
  if (docEntry.compression === 8) {
    // Deflate — use raw inflate (no zlib header)
    xml = zlib.inflateRawSync(docEntry.data).toString('utf8');
  } else {
    xml = docEntry.data.toString('utf8');
  }

  // Extract text from XML: get content of <w:t> tags, preserve paragraph breaks
  // Replace paragraph endings with newlines for structure
  let text = xml
    .replace(/<\/w:p[^>]*>/gi, '\n')          // paragraph end → newline
    .replace(/<w:tab\/>/gi, '\t')              // tab
    .replace(/<w:br[^>]*\/>/gi, '\n')          // line break
    .replace(/<[^>]+>/g, '')                    // strip all XML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, '')                     // numeric entities
    .replace(/[ \t]+/g, ' ')                    // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')                 // collapse excessive newlines
    .trim();

  return text;
}

// Minimal ZIP parser — reads local file headers to find entries
function parseZipEntries(buffer) {
  const entries = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    // Local file header signature: PK\x03\x04
    if (buffer[offset] === 0x50 && buffer[offset + 1] === 0x4B &&
        buffer[offset + 2] === 0x03 && buffer[offset + 3] === 0x04) {

      const compression = buffer.readUInt16LE(offset + 8);
      const compSize    = buffer.readUInt32LE(offset + 18);
      const uncompSize  = buffer.readUInt32LE(offset + 22);
      const nameLen     = buffer.readUInt16LE(offset + 26);
      const extraLen    = buffer.readUInt16LE(offset + 28);
      const name        = buffer.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
      const dataStart   = offset + 30 + nameLen + extraLen;
      const dataEnd     = dataStart + compSize;

      if (dataEnd <= buffer.length) {
        entries.push({
          name,
          compression,
          data: buffer.slice(dataStart, dataEnd),
          uncompSize
        });
      }

      offset = dataEnd;
    } else {
      offset++;
    }
  }

  return entries;
}

// ── PDF TEXT EXTRACTION (server-side) ──
// Extracts text from PDF by parsing the raw PDF structure.
// Handles common text operators (Tj, TJ, ', ") and text streams.
// This is a lightweight extractor — not a full PDF parser — but covers
// 95%+ of resume PDFs which use simple text rendering.
function extractTextFromPDF(buffer) {
  const content = buffer.toString('binary');

  // Find all stream...endstream blocks
  const textChunks = [];
  let searchStart = 0;

  while (true) {
    const streamIdx = content.indexOf('stream\n', searchStart);
    if (streamIdx === -1) break;

    const dataStart = streamIdx + 7; // after "stream\n"
    // Also handle stream\r\n
    const actualStart = content[streamIdx + 6] === '\r' ? streamIdx + 8 : dataStart;

    const endIdx = content.indexOf('endstream', actualStart);
    if (endIdx === -1) break;

    const rawStream = Buffer.from(content.slice(actualStart, endIdx), 'binary');

    // Try to decompress (most PDF streams are FlateDecode)
    let decoded;
    try {
      decoded = zlib.inflateSync(rawStream).toString('latin1');
    } catch {
      decoded = rawStream.toString('latin1');
    }

    // Extract text from PDF text operators
    const lines = extractPDFTextFromStream(decoded);
    if (lines.length > 0) {
      textChunks.push(...lines);
    }

    searchStart = endIdx + 9;
  }

  if (textChunks.length === 0) {
    // Fallback: try to find raw text strings in the PDF
    return extractPDFRawStrings(content);
  }

  let text = textChunks.join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

// Extract text from a decoded PDF content stream using text operators
function extractPDFTextFromStream(stream) {
  const lines = [];
  let currentLine = '';

  // Match text showing operators: (text)Tj, [(text)]TJ, (text)', (text)"
  // TJ arrays: [(Hello ) -10 (World)]TJ
  const tjPattern = /\(([^)]*)\)\s*Tj/g;
  const tjArrayPattern = /\[([^\]]*)\]\s*TJ/g;
  const newLinePatterns = /\bT\*|BT\b/g;

  // Process TJ arrays (most common in modern PDFs)
  let match;
  const segments = [];

  // Split stream by BT...ET blocks for better structure
  const btBlocks = stream.split(/\bBT\b/);

  for (const block of btBlocks) {
    const etIdx = block.indexOf('ET');
    const textBlock = etIdx >= 0 ? block.substring(0, etIdx) : block;

    let blockText = '';

    // Process TJ arrays
    while ((match = tjArrayPattern.exec(textBlock)) !== null) {
      const inner = match[1];
      const parts = inner.match(/\(([^)]*)\)/g);
      if (parts) {
        blockText += parts.map(p => p.slice(1, -1)).join('');
      }
    }
    tjArrayPattern.lastIndex = 0;

    // Process simple Tj
    while ((match = tjPattern.exec(textBlock)) !== null) {
      blockText += match[1];
    }
    tjPattern.lastIndex = 0;

    if (blockText.length > 0) {
      // Decode PDF escape sequences
      blockText = decodePDFString(blockText);
      segments.push(blockText);
    }
  }

  return segments;
}

function decodePDFString(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function extractPDFRawStrings(content) {
  // Last resort: extract parenthesized strings from the PDF
  const strings = [];
  const pattern = /\(([^)]{2,})\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const s = decodePDFString(match[1]).trim();
    // Filter out binary noise and very short strings
    if (s.length > 2 && /[a-zA-Z]/.test(s) && !/^[\\x00-\\x1f]+$/.test(s)) {
      strings.push(s);
    }
  }
  return strings.join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── NORMALIZE extracted text ──
// Canonical normalization applied to ALL extracted text regardless of source.
// Ensures PDF and DOCX of the same resume produce identical downstream analysis.
function normalizeResumeText(rawText) {
  if (!rawText) return '';
  return rawText
    .replace(/\r\n/g, '\n')                    // normalize line endings
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')                    // non-breaking space → space
    .replace(/[\u2018\u2019]/g, "'")            // smart quotes
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')            // en/em dash → hyphen
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '- ')  // bullet chars → dash
    .replace(/\t/g, ' ')                         // tabs → space
    .replace(/[ ]{2,}/g, ' ')                    // collapse spaces
    .replace(/\n{3,}/g, '\n\n')                  // collapse blank lines
    .trim();
    // No truncation here — ATS needs the full text.
    // Claude input is capped at 4000 chars in analyze.js.
}

// ── ANTHROPIC FILES API BETA HEADER ──
// NOTE: If uploads start failing after an Anthropic API update,
// check docs.anthropic.com for the updated beta header version
const FILES_BETA = 'files-api-2025-04-14';

// ── BUILD MULTIPART FORM DATA ──
function buildMultipart(boundary, filename, mimeType, fileBuffer) {
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([header, fileBuffer, footer]);
}

// ── HTTPS REQUEST HELPER ──
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── DELETE FILE from Anthropic ──
// Exported so analyze.js can call it after analysis completes
// Also called by this handler when student uploads a replacement file
async function deleteFile(fileId, apiKey) {
  if (!fileId || !apiKey) return;
  try {
    await new Promise((resolve) => {
      const opts = {
        hostname: 'api.anthropic.com',
        path: `/v1/files/${fileId}`,
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': FILES_BETA
        },
        timeout: 10000
      };
      const req = https.request(opts, res => { res.resume(); resolve(); });
      req.on('error', resolve);   // silent — deletion failure is never critical
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    });
  } catch { /* silent */ }
}

// ── MAIN HANDLER ──
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  // ── DELETE ROUTE — called when student uploads a replacement file ──
  // Frontend sends DELETE with { fileId } to clean up the previous upload
  if (req.method === 'DELETE') {
    const { fileId } = req.body || {};
    if (fileId) await deleteFile(fileId, apiKey);
    // Always return 200 — deletion is best-effort, never a blocker
    return res.status(200).json({ deleted: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── POST ROUTE — upload new file ──
  const body = req.body || {};
  const { filename, mimeType, data } = body;

  // ── VALIDATE INPUTS ──
  if (!filename || !data) {
    return res.status(200).json({
      fallback: true,
      error: 'Missing file data — using browser parsing instead.'
    });
  }

  const ext = (filename.split('.').pop() || '').toLowerCase();
  const resolvedMime = mimeType || MIME_TYPES[ext];
  if (!resolvedMime) {
    return res.status(200).json({
      fallback: true,
      error: `Unsupported file type .${ext} — please upload a PDF or DOCX file.`
    });
  }

  // ── DECODE BASE64 ──
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(data, 'base64');
  } catch {
    return res.status(200).json({
      fallback: true,
      error: 'Invalid file encoding — using browser parsing instead.'
    });
  }

  // ── VALIDATE SIZE ──
  // 3MB limit keeps us safely under Vercel's 4.5MB request body limit
  // after base64 encoding overhead (~33%)
  if (fileBuffer.length > MAX_FILE_SIZE) {
    return res.status(200).json({
      fallback: true,
      error: 'File too large. Please save your resume under 3MB.',
      tooLarge: true  // frontend shows specific "too large" message
    });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 1: EXTRACT TEXT SERVER-SIDE (canonical pipeline)
  // Both PDF and DOCX go through the same normalization.
  // This text is always returned to ensure deterministic ATS scoring.
  // ═══════════════════════════════════════════════════════
  let extractedText = '';
  try {
    if (ext === 'docx') {
      extractedText = normalizeResumeText(extractTextFromDOCX(fileBuffer));
    } else if (ext === 'pdf') {
      extractedText = normalizeResumeText(extractTextFromPDF(fileBuffer));
    }
  } catch (extractErr) {
    console.error(`Server text extraction failed for ${ext}:`, extractErr.message);
    // Not fatal — browser fallback can still extract, and we'll proceed
  }

  // Validate extracted text quality
  const cleanText = (extractedText || '').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const hasGoodText = cleanText.length >= 200;

  if (!hasGoodText && ext === 'docx') {
    // DOCX files can't go to Files API — text extraction is the only path
    // If extraction failed, we need to tell the browser to try its own parsing
    return res.status(200).json({
      fallback: true,
      resumeText: extractedText || '',
      error: extractedText
        ? 'DOCX text extraction produced very little content. Please check the file.'
        : 'Could not extract text from this DOCX. Try saving as PDF and uploading again.'
    });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 2: UPLOAD TO ANTHROPIC FILES API (PDF only)
  // DOCX is not supported by Anthropic Files API.
  // For DOCX, we skip the upload and return text only.
  // ═══════════════════════════════════════════════════════
  if (ext === 'docx') {
    // DOCX: text-only path — no Files API upload
    return res.status(200).json({
      fileId: null,
      filename,
      mimeType: resolvedMime,
      resumeText: extractedText,
      fallback: false
    });
  }

  // PDF: upload to Files API for rich Claude analysis + return extracted text for ATS
  const boundary = `GradLaunchBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const multipartBody = buildMultipart(boundary, filename, 'application/pdf', fileBuffer);

  try {
    const uploadRes = await httpsRequest(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/files',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': FILES_BETA,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': multipartBody.length
        },
        timeout: 25000
      },
      multipartBody
    );

    // Upload failed — fall back to text-only path
    if (uploadRes.status !== 200 && uploadRes.status !== 201) {
      console.error('Files API upload failed:', uploadRes.status,
        typeof uploadRes.body === 'object' ? uploadRes.body?.error?.message : uploadRes.body
      );
      return res.status(200).json({
        fallback: !hasGoodText,
        fileId: null,
        resumeText: extractedText,
        error: hasGoodText ? null : 'Files API unavailable — using browser parsing instead.'
      });
    }

    const fileId = uploadRes.body?.id;
    if (!fileId) {
      return res.status(200).json({
        fallback: !hasGoodText,
        fileId: null,
        resumeText: extractedText,
        error: hasGoodText ? null : 'No file ID returned — using browser parsing instead.'
      });
    }

    // ── SUCCESS: return both fileId (for Claude) AND text (for ATS) ──
    return res.status(200).json({
      fileId,
      filename,
      mimeType: 'application/pdf',
      resumeText: extractedText,
      fallback: false
    });

  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(200).json({
      fallback: !hasGoodText,
      fileId: null,
      resumeText: extractedText,
      error: hasGoodText ? null : 'Upload failed — using browser parsing instead.'
    });
  }
};

// ── EXPORTS for use in analyze.js ──
module.exports.deleteFile = deleteFile;
module.exports.normalizeResumeText = normalizeResumeText;
