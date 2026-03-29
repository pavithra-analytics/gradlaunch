const https = require('https');

// ═══════════════════════════════════════════════════════
// UPSTASH CACHE — shared with analyze.js
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
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    const res = await httpGet(`${url}/get/${encodeURIComponent(key)}`, {
      Authorization: `Bearer ${token}`
    });
    if (res && res.result !== undefined && res.result !== null) {
      try {
        return typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
      } catch { return null; }
    }
    return null;
  } catch { return null; }
}

async function upstashSet(key, value) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
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
      method: 'GET',
      headers,
      timeout: 28000
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.end();
  });
}

function httpPost(url, headers = {}, body = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 28000
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════
// SKILL KEYWORDS — extracted from job descriptions
// ═══════════════════════════════════════════════════════
const SKILL_KEYWORDS = [
  'python', 'sql', 'scala', 'java', 'javascript', 'typescript', 'r ',
  'dbt', 'airflow', 'spark', 'kafka', 'databricks', 'snowflake',
  'redshift', 'bigquery', 'postgres', 'mysql', 'mongodb',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',
  'tableau', 'power bi', 'looker', 'excel', 'dax',
  'machine learning', 'deep learning', 'nlp', 'pytorch', 'tensorflow',
  'pandas', 'numpy', 'pyspark', 'scikit-learn',
  'git', 'agile', 'scrum', 'jira',
  'statistics', 'a/b testing', 'experimentation',
  'product analytics', 'business intelligence', 'data modeling',
  'etl', 'elt', 'data pipeline', 'data warehouse', 'data lake',
  'looker studio', 'metabase', 'superset',
  'react', 'node.js', 'fastapi', 'django', 'flask',
  'streamlit', 'plotly', 'matplotlib'
];

// ═══════════════════════════════════════════════════════
// EXTRACT SKILL FREQUENCIES from job descriptions
// ═══════════════════════════════════════════════════════
function extractSkillFrequencies(items) {
  const total = items.length;
  if (!total) return [];

  const counts = {};
  for (const item of items) {
    const text = [
      item.description || '',
      item.title || '',
      item.skills || '',
      (item.requirements || []).join(' ')
    ].join(' ').toLowerCase();

    const seen = new Set(); // count each skill once per job
    for (const skill of SKILL_KEYWORDS) {
      if (!seen.has(skill) && text.includes(skill)) {
        counts[skill] = (counts[skill] || 0) + 1;
        seen.add(skill);
      }
    }
  }

  return Object.entries(counts)
    .map(([skill, count]) => ({
      skill: skill.trim(),
      pct: Math.round((count / total) * 100)
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 15);
}

// ═══════════════════════════════════════════════════════
// EXTRACT JOB LISTINGS for Find Jobs tab
// Filters to listings with usable apply URLs
// ═══════════════════════════════════════════════════════
function extractJobListings(items) {
  return items
    .map(item => {
      // Apify actor may return different URL field names
      // Try all known variants
      const url = item.jobUrl
        || item.applyUrl
        || item.url
        || item.link
        || item.jobLink
        || null;

      if (!url || !url.startsWith('http')) return null;

      return {
        title:   item.title   || item.jobTitle   || 'Job Opening',
        company: item.company || item.companyName || 'Company',
        location:item.location|| item.jobLocation || '',
        url,
        // Posted date if available — helps detect freshness
        postedAt: item.postedAt || item.publishedAt || null
      };
    })
    .filter(Boolean)
    .slice(0, 15); // cap at 15 for Find Jobs tab
}

// ═══════════════════════════════════════════════════════
// RUN APIFY SCRAPER
// Returns { skillFreq, totalJobs, jobs, fromCache }
// Always resolves — never rejects (failures return null)
// ═══════════════════════════════════════════════════════
async function runApify(role, location) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.log('APIFY_API_TOKEN not set — skipping scrape');
    return null;
  }

  const cacheKey = `apify|${role.toLowerCase().trim()}|${(location || 'usa').toLowerCase().trim()}`;

  // Check cache first
  const cached = await cacheGet(cacheKey);
  if (cached) {
    console.log(`Apify cache hit: ${cacheKey}`);
    return { ...cached, fromCache: true };
  }

  try {
    // Build LinkedIn jobs search URL
    // NOTE: If scraping returns 100 jobs instead of 40,
    // the field name may need to change from 'count' to
    // 'limit' or 'numberOfJobs' — check Apify run logs
    const query = encodeURIComponent(role);
    const loc   = encodeURIComponent(location || 'United States');
    const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${query}&location=${loc}&position=1&pageNum=0`;

    console.log(`Apify starting run for: ${role} in ${location || 'USA'}`);

    // Start actor run
    const startRes = await httpPost(
      `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs?token=${token}`,
      {},
      {
        urls: [linkedinUrl],
        count: 40,           // NOTE: verify field name on first test
        scrapeCompany: false // faster without company details
      }
    );

    const runId = startRes?.data?.id;
    if (!runId) {
      console.error('Apify: no run ID returned', JSON.stringify(startRes).substring(0, 200));
      return null;
    }

    console.log(`Apify run started: ${runId}`);

    // Poll for completion — max 25 seconds (10 × 2.5s)
    let succeeded = false;
    for (let i = 0; i < 10; i++) {
      await sleep(2500);
      try {
        const statusRes = await httpGet(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
        );
        const status = statusRes?.data?.status;
        console.log(`Apify poll ${i + 1}/10: ${status}`);
        if (status === 'SUCCEEDED') { succeeded = true; break; }
        if (status === 'FAILED' || status === 'ABORTED') {
          console.error(`Apify run ${status}`);
          return null;
        }
      } catch (e) {
        console.log(`Apify poll error: ${e.message}`);
      }
    }

    if (!succeeded) {
      console.log('Apify: timed out waiting for results');
      return null;
    }

    // Fetch results
    const items = await httpGet(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&limit=40`
    );

    if (!Array.isArray(items) || !items.length) {
      console.log('Apify: no items returned');
      return null;
    }

    console.log(`Apify: got ${items.length} job listings`);

    // Extract data
    const skillFreq  = extractSkillFrequencies(items);
    const jobs       = extractJobListings(items);
    const totalJobs  = items.length;

    const result = { skillFreq, jobs, totalJobs, role, location };

    // Cache for 24 hours
    await cacheSet(cacheKey, result);

    return { ...result, fromCache: false };

  } catch (e) {
    console.error('Apify error:', e.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════
// MAIN HANDLER
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

  if (!role) {
    return res.status(400).json({ error: 'Role is required.' });
  }

  try {
    const result = await runApify(role, location);

    // Always return 200 — Apify failure is non-critical
    // Frontend handles null gracefully (tabs stay hidden)
    if (!result) {
      return res.status(200).json({
        skillFreq:   [],
        jobs:        [],
        totalJobs:   0,
        fromCache:   false,
        unavailable: true
      });
    }

    return res.status(200).json(result);

  } catch (e) {
    console.error('Apify handler error:', e.message);
    return res.status(200).json({
      skillFreq:   [],
      jobs:        [],
      totalJobs:   0,
      fromCache:   false,
      unavailable: true
    });
  }
};

// Export for warmcache.js
module.exports.runApify = runApify;
