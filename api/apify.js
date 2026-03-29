const https = require('https');

// ═══════════════════════════════════════════════════════
// UPSTASH CACHE
// ═══════════════════════════════════════════════════════
const memCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function memGet(k) {
  const e = memCache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { memCache.delete(k); return null; }
  return e.v;
}
function memSet(k, v) { memCache.set(k, { v, ts: Date.now() }); }

async function upstashGet(key) {
  try {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    const res = await httpGet(`${url}/get/${encodeURIComponent(key)}`, {
      Authorization: `Bearer ${token}`
    });
    if (res && res.result != null) {
      try { return typeof res.result === 'string' ? JSON.parse(res.result) : res.result; }
      catch { return null; }
    }
    return null;
  } catch { return null; }
}

async function upstashSet(key, value) {
  try {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;
    const encoded = encodeURIComponent(JSON.stringify(value));
    await httpGet(`${url}/set/${encodeURIComponent(key)}/${encoded}?EX=86400`, {
      Authorization: `Bearer ${token}`
    });
  } catch { /* silent */ }
}

async function cacheGet(key) {
  const mem = memGet(key);
  if (mem) return mem;
  const remote = await upstashGet(key);
  if (remote) { memSet(key, remote); return remote; }
  return null;
}

async function cacheSet(key, value) {
  memSet(key, value);
  await upstashSet(key, value);
}

// ═══════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET', headers, timeout: 15000
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, headers = {}, body = {}) {
  return new Promise((resolve, reject) => {
    const u    = new URL(url);
    const data = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 15000
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════
// SKILL KEYWORDS
// ═══════════════════════════════════════════════════════
const SKILL_KEYWORDS = [
  'python','sql','scala','java','javascript','typescript','r ',
  'dbt','airflow','spark','kafka','databricks','snowflake',
  'redshift','bigquery','postgres','mysql','mongodb',
  'aws','azure','gcp','docker','kubernetes','terraform',
  'tableau','power bi','looker','excel','dax',
  'machine learning','deep learning','nlp','pytorch','tensorflow',
  'pandas','numpy','pyspark','scikit-learn',
  'git','agile','scrum','jira',
  'statistics','a/b testing','experimentation',
  'product analytics','business intelligence','data modeling',
  'etl','elt','data pipeline','data warehouse','data lake',
  'looker studio','metabase','superset',
  'react','node.js','fastapi','django','flask',
  'streamlit','plotly','matplotlib'
];

function extractSkillFrequencies(items) {
  const total = items.length;
  if (!total) return [];
  const counts = {};
  for (const item of items) {
    const text = [item.description||'', item.title||'', item.skills||'',
      (item.requirements||[]).join(' ')].join(' ').toLowerCase();
    const seen = new Set();
    for (const skill of SKILL_KEYWORDS) {
      if (!seen.has(skill) && text.includes(skill)) {
        counts[skill] = (counts[skill] || 0) + 1;
        seen.add(skill);
      }
    }
  }
  return Object.entries(counts)
    .map(([skill, count]) => ({ skill: skill.trim(), pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 15);
}

function extractJobListings(items) {
  return items.map(item => {
    const url = item.jobUrl || item.applyUrl || item.url || item.link || item.jobLink || null;
    if (!url || !url.startsWith('http')) return null;
    return {
      title:    item.title    || item.jobTitle    || 'Job Opening',
      company:  item.company  || item.companyName || 'Company',
      location: item.location || item.jobLocation || '',
      url,
      postedAt: item.postedAt || item.publishedAt || null
    };
  }).filter(Boolean).slice(0, 15);
}

// ═══════════════════════════════════════════════════════
// CACHE KEY HELPER — shared with apifypoll.js
// ═══════════════════════════════════════════════════════
function cacheKey(role, location) {
  return `apify|${role.toLowerCase().trim()}|${(location||'usa').toLowerCase().trim()}`;
}

// ═══════════════════════════════════════════════════════
// MAIN HANDLER
// Checks cache first — if hit, returns immediately.
// If miss, starts Apify run and returns runId to frontend.
// Frontend polls /api/apifypoll for completion.
// ═══════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body     = req.body || {};
  const role     = (body.role     || '').substring(0, 50).trim();
  const location = (body.location || '').substring(0, 50).trim();

  if (!role) return res.status(400).json({ error: 'Role is required.' });

  const token = process.env.APIFY_API_TOKEN;

  // ── CACHE HIT — return immediately, no Apify call needed ──
  const key    = cacheKey(role, location);
  const cached = await cacheGet(key);
  if (cached) {
    console.log(`Apify cache hit: ${key}`);
    return res.status(200).json({ ...cached, fromCache: true });
  }

  // ── CACHE MISS — start Apify run, return runId immediately ──
  if (!token) {
    console.log('APIFY_API_TOKEN not set');
    return res.status(200).json({ unavailable: true });
  }

  try {
    const query      = encodeURIComponent(role);
    const loc        = encodeURIComponent(location || 'United States');
    const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${query}&location=${loc}&position=1&pageNum=0`;

    console.log(`Apify starting run: ${role} in ${location || 'USA'}`);

    const startRes = await httpPost(
      `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs?token=${token}`,
      {},
      {
        // NOTE: field name verified from error — actor uses 'urls' not 'startUrls'
        urls:          [linkedinUrl],
        count:         20,
        scrapeCompany: false
      }
    );

    const runId = startRes?.data?.id;
    if (!runId) {
      console.error('Apify: no run ID', JSON.stringify(startRes).substring(0, 200));
      return res.status(200).json({ unavailable: true });
    }

    console.log(`Apify run started: ${runId}`);

    // Return runId immediately — frontend polls apifypoll.js for status
    // This function completes in ~2 seconds, well within Vercel limits
    return res.status(200).json({
      runId,
      pending:  true,
      cacheKey: key
    });

  } catch (e) {
    console.error('Apify start error:', e.message);
    return res.status(200).json({ unavailable: true });
  }
};

// ── EXPORTS for warmcache.js and apifypoll.js ──
module.exports.cacheKey            = cacheKey;
module.exports.cacheGet            = cacheGet;
module.exports.cacheSet            = cacheSet;
module.exports.extractSkillFrequencies = extractSkillFrequencies;
module.exports.extractJobListings  = extractJobListings;
module.exports.httpGet             = httpGet;
