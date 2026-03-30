'use strict';
const https        = require('https');
const { deleteFile }              = require('./upload');
const { roleCacheKey, upstashGet, ROLES } = require('./warmcache');

// ═══════════════════════════════════════════════════════
// RATE LIMITER — 5 per IP per rolling hour
// ═══════════════════════════════════════════════════════
const ipHits = new Map();

function getRateStatus(ip) {
  const now    = Date.now();
  const window = 60 * 60 * 1000;
  const hits   = (ipHits.get(ip) || []).filter(t => now - t < window);
  return {
    limited:   hits.length >= 5,
    remaining: Math.max(0, 5 - hits.length),
    resetAt:   hits.length >= 5 ? new Date(hits[0] + window).toISOString() : null
  };
}

function recordHit(ip) {
  const now    = Date.now();
  const window = 60 * 60 * 1000;
  const hits   = (ipHits.get(ip) || []).filter(t => now - t < window);
  hits.push(now);
  ipHits.set(ip, hits);
}

// ═══════════════════════════════════════════════════════
// FUZZY ROLE MATCH
// ═══════════════════════════════════════════════════════
const STRIP_WORDS = [
  'senior','sr','junior','jr','lead','principal','staff',
  'associate','manager','director','vp','vice president',
  'head of','intern','contract','contractor','remote','i','ii','iii','iv'
];

function fuzzyMatchRole(searchRole) {
  if (!searchRole) return null;
  let normalized = searchRole.toLowerCase().trim();
  for (const w of STRIP_WORDS) {
    normalized = normalized.replace(new RegExp(`\\b${w}\\b`, 'gi'), '').trim();
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();

  const exact = ROLES.find(r => r.toLowerCase() === normalized);
  if (exact) return exact;

  const sub = ROLES.find(r => {
    const rl = r.toLowerCase();
    return normalized.includes(rl) || rl.includes(normalized);
  });
  if (sub) return sub;

  const searchWords = new Set(normalized.split(' ').filter(w => w.length > 2));
  let best = null, bestScore = 0;
  for (const role of ROLES) {
    const roleWords = role.toLowerCase().split(' ');
    const overlap   = roleWords.filter(w => searchWords.has(w)).length;
    if (overlap > bestScore) { bestScore = overlap; best = role; }
  }
  return bestScore > 0 ? best : null;
}

// ═══════════════════════════════════════════════════════
// EXTRACT ROLE FROM JD
// Reads first 5 lines, tries labelled patterns then
// fuzzy-matches each line to the 30 pre-baked roles.
// ═══════════════════════════════════════════════════════
function extractRoleFromJD(jd) {
  if (!jd || jd.trim().length < 50) return null;

  const lines = jd.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 5);

  const patterns = [
    /^(?:job\s+title|position|role|title)\s*[:]\s*(.+)$/i,
    /^we(?:'re| are) hiring\s+(?:a\s+)?(.+)$/i,
    /^(?:about the role|the role)\s*[:]\s*(.+)$/i,
  ];

  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m && m[1]) {
        const matched = fuzzyMatchRole(m[1].trim());
        if (matched) return { role: m[1].trim(), matched };
      }
    }
  }

  for (const line of lines) {
    if (line.length > 4 && line.length < 80 && !/http|www|@/.test(line)) {
      const matched = fuzzyMatchRole(line);
      if (matched) return { role: line, matched };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════
// SALARY LOOKUP — BLS fallback
// ═══════════════════════════════════════════════════════
const SALARY = {
  'new york':      { e: '$69k', m: '$112k', s: '$175k' },
  'san francisco': { e: '$85k', m: '$135k', s: '$220k' },
  'seattle':       { e: '$78k', m: '$125k', s: '$200k' },
  'austin':        { e: '$62k', m: '$102k', s: '$165k' },
  'chicago':       { e: '$60k', m: '$98k',  s: '$155k' },
  'boston':        { e: '$70k', m: '$112k', s: '$175k' },
  'los angeles':   { e: '$68k', m: '$108k', s: '$170k' },
  'dallas':        { e: '$60k', m: '$98k',  s: '$155k' },
  'washington':    { e: '$68k', m: '$110k', s: '$172k' },
  'atlanta':       { e: '$58k', m: '$96k',  s: '$155k' },
  'denver':        { e: '$62k', m: '$101k', s: '$160k' },
  'default':       { e: '$55k', m: '$92k',  s: '$160k' }
};

// ═══════════════════════════════════════════════════════
// CERTIFICATIONS DB — expanded with roles mapping
// ═══════════════════════════════════════════════════════
const CERTS_DB = {
  'Google Data Analytics Certificate':  { provider: 'Google/Coursera', level: 'Entry',        cost: 'Free', duration: '6 months',   url: 'https://grow.google/certificates/data-analytics/',            roles: ['Data Analyst','Business Analyst','Marketing Analyst','Operations Analyst','Healthcare Data Analyst'] },
  'Google Advanced Data Analytics':     { provider: 'Google/Coursera', level: 'Intermediate', cost: 'Free', duration: '6 months',   url: 'https://grow.google/certificates/advanced-data-analytics/',   roles: ['Data Analyst','Data Scientist','Business Analyst','Product Analyst'] },
  'Meta Data Analyst Certificate':      { provider: 'Meta/Coursera',   level: 'Entry',        cost: 'Free', duration: '5 months',   url: 'https://www.coursera.org/professional-certificates/meta-data-analyst', roles: ['Data Analyst','Marketing Analyst','Product Analyst','Growth Analyst'] },
  'Microsoft Power BI PL-300':          { provider: 'Microsoft',       level: 'Associate',    cost: '$165', duration: '2 months',   url: 'https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/', roles: ['Business Intelligence Analyst','Data Analyst','Business Analyst','Financial Analyst'] },
  'Tableau Desktop Specialist':         { provider: 'Tableau',         level: 'Associate',    cost: '$250', duration: '1 month',    url: 'https://www.tableau.com/learn/certification/desktop-specialist', roles: ['Data Analyst','Business Intelligence Analyst','Marketing Analyst','Operations Analyst'] },
  'dbt Analytics Engineering':          { provider: 'dbt Labs',        level: 'Associate',    cost: '$200', duration: '1 month',    url: 'https://www.getdbt.com/certifications',                       roles: ['Analytics Engineer','Data Engineer','Data Analyst'] },
  'Databricks Data Engineer Associate': { provider: 'Databricks',      level: 'Associate',    cost: '$200', duration: '1-2 months', url: 'https://www.databricks.com/learn/certification/data-engineer-associate', roles: ['Data Engineer','Analytics Engineer','Data Architect'] },
  'Snowflake SnowPro Core':             { provider: 'Snowflake',       level: 'Associate',    cost: '$175', duration: '1 month',    url: 'https://learn.snowflake.com/en/certifications/snowpro-core/', roles: ['Data Engineer','Analytics Engineer','Data Architect','Data Analyst'] },
  'Google Cloud Professional DE':       { provider: 'Google Cloud',    level: 'Professional', cost: '$200', duration: '2-3 months', url: 'https://cloud.google.com/learn/certification/data-engineer',  roles: ['Data Engineer','Data Architect','Solutions Architect'] },
  'AWS Solutions Architect Associate':  { provider: 'AWS',             level: 'Associate',    cost: '$150', duration: '2-3 months', url: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/', roles: ['Solutions Architect','Data Architect','Software Engineer','AI Engineer'] },
  'AWS Cloud Practitioner':             { provider: 'AWS',             level: 'Entry',        cost: '$100', duration: '1 month',    url: 'https://aws.amazon.com/certification/certified-cloud-practitioner/', roles: ['Software Engineer','Data Engineer','Solutions Architect','AI Engineer'] },
  'CompTIA Security+':                  { provider: 'CompTIA',         level: 'Associate',    cost: '$370', duration: '2 months',   url: 'https://www.comptia.org/certifications/security',             roles: ['Cybersecurity Analyst'] },
  'Professional Scrum Product Owner I': { provider: 'Scrum.org',       level: 'Entry',        cost: '$200', duration: '2 weeks',    url: 'https://www.scrum.org/assessments/professional-scrum-product-owner-i-certification', roles: ['Product Manager','Product Analyst','Program Manager','Project Manager'] },
  'Scrum Master PSM I':                 { provider: 'Scrum.org',       level: 'Entry',        cost: '$150', duration: '2 weeks',    url: 'https://www.scrum.org/assessments/professional-scrum-master-i-certification', roles: ['Project Manager','Program Manager','Product Manager','Operations Analyst'] },
  'Google Project Management':          { provider: 'Google/Coursera', level: 'Entry',        cost: 'Free', duration: '6 months',   url: 'https://grow.google/certificates/project-management/',        roles: ['Project Manager','Program Manager','Operations Analyst','Business Analyst'] },
  'PMP':                                { provider: 'PMI',             level: 'Professional', cost: '$405', duration: '3+ months',  url: 'https://www.pmi.org/certifications/project-management-pmp',  roles: ['Project Manager','Program Manager','Operations Analyst'] },
  'CAPM':                               { provider: 'PMI',             level: 'Entry',        cost: '$225', duration: '2 months',   url: 'https://www.pmi.org/certifications/certified-associate-capm', roles: ['Project Manager','Program Manager','Business Analyst'] },
  'Amplitude Analytics Certification':  { provider: 'Amplitude',       level: 'Entry',        cost: 'Free', duration: '2 weeks',    url: 'https://academy.amplitude.com/amplitude-analytics-for-digital-products', roles: ['Product Analyst','Growth Analyst','Product Manager','Marketing Analyst'] },
  'Google Analytics Individual Qual':   { provider: 'Google',          level: 'Entry',        cost: 'Free', duration: '2 weeks',    url: 'https://skillshop.withgoogle.com/intl/en_ALL/lp/googleanalytics', roles: ['Marketing Analyst','Growth Analyst','Product Analyst','Strategy Analyst'] },
  'Salesforce Admin':                   { provider: 'Salesforce',      level: 'Associate',    cost: '$200', duration: '2 months',   url: 'https://trailhead.salesforce.com/credentials/administrator',  roles: ['Revenue Operations','Sales Operations','Business Analyst'] },
  'Google UX Design':                   { provider: 'Google/Coursera', level: 'Entry',        cost: 'Free', duration: '6 months',   url: 'https://grow.google/certificates/ux-design/',                roles: ['UX Researcher','Product Manager','Product Analyst'] },
  'CFA Level I':                        { provider: 'CFA Institute',   level: 'Professional', cost: '$900', duration: '6+ months',  url: 'https://www.cfainstitute.org/programs/cfa',                   roles: ['Financial Analyst','Quantitative Analyst','Risk Analyst','Pricing Analyst'] },
  'Financial Modeling and Valuation':   { provider: 'CFI',             level: 'Entry',        cost: '$497', duration: '3 months',   url: 'https://corporatefinanceinstitute.com/certifications/financial-modeling-valuation-analyst-fmva-certification/', roles: ['Financial Analyst','Strategy Analyst','Pricing Analyst'] }
};

const ROLE_CERT_PRIORITY = {
  'Product Analyst':               ['Amplitude Analytics Certification','Professional Scrum Product Owner I','Google Analytics Individual Qual','Google Advanced Data Analytics','Meta Data Analyst Certificate'],
  'Product Manager':               ['Professional Scrum Product Owner I','Amplitude Analytics Certification','Google Project Management','Google UX Design','Scrum Master PSM I'],
  'Marketing Analyst':             ['Google Analytics Individual Qual','Meta Data Analyst Certificate','Google Data Analytics Certificate','Tableau Desktop Specialist','Microsoft Power BI PL-300'],
  'Growth Analyst':                ['Google Analytics Individual Qual','Amplitude Analytics Certification','Meta Data Analyst Certificate','Google Advanced Data Analytics','Google Data Analytics Certificate'],
  'UX Researcher':                 ['Google UX Design','Google Project Management','Professional Scrum Product Owner I','Google Analytics Individual Qual','Amplitude Analytics Certification'],
  'Business Analyst':              ['Google Data Analytics Certificate','Google Project Management','Microsoft Power BI PL-300','CAPM','Tableau Desktop Specialist'],
  'Strategy Analyst':              ['Google Advanced Data Analytics','Financial Modeling and Valuation','Google Data Analytics Certificate','Microsoft Power BI PL-300','CAPM'],
  'Financial Analyst':             ['CFA Level I','Financial Modeling and Valuation','Google Advanced Data Analytics','Microsoft Power BI PL-300','Google Data Analytics Certificate'],
  'Quantitative Analyst':          ['CFA Level I','Financial Modeling and Valuation','Google Advanced Data Analytics','Databricks Data Engineer Associate','Google Data Analytics Certificate'],
  'Risk Analyst':                  ['CFA Level I','Financial Modeling and Valuation','Google Advanced Data Analytics','CompTIA Security+','Microsoft Power BI PL-300'],
  'Pricing Analyst':               ['Financial Modeling and Valuation','CFA Level I','Google Advanced Data Analytics','Google Data Analytics Certificate','Microsoft Power BI PL-300'],
  'Data Analyst':                  ['Google Advanced Data Analytics','Tableau Desktop Specialist','Microsoft Power BI PL-300','dbt Analytics Engineering','Snowflake SnowPro Core'],
  'Business Intelligence Analyst': ['Microsoft Power BI PL-300','Tableau Desktop Specialist','Google Advanced Data Analytics','dbt Analytics Engineering','Snowflake SnowPro Core'],
  'Analytics Engineer':            ['dbt Analytics Engineering','Snowflake SnowPro Core','Databricks Data Engineer Associate','Google Advanced Data Analytics','Google Cloud Professional DE'],
  'Data Engineer':                 ['Databricks Data Engineer Associate','Snowflake SnowPro Core','dbt Analytics Engineering','Google Cloud Professional DE','AWS Solutions Architect Associate'],
  'Data Scientist':                ['Google Advanced Data Analytics','Databricks Data Engineer Associate','Google Cloud Professional DE','dbt Analytics Engineering','Snowflake SnowPro Core'],
  'Data Architect':                ['Google Cloud Professional DE','Databricks Data Engineer Associate','Snowflake SnowPro Core','AWS Solutions Architect Associate','dbt Analytics Engineering'],
  'Machine Learning Engineer':     ['Databricks Data Engineer Associate','Google Cloud Professional DE','AWS Solutions Architect Associate','dbt Analytics Engineering','Snowflake SnowPro Core'],
  'AI Engineer':                   ['Google Cloud Professional DE','AWS Solutions Architect Associate','Databricks Data Engineer Associate','dbt Analytics Engineering','Snowflake SnowPro Core'],
  'Software Engineer':             ['AWS Solutions Architect Associate','AWS Cloud Practitioner','Google Cloud Professional DE','Scrum Master PSM I','CompTIA Security+'],
  'Solutions Architect':           ['AWS Solutions Architect Associate','Google Cloud Professional DE','AWS Cloud Practitioner','Databricks Data Engineer Associate','Scrum Master PSM I'],
  'Project Manager':               ['PMP','Google Project Management','Scrum Master PSM I','CAPM','Professional Scrum Product Owner I'],
  'Program Manager':               ['PMP','Google Project Management','Scrum Master PSM I','CAPM','Professional Scrum Product Owner I'],
  'Operations Analyst':            ['Google Project Management','Scrum Master PSM I','Google Data Analytics Certificate','Microsoft Power BI PL-300','CAPM'],
  'Revenue Operations':            ['Salesforce Admin','Google Analytics Individual Qual','Google Data Analytics Certificate','Microsoft Power BI PL-300','Amplitude Analytics Certification'],
  'Sales Operations':              ['Salesforce Admin','Google Analytics Individual Qual','Google Data Analytics Certificate','Microsoft Power BI PL-300','Amplitude Analytics Certification'],
  'Supply Chain Analyst':          ['Google Project Management','Google Data Analytics Certificate','Microsoft Power BI PL-300','PMP','Tableau Desktop Specialist'],
  'Research Scientist':            ['Google Advanced Data Analytics','Databricks Data Engineer Associate','Google Cloud Professional DE','Google Data Analytics Certificate','Financial Modeling and Valuation'],
  'Healthcare Data Analyst':       ['Google Data Analytics Certificate','Google Advanced Data Analytics','Microsoft Power BI PL-300','Tableau Desktop Specialist','Databricks Data Engineer Associate'],
  'Cybersecurity Analyst':         ['CompTIA Security+','AWS Cloud Practitioner','Google Cloud Professional DE','AWS Solutions Architect Associate','Scrum Master PSM I']
};

const CERT_NAMES = Object.keys(CERTS_DB).join(', ');

// ═══════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 55000
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════
// NORMALIZE HELPERS
// ═══════════════════════════════════════════════════════
function normalizeCerts(certPicks, certReasons, role) {
  const validPicks = (certPicks || []).filter(n => CERTS_DB[n]);
  const certs = validPicks.slice(0, 3)
    .map(n => ({ name: n, ...CERTS_DB[n], why: certReasons?.[n] || 'Closes your top gap.' }));

  if (certs.length < 3) {
    const used        = new Set(certs.map(c => c.name));
    const matchedRole = fuzzyMatchRole(role) || role;
    const priority    = ROLE_CERT_PRIORITY[matchedRole] || [];

    for (const name of priority) {
      if (certs.length >= 3) break;
      if (!used.has(name) && CERTS_DB[name]) {
        certs.push({ name, ...CERTS_DB[name], why: `Commonly required for ${matchedRole} roles.` });
        used.add(name);
      }
    }

    if (certs.length < 3) {
      for (const [name, d] of Object.entries(CERTS_DB)) {
        if (certs.length >= 3) break;
        const firstWord = (matchedRole || '').toLowerCase().split(' ')[0];
        if (!used.has(name) && (d.roles || []).some(r => r.toLowerCase().includes(firstWord))) {
          certs.push({ name, ...d, why: `Relevant for ${matchedRole} roles.` });
          used.add(name);
        }
      }
    }
  }

  return certs;
}

function sanitizeLinkedIn(headline) {
  return (headline || '')
    .replace(/\b(F-1|H-1B|STEM OPT|OPT|visa|work authorization|EAD|green card|permanent resident|open to work|seeking|looking for opportunities)\b/gi, '')
    .replace(/\s{2,}/g, ' ').replace(/\|\s*\|/g, '|')
    .replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').trim();
}

function clamp(val, min, max) {
  const n = typeof val === 'number' ? val : parseFloat(val);
  if (isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// ═══════════════════════════════════════════════════════
// SSE HELPER
// ═══════════════════════════════════════════════════════
function sendEvent(res, eventName, data) {
  try { res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`); }
  catch { /* client disconnected */ }
}

// ═══════════════════════════════════════════════════════
// STREAM A TOOLS — Haiku (fast structured data)
// Verdict, skills, gaps, scores, bullet groups, JD breakdown
// ═══════════════════════════════════════════════════════
const TOOLS_A = [
  {
    name: 'set_verdict',
    description: 'Set the overall verdict. Call FIRST.',
    input_schema: {
      type: 'object',
      properties: {
        match_score:         { type: 'number',  description: '0-100 match score based on skills in resume vs market data requirements' },
        verdict_headline:    { type: 'string',  description: 'ONE quotable sentence. Must name something SPECIFIC from this resume — a company, a tool, a gap, a number. Never generic. No dashes or em-dashes.' },
        verdict_sub:         { type: 'string',  description: 'ONE sentence: the single most important thing this person needs to change or know right now.' },
        ats_pass_rate:       { type: 'number',  description: 'Current ATS pass rate 0-100 based on keyword match vs market data' },
        ats_potential:       { type: 'number',  description: 'ATS pass rate after adding the missing keywords 0-100' },
        ats_missing_keyword: { type: 'string',  description: 'Single most impactful missing keyword for this role from market data' }
      },
      required: ['match_score','verdict_headline','verdict_sub','ats_pass_rate','ats_potential','ats_missing_keyword']
    }
  },
  {
    name: 'set_skills',
    description: 'Set skills present in resume with market data relevance percentages.',
    input_schema: {
      type: 'object',
      properties: {
        skills_present:  { type: 'array',  items: { type: 'string' }, description: 'Up to 6 skills most relevant to target role found in the resume' },
        skill_levels:    { type: 'object', additionalProperties: { type: 'string' }, description: 'Map skill to Strong, Intermediate, or Basic based on how the resume presents it' },
        skill_relevance: {
          type: 'object',
          additionalProperties: { type: 'number' },
          description: 'Map skill to percentage 0-100 from market data showing how often this skill appears in target role postings. Use EXACT numbers from market data. This is posting frequency, NOT user proficiency. If SQL appears in 82% of postings, output 82. If skill not in market data, estimate conservatively with a max of 55.'
        }
      },
      required: ['skills_present','skill_levels','skill_relevance']
    }
  },
  {
    name: 'set_gaps',
    description: 'Set skill gaps using EXACT percentages from market data.',
    input_schema: {
      type: 'object',
      properties: {
        gaps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              skill:      { type: 'string' },
              priority:   { type: 'string', enum: ['Critical','Important','Nice to have'] },
              how_often:  { type: 'number', description: 'EXACT % from market data. If skill not in market data, estimate conservatively.' },
              how_to_fix: { type: 'string', description: 'Specific resource, course, or action with URL if possible.' }
            },
            required: ['skill','priority','how_often','how_to_fix']
          },
          maxItems: 5
        }
      },
      required: ['gaps']
    }
  },
  {
    name: 'set_scores',
    description: 'Set resume quality scores and the headline roast.',
    input_schema: {
      type: 'object',
      properties: {
        bullet_quality: { type: 'number', description: '0-10: strength and specificity of resume bullets overall' },
        impact_metrics: { type: 'number', description: '0-10: presence of quantified outcomes and measurable results' },
        ats_alignment:  { type: 'number', description: '0-10: keyword alignment with target role from market data' },
        headline_roast: { type: 'string', description: 'ONE punchy sentence naming something specific from their actual resume. No dashes. Sounds like a person said it out loud, not a system.' }
      },
      required: ['bullet_quality','impact_metrics','ats_alignment','headline_roast']
    }
  },
  {
    name: 'add_bullet_group',
    description: 'Add one company of resume bullets. Call once per company.',
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        role:    { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text:         { type: 'string' },
              status:       { type: 'string', enum: ['green','red'] },
              tags:         { type: 'array', items: { type: 'string', enum: ['Missing Metric','Passive Voice','No Impact Statement','Vague Action Verb','Strong','Impact Validated','Quantified'] } },
              brutal_honey: { type: 'string', description: 'Red only. MAX 3 SENTENCES. No dashes. Sentence 1: why a recruiter skips this exact bullet. Sentence 2: what is salvageable. Sentence 3: direction for the rewrite. Human voice.' },
              rewrite:      { type: 'string', description: 'Red only. ONE sentence under 25 words. Strong action verb first. Most relevant ATS keyword from market data. Use [X][Y][Z] only where numbers are genuinely missing. Self-check: strong verb? ATS keyword present? Under 25 words? Revise once if any check fails.' }
            },
            required: ['text','status','tags','brutal_honey','rewrite']
          }
        }
      },
      required: ['company','role','items']
    }
  },
  {
    name: 'set_jd_breakdown',
    description: 'Only call if a job description was provided.',
    input_schema: {
      type: 'object',
      properties: {
        jd_breakdown: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              requirement: { type: 'string' },
              met:         { type: 'boolean' },
              note:        { type: 'string' }
            },
            required: ['requirement','met','note']
          }
        }
      },
      required: ['jd_breakdown']
    }
  }
];

// ═══════════════════════════════════════════════════════
// STREAM B TOOLS — Sonnet (qualitative writing)
// LinkedIn, certifications, projects
// ═══════════════════════════════════════════════════════
const TOOLS_B = [
  {
    name: 'set_linkedin',
    description: 'Set LinkedIn optimization. Quality is everything here — this must not read like AI output.',
    input_schema: {
      type: 'object',
      properties: {
        linkedin_headline: {
          type: 'string',
          description: 'Format: [Core identity] | [Strongest specific tool or domain] | [What you deliver for the business]. Under 160 chars. Zero status language. Must name a specific tool or method from the resume. Example: Product Analyst | Mixpanel and SQL | Translating user behaviour into decisions that move revenue.'
        },
        linkedin_about: {
          type: 'string',
          description: 'Exactly 3 sentences. SENTENCE 1: Name one specific thing you built or solved from this resume, include the tool you used and a result with a number if one exists. SENTENCE 2: The 2-3 skills most demanded for this role from market data, written as what you do well not a list. SENTENCE 3: What kind of problem you want to work on next, stated as a capability not a job title. FORBIDDEN OPENERS: I am a, As a, With X years, Passionate about, Dedicated professional, Results-driven. Must sound like a smart person wrote it themselves.'
        },
        linkedin_skills: {
          type: 'array',
          items: { type: 'string' },
          minItems: 5,
          maxItems: 5,
          description: 'Exactly 5 skills. ALL 5 must appear in the top 10 of market data skill frequency for this role AND be absent or underrepresented in the resume. Do not suggest skills the user already demonstrates. Do not suggest skills outside the market data top list.'
        }
      },
      required: ['linkedin_headline','linkedin_about','linkedin_skills']
    }
  },
  {
    name: 'set_certifications',
    description: 'Pick exactly 3 certs from the provided list. Must be role-relevant and gap-closing based on market data.',
    input_schema: {
      type: 'object',
      properties: {
        cert_picks: {
          type: 'array',
          items: { type: 'string' },
          minItems: 3,
          maxItems: 3,
          description: 'Pick 3 from the AVAILABLE CERTIFICATIONS list only. Priority: certs addressing skills at high frequency in market data that are missing from the resume. Never pick a cert for a skill the user already demonstrates well.'
        },
        cert_reasons: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Map cert name to one specific sentence explaining which gap it closes and why that matters. Reference the market data percentage. Example: SQL appears in 78% of Product Analyst postings and your resume shows no SQL projects — this cert gives you a structured 6-week path to close that.'
        }
      },
      required: ['cert_picks','cert_reasons']
    }
  },
  {
    name: 'set_projects',
    description: 'Set 3 projects. CRITICAL: ALL THREE must have identical depth. Project 3 ai_prompt must be as long and specific as project 1.',
    input_schema: {
      type: 'object',
      properties: {
        projects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              market_signal: { type: 'number', description: 'EXACT % from market data for the primary skill this project builds. Never invent a number.' },
              title:         { type: 'string', description: 'Specific title naming the actual tech and deliverable. Not Data Dashboard but Customer Churn Prediction Dashboard using Python and Streamlit.' },
              justification: { type: 'string', description: 'One sentence referencing the exact market data % for the skill this builds and why it matters for this specific resume.' },
              description:   { type: 'string', description: 'Two sentences. Sentence 1: name the specific free API or public dataset they will use. Sentence 2: name the exact tool stack and what the final deliverable looks like visually.' },
              skills:        { type: 'array', items: { type: 'string' }, description: '3-5 specific skills this project builds. Use exact market data skill names.' },
              time_hours:    { type: 'number' },
              ai_prompt:     {
                type: 'string',
                description: 'A complete 3-phase AI prompt the student can paste into Claude or ChatGPT. Must follow this EXACT structure for ALL THREE projects: Start with Act as a senior [specific role matching tech stack]. We are building [exact project title] together from scratch using [specific free API or dataset] and [exact tool stack]. The final output will be [specific visual description of deliverable]. PHASE 1: Ask me 2 specific questions about what this should do and who will use it. Say next phase when ready. PHASE 2: Show me the exact folder structure, every file name, and every function as a stub with inputs and outputs. Get my approval before writing implementation code. Say next phase when ready. PHASE 3: Build one function at a time starting with data fetching. Show actual output after each function. Never move to the next function until the current one works. Under 220 words. No dashes. This exact quality and length is required for project 1, 2, AND 3.'
              },
              bullets: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 2,
                description: 'Two resume bullets assuming project complete. Strong action verb. Metric placeholders [X] [Y] [Z]. Include the most in-demand ATS keyword for this role from market data. Under 20 words each.'
              }
            },
            required: ['market_signal','title','justification','description','skills','time_hours','ai_prompt','bullets']
          },
          minItems: 3,
          maxItems: 3
        }
      },
      required: ['projects']
    }
  }
];

// ═══════════════════════════════════════════════════════
// SYSTEM PROMPTS — with prompt caching
// ═══════════════════════════════════════════════════════
function buildSystemPromptA() {
  return [
    {
      type: 'text',
      text: `You are GradLaunch, a brutally honest career advisor for students navigating the US job market. You are the brilliant, slightly sarcastic senior friend who works in recruiting and genuinely wants them to win.

YOUR VOICE:
Direct and specific. Always reference THIS resume, THIS role, THIS person's actual experience.
Slightly sarcastic but never mean. Uncomfortable truths delivered with immediate actionable direction.
Sound like a human talking out loud. Never like a product, a report, or a career coach.
This student likely comes from a non-target school. Impostor syndrome is real. Honest but never discouraging.

CRITICAL RULES:
NEVER use dashes, em-dashes, or en-dashes in output text.
NEVER use bullet points inside brutal_honey or verdict fields. Flowing sentences only.
NEVER start with Additionally, Furthermore, Moreover, or Overall.
NEVER use: results-driven, passionate about, seeking opportunities, team player, synergy, leveraged, utilized, or any visa language.

MARKET DATA IS LAW:
skill_relevance: use EXACT percentages from market data. These represent how often the skill appears in real job postings, not how proficient the user is. If SQL appears in 82% of postings, output 82, not 98. If skill not in market data, estimate conservatively with max 55.
set_gaps how_often: EXACT % from market data.

VERDICT QUALITY:
verdict_headline must name something SPECIFIC from this resume. A company, a tool, a number, a gap. If you could apply the same sentence to a different resume without changing a word, rewrite it.
brutal_honey: MAXIMUM 3 SENTENCES. No dashes. Sentence 1: why a recruiter skips this exact bullet. Sentence 2: what is salvageable. Sentence 3: direction for the rewrite. Nothing more.
rewrite: ONE sentence under 25 words. Strong verb first. Most relevant ATS keyword from market data. [X][Y][Z] only where numbers are genuinely missing. Self-check before outputting: strong verb? keyword? under 25 words? Revise once if any check fails.

TOOL ORDER: set_verdict, set_skills, set_gaps, set_scores, add_bullet_group once per company, set_jd_breakdown only if JD provided.
Call EVERY tool. Never stop after set_verdict.`,
      cache_control: { type: 'ephemeral' }
    }
  ];
}

function buildSystemPromptB(certNames) {
  return [
    {
      type: 'text',
      text: `You are GradLaunch's senior career strategist. You have personally reviewed 10,000 resumes and written LinkedIn profiles for candidates who got hired at Google, Stripe, and early-stage startups. You can spot a generic AI-generated response instantly, and you refuse to produce one.

YOUR STANDARD:
Every output must make the student say how did it know that about me, not this could apply to anyone.
If you write something a recruiter has seen before, you have failed.
Specificity is your only tool. Reference company names from the resume, specific tools they used, specific numbers if present, specific market data percentages.

FORBIDDEN OUTPUTS — if you produce any of these, stop and rewrite before outputting:
LinkedIn About openers: I am a, As a, With X years of experience, Passionate about, Dedicated professional, Results-driven, Dynamic, Innovative, Looking for
Any sentence that could apply to a different person's resume without changing a word
Cert picks not directly linked to a verified gap in the market data for this specific role
Project ai_prompt fields that are vague, short, or do not name specific tools and free datasets
linkedin_skills that include skills already prominent in the resume

MARKET DATA IS LAW:
linkedin_skills: pick from top 10 market data frequency for this role that are absent in the resume.
cert_picks: prioritise certs that address skills at high frequency in market data but missing from resume.
project market_signal: EXACT percentages from market data. Never invent numbers.

PROJECT QUALITY RULE — CRITICAL:
All 3 projects must have identical depth and length in ai_prompt. If you find yourself writing a shorter or vaguer ai_prompt for project 2 or 3, stop and bring it up to match project 1 quality. All three students are paying equal attention. Treat all 3 projects as equally important. The ai_prompt for project 3 must be as complete and copy-pasteable as project 1.

AVAILABLE CERTIFICATIONS — cert_picks must use EXACT names from this list:
${certNames}

TOOL ORDER: set_linkedin, set_certifications, set_projects. Call all three.`,
      cache_control: { type: 'ephemeral' }
    }
  ];
}

// ═══════════════════════════════════════════════════════
// MARKET DATA BLOCK
// ═══════════════════════════════════════════════════════
function buildMarketDataBlock(marketData, matchedRole) {
  if (!marketData) {
    return `MARKET DATA: Not available for this role. Use your best estimates for skill frequencies with a maximum of 55% for any single estimate. Label all estimates as estimated.`;
  }

  const skillLines = marketData.skillFreq
    .slice(0, 20)
    .map(s => `  ${s.skill}: ${s.pct}%`)
    .join('\n');

  const salaryLine = marketData.salaryData
    ? `Salary from postings: ${marketData.salaryData.median} (${marketData.salaryData.note})`
    : null;

  const age = marketData.scrapedAt
    ? Math.round((Date.now() - new Date(marketData.scrapedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return `MARKET DATA: Based on ${marketData.totalJobs || 40} real LinkedIn postings for ${matchedRole}${age !== null ? ` scraped ${age} days ago` : ''}:
Skill frequencies (% of real postings containing this skill):
${skillLines}

${salaryLine || ''}

RULES FOR USING THIS DATA:
skill_relevance values must use these exact numbers. They represent posting frequency, not user proficiency.
set_gaps how_often must use these exact numbers.
set_projects market_signal must use these exact numbers for the primary skill each project builds.
linkedin_skills must come from skills high on this list that are absent in the resume.
cert_picks must address skills high on this list that are missing from the resume.`;
}

// ═══════════════════════════════════════════════════════
// ANALYSIS PROMPTS
// ═══════════════════════════════════════════════════════
function buildAnalysisPromptA(role, locationStr, jd, hasJD, sal, marketDataBlock) {
  return `Analyze this resume for a ${role} role${locationStr !== 'Nationwide USA' ? ` in ${locationStr}` : ''}.

${marketDataBlock}

Salary context (do not output these numbers directly): Entry ${sal.e} | Mid ${sal.m} | Senior ${sal.s}.

${hasJD ? `JOB DESCRIPTION:\n${jd}\n\nSince a JD was provided, also call set_jd_breakdown.` : ''}

Call ALL tools in order. Never stop after set_verdict. Every output must reference actual content from this specific resume.`;
}

function buildAnalysisPromptB(role, locationStr, jd, hasJD, sal, marketDataBlock, resumeText) {
  return `Write LinkedIn optimization, certifications, and project suggestions for a ${role} candidate.

${marketDataBlock}

${resumeText ? `RESUME TEXT:\n${resumeText}\n` : ''}

${hasJD ? `JOB DESCRIPTION:\n${jd}\n` : ''}

Call ALL tools: set_linkedin, set_certifications, set_projects.
Every LinkedIn sentence must reference something specific from this resume. Every cert must close a real gap from market data. Every project ai_prompt must be complete and copy-pasteable. All 3 project ai_prompts must have identical depth.`;
}

// ═══════════════════════════════════════════════════════
// TOOL EMITTERS
// ═══════════════════════════════════════════════════════
function emitToolCallA(name, args, res, sal, role) {
  switch (name) {
    case 'set_verdict':
      sendEvent(res, 'verdict', {
        match_score:         clamp(args.match_score, 0, 100),
        verdict_headline:    args.verdict_headline || `${role} resume analyzed.`,
        verdict_sub:         args.verdict_sub || '',
        ats_pass_rate:       clamp(args.ats_pass_rate, 0, 100),
        ats_potential:       clamp(args.ats_potential, 0, 100),
        ats_missing_keyword: args.ats_missing_keyword || '',
        salary: {
          e: sal.e, m: sal.m, s: sal.s,
          low:  sal.e,
          high: sal.s,
          fromPostings: sal._fromPostings || null
        }
      });
      break;
    case 'set_skills':
      sendEvent(res, 'skills', {
        skills_present:  (args.skills_present || []).slice(0, 6),
        skill_levels:    args.skill_levels    || {},
        skill_relevance: args.skill_relevance || {}
      });
      break;
    case 'set_gaps':
      sendEvent(res, 'gaps', {
        gaps: (args.gaps || []).slice(0, 5).map(g => ({
          skill:      g.skill    || '',
          priority:   ['Critical','Important','Nice to have'].includes(g.priority) ? g.priority : 'Important',
          how_often:  clamp(g.how_often || 0, 0, 100),
          how_to_fix: g.how_to_fix || ''
        }))
      });
      break;
    case 'set_scores':
      sendEvent(res, 'scores', {
        bullet_quality: clamp(args.bullet_quality || 5, 0, 10),
        impact_metrics: clamp(args.impact_metrics || 5, 0, 10),
        ats_alignment:  clamp(args.ats_alignment  || 5, 0, 10),
        headline_roast: args.headline_roast || 'Your resume has been through a lot today.'
      });
      break;
    case 'add_bullet_group':
      sendEvent(res, 'bullet_group', {
        company: args.company || '',
        role:    args.role    || '',
        items: (args.items || []).map(item => ({
          text:         item.text || '',
          status:       item.status === 'green' ? 'green' : 'red',
          tags:         item.tags  || [],
          brutal_honey: item.status === 'red' ? (item.brutal_honey || 'This bullet needs work.') : null,
          rewrite:      item.status === 'red' ? (item.rewrite || null) : null
        }))
      });
      break;
    case 'set_jd_breakdown':
      sendEvent(res, 'jd_breakdown', {
        jd_breakdown: (args.jd_breakdown || []).map(r => ({
          requirement: r.requirement || '',
          met:         !!r.met,
          note:        r.note || ''
        }))
      });
      break;
    default:
      console.log('Stream A unknown tool:', name);
  }
}

function emitToolCallB(name, args, res, role) {
  switch (name) {
    case 'set_linkedin':
      sendEvent(res, 'linkedin', {
        linkedin_headline: sanitizeLinkedIn(args.linkedin_headline),
        linkedin_about:    args.linkedin_about   || '',
        linkedin_skills:   (args.linkedin_skills || []).slice(0, 5)
      });
      break;
    case 'set_certifications':
      sendEvent(res, 'certifications', {
        certifications: normalizeCerts(args.cert_picks, args.cert_reasons, role)
      });
      break;
    case 'set_projects': {
      const projects = (args.projects || []).map(p => ({
        market_signal: clamp(p.market_signal || 50, 0, 100),
        title:         p.title         || '',
        justification: p.justification || '',
        description:   p.description   || '',
        skills:        p.skills        || [],
        time_hours:    p.time_hours    || 8,
        ai_prompt:     p.ai_prompt     || '',
        bullets:       (p.bullets || []).slice(0, 2)
      }));
      projects.sort((a, b) => b.market_signal - a.market_signal);
      sendEvent(res, 'projects', { projects: projects.slice(0, 3) });
      break;
    }
    default:
      console.log('Stream B unknown tool:', name);
  }
}

// ═══════════════════════════════════════════════════════
// STREAM PROCESSOR — generic, reused by both A and B
// ═══════════════════════════════════════════════════════
function processStream(anthropicRes, emitFn) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const toolBuffers = {};

    anthropicRes.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        let event;
        try { event = JSON.parse(raw); } catch { continue; }

        const type = event.type;

        if (type === 'content_block_start' && event.content_block?.type === 'thinking') continue;
        if (type === 'content_block_delta' && event.delta?.type === 'thinking_delta') continue;
        if (type === 'content_block_delta' && event.delta?.type === 'thinking_summary_delta') continue;

        if (type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          const { id, name } = event.content_block;
          toolBuffers[id] = { name, args: '', complete: false };
          continue;
        }

        if (type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
          const openId = Object.keys(toolBuffers).find(id => !toolBuffers[id].complete);
          if (openId) toolBuffers[openId].args += event.delta.partial_json || '';
          continue;
        }

        if (type === 'content_block_stop') {
          for (const [id, buf] of Object.entries(toolBuffers)) {
            if (!buf.complete && buf.args) {
              buf.complete = true;
              try {
                emitFn(buf.name, JSON.parse(buf.args));
              } catch (e) {
                console.error(`Tool parse error ${buf.name}:`, e.message, buf.args.substring(0, 80));
              }
            }
          }
          continue;
        }
      }
    });

    anthropicRes.on('end',   resolve);
    anthropicRes.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════
// MAKE ANTHROPIC STREAMING REQUEST
// ═══════════════════════════════════════════════════════
function makeStreamRequest({ apiKey, model, system, userContent, tools, fileId, maxTokens }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens || 8000,
      system,
      messages: [{ role: 'user', content: userContent }],
      tools,
      tool_choice: { type: 'any' },
      stream: true
    });

    const betaHeaders = ['prompt-caching-2024-07-31'];
    if (fileId) betaHeaders.push('files-api-2025-04-14');

    const opts = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    betaHeaders.join(','),
        'Content-Length':    Buffer.byteLength(body)
      },
      timeout: 55000
    };

    const req = https.request(opts, anthropicRes => {
      if (anthropicRes.statusCode !== 200) {
        let errBody = '';
        anthropicRes.on('data', c => errBody += c);
        anthropicRes.on('end', () => {
          try {
            const p = JSON.parse(errBody);
            reject(new Error(p.error?.message || `API error ${anthropicRes.statusCode}`));
          } catch { reject(new Error(`API error ${anthropicRes.statusCode}`)); }
        });
        return;
      }
      resolve(anthropicRes);
    });

    req.on('timeout', () => req.destroy(new Error('Analysis timed out. Please try again.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'unknown';

  const rate = getRateStatus(ip);
  if (rate.limited) {
    const t = new Date(rate.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return res.status(429).json({
      error:     'rate_limited',
      message:   `You've run 5 analyses this hour — we cap it to keep the service free for everyone. It resets at ${t}.`,
      resetAt:   rate.resetAt,
      remaining: 0
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const body     = req.body || {};
  const fileId   = body.fileId   || null;
  const resume   = (body.resume  || '').substring(0, 4000);
  const location = (body.location|| '').substring(0, 50);
  const jd       = (body.jd      || '').substring(0, 1200);
  const hasJD    = jd.trim().length > 50;

  // Role: explicit or extracted from JD
  let role         = (body.role || '').substring(0, 80).trim();
  let roleFromJD   = false;
  let detectedRole = null;

  if (!role && hasJD) {
    const extracted = extractRoleFromJD(jd);
    if (extracted) {
      role         = extracted.role;
      roleFromJD   = true;
      detectedRole = extracted.matched;
      console.log(`Role extracted from JD: "${role}" matched to "${detectedRole}"`);
    }
  }

  if ((!resume || resume.length < 100) && !fileId) {
    return res.status(400).json({ error: 'Resume content or file ID is required.' });
  }
  if (!role) {
    return res.status(400).json({
      error: 'Please enter a target role or paste a job description — we need at least one to run your analysis.'
    });
  }

  recordHit(ip);
  const rateAfter   = getRateStatus(ip);
  const locationStr = location.trim() || 'Nationwide USA';
  const locKey      = Object.keys(SALARY).find(k => k !== 'default' && locationStr.toLowerCase().includes(k)) || 'default';
  const sal         = { ...SALARY[locKey] }; // clone to avoid mutating the constant

  // Market data lookup
  const matchedRole = detectedRole || fuzzyMatchRole(role);
  let   marketData  = null;
  let   hasLiveData = false;

  if (matchedRole) {
    try {
      marketData = await upstashGet(roleCacheKey(matchedRole));
      if (marketData?.skillFreq?.length) {
        hasLiveData = true;
        console.log(`Market data: ${matchedRole} (${marketData.totalJobs} jobs)`);
      }
    } catch (e) {
      console.log('Warmcache lookup failed gracefully:', e.message);
    }
  }

  if (marketData?.salaryData) {
    sal._fromPostings = marketData.salaryData.median;
    sal._postingNote  = marketData.salaryData.note;
  }

  const marketDataBlock = buildMarketDataBlock(marketData, matchedRole || role);
  const systemPromptA   = buildSystemPromptA();
  const systemPromptB   = buildSystemPromptB(CERT_NAMES);

  // Stream A user content — includes file or resume text
  const promptA    = buildAnalysisPromptA(role, locationStr, jd, hasJD, sal, marketDataBlock);
  const userContentA = fileId
    ? [
        { type: 'document', source: { type: 'file', file_id: fileId } },
        { type: 'text',     text: promptA }
      ]
    : promptA + `\n\nRESUME TEXT:\n${resume}`;

  // Stream B user content — text only (Sonnet gets resume text, not the file)
  const resumeForB = resume || '';
  const userContentB = buildAnalysisPromptB(role, locationStr, jd, hasJD, sal, marketDataBlock, resumeForB);

  // SSE headers
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-RateLimit-Remaining', rateAfter.remaining);
  if (rateAfter.resetAt) res.setHeader('X-RateLimit-Reset', rateAfter.resetAt);

  sendEvent(res, 'metadata', {
    rateRemaining: rateAfter.remaining,
    rateResetAt:   rateAfter.resetAt || null,
    hasLiveData,
    matchedRole:   matchedRole   || null,
    roleFromJD,
    detectedRole:  detectedRole  || null,
    totalJobs:     marketData?.totalJobs || null
  });

  let fileDeleted = false;
  const cleanupFile = async () => {
    if (fileId && !fileDeleted) {
      fileDeleted = true;
      await deleteFile(fileId, apiKey);
    }
  };

  try {
    // Launch both streams simultaneously
    const [anthropicResA, anthropicResB] = await Promise.all([
      makeStreamRequest({
        apiKey,
        model:       'claude-haiku-4-5-20251001',
        system:      systemPromptA,
        userContent: userContentA,
        tools:       TOOLS_A,
        fileId,
        maxTokens:   8000
      }),
      makeStreamRequest({
        apiKey,
        model:       'claude-sonnet-4-5',
        system:      systemPromptB,
        userContent: userContentB,
        tools:       TOOLS_B,
        fileId:      null,
        maxTokens:   6000
      })
    ]);

    // Process both concurrently
    await Promise.all([
      processStream(anthropicResA, (name, args) => emitToolCallA(name, args, res, sal, role)),
      processStream(anthropicResB, (name, args) => emitToolCallB(name, args, res, role))
    ]);

    await cleanupFile();
    sendEvent(res, 'done', { complete: true });
    res.end();

  } catch (err) {
    console.error('Stream error:', err.message);
    await cleanupFile();
    sendEvent(res, 'partial', {
      message: 'Analysis took longer than expected. Your partial results are below — re-run for complete results.'
    });
    sendEvent(res, 'error', { message: err.message || 'Analysis failed. Please try again.' });
    res.end();
  }
};
