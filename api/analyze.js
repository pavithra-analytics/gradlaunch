const https = require('https');
const { deleteFile } = require('./upload');

// ═══════════════════════════════════════════════════════
// RATE LIMITER — 5 per IP per rolling hour
// ═══════════════════════════════════════════════════════
const ipHits = new Map();

function getRateStatus(ip) {
  const now    = Date.now();
  const window = 60 * 60 * 1000;
  const hits   = (ipHits.get(ip) || []).filter(t => now - t < window);
  const remaining = Math.max(0, 5 - hits.length);
  const resetAt   = hits.length >= 5
    ? new Date(hits[0] + window).toISOString()
    : null;
  return { limited: hits.length >= 5, remaining, resetAt };
}

function recordHit(ip) {
  const now    = Date.now();
  const window = 60 * 60 * 1000;
  const hits   = (ipHits.get(ip) || []).filter(t => now - t < window);
  hits.push(now);
  ipHits.set(ip, hits);
}

// ═══════════════════════════════════════════════════════
// SALARY LOOKUP — BLS data, never from LLM
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
      timeout: 15000
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

// ═══════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════
const TOOLS = [
  {
    name: 'set_verdict',
    description: 'Set the overall verdict. Call this FIRST — it renders immediately.',
    input_schema: {
      type: 'object',
      properties: {
        match_score:         { type: 'number',  description: '0-100 match for this role' },
        verdict_headline:    { type: 'string',  description: 'ONE punchy quotable sentence about THIS resume. Never generic.' },
        verdict_sub:         { type: 'string',  description: 'ONE sentence elaboration, specific to their background.' },
        ats_pass_rate:       { type: 'number',  description: 'Current ATS pass rate 0-100' },
        ats_potential:       { type: 'number',  description: 'Potential ATS pass rate after fixes 0-100' },
        ats_missing_keyword: { type: 'string',  description: 'Single most impactful missing keyword' }
      },
      required: ['match_score','verdict_headline','verdict_sub','ats_pass_rate','ats_potential','ats_missing_keyword']
    }
  },
  {
    name: 'set_skills',
    description: 'Set skills present in the resume with levels.',
    input_schema: {
      type: 'object',
      properties: {
        skills_present: { type: 'array', items: { type: 'string' }, description: 'Up to 6 skills most relevant to target role' },
        skill_levels:   { type: 'object', description: 'Map skill → "Strong"|"Intermediate"|"Basic"', additionalProperties: { type: 'string' } }
      },
      required: ['skills_present','skill_levels']
    }
  },
  {
    name: 'set_gaps',
    description: 'Set skill gaps. Call after set_skills.',
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
              how_often:  { type: 'number', description: 'Realistic % this skill appears in job postings' },
              how_to_fix: { type: 'string', description: 'Specific resource with URL' }
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
    description: 'Set LinkedIn optimization. ZERO visa words. ZERO "open to work". ZERO "seeking".',
    input_schema: {
      type: 'object',
      properties: {
        linkedin_headline: { type: 'string', description: 'Under 200 chars. No status language. Sounds like someone who built something.' },
        linkedin_about:    { type: 'string', description: '3 sentences. 1: what they built. 2: tools/skills. 3: direction. No corporate speak.' },
        linkedin_skills:   { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Skills to add to LinkedIn' }
      },
      required: ['linkedin_headline','linkedin_about','linkedin_skills']
    }
  },
  {
    name: 'set_certifications',
    description: 'Pick exactly 3 certs from the provided list. Use exact names.',
    input_schema: {
      type: 'object',
      properties: {
        cert_picks:   { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3, description: 'Exact names from the provided list' },
        cert_reasons: { type: 'object', additionalProperties: { type: 'string' }, description: 'Map cert name → one sentence why it closes a gap' }
      },
      required: ['cert_picks','cert_reasons']
    }
  },
  {
    name: 'set_projects',
    description: 'Set 3 project suggestions. Each must name a specific API/dataset and be startable this weekend.',
    input_schema: {
      type: 'object',
      properties: {
        projects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              market_signal:  { type: 'number', description: '% of postings requiring primary skill' },
              title:          { type: 'string' },
              justification:  { type: 'string', description: 'One sentence why this closes their biggest gap' },
              description:    { type: 'string', description: 'Two sentences. Name the API, tools, exact output.' },
              skills:         { type: 'array', items: { type: 'string' } },
              time_hours:     { type: 'number' },
              ai_prompt:      { type: 'string', description: 'Full three-phase prompt. Phase 1 planning, Phase 2 design, Phase 3 guided coding. Student types "next phase" to advance.' },
              bullets:        { type: 'array', items: { type: 'string', description: 'Resume bullet with [X][Y][Z] placeholders' }, minItems: 2, maxItems: 2 }
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
    description: 'Set resume quality scores and Tab 3 headline roast.',
    input_schema: {
      type: 'object',
      properties: {
        bullet_quality: { type: 'number', description: '0-10' },
        impact_metrics: { type: 'number', description: '0-10' },
        ats_alignment:  { type: 'number', description: '0-10' },
        headline_roast: { type: 'string', description: 'Punchy one sentence roast referencing something specific in their actual resume.' }
      },
      required: ['bullet_quality','impact_metrics','ats_alignment','headline_roast']
    }
  },
  {
    name: 'add_bullet_group',
    description: 'Add one company worth of resume bullets. Call once per company.',
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
              text:         { type: 'string',  description: 'Exact bullet from resume' },
              status:       { type: 'string',  enum: ['green','red'] },
              brutal_honey: { type: 'string',  description: 'Red only: ONE paragraph. Uncomfortable truth first, then what is salvageable. null for green.' },
              rewrite:      { type: 'string',  description: 'Red only: Stronger version with [X][Y][Z] placeholders. null for green.' }
            },
            required: ['text','status','brutal_honey','rewrite']
          }
        }
      },
      required: ['company','role','items']
    }
  },
  {
    name: 'set_jd_breakdown',
    description: 'Only call if a job description was provided. Break down JD requirements.',
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
              note:        { type: 'string', description: 'One sentence assessment' }
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
// SYSTEM PROMPT — static section (cached by Anthropic)
// ═══════════════════════════════════════════════════════
function buildSystemPrompt(certNames) {
  return `You are GradLaunch — a brutally honest but genuinely helpful career advisor for students navigating the US job market. You are the brilliant, slightly sarcastic senior friend who works in recruiting and actually wants them to win.

YOUR VOICE:
- Direct and specific — always reference THIS resume, THIS role, THIS person's actual experience
- Slightly sarcastic but never mean — uncomfortable truths delivered with immediate redemption
- Sound like a person, never a product
- Every output should feel written specifically for this student, not copied from a template

FORBIDDEN PHRASES — never use:
"results-driven", "passionate about", "seeking opportunities", "open to work",
"team player", "synergy", "leveraged", "utilized", any visa language (OPT, H-1B, F-1, EAD, work authorization, green card)

AVAILABLE CERTIFICATIONS — cert_picks must use exact names from this list:
${certNames}

TOOL CALLING ORDER — always in this sequence:
1. set_verdict (renders immediately — student sees this first)
2. set_skills
3. set_gaps
4. set_linkedin
5. set_certifications
6. set_projects
7. set_scores
8. add_bullet_group (once per company — call multiple times)
9. set_jd_breakdown (only if JD was provided)

QUALITY RULES:
- verdict_headline: must be quotable and specific to THIS resume. "Your resume is technically correct and completely forgettable." not "Your resume needs improvement."
- brutal_honey: ONE paragraph per red bullet. Uncomfortable truth first, then redemption. Human voice.
- rewrite: must have [X] [Y] [Z] placeholders. Always end with: "Estimates count — ~40% faster based on before/after testing is real data."
- projects: name a specific free API or dataset, specific tools, specific output.
- linkedin_headline: under 200 chars, zero status language, sounds like someone who built something
- All percentages must be realistic — never fabricate high numbers`;
}

// ═══════════════════════════════════════════════════════
// NORMALIZE HELPERS
// ═══════════════════════════════════════════════════════
function normalizeCerts(certPicks, certReasons, role) {
  const picks = (certPicks || []).filter(n => CERTS_DB[n]);
  const certs = picks.map(n => ({
    name: n, ...CERTS_DB[n],
    why: certReasons?.[n] || 'Directly closes your top gap.'
  })).slice(0, 3);
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
        // Include salary in verdict so frontend can render sum-row completely
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
    case 'set_projects':
      sendEvent(res, 'projects', {
        projects: (args.projects || []).slice(0, 3).map(p => ({
          market_signal: clamp(p.market_signal || 50, 0, 100),
          title:         p.title || '',
          justification: p.justification || '',
          description:   p.description || '',
          skills:        p.skills || [],
          time_hours:    p.time_hours || 8,
          ai_prompt:     p.ai_prompt || '',
          bullets:       (p.bullets || []).slice(0, 2)
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
// FIX: toolBuffers is passed in per-request — no module-level shared state
// ═══════════════════════════════════════════════════════
function handleStreamEvent(event, toolBuffers, res, sal, role, certNames) {
  const type = event.type;

  // Ignore thinking blocks — internal reasoning, never shown to students
  if (type === 'content_block_start' && event.content_block?.type === 'thinking') return;
  if (type === 'content_block_delta' && event.delta?.type === 'thinking_delta')   return;
  if (type === 'content_block_delta' && event.delta?.type === 'thinking_summary_delta') return;

  // Tool use start — register buffer keyed by tool_use_id
  if (type === 'content_block_start' && event.content_block?.type === 'tool_use') {
    const { id, name } = event.content_block;
    toolBuffers[id] = { name, args: '', complete: false };
    return;
  }

  // Tool use delta — accumulate partial JSON into correct buffer using event.index
  // We find the buffer by matching the most recently opened incomplete one
  // This works correctly because Claude calls tools sequentially
  if (type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
    const openId = Object.keys(toolBuffers).find(id => !toolBuffers[id].complete);
    if (openId) {
      toolBuffers[openId].args += event.delta.partial_json || '';
    }
    return;
  }

  // Content block stop — parse and emit the completed tool call
  if (type === 'content_block_stop') {
    for (const [id, buf] of Object.entries(toolBuffers)) {
      if (!buf.complete && buf.args) {
        buf.complete = true;
        try {
          const parsed = JSON.parse(buf.args);
          emitToolCall(buf.name, parsed, res, sal, role, certNames);
        } catch (e) {
          console.error(`Tool parse error for ${buf.name}:`, e.message,
            buf.args.substring(0, 120));
        }
      }
    }
    return;
  }
}

// ═══════════════════════════════════════════════════════
// STREAMING ANALYSIS
// ═══════════════════════════════════════════════════════
async function streamAnalysis({ apiKey, systemPrompt, userContent, tools, res, fileId, certNames, role, sal }) {
  return new Promise((resolve, reject) => {

    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      thinking: { type: 'adaptive'},
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
          content: userContent  // FIX: was redundant ternary, now direct
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
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
        'Content-Length': Buffer.byteLength(requestBody)
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
          } catch {
            reject(new Error(`API error ${anthropicRes.statusCode}`));
          }
        });
        return;
      }

      let buffer = '';
      // FIX: toolBuffers is local to this request — no shared state between requests
      const toolBuffers = {};
      let fileDeleted = false;

      anthropicRes.on('data', (chunk) => {
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

    req.on('timeout', () => req.destroy(new Error('Request timed out after 55 seconds')));
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
      resetAt: rate.resetAt,
      remaining: 0
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
  const rateAfter  = getRateStatus(ip);
  const locationStr = location.trim() || 'Nationwide USA';
  const locKey = Object.keys(SALARY).find(
    k => k !== 'default' && locationStr.toLowerCase().includes(k)
  ) || 'default';
  const sal = SALARY[locKey];

  const certNames   = Object.keys(CERTS_DB).join(', ');
  const systemPrompt = buildSystemPrompt(certNames);

  // Build user message
  const userContent = fileId
    ? [
        { type: 'document', source: { type: 'file', file_id: fileId } },
        { type: 'text', text: buildAnalysisPrompt(role, locationStr, jd, hasJD, sal) }
      ]
    : buildAnalysisPrompt(role, locationStr, jd, hasJD, sal) + `\n\nRESUME TEXT:\n${resume}`;

  // Streaming headers — X-Accel-Buffering prevents Vercel nginx buffering
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-RateLimit-Remaining', rateAfter.remaining);
  if (rateAfter.resetAt) res.setHeader('X-RateLimit-Reset', rateAfter.resetAt);

  // Send metadata first — frontend renders salary immediately
  sendEvent(res, 'metadata', {
    role,
    location:      locationStr,
    rateRemaining: rateAfter.remaining,
    rateResetAt:   rateAfter.resetAt || null
    // Note: salary is now sent inside set_verdict so sum-row renders atomically
  });

  try {
    await streamAnalysis({ apiKey, systemPrompt, userContent, tools: TOOLS,
      res, fileId, certNames, role, sal });
  } catch (err) {
    console.error('Stream error:', err.message);
    sendEvent(res, 'error', { message: err.message || 'Analysis failed. Please try again.' });
    res.end();
  }
};

// ═══════════════════════════════════════════════════════
// BUILD ANALYSIS PROMPT
// ═══════════════════════════════════════════════════════
function buildAnalysisPrompt(role, locationStr, jd, hasJD, sal) {
  return `Analyze this resume for a ${role} role in ${locationStr}.

${hasJD ? `JOB DESCRIPTION:\n${jd}\n\nAlso call set_jd_breakdown since a JD was provided.` : ''}

Salary context for ${locationStr} (use for context only, do not output):
Entry: ${sal.e} | Mid: ${sal.m} | Senior: ${sal.s}

Call tools in the required order. Be brutally honest and specific to this actual resume — never generic.`;
}
