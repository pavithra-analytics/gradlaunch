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

  const prompt = `Write a professional cover letter for a ${role} role${locationLine}.${skillsLine}${gapsLine}${jdLine}

Requirements:
- 3 short paragraphs (opening, value proposition, closing)
- Professional but genuine tone — not corporate boilerplate
- Acknowledge one specific skill gap honestly and show growth mindset
- Under 250 words total
- Use [Your Name], [Company Name], [Date] as placeholders where needed
- Output only the cover letter text, no subject line or meta-commentary`;

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
