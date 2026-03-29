const https   = require('https');
const { deleteFile }   = require('./upload');
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
// Strips seniority/level words then finds closest pre-baked role
// "Senior Data Analyst" → "Data Analyst"
// "ML Engineer" → "Machine Learning Engineer"
// ═══════════════════════════════════════════════════════
const STRIP_WORDS = [
  'senior','sr','junior','jr','lead','principal','staff',
  'associate','manager','director','vp','vice president',
  'head of','intern','contract','contractor','remote','i','ii','iii','iv'
];

function fuzzyMatchRole(searchRole) {
  if (!searchRole) return null;

  // Normalize search role
  let normalized = searchRole.toLowerCase().trim();
  for (const w of STRIP_WORDS) {
    normalized = normalized.replace(new RegExp(`\\b${w}\\b`, 'gi'), '').trim();
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Exact match first
  const exact = ROLES.find(r => r.toLowerCase() === normalized);
  if (exact) return exact;

  // Substring match — search contains role name or role name contains search
  const sub = ROLES.find(r => {
    const rl = r.toLowerCase();
    return normalized.includes(rl) || rl.includes(normalized);
  });
  if (sub) return sub;

  // Word overlap — find role with most shared words
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
// SALARY LOOKUP — BLS data fallback
// ═══════════════════════════════════════════════════════
const SALARY = {
  'new york':      { e: '$69k–$94k',  m: '$95k–$130k',  s: '$130k–$175k' },
  'san francisco': { e: '$85k–$115k', m: '$115k–$155k', s: '$155k–$220k' },
  'seattle':       { e: '$78k–$105k', m: '$105k–$145k', s: '$145k–$200k' },
  'austin':        { e: '$62k–$85k',  m: '$85k–$120k',  s: '$120k–$165k' },
  'chicago':       { e: '$60k–$82k',  m: '$82k–$115k',  s: '$115k–$155k' },
  'boston':        { e: '$70k–$95k',  m: '$95k–$130k',  s: '$130k–$175k' },
  'los angeles':   { e: '$68k–$92k',  m: '$92k–$125k',  s: '$125k–$170k' },
  'dallas':        { e: '$60k–$82k',  m: '$82k–$115k',  s: '$115k–$155k' },
  'washington':    { e: '$68k–$92k',  m: '$92k–$128k',  s: '$128k–$172k' },
  'atlanta':       { e: '$58k–$80k',  m: '$80k–$112k',  s: '$112k–$155k' },
  'denver':        { e: '$62k–$85k',  m: '$85k–$118k',  s: '$118k–$160k' },
  'default':       { e: '$55k–$75k',  m: '$75k–$110k',  s: '$110k–$160k' }
};

// ═══════════════════════════════════════════════════════
// CERTIFICATIONS DB
// ═══════════════════════════════════════════════════════
const CERTS_DB = {
  'Google Data Analytics Certificate':  { provider: 'Google/Coursera', level: 'Entry',        cost: 'Free–$49/mo', duration: '6 months',   url: 'https://grow.google/certificates/data-analytics/' },
  'AWS Cloud Practitioner':             { provider: 'AWS',             level: 'Entry',        cost: '$100',        duration: '1 month',    url: 'https://aws.amazon.com/certification/certified-cloud-practitioner/' },
  'Google Project Management':          { provider: 'Google/Coursera', level: 'Entry',        cost: 'Free–$49/mo', duration: '6 months',   url: 'https://grow.google/certificates/project-management/' },
  'Tableau Desktop Specialist':         { provider: 'Tableau',         level: 'Associate',    cost: '$250',        duration: '1 month',    url: 'https://www.tableau.com/learn/certification/desktop-specialist' },
  'Microsoft Power BI PL-300':          { provider: 'Microsoft',       level: 'Associate',    cost: '$165',        duration: '2 months',   url: 'https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/' },
  'AWS Solutions Architect Associate':  { provider: 'AWS',             level: 'Associate',    cost: '$150',        duration: '2–3 months', url: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/' },
  'dbt Analytics Engineering':          { provider: 'dbt Labs',        level: 'Associate',    cost: '$200',        duration: '1 month',    url: 'https://www.getdbt.com/certifications' },
  'Scrum Master PSM I':                 { provider: 'Scrum.org',       level: 'Entry',        cost: '$150',        duration: '2 weeks',    url: 'https://www.scrum.org/assessments/professional-scrum-master-i-certification' },
  'Google UX Design':                   { provider: 'Google/Coursera', level: 'Entry',        cost: 'Free–$49/mo', duration: '6 months',   url: 'https://grow.google/certificates/ux-design/' },
  'Salesforce Admin':                   { provider: 'Salesforce',      level: 'Associate',    cost: '$200',        duration: '2 months',   url: 'https://trailhead.salesforce.com/credentials/administrator' },
  'PMP':                                { provider: 'PMI',             level: 'Professional', cost: '$405',        duration: '3+ months',  url: 'https://www.pmi.org/certifications/project-management-pmp' },
  'CompTIA Security+':                  { provider: 'CompTIA',         level: 'Associate',    cost: '$370',        duration: '2 months',   url: 'https://www.comptia.org/certifications/security' },
  'Databricks Data Engineer Associate': { provider: 'Databricks',      level: 'Associate',    cost: '$200',        duration: '1–2 months', url: 'https://www.databricks.com/learn/certification/data-engineer-associate' },
  'Snowflake SnowPro Core':             { provider: 'Snowflake',       level: 'Associate',    cost: '$175',        duration: '1 month',    url: 'https://learn.snowflake.com/en/certifications/snowpro-core/' },
  'Google Cloud Professional DE':       { provider: 'Google Cloud',    level: 'Professional', cost: '$200',        duration: '2–3 months', url: 'https://cloud.google.com/learn/certification/data-engineer' }
};

// ═══════════════════════════════════════════════════════
// HTTP HELPER
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

// ═══════════════════════════════════════════════════════
// HTTPS POST HELPER — for meta-prompt Anthropic call
// ═══════════════════════════════════════════════════════
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 20000
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
// GENERATE PROJECT PROMPT — dedicated meta-prompt call
// Uses a separate Haiku call whose only job is to write
// an excellent agentic coding prompt for the project.
// Cost: ~$0.001 per analysis. Worth every fraction of a cent.
// ═══════════════════════════════════════════════════════
async function generateProjectPrompt(project, apiKey) {
  try {
    const { title, description, skills } = project;
    const techStack = (skills || []).slice(0, 5).join(', ');

    const metaPrompt = `Write a prompt that instructs an AI coding assistant to help a developer build this portfolio project from scratch.

Project: ${title}
Tech stack: ${techStack}
What gets built: ${description}

Rules for the prompt you write:
- Start with "Act as a senior [appropriate role based on the tech stack]"
- Address the developer as "you" — never use any personal names
- No explanation of why they are building this — just build it
- Phase 1 (2 sentences): AI interviews developer about their setup and requirements before planning anything. Ends with "Say 'next phase' when ready."
- Phase 2 (2 sentences): AI designs the architecture and file structure, gets approval before writing any code. Ends with "Say 'next phase' when ready."  
- Phase 3 (2 sentences): AI builds one file at a time, asks questions when it needs specifics, never dumps everything at once.
- Total prompt must be under 180 words
- No dashes or em-dashes
- Output ONLY the prompt text, nothing else`;

    const response = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: metaPrompt }]
      }
    );

    const text = response?.content?.[0]?.text?.trim();
    if (text && text.length > 50) return text;
    return null;

  } catch (e) {
    console.log('Meta-prompt generation failed gracefully:', e.message);
    return null;
  }
}


const TOOLS = [
  {
    name: 'set_verdict',
    description: 'Set the overall verdict. Call this FIRST — it renders immediately.',
    input_schema: {
      type: 'object',
      properties: {
        match_score:         { type: 'number',  description: '0-100 match score for this role' },
        verdict_headline:    { type: 'string',  description: 'ONE quotable sentence about THIS resume. Never generic. Reference something specific.' },
        verdict_sub:         { type: 'string',  description: 'ONE sentence elaboration specific to their background.' },
        ats_pass_rate:       { type: 'number',  description: 'Current ATS pass rate 0-100' },
        ats_potential:       { type: 'number',  description: 'Potential ATS pass rate after fixes 0-100' },
        ats_missing_keyword: { type: 'string',  description: 'Single most impactful missing keyword for this role' }
      },
      required: ['match_score','verdict_headline','verdict_sub','ats_pass_rate','ats_potential','ats_missing_keyword']
    }
  },
  {
    name: 'set_skills',
    description: 'Set skills present in the resume.',
    input_schema: {
      type: 'object',
      properties: {
        skills_present: { type: 'array', items: { type: 'string' }, description: 'Up to 6 skills most relevant to target role' },
        skill_levels:   { type: 'object', additionalProperties: { type: 'string' }, description: 'Map skill → "Strong"|"Intermediate"|"Basic"' }
      },
      required: ['skills_present','skill_levels']
    }
  },
  {
    name: 'set_gaps',
    description: 'Set skill gaps using the EXACT percentages from the market data provided. Do not estimate your own numbers.',
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
              how_often:  { type: 'number', description: 'Use the exact % from the market data. If not in market data, use your best estimate.' },
              how_to_fix: { type: 'string', description: 'Specific resource or action with URL if possible' }
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
    name: 'set_linkedin',
    description: 'Set LinkedIn optimization. ZERO visa language. ZERO "open to work". ZERO "seeking". Exactly 3 sentences in about section.',
    input_schema: {
      type: 'object',
      properties: {
        linkedin_headline: { type: 'string', description: 'Under 200 chars. No status language. Reads like someone who built something, not someone looking for a job.' },
        linkedin_about:    { type: 'string', description: 'Exactly 3 sentences. Sentence 1: what they built/solved with specifics. Sentence 2: tools and skills. Sentence 3: what direction they are heading. No corporate speak.' },
        linkedin_skills:   { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Skills to add — prioritize ones that appear in job postings for this role' }
      },
      required: ['linkedin_headline','linkedin_about','linkedin_skills']
    }
  },
  {
    name: 'set_certifications',
    description: 'Pick exactly 3 certs from the provided list that close the most critical gaps. Use exact names.',
    input_schema: {
      type: 'object',
      properties: {
        cert_picks:   { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
        cert_reasons: { type: 'object', additionalProperties: { type: 'string' }, description: 'Map cert name → one sentence why it closes a specific gap' }
      },
      required: ['cert_picks','cert_reasons']
    }
  },
  {
    name: 'set_projects',
    description: 'Set 3 project suggestions using the market data to pick the highest-signal skills to build.',
    input_schema: {
      type: 'object',
      properties: {
        projects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              market_signal:  { type: 'number', description: 'Use exact % from market data for the primary skill this project builds' },
              title:          { type: 'string' },
              justification:  { type: 'string', description: 'One sentence why this closes their biggest gap — reference the market data %' },
              description:    { type: 'string', description: 'Two sentences. Name a specific free API or dataset, specific tools, specific deliverable.' },
              skills:         { type: 'array', items: { type: 'string' } },
              time_hours:     { type: 'number' },
              ai_prompt:      { type: 'string', description: 'Three-phase prompt. Phase 1: planning (no code). Phase 2: output design (no code). Phase 3: guided coding. Student types "next phase" to advance.' },
              bullets:        { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2, description: 'Resume bullets with [X][Y][Z] placeholders for numbers' }
            },
            required: ['market_signal','title','justification','description','skills','time_hours','ai_prompt','bullets']
          },
          minItems: 3, maxItems: 3
        }
      },
      required: ['projects']
    }
  },
  {
    name: 'set_scores',
    description: 'Set resume quality scores and the headline roast.',
    input_schema: {
      type: 'object',
      properties: {
        bullet_quality: { type: 'number', description: '0-10: are bullets doing work or just taking up space?' },
        impact_metrics: { type: 'number', description: '0-10: numbers and measurable outcomes present?' },
        ats_alignment:  { type: 'number', description: '0-10: keyword alignment with target role based on market data?' },
        headline_roast: { type: 'string', description: 'ONE punchy sentence referencing something specific in their actual resume. No dashes. No em-dashes. Sounds like a person said it out loud.' }
      },
      required: ['bullet_quality','impact_metrics','ats_alignment','headline_roast']
    }
  },
  {
    name: 'add_bullet_group',
    description: 'Add one company worth of resume bullets. Call once per company in the resume.',
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        role:    { type: 'string', description: 'Job title at this company' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text:         { type: 'string',  description: 'Exact bullet text from resume' },
              status:       { type: 'string',  enum: ['green','red'] },
              tags:         { type: 'array', items: { type: 'string', enum: ['Missing Metric','Passive Voice','No Impact Statement','Vague Action Verb','Strong','Impact Validated','Quantified'] }, description: 'One or two diagnostic tags for this bullet. Green bullets get positive tags, red bullets get problem tags.' },
              brutal_honey: { type: 'string',  description: 'Red only: ONE paragraph. No dashes or em-dashes. Start with why a recruiter skips this bullet, then what is salvageable. Human voice, sounds like a person talking. null for green.' },
              rewrite:      { type: 'string',  description: 'Red only: Stronger version with [X][Y][Z] placeholders. No dashes or em-dashes. End with: "Estimates count. 40% faster based on before/after testing is real data." null for green.' }
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
// BUILD SYSTEM PROMPT
// Static section — cached by Anthropic across requests
// Market data block uses separate cache_control
// ═══════════════════════════════════════════════════════
function buildSystemPrompt(certNames) {
  return `You are GradLaunch. You are a brutally honest but genuinely helpful career advisor for students navigating the US job market. You are the brilliant, slightly sarcastic senior friend who works in recruiting and actually wants them to win.

YOUR VOICE:
- Direct and specific. Always reference THIS resume, THIS role, THIS person's actual experience.
- Slightly sarcastic but never mean. Uncomfortable truths delivered with immediate redemption.
- Sound like a human talking out loud. Never like a product or a report.
- Every line written for this specific student. Never copied from a template.
- This student likely comes from a non-target university. Impostor syndrome is real. Be honest but never discouraging.

CRITICAL FORMATTING RULES:
- NEVER use dashes as separators, em-dashes, or en-dashes anywhere in your output text.
- NEVER use bullet points or numbered lists inside brutal_honey or verdict fields. Write in flowing sentences.
- NEVER start a sentence with "Additionally", "Furthermore", "Moreover", or "Overall".
- Use commas and periods to connect ideas instead of dashes.

FORBIDDEN PHRASES:
"results-driven", "passionate about", "seeking opportunities", "open to work", "team player",
"synergy", "leveraged", "utilized", "interface with",
any visa language (OPT, H-1B, F-1, EAD, work authorization, green card)

AVAILABLE CERTIFICATIONS — cert_picks must use exact names:
${certNames}

TOOL CALLING ORDER:
1. set_verdict
2. set_skills
3. set_gaps
4. set_linkedin
5. set_certifications
6. set_projects
7. set_scores
8. add_bullet_group (once per company)
9. set_jd_breakdown (only if JD provided)

QUALITY RULES:
- verdict_headline: quotable and specific to THIS resume. "You have 4 years of experience and a resume that reads like your first draft." No dashes. Sounds like something a friend said out loud.
- brutal_honey: MAXIMUM 3 SENTENCES. No dashes. No bullet points. Sentence 1: the uncomfortable truth about why a recruiter skips this exact bullet. Sentence 2: what is actually salvageable or good about it. Sentence 3: the specific direction for the rewrite. Nothing more.
- rewrite bullets: [X][Y][Z] placeholders always. End with: "Estimates count. 40% faster based on before/after testing is real data." No dashes.
- linkedin_headline: under 200 chars, zero status language. Use a pipe symbol to separate elements if needed.
- set_gaps how_often: USE THE EXACT PERCENTAGES FROM THE MARKET DATA BLOCK. If a skill is not in market data use your best estimate.
- set_projects market_signal: USE THE EXACT PERCENTAGES FROM THE MARKET DATA BLOCK.
- ai_prompt: Write a brief fallback placeholder only. This field will be replaced by a dedicated prompt optimizer. Just write: "Act as a senior [relevant role]. Help me build [project title] using [main skill]. Guide me through planning, design, and coding one step at a time." Under 30 words. No personal details. No names. No explanation of why.
- bullet tags: pick 1 or 2 accurate diagnostic tags. "Missing Metric" only if no numbers exist. "Passive Voice" only if the verb is genuinely passive.`;
}

// ═══════════════════════════════════════════════════════
// BUILD MARKET DATA BLOCK
// Injected into user message — separate cache_control
// Claude told to use these exact numbers
// ═══════════════════════════════════════════════════════
function buildMarketDataBlock(marketData, matchedRole) {
  if (!marketData) {
    return `MARKET DATA: Not available for this role. Use your best estimates for skill frequencies and label them as estimated.`;
  }

  const skillLines = marketData.skillFreq
    .slice(0, 15)
    .map(s => `  ${s.skill}: ${s.pct}%`)
    .join('\n');

  const salaryLine = marketData.salaryData
    ? `Salary from postings: ${marketData.salaryData.median} (${marketData.salaryData.note})`
    : null;

  const age = marketData.scrapedAt
    ? Math.round((Date.now() - new Date(marketData.scrapedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return `MARKET DATA — Based on job postings for ${matchedRole}${age !== null ? ` (${age} days ago)` : ''}:
Skill frequencies (% of postings containing this skill):
${skillLines}

${salaryLine || ''}

IMPORTANT: Use these EXACT percentages in set_gaps (how_often) and set_projects (market_signal).
Do not invent your own numbers. If a gap skill is not in this list, use your judgment and note it as estimated.`;
}

// ═══════════════════════════════════════════════════════
// BUILD ANALYSIS PROMPT
// ═══════════════════════════════════════════════════════
function buildAnalysisPrompt(role, locationStr, jd, hasJD, sal, marketDataBlock) {
  return `Analyze this resume for a ${role} role${locationStr !== 'Nationwide USA' ? ` in ${locationStr}` : ''}.

${marketDataBlock}

Salary context for ${locationStr} (do not output these numbers, use for context only):
Entry: ${sal.e} | Mid: ${sal.m} | Senior: ${sal.s}

${hasJD ? `JOB DESCRIPTION:\n${jd}\n\nSince a JD was provided, also call set_jd_breakdown.` : ''}

Call ALL tools in the required order. Do not stop after set_verdict. Complete every single tool call including set_skills, set_gaps, set_linkedin, set_certifications, set_projects, set_scores, and add_bullet_group for every company in the resume. Every verdict, roast, and rewrite must reference actual content from this specific resume. Never write generic advice.`;
}

// ═══════════════════════════════════════════════════════
// NORMALIZE HELPERS
// ═══════════════════════════════════════════════════════
function normalizeCerts(certPicks, certReasons, role) {
  const picks = (certPicks || []).filter(n => CERTS_DB[n]);
  const certs = picks.map(n => ({ name: n, ...CERTS_DB[n], why: certReasons?.[n] || 'Closes your top gap.' })).slice(0, 3);
  if (certs.length < 3) {
    const used = new Set(certs.map(c => c.name));
    for (const [n, d] of Object.entries(CERTS_DB)) {
      if (certs.length >= 3) break;
      if (!used.has(n)) { certs.push({ name: n, ...d, why: `Recommended for ${role} roles.` }); used.add(n); }
    }
  }
  return certs;
}

function sanitizeLinkedIn(headline) {
  return (headline || '')
    .replace(/\b(F-1|H-1B|STEM OPT|OPT|visa|work authorization|EAD|green card|permanent resident|open to work|seeking|looking for opportunities)\b/gi, '')
    .replace(/\s{2,}/g,' ').replace(/\|\s*\|/g,'|').replace(/^\s*\|\s*/,'').replace(/\s*\|\s*$/,'').trim();
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
// TOOL CALL EMITTER
// ═══════════════════════════════════════════════════════
function emitToolCall(name, args, res, sal, role, certNames) {
  switch (name) {
    case 'set_verdict':
      sendEvent(res, 'verdict', {
        match_score:         clamp(args.match_score, 0, 100),
        verdict_headline:    args.verdict_headline || `${role} resume analyzed.`,
        verdict_sub:         args.verdict_sub || '',
        ats_pass_rate:       clamp(args.ats_pass_rate, 0, 100),
        ats_potential:       clamp(args.ats_potential, 0, 100),
        ats_missing_keyword: args.ats_missing_keyword || '',
        salary: sal
      });
      break;
    case 'set_skills':
      sendEvent(res, 'skills', {
        skills_present: (args.skills_present || []).slice(0, 6),
        skill_levels:   args.skill_levels || {}
      });
      break;
    case 'set_gaps':
      sendEvent(res, 'gaps', {
        gaps: (args.gaps || []).slice(0, 5).map(g => ({
          skill:      g.skill || '',
          priority:   ['Critical','Important','Nice to have'].includes(g.priority) ? g.priority : 'Important',
          how_often:  clamp(g.how_often || 0, 0, 100),
          how_to_fix: g.how_to_fix || ''
        }))
      });
      break;
    case 'set_linkedin':
      sendEvent(res, 'linkedin', {
        linkedin_headline: sanitizeLinkedIn(args.linkedin_headline),
        linkedin_about:    args.linkedin_about || '',
        linkedin_skills:   (args.linkedin_skills || []).slice(0, 8)
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
        title:         p.title || '',
        justification: p.justification || '',
        description:   p.description || '',
        skills:        p.skills || [],
        time_hours:    p.time_hours || 8,
        ai_prompt:     p.ai_prompt || '',
        bullets:       (p.bullets || []).slice(0, 2)
      }));
      projects.sort((a, b) => b.market_signal - a.market_signal);
      const top3 = projects.slice(0, 3);

      // Generate optimized agentic prompts for all 3 projects in parallel
      // Each is a dedicated Haiku call whose only job is writing a great prompt
      // Falls back to Claude's original ai_prompt if the meta-call fails
      Promise.all(
        top3.map(p => generateProjectPrompt(p, process.env.ANTHROPIC_API_KEY)
          .then(optimized => {
            if (optimized) p.ai_prompt = optimized;
          })
          .catch(() => {})
        )
      ).then(() => {
        sendEvent(res, 'projects', { projects: top3 });
      }).catch(() => {
        // If anything goes wrong, emit with original prompts
        sendEvent(res, 'projects', { projects: top3 });
      });
      break;
    }
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
          tags:         item.tags || [],
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
      console.log('Unknown tool call:', name);
  }
}

// ═══════════════════════════════════════════════════════
// STREAM EVENT HANDLER
// toolBuffers is local per request — no shared state
// ═══════════════════════════════════════════════════════
function handleStreamEvent(event, toolBuffers, res, sal, role, certNames) {
  const type = event.type;

  // Ignore thinking blocks
  if (type === 'content_block_start' && event.content_block?.type === 'thinking') return;
  if (type === 'content_block_delta' && event.delta?.type === 'thinking_delta') return;
  if (type === 'content_block_delta' && event.delta?.type === 'thinking_summary_delta') return;

  // Tool start
  if (type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    const { id, name } = event.content_block;
    toolBuffers[id] = { name, args: '', complete: false };
    return;
  }

  // Tool delta — accumulate into most recently opened buffer
  if (type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
    const openId = Object.keys(toolBuffers).find(id => !toolBuffers[id].complete);
    if (openId) toolBuffers[openId].args += event.delta.partial_json || '';
    return;
  }

  // Tool complete — parse and emit
  if (type === 'content_block_stop') {
    for (const [id, buf] of Object.entries(toolBuffers)) {
      if (!buf.complete && buf.args) {
        buf.complete = true;
        try {
          emitToolCall(buf.name, JSON.parse(buf.args), res, sal, role, certNames);
        } catch (e) {
          console.error(`Tool parse error ${buf.name}:`, e.message, buf.args.substring(0, 80));
        }
      }
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════
// STREAMING ANALYSIS
// ═══════════════════════════════════════════════════════
async function streamAnalysis({ apiKey, systemPrompt, marketDataBlock, userContent, tools, res, fileId, certNames, role, sal }) {
  return new Promise((resolve, reject) => {

    const requestBody = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      // No thinking — Haiku completes in 10-12s well within 60s limit
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' } // cache static system prompt
        }
      ],
      messages: [
        {
          role: 'user',
          content: userContent
        }
      ],
      tools,
      tool_choice: { type: 'auto' },
      stream: true
    });

    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        ...(fileId ? { 'anthropic-beta': 'files-api-2025-04-14' } : {}),
        'Content-Length':    Buffer.byteLength(requestBody)
      },
      timeout: 55000
    };

    const req = https.request(opts, (anthropicRes) => {
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

      let buffer = '';
      const toolBuffers = {}; // local per request
      let fileDeleted  = false;

      anthropicRes.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          let event;
          try { event = JSON.parse(data); } catch { continue; }
          handleStreamEvent(event, toolBuffers, res, sal, role, certNames);
        }
      });

      anthropicRes.on('end', async () => {
        if (fileId && !fileDeleted) {
          fileDeleted = true;
          await deleteFile(fileId, process.env.ANTHROPIC_API_KEY);
        }
        sendEvent(res, 'done', { complete: true });
        res.end();
        resolve();
      });

      anthropicRes.on('error', reject);
    });

    req.on('timeout', () => req.destroy(new Error('Analysis timed out. Please try again.')));
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
      error: 'rate_limited',
      message: `You've used all 5 analyses for this hour. Limit resets at ${t}.`,
      resetAt: rate.resetAt, remaining: 0
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const body     = req.body || {};
  const fileId   = body.fileId   || null;
  const resume   = (body.resume  || '').substring(0, 4000);
  const role     = (body.role    || '').substring(0, 50);
  const location = (body.location|| '').substring(0, 50);
  const jd       = (body.jd     || '').substring(0, 800);
  const hasJD    = jd.trim().length > 20;

  if ((!resume || resume.length < 100) && !fileId) {
    return res.status(400).json({ error: 'Resume content or file ID is required.' });
  }
  if (!role) return res.status(400).json({ error: 'Target role is required.' });

  recordHit(ip);
  const rateAfter   = getRateStatus(ip);
  const locationStr = location.trim() || 'Nationwide USA';
  const locKey      = Object.keys(SALARY).find(k => k !== 'default' && locationStr.toLowerCase().includes(k)) || 'default';
  const sal         = SALARY[locKey];
  const certNames   = Object.keys(CERTS_DB).join(', ');

  // ── WARMCACHE LOOKUP — fuzzy match role to pre-baked data ──
  const matchedRole  = fuzzyMatchRole(role);
  let   marketData   = null;
  let   hasLiveData  = false;

  if (matchedRole) {
    try {
      marketData = await upstashGet(roleCacheKey(matchedRole));
      if (marketData?.skillFreq?.length) {
        hasLiveData = true;
        console.log(`Market data found: ${matchedRole} (${marketData.totalJobs} jobs, ${Math.round((Date.now()-new Date(marketData.scrapedAt).getTime())/86400000)}d ago)`);
      }
    } catch (e) {
      console.log('Warmcache lookup failed gracefully:', e.message);
    }
  }

  // Use salary from postings if available and more specific than BLS
  if (marketData?.salaryData) {
    sal._fromPostings = marketData.salaryData.median;
    sal._postingNote  = marketData.salaryData.note;
  }

  const marketDataBlock = buildMarketDataBlock(marketData, matchedRole || role);
  const systemPrompt    = buildSystemPrompt(certNames);

  // Build user message — file or text + market data block
  const analysisPrompt = buildAnalysisPrompt(role, locationStr, jd, hasJD, sal, marketDataBlock);
  const userContent    = fileId
    ? [
        { type: 'document', source: { type: 'file', file_id: fileId } },
        { type: 'text', text: analysisPrompt }
      ]
    : analysisPrompt + `\n\nRESUME TEXT:\n${resume}`;

  // Streaming headers
  res.setHeader('Content-Type',     'text/event-stream');
  res.setHeader('Cache-Control',    'no-cache');
  res.setHeader('Connection',       'keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  res.setHeader('X-RateLimit-Remaining', rateAfter.remaining);
  if (rateAfter.resetAt) res.setHeader('X-RateLimit-Reset', rateAfter.resetAt);

  // Send metadata — rate info + whether live data is available
  sendEvent(res, 'metadata', {
    rateRemaining: rateAfter.remaining,
    rateResetAt:   rateAfter.resetAt || null,
    hasLiveData,
    matchedRole:   matchedRole || null
  });

  try {
    await streamAnalysis({
      apiKey, systemPrompt, marketDataBlock, userContent,
      tools: TOOLS, res, fileId, certNames, role, sal
    });
  } catch (err) {
    console.error('Stream error:', err.message);
    // Send partial results message then error
    sendEvent(res, 'partial', {
      message: 'Analysis took longer than expected. Your partial results are below — re-run for complete results.'
    });
    sendEvent(res, 'error', { message: err.message || 'Analysis failed. Please try again.' });
    res.end();
  }
};
