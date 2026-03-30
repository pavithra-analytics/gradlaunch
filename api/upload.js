const https = require('https');

// ── SUPPORTED MIME TYPES — PDF only (Anthropic Files API only supports PDF + plaintext) ──
// DOCX and TXT fall back to browser-side parsing in handleFile() in index.html
const MIME_TYPES = {
  'pdf': 'application/pdf'
};

// ── MAX FILE SIZE: 3MB (base64 overhead keeps us under Vercel 4.5MB body limit) ──
const MAX_FILE_SIZE = 3 * 1024 * 1024;

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
      error: `Unsupported file type .${ext} — using browser parsing instead.`
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
      error: 'File too large. Please save your resume as a compressed PDF under 3MB.',
      tooLarge: true  // frontend shows specific "too large" message
    });
  }

  // ── BUILD MULTIPART BODY ──
  const boundary = `GradLaunchBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const multipartBody = buildMultipart(boundary, filename, resolvedMime, fileBuffer);

  // ── UPLOAD TO ANTHROPIC FILES API ──
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

    // ── UPLOAD FAILED — fall back to browser parsing ──
    if (uploadRes.status !== 200 && uploadRes.status !== 201) {
      console.error('Files API upload failed:', uploadRes.status,
        typeof uploadRes.body === 'object' ? uploadRes.body?.error?.message : uploadRes.body
      );
      return res.status(200).json({
        fallback: true,
        error: 'Files API unavailable — using browser parsing instead.'
      });
    }

    const fileId = uploadRes.body?.id;
    if (!fileId) {
      return res.status(200).json({
        fallback: true,
        error: 'No file ID returned — using browser parsing instead.'
      });
    }

    // ── SUCCESS ──
    return res.status(200).json({
      fileId,
      filename,
      mimeType: resolvedMime,
      fallback: false
    });

  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(200).json({
      fallback: true,
      error: 'Upload failed — using browser parsing instead.'
    });
  }
};

// ── EXPORT deleteFile for use in analyze.js ──
module.exports.deleteFile = deleteFile;
