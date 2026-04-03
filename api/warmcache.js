const https = require('https');

// ═══════════════════════════════════════════════════════
// WARMCACHE — called weekly by GitHub Actions (Sunday 3am UTC)
// Scrapes 30 roles nationally, stores structured data in Upstash
// TTL: 8 days — survives full week between scrapes with buffer
//
// Data stored per role:
//   skillFreq  — skill name → % of postings containing it
//   salaryData — extracted salary ranges from job descriptions
//   totalJobs  — number of postings scraped
//   scrapedAt  — ISO timestamp (enables trending in V3)
//   prevFreq   — previous week's frequencies (for future trending)
// ═══════════════════════════════════════════════════════

// ── 30 pre-baked roles — covers ~90% of GradLaunch students ──
const ROLES = [
  'Data Analyst',
  'Data Engineer',
  'Data Scientist',
  'Business Analyst',
  'Software Engineer',
  'Product Manager',
  'Machine Learning Engineer',
  'Analytics Engineer',
  'Business Intelligence Analyst',
  'Financial Analyst',
  'Marketing Analyst',
  'Operations Analyst',
  'Product Analyst',
  'Strategy Analyst',
  'Quantitative Analyst',
  'UX Researcher',
  'Project Manager',
  'Program Manager',
  'Solutions Architect',
  'Data Architect',
  'AI Engineer',
  'Research Scientist',
  'Growth Analyst',
  'Revenue Operations',
  'Sales Operations',
  'Supply Chain Analyst',
  'Risk Analyst',
  'Pricing Analyst',
  'Healthcare Data Analyst',
  'Cybersecurity Analyst'
];

// ═══════════════════════════════════════════════════════
// SKILL KEYWORDS — what we scan for in job descriptions
//
// Expanded in Chunk 1 to cover product, business, UX, marketing,
// and research roles that the original engineering-heavy list missed.
// These additions fix "Python 98%" for Product Analyst by giving the
// scraper the right vocabulary for non-engineering roles.
// ═══════════════════════════════════════════════════════
const SKILL_KEYWORDS = [
  // ── Core programming & query ──
  'python', 'sql', 'scala', 'java', 'javascript', 'typescript', 'r ',

  // ── Data engineering & pipeline ──
  'dbt', 'airflow', 'spark', 'kafka', 'databricks', 'snowflake',
  'redshift', 'bigquery', 'postgres', 'mysql', 'mongodb',
  'etl', 'elt', 'data pipeline', 'data warehouse', 'data lake',
  'data modeling', 'data architecture',

  // ── Cloud & DevOps ──
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform',

  // ── BI & visualisation ──
  'tableau', 'power bi', 'looker', 'excel', 'dax',
  'looker studio', 'metabase', 'superset', 'plotly', 'matplotlib',

  // ── ML & AI ──
  'machine learning', 'deep learning', 'nlp', 'pytorch', 'tensorflow',
  'scikit-learn', 'llm', 'generative ai', 'prompt engineering',

  // ── Python data stack ──
  'pandas', 'numpy', 'pyspark',

  // ── Web frameworks ──
  'react', 'node.js', 'fastapi', 'django', 'flask', 'streamlit',

  // ── Collaboration & project tools ──
  'git', 'jira', 'confluence', 'notion', 'asana', 'linear',

  // ── Methodology ──
  'agile', 'scrum', 'kanban', 'waterfall', 'okr',

  // ── Statistics & experimentation ──
  'statistics', 'a/b testing', 'experimentation', 'hypothesis testing',
  'regression', 'forecasting', 'cohort analysis', 'funnel analysis',
  'statistical significance',

  // ── Product & analytics tools (NEW) ──
  'mixpanel', 'amplitude', 'segment', 'heap', 'fullstory',
  'google analytics', 'firebase analytics', 'pendo', 'hotjar',
  'product analytics', 'business intelligence',

  // ── Product management (NEW) ──
  'product roadmap', 'roadmap', 'product strategy', 'go-to-market',
  'product discovery', 'customer discovery', 'user stories',
  'product requirements', 'prd', 'prioritisation', 'prioritization',
  'stakeholder management', 'cross-functional', 'feature flags',
  'product led growth', 'plg',

  // ── UX & design (NEW) ──
  'figma', 'user research', 'usability testing', 'wireframing',
  'prototyping', 'design thinking', 'ux research', 'user interviews',
  'information architecture', 'accessibility', 'sketch',

  // ── Marketing & growth (NEW) ──
  'seo', 'sem', 'paid media', 'email marketing', 'crm',
  'hubspot', 'salesforce', 'marketo', 'google ads', 'meta ads',
  'content strategy', 'brand strategy', 'marketing analytics',
  'customer acquisition', 'retention', 'churn', 'ltv', 'cac',
  'nps', 'csat', 'customer journey', 'lifecycle marketing',

  // ── Business & strategy (NEW) ──
  'financial modeling', 'financial analysis', 'budgeting', 'forecasting',
  'market research', 'competitive analysis', 'business case',
  'strategic planning', 'operations management', 'process improvement',
  'six sigma', 'lean', 'kpi', 'metrics', 'reporting',

  // ── Research & science (NEW) ──
  'survey design', 'qualitative research', 'quantitative research',
  'literature review', 'data collection', 'ethnography',

  // ── Security (for Cybersecurity Analyst role) ──
  'siem', 'soc', 'penetration testing', 'threat modeling',
  'vulnerability management', 'compliance', 'nist', 'iso 27001',
  'incident response', 'zero trust', 'endpoint detection',

  // ── Supply chain & operations (NEW) ──
  'supply chain', 'inventory management', 'procurement', 'logistics',
  'demand planning', 'erp', 'sap', 'oracle', 'tableau supply chain',

  // ── Healthcare data (NEW) ──
  'hl7', 'fhir', 'epic', 'ehr', 'hipaa', 'clinical data',
  'healthcare analytics', 'icd codes', 'medical coding'
];

// ═══════════════════════════════════════════════════════
// SALARY EXTRACTION — parse salary ranges from job descriptions
// Handles formats: $80k-$120k, $80,000-$120,000, 80k to 120k
// ═══════════════════════════════════════════════════════
function extractSalaryRanges(items) {
  const ranges = [];

  for (const item of items) {
    const text = (item.description || item.salary || '').toLowerCase();

    // Pattern: $80k-$120k or $80,000-$120,000
    const kPattern = /\$(\d+)k?\s*[-–to]+\s*\$?(\d+)k/gi;
    const fullPattern = /\$(\d{2,3}),000\s*[-–to]+\s*\$?(\d{2,3}),000/gi;

    let match;
    while ((match = kPattern.exec(text)) !== null) {
      const lo = parseInt(match[1]) * (match[1].length <= 3 ? 1000 : 1);
      const hi = parseInt(match[2]) * (match[2].length <= 3 ? 1000 : 1);
      if (lo >= 30000 && hi <= 500000 && hi > lo) ranges.push({ lo, hi });
    }
    while ((match = fullPattern.exec(text)) !== null) {
      const lo = parseInt(match[1]) * 1000;
      const hi = parseInt(match[2]) * 1000;
      if (lo >= 30000 && hi <= 500000 && hi > lo) ranges.push({ lo, hi });
    }
  }

  if (!ranges.length) return null;

  // Compute median low and high
  ranges.sort((a, b) => a.lo - b.lo);
  const mid   = Math.floor(ranges.length / 2);
  const medLo = ranges[mid].lo;
  const medHi = ranges[mid].hi;

  const fmt = n => `$${Math.round(n / 1000)}k`;
  return {
    median: `${fmt(medLo)}–${fmt(medHi)}`,
    count:  ranges.length,
    note:   `From ${ranges.length} postings with listed salary`
  };
}

// ═══════════════════════════════════════════════════════
// SKILL FREQUENCY EXTRACTION
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

    const seen = new Set();
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
      pct:   Math.round((count / total) * 100)
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 25); // top 25 skills per role (increased from 20 to match expanded keyword list)
}

// ═══════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers, timeout: 15000
    }, res => {
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
    const req  = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 15000
    }, res => {
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════
// UPSTASH HELPERS
// TTL: 691200 seconds = 8 days
// ═══════════════════════════════════════════════════════
const UPSTASH_TTL = 691200; // 8 days in seconds

async function upstashGet(key) {
  try {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    const res = await httpGet(
      `${url}/get/${encodeURIComponent(key)}`,
      { Authorization: `Bearer ${token}` }
    );
    if (res?.result != null) {
      return typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
    }
    return null;
  } catch { return null; }
}

async function upstashSet(key, value) {
  try {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return false;
    const encoded = encodeURIComponent(JSON.stringify(value));
    await httpGet(
      `${url}/set/${encodeURIComponent(key)}/${encoded}?EX=${UPSTASH_TTL}`,
      { Authorization: `Bearer ${token}` }
    );
    return true;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════
// CACHE KEY — used by analyze.js for lookup
// National data only — no location in key
// ═══════════════════════════════════════════════════════
function roleCacheKey(role) {
  return `wc|${role.toLowerCase().trim()}`;
}

// ═══════════════════════════════════════════════════════
// SCRAPE ONE ROLE
// Returns structured data or null on failure
// ═══════════════════════════════════════════════════════
async function scrapeRole(role, token) {
  const query       = encodeURIComponent(role);
  const linkedinUrl = `https://www.linkedin.com/jobs/search/?keywords=${query}&location=United+States&position=1&pageNum=0`;

  console.log(`  Scraping: ${role}`);

  // Start Apify run — request 40 jobs (Apify's maximum for this actor)
  const startRes = await httpPost(
    `https://api.apify.com/v2/acts/curious_coder~linkedin-jobs-scraper/runs?token=${token}`,
    {},
    { urls: [linkedinUrl], count: 40, scrapeCompany: false }
  );

  const runId = startRes?.data?.id;
  if (!runId) {
    console.error(`  ✗ ${role}: no run ID — ${JSON.stringify(startRes).substring(0, 100)}`);
    return null;
  }

  // Poll for completion — max 90 seconds (18 × 5s)
  // warmcache runs overnight so we can afford to wait
  let succeeded = false;
  for (let i = 0; i < 10; i++) {
    await sleep(5000);
    try {
      const s      = await httpGet(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
      const status = s?.data?.status;
      if (status === 'SUCCEEDED') { succeeded = true; break; }
      if (status === 'FAILED' || status === 'ABORTED') {
        console.error(`  ✗ ${role}: run ${status}`);
        return null;
      }
    } catch { /* continue polling */ }
  }

  if (!succeeded) {
    console.log(`  ✗ ${role}: timed out after 50s — Apify may be slow, will retry next run`);
    return null;
  }

  // Fetch results — cap at 40 (Apify actor limit)
  const items = await httpGet(
    `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&limit=40`
  );

  if (!Array.isArray(items) || !items.length) {
    console.log(`  ✗ ${role}: no items returned`);
    return null;
  }

  // ── W2: Log actual item count to verify Apify is returning 40 ──
  // If this consistently shows < 40, the actor may be throttled or
  // the LinkedIn search is returning fewer results for that role.
  // Check Vercel logs after each warmcache run to monitor.
  const actualCount = items.length;
  if (actualCount < 40) {
    console.warn(`  ⚠ ${role}: requested 40 jobs but only received ${actualCount} — Apify may be throttled or LinkedIn returned fewer results for this role`);
  } else {
    console.log(`  ✓ ${role}: received full ${actualCount} jobs from Apify`);
  }

  const skillFreq  = extractSkillFrequencies(items);
  const salaryData = extractSalaryRanges(items);
  const totalJobs  = actualCount;

  // Log the top 5 skills found so you can verify quality in Vercel logs
  const topSkills = skillFreq.slice(0, 5).map(s => `${s.skill}:${s.pct}%`).join(', ');
  console.log(`  ✓ ${role}: ${totalJobs} jobs | ${skillFreq.length} skills | top: ${topSkills}`);

  return { skillFreq, salaryData, totalJobs, scrapedAt: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════
// MAIN HANDLER
//
// Two modes:
//   GET /api/warmcache?role=Data+Analyst  → scrape one role (used by GitHub Actions loop)
//   GET /api/warmcache                    → return cache status for all 30 roles (admin check)
//
// GitHub Actions calls this 30 times in sequence, once per role.
// Each call completes in ~50s — within Vercel Hobby 60s limit.
// ═══════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.APIFY_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'APIFY_API_TOKEN not set' });

  // Parse role from query string
  const urlObj    = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const roleParam = urlObj.searchParams.get('role')?.trim();

  // ── SINGLE ROLE MODE — called by GitHub Actions loop ──
  if (roleParam) {
    const matched = ROLES.find(r => r.toLowerCase() === roleParam.toLowerCase());
    if (!matched) {
      return res.status(400).json({
        error:     `Role not found: "${roleParam}"`,
        available: ROLES
      });
    }

    const key = roleCacheKey(matched);

    // Skip if fresh (scraped within last 6 days)
    const existing = await upstashGet(key);
    if (existing?.scrapedAt) {
      const age     = Date.now() - new Date(existing.scrapedAt).getTime();
      const sixDays = 6 * 24 * 60 * 60 * 1000;
      if (age < sixDays) {
        console.log(`Warmcache skip (fresh): ${matched}`);
        return res.status(200).json({
          role:      matched,
          status:    'skipped_fresh',
          scrapedAt: existing.scrapedAt,
          ageHours:  Math.round(age / 3600000)
        });
      }
    }

    // Scrape this role
    console.log(`Warmcache scraping: ${matched}`);
    const data = await scrapeRole(matched, token);

    if (!data) {
      return res.status(200).json({ role: matched, status: 'failed' });
    }

    const prevFreq = existing?.skillFreq || null;
    const stored   = await upstashSet(key, { ...data, prevFreq });

    if (!stored) {
      return res.status(200).json({ role: matched, status: 'storage_failed' });
    }

    return res.status(200).json({
      role:      matched,
      status:    'warmed',
      jobs:      data.totalJobs,
      skills:    data.skillFreq.length,
      hasSalary: !!data.salaryData,
      scrapedAt: data.scrapedAt
    });
  }

  // ── STATUS MODE — called with no role param, returns cache status ──
  const status = [];
  for (const role of ROLES) {
    const data = await upstashGet(roleCacheKey(role));
    status.push({
      role,
      cached:    !!data,
      jobs:      data?.totalJobs        || 0,
      skills:    data?.skillFreq?.length || 0,
      hasSalary: !!data?.salaryData,
      scrapedAt: data?.scrapedAt        || null,
      ageHours:  data?.scrapedAt
        ? Math.round((Date.now() - new Date(data.scrapedAt).getTime()) / 3600000)
        : null
    });
  }

  const cached  = status.filter(s => s.cached).length;
  const missing = ROLES.length - cached;

  return res.status(200).json({
    total: ROLES.length,
    cached,
    missing,
    hint: missing > 0
      ? `Trigger GitHub Actions workflow to warm missing roles, or call /api/warmcache?role=Data+Analyst for individual roles.`
      : 'All roles cached.',
    roles: status
  });
};

// ═══════════════════════════════════════════════════════
// EXPORTS — used by analyze.js for cache lookup
// ═══════════════════════════════════════════════════════
module.exports.roleCacheKey   = roleCacheKey;
module.exports.upstashGet     = upstashGet;
module.exports.upstashSet     = upstashSet;
module.exports.ROLES          = ROLES;
module.exports.SKILL_KEYWORDS = SKILL_KEYWORDS;
