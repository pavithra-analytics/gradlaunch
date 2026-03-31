'use strict';
const https = require('https');

const rewriteHits = new Map();
const REWRITE_LIMIT  = 20;
const REWRITE_WINDOW = 60 * 60 * 1000;

function checkRewriteRate(ip) {
  const now    = Date.now();
  const record = rewriteHits.get(ip) || { count: 0, window: now };
  if (now - record.window > REWRITE_WINDOW) { record.count = 1; record.window = now; }
  else record.count++;
  rewriteHits.set(ip, record);
  return record.count <= REWRITE_LIMIT;
}

function callAnthropic(apiKey, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 150, messages });
    const opts = {
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey,
                 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('timeout', () => req.destroy(new Error('Rewrite timed out')));
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
  if (!checkRewriteRate(ip)) return res.status(429).json({ error: 'Too many rewrite requests. Try again in an hour.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const { bullet, role, brutalHoney, missingKeywords } = req.body || {};
  if (!bullet || !role) return res.status(400).json({ error: 'bullet and role are required.' });

  const kwHint = missingKeywords?.length
    ? `Top missing ATS keywords: ${missingKeywords.slice(0, 3).join(', ')}. Naturally work the most relevant one in if it fits what the person actually did.`
    : '';

  try {
    const data = await callAnthropic(apiKey, [{
      role: 'user',
      content: `Rewrite this resume bullet for a ${role} role.

Original: "${bullet}"
Problem: ${brutalHoney || 'Not relevant to the target role.'}
${kwHint}

Write ONE replacement bullet under 25 words. Strong verb first. ${role}-relevant outcome. Use [X] placeholders only where real numbers are missing. Output ONLY the bullet. No quotes. No explanation.`
    }]);

    const text = data?.content?.[0]?.text?.trim();
    if (!text || text.length < 10) return res.status(200).json({ rewrite: null, fallback: true });
    return res.status(200).json({ rewrite: text });
  } catch (err) {
    console.error('Rewrite error:', err.message);
    return res.status(200).json({ rewrite: null, fallback: true });
  }
};
