'use strict';
const https = require('https');

const clHits = new Map();
const CL_LIMIT  = 10;
const CL_WINDOW = 60 * 60 * 1000;

function checkRate(ip) {
  const now    = Date.now();
  const record = clHits.get(ip) || { count: 0, window: now };
  if (now - record.window > CL_WINDOW) { record.count = 1; record.window = now; }
  else record.count++;
  clHits.set(ip, record);
  return record.count <= CL_LIMIT;
}

function callAnthropic(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 600, messages });
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey,
                 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) },
      timeout: 20000
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) return res.status(429).json({ error: 'Too many requests. Try again later.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const { role, location, skills, gaps, jdHints } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role is required.' });

  const locationLine = location ? ` based in ${location}` : '';
  const skillsLine   = skills   ? `\nKey skills: ${skills}`    : '';
  const gapsLine     = gaps     ? `\nSkills to develop: ${gaps}` : '';
  const jdLine       = jdHints  ? `\nJob description excerpt: ${jdHints}` : '';

  const prompt = `Write a cover letter for a ${role} role${locationLine}.${skillsLine}${gapsLine}${jdLine}

GROUNDING RULES — CRITICAL:
You have been given only the role, skills, gaps, and optionally a job description excerpt above. You have NOT been given a full resume. Do not invent specific companies, project names, metrics, achievements, or experiences that were not provided. Every specific claim must come from the skills, gaps, or role information above. Where experience details are needed, write them as fill-in placeholders: [e.g. at [Company], I built X using Y]. The student will replace placeholders with their real experience before sending.

VOICE RULES — this must sound like a real person wrote it, not an AI:
FORBIDDEN words: leveraged, utilized, spearheaded, passionate, dedicated, results-driven, synergy, innovative, impactful, value-add, game-changer, proven track record, well-versed, seasoned.
FORBIDDEN sentence patterns: "not only X but also Y", "having said that", "that being said", "in today's competitive landscape", "I am a highly motivated", "I have always been passionate about", "I would love to".
Opening sentence must NOT start with "I am", "As a", "With X years of", or "I have always been". Start with a concrete action or observation tied to the role.
Vary sentence length. Short sentences land harder. Do not write three medium-length sentences in a row.

FORMAT:
- 3 short paragraphs (opening, value proposition, closing)
- Genuine tone — write like a real person talking, not a template
- Acknowledge one specific skill gap honestly and show a concrete plan to close it
- Under 250 words total
- Placeholders: [Your Name], [Company Name], [Date] — and [specific experience] where the student must fill in real details
- Output only the cover letter text, no subject line, no meta-commentary`;

  try {
    const data = await callAnthropic(apiKey, [{ role: 'user', content: prompt }]);
    const text = data?.content?.[0]?.text?.trim();
    if (!text || text.length < 50) return res.status(200).json({ letter: null, fallback: true });
    return res.status(200).json({ letter: text });
  } catch (err) {
    console.error('Cover letter error:', err.message);
    return res.status(200).json({ letter: null, fallback: true });
  }
};
