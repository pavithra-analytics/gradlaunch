const https = require('https');

// ── IN-MEMORY CACHE FOR WEB SEARCH (24hr TTL) ──
const searchCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function getCached(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { searchCache.delete(key); return null; }
  return entry.value;
}
function setCache(key, value) {
  searchCache.set(key, { value, ts: Date.now() });
}

// ── SALARY LOOKUP ──
const SALARY = {
  'new york':     { e:'$69k-$94k',  m:'$95k-$130k',  s:'$130k-$175k' },
  'san francisco':{ e:'$85k-$115k', m:'$115k-$155k', s:'$155k-$220k' },
  'seattle':      { e:'$78k-$105k', m:'$105k-$145k', s:'$145k-$200k' },
  'austin':       { e:'$62k-$85k',  m:'$85k-$120k',  s:'$120k-$165k' },
  'chicago':      { e:'$60k-$82k',  m:'$82k-$115k',  s:'$115k-$155k' },
  'boston':       { e:'$70k-$95k',  m:'$95k-$130k',  s:'$130k-$175k' },
  'los angeles':  { e:'$68k-$92k',  m:'$92k-$125k',  s:'$125k-$170k' },
  'dallas':       { e:'$60k-$82k',  m:'$82k-$115k',  s:'$115k-$155k' },
  'washington':   { e:'$68k-$92k',  m:'$92k-$128k',  s:'$128k-$172k' },
  'default':      { e:'$55k-$75k',  m:'$75k-$110k',  s:'$110k-$160k' }
};

// ── CERTIFICATIONS LOOKUP ──
const CERTS_DB = {
  'Google Data Analytics Certificate': { provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/data-analytics/' },
  'AWS Cloud Practitioner': { provider:'AWS', level:'Entry', cost:'$100', duration:'1 month', free:false, url:'https://aws.amazon.com/certification/certified-cloud-practitioner/' },
  'Google Project Management': { provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/project-management/' },
  'Tableau Desktop Specialist': { provider:'Tableau', level:'Associate', cost:'$250', duration:'1 month', free:false, url:'https://www.tableau.com/learn/certification/desktop-specialist' },
  'Microsoft Power BI PL-300': { provider:'Microsoft', level:'Associate', cost:'$165', duration:'2 months', free:false, url:'https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/' },
  'AWS Solutions Architect Associate': { provider:'AWS', level:'Associate', cost:'$150', duration:'2-3 months', free:false, url:'https://aws.amazon.com/certification/certified-solutions-architect-associate/' },
  'PMP': { provider:'PMI', level:'Professional', cost:'$405', duration:'3+ months', free:false, url:'https://www.pmi.org/certifications/project-management-pmp' },
  'dbt Analytics Engineering': { provider:'dbt Labs', level:'Associate', cost:'$200', duration:'1 month', free:false, url:'https://www.getdbt.com/certifications' },
  'Scrum Master PSM I': { provider:'Scrum.org', level:'Entry', cost:'$150', duration:'2 weeks', free:false, url:'https://www.scrum.org/assessments/professional-scrum-master-i-certification' },
  'CompTIA Security+': { provider:'CompTIA', level:'Associate', cost:'$370', duration:'2 months', free:false, url:'https://www.comptia.org/certifications/security' },
  'Google UX Design': { provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/ux-design/' },
  'Salesforce Admin': { provider:'Salesforce', level:'Associate', cost:'$200', duration:'2 months', free:false, url:'https://trailhead.salesforce.com/credentials/administrator' }
};

// ── DEFAULT PLAN (used when LLM truncates plan_30) ──
function defaultPlan(role) {
  return {
    weeks: [
      { label: 'Week 1', steps: [
        { action: 'Update LinkedIn headline and skills section', detail: 'Add your top skills explicitly. Recruiters and ATS systems scan for exact keywords. (30 min)', link: 'https://linkedin.com', link_label: 'Open LinkedIn' },
        { action: 'Rewrite 3 resume bullets using strong action verbs and metrics', detail: 'Use the ATS rewrites in the Resources tab as a guide. (1 hour)', link: '', link_label: '' }
      ]},
      { label: 'Week 2', steps: [
        { action: 'Apply to 10 target roles', detail: 'Focus on companies that match your background. Customize your cover letter for each. (2-3 hours)', link: 'https://linkedin.com/jobs', link_label: 'Browse jobs' },
        { action: 'Start your top recommended certification', detail: 'Even completing the first module and adding "In Progress" to LinkedIn helps. (2 hours)', link: '', link_label: '' }
      ]},
      { label: 'Week 3', steps: [
        { action: 'Practice 10 interview questions for ' + role, detail: 'Mix technical and behavioral. Use Glassdoor for company-specific questions. (1-2 hours)', link: 'https://glassdoor.com', link_label: 'Glassdoor' },
        { action: 'Reach out to 5 people at target companies on LinkedIn', detail: '"Hi, I\'m a [role] professional — would love 15 min to learn about your team." 20% response rate. (30 min)', link: '', link_label: '' }
      ]},
      { label: 'Week 4', steps: [
        { action: 'Follow up on all applications and expand your search', detail: 'Follow up on week 2 applications. Add 10 more roles. Track everything in a spreadsheet. (1 hour)', link: '', link_label: '' },
        { action: 'Complete one portfolio project or GitHub contribution', detail: 'Even a small project shows initiative. Recruiters check GitHub and portfolios. (3-4 hours)', link: 'https://github.com', link_label: 'GitHub' }
      ]}
    ],
    callout: 'Consistency beats intensity. Two focused actions per week compounds into real results over 30 days.'
  };
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch (e) {}
  try {
    const fixed = cleaned.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F\u007F]/g, ' ');
    return JSON.parse(fixed);
  } catch (e) {}
  try {
    let f = cleaned.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F\u007F]/g, ' ');
    let braces = 0, brackets = 0, inStr = false, escape = false;
    for (const ch of f) {
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inStr) { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') braces++; if (ch === '}') braces--;
      if (ch === '[') brackets++; if (ch === ']') brackets--;
    }
    f += ']'.repeat(Math.max(0, brackets)) + '}'.repeat(Math.max(0, braces));
    return JSON.parse(f);
  } catch (e) {}
  return null;
}

// ── NORMALIZE + VALIDATE — fill defaults for missing fields ──
function normalize(parsed, role, locationStr, sal, salNote, liveData, needsVisa) {
  // Core fields
  parsed.match_score = (typeof parsed.match_score === 'number')
    ? Math.min(100, Math.max(0, parsed.match_score)) : 50;

  parsed.summary = parsed.summary || {};
  parsed.summary.headline = parsed.summary.headline || (role + ' candidate — analysis complete');
  parsed.summary.description = parsed.summary.description || 'Analysis based on your resume and target role.';

  parsed.skills_present = Array.isArray(parsed.skills_present) ? parsed.skills_present.slice(0, 5) : [];
  parsed.skill_levels = parsed.skill_levels || {};
  parsed.gaps = Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 5) : [];
  parsed.priority_actions = Array.isArray(parsed.priority_actions) ? parsed.priority_actions.slice(0, 3) : [];
  parsed.trending_skills = Array.isArray(parsed.trending_skills) ? parsed.trending_skills.slice(0, 5) : [];
  parsed.top_companies = Array.isArray(parsed.top_companies) ? parsed.top_companies.slice(0, 4) : [];
  parsed.ats_rewrites = Array.isArray(parsed.ats_rewrites) ? parsed.ats_rewrites.slice(0, 2) : [];
  parsed.linkedin_headline = parsed.linkedin_headline || '';

  // Salary — always from our lookup, never from LLM
  parsed.salary = { entry: sal.e, mid: sal.m, senior: sal.s, note: salNote };

  // Certifications — match LLM picks to our DB
  const certPicks = Array.isArray(parsed.cert_picks) ? parsed.cert_picks : [];
  parsed.certifications = certPicks
    .filter(name => CERTS_DB[name])
    .map(name => ({ name, ...CERTS_DB[name], why: parsed.cert_reasons?.[name] || 'Relevant to your target role and gaps.' }))
    .slice(0, 3);

  // If fewer than 3 matched, fill from DB
  if (parsed.certifications.length < 3) {
    const used = new Set(parsed.certifications.map(c => c.name));
    for (const [name, data] of Object.entries(CERTS_DB)) {
      if (parsed.certifications.length >= 3) break;
      if (!used.has(name)) {
        parsed.certifications.push({ name, ...data, why: 'Recommended for ' + role + ' roles.' });
        used.add(name);
      }
    }
  }

  // Plan — use LLM plan or default
  if (!parsed.plan_30 || !Array.isArray(parsed.plan_30.weeks) || parsed.plan_30.weeks.length < 2) {
    parsed.plan_30 = defaultPlan(role);
  }

  // Visa fields
  if (needsVisa) {
    parsed.sponsors = Array.isArray(parsed.sponsors) ? parsed.sponsors : [];
  }

  return parsed;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const body = req.body || {};
  const resume = (body.resume || '').substring(0, 1500);
  const role = (body.role || '').substring(0, 50);
  const location = (body.location || '').substring(0, 50);
  const visa = body.visa || 'F-1 OPT';
  const needsVisa = body.needsVisa === true || body.needsVisa === 'true';
  const jd = (body.jd || '').substring(0, 800);

  if (!resume || !role) return res.status(400).json({ error: 'Resume and target role are required.' });

  const hasJD = jd.trim().length > 20;
  const locationStr = location.trim() || 'Nationwide USA';
  const isNational = !location.trim() || /^(usa|us|united states)$/i.test(location.trim());
  const locKey = Object.keys(SALARY).find(k => k !== 'default' && locationStr.toLowerCase().includes(k)) || 'default';
  const sal = SALARY[locKey];
  const salNote = isNational ? 'National averages. NYC, SF, Seattle pay 20-40% more.' : locationStr + ' market rates.';

  // ── WEB SEARCH — cached ──
  const cacheKey = role.toLowerCase().trim() + '|' + locationStr.toLowerCase() + '|' + (needsVisa ? 'visa' : 'novisa');
  let liveData = getCached(cacheKey) || '';

  if (!liveData) {
    try {
      const searchR = await httpsPost(
        'api.anthropic.com', '/v1/messages',
        { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 150,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system: 'Search and return 2 plain text sentences only. No JSON.',
          messages: [{ role: 'user', content: 'Which companies are hiring ' + role + ' in ' + locationStr + ' right now' + (needsVisa ? ' and sponsor H-1B' : '') + '? 2 sentences only.' }]
        }
      );
      if (searchR.status === 200 && Array.isArray(searchR.body.content)) {
        liveData = searchR.body.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().substring(0, 200);
        if (liveData) setCache(cacheKey, liveData);
      }
    } catch (e) { console.log('Web search skipped:', e.message); }
  }

  // ── PROMPT — LLM REASONS ONLY, no salary/cert details ──
  const certNames = Object.keys(CERTS_DB).join(', ');

  const jdSection = hasJD ? `
  "jd_breakdown": [
    {"requirement": "requirement from JD", "met": true, "note": "one sentence"},
    {"requirement": "requirement from JD", "met": false, "note": "one sentence"},
    {"requirement": "requirement from JD", "met": true, "note": "one sentence"}
  ],` : `
  "trending_skills": [
    {"skill": "trending skill", "have": false},
    {"skill": "trending skill", "have": true},
    {"skill": "trending skill", "have": false},
    {"skill": "trending skill", "have": true},
    {"skill": "trending skill", "have": false}
  ],
  "top_companies": [
    {"name": "company", "detail": "role type and openings"},
    {"name": "company", "detail": "role type"},
    {"name": "company", "detail": "role type"},
    {"name": "company", "detail": "role type"}
  ],`;

  const sponsorsSection = needsVisa ? `
  "sponsors": [
    {"name": "large company", "roles": "relevant roles", "why": "one reason", "size": "Large"},
    {"name": "large company", "roles": "relevant roles", "why": "one reason", "size": "Large"},
    {"name": "mid company",   "roles": "relevant roles", "why": "one reason", "size": "Mid"},
    {"name": "mid company",   "roles": "relevant roles", "why": "one reason", "size": "Mid"},
    {"name": "small company", "roles": "relevant roles", "why": "one reason", "size": "Small"}
  ],` : '';

  const prompt = `You are a career advisor API. Analyze this resume and return ONLY a JSON object.
Return pure JSON. No markdown. No explanation.

RESUME: ${resume}
ROLE: ${role}
LOCATION: ${locationStr}
${hasJD ? 'JOB DESCRIPTION: ' + jd : ''}
${liveData ? 'LIVE DATA: ' + liveData : ''}

CERT NAMES (pick exactly 3 most relevant to gaps, use exact names):
${certNames}

RULES:
- skills_present: exactly 5 skills from resume most relevant to ${role}
- headline: reflect actual seniority — never call experienced people graduates
- linkedin_headline: no visa status, under 220 chars
- plan: exactly 2 steps per week with specific URLs
- cert_picks: exactly 3 names from the list above
- cert_reasons: one sentence per cert explaining why it closes a gap

{
  "match_score": 0,
  "summary": {"headline": "8-12 words reflecting actual seniority", "description": "2 honest sentences"},
  "skills_present": ["skill1","skill2","skill3","skill4","skill5"],
  "skill_levels": {"skill1": "Strong"},
  "gaps": [
    {"skill": "missing skill", "priority": "High", "how_to_fix": "resource with URL"},
    {"skill": "missing skill", "priority": "Medium", "how_to_fix": "resource with URL"},
    {"skill": "missing skill", "priority": "Low", "how_to_fix": "resource with URL"}
  ],
  ${jdSection}
  "priority_actions": ["action with URL", "action with URL", "action"],
  "ats_rewrites": [
    {"original": "exact bullet from resume", "rewritten": "stronger version with metrics", "keywords_added": ["kw1","kw2"]},
    {"original": "exact bullet from resume", "rewritten": "stronger version", "keywords_added": ["kw1"]}
  ],
  "linkedin_headline": "Role | Skill1 Skill2 | Cert in progress | Company",
  "cert_picks": ["Cert Name 1", "Cert Name 2", "Cert Name 3"],
  "cert_reasons": {"Cert Name 1": "why it closes a gap", "Cert Name 2": "why", "Cert Name 3": "why"},
  ${sponsorsSection}
  "plan_30": {
    "weeks": [
      {"label": "Week 1", "steps": [
        {"action": "specific action", "detail": "how with URL and time", "link": "https://url", "link_label": "Visit"},
        {"action": "specific action", "detail": "how with time", "link": "", "link_label": ""}
      ]},
      {"label": "Week 2", "steps": [
        {"action": "specific action", "detail": "how with URL", "link": "https://url", "link_label": "Visit"},
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""}
      ]},
      {"label": "Week 3", "steps": [
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""},
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""}
      ]},
      {"label": "Week 4", "steps": [
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""},
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""}
      ]}
    ],
    "callout": "1-2 sentences about what this plan achieves"
  }
}`;

  try {
    const r = await httpsPost(
      'api.anthropic.com', '/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: 'You are a career advisor API. Return ONLY valid JSON. No markdown. No explanation.',
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: '{' }
        ]
      }
    );

    if (r.status !== 200) {
      const msg = r.body && r.body.error ? r.body.error.message : 'Analysis failed.';
      console.error('API error:', msg);
      return res.status(502).json({ error: msg });
    }

    const content = r.body && r.body.content;
    if (!Array.isArray(content)) return res.status(502).json({ error: 'Unexpected response. Please try again.' });

    const rawText = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!rawText) return res.status(502).json({ error: 'Empty response. Please try again.' });

    const parsed = extractJSON('{' + rawText);
    if (!parsed) {
      console.error('JSON parse failed. Sample:', ('{' + rawText).substring(0, 200));
      return res.status(502).json({ error: 'Analysis format error. Please try again.' });
    }

    const result = normalize(parsed, role, locationStr, sal, salNote, liveData, needsVisa);
    result.role = role;
    result.location = locationStr;
    result._live = liveData.length > 0;
    result._cached = !!getCached(cacheKey);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
