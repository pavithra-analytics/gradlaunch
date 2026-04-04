'use strict';
const https        = require('https');
const { deleteFile }              = require('./upload');
const { roleCacheKey, upstashGet, ROLES, SKILL_KEYWORDS } = require('./warmcache');

// ── Model strings from env vars — swap without code deploy ──
// Set STREAM_A_MODEL and STREAM_B_MODEL in Vercel environment variables.
// Fallbacks pin to last tested versions.
const MODEL_A = process.env.STREAM_A_MODEL || 'claude-haiku-4-5';
const MODEL_B = process.env.STREAM_B_MODEL || 'claude-sonnet-4-5';

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
    .slice(0, 10); // scan more lines for better coverage

  // Labelled patterns — high confidence
  const patterns = [
    /^(?:job\s+title|position|role|title)\s*[:]\s*(.+)$/i,
    /^we(?:'re| are) (?:hiring|looking for|seeking)\s+(?:a\s+|an\s+)?(.+)$/i,
    /^(?:about the role|the role|the position)\s*[:]\s*(.+)$/i,
    /^(?:open(?:ing)?|opportunity)\s*[:]\s*(.+)$/i,
    /^(?:join .+ as)\s+(?:a\s+|an\s+)?(.+)$/i,
  ];

  for (const line of lines) {
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m && m[1]) {
        const cleaned = m[1].replace(/[–—\-]\s*Remote.*$/i, '').replace(/\s*\(.*$/, '').trim();
        const matched = fuzzyMatchRole(cleaned);
        if (matched) return { role: cleaned, matched };
      }
    }
  }

  // Fallback: try each short line as a potential role title
  for (const line of lines) {
    if (line.length > 4 && line.length < 80 && !/http|www|@|apply|deadline|posted/i.test(line)) {
      const matched = fuzzyMatchRole(line);
      if (matched) return { role: line, matched };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════
// JD REQUIREMENT EXTRACTION (deterministic, rule-based)
//
// Scans pasted JD text against the same SKILL_KEYWORDS used
// by the warmcache scraper. Produces a stable list of
// requirements regardless of Claude. When merged with market
// data, this ensures JD mode feeds the same deterministic
// pipeline as target-role mode.
// ═══════════════════════════════════════════════════════
function extractJDRequirements(jd) {
  if (!jd || jd.trim().length < 50) return [];
  const text = jd.toLowerCase();
  const found = [];
  const seen  = new Set();

  for (const kw of SKILL_KEYWORDS) {
    const needle = kw.trim().toLowerCase();
    if (needle.length < 2) continue;
    // Word-boundary-aware match for short keywords to avoid false positives
    // e.g. "r " should not match inside "researcher"
    if (needle.length <= 3) {
      // Use word boundary regex for very short keywords
      const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (!re.test(jd)) continue;
    } else {
      if (!text.includes(needle)) continue;
    }
    if (seen.has(needle)) continue;
    seen.add(needle);
    found.push(needle);
  }

  return found;
}

// ═══════════════════════════════════════════════════════
// JD CACHE — in-memory, keyed by normalized JD hash.
// Avoids re-parsing the same JD on repeated runs within
// the same serverless container lifetime. No external infra.
// ═══════════════════════════════════════════════════════
const jdCache = new Map();
const JD_CACHE_MAX = 50; // cap to prevent memory growth

function hashJD(jd) {
  // Simple but deterministic hash — same JD text = same key
  let h = 0;
  for (let i = 0; i < jd.length; i++) {
    h = ((h << 5) - h + jd.charCodeAt(i)) | 0;
  }
  return 'jd_' + h.toString(36);
}

function getCachedJDParse(jd) {
  const key = hashJD(jd.trim().toLowerCase());
  return jdCache.get(key) || null;
}

function setCachedJDParse(jd, result) {
  const key = hashJD(jd.trim().toLowerCase());
  if (jdCache.size >= JD_CACHE_MAX) {
    // Evict oldest entry
    const firstKey = jdCache.keys().next().value;
    jdCache.delete(firstKey);
  }
  jdCache.set(key, result);
}

// Build a merged skill frequency list from market data + JD requirements.
// Two-tier approach:
//   Tier 1: skills in both JD and market data — ranked by real market pct
//   Tier 2: JD-only skills (not in market data) — always ranked below Tier 1,
//           ordered by appearance in JD. No fake market percentages.
function mergeMarketAndJDSkills(marketSkillFreq, jdRequirements) {
  if (!jdRequirements || !jdRequirements.length) return marketSkillFreq || [];

  const merged = [];
  const seen   = new Set();

  // Tier 1: market data skills (authoritative frequencies)
  if (marketSkillFreq && marketSkillFreq.length) {
    for (const s of marketSkillFreq) {
      merged.push({ ...s });
      seen.add(s.skill.toLowerCase());
    }
  }

  // Tier 2: JD-only requirements not in market data
  // pct: 0 ensures they never outrank real market skills.
  // _jdOrder preserves appearance order within Tier 2.
  let jdOrder = 0;
  for (const req of jdRequirements) {
    if (seen.has(req)) continue;
    seen.add(req);
    merged.push({ skill: req, pct: 0, _fromJD: true, _jdOrder: jdOrder++ });
  }

  // Sort: Tier 1 by pct descending, then Tier 2 by JD appearance order
  merged.sort((a, b) => {
    if (a._fromJD && !b._fromJD) return 1;  // JD-only after market
    if (!a._fromJD && b._fromJD) return -1;  // market before JD-only
    if (a._fromJD && b._fromJD) return (a._jdOrder || 0) - (b._jdOrder || 0);
    return b.pct - a.pct;
  });
  return merged;
}

// ═══════════════════════════════════════════════════════
// SALARY — sourced from warmcache scrape when available.
// Falls back to Claude's knowledge via prompt instruction.
// No hardcoded table — role-specific accuracy requires
// either live data or Claude's training, not a generic map.
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// CERTIFICATIONS — Claude recommends freely from knowledge.
// No hardcoded database — the 23-cert list caused wrong
// recommendations (e.g. Databricks for SDE) because it
// couldn't cover every role. Claude knows real certs for
// any role including Pilot, Pharmacist, Chemist, etc.
// Prompt constraints prevent hallucination (see buildSystemPromptB).
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// SERVER-SIDE ATS + MATCH SCORE CALCULATION
//
// Computes deterministic ATS keyword match from resume text
// vs scraped skillFreq data. Same resume + same role = same
// number every run. Claude is told this number — not asked
// to calculate it — eliminating run-to-run inconsistency.
// ═══════════════════════════════════════════════════════
function computeATS(resumeText, skillFreq) {
  if (!skillFreq || !skillFreq.length || !resumeText) {
    return { atsScore: null, atsPotential: null, missingTop: [], presentTop: [] };
  }

  const text = resumeText.toLowerCase();
  // Use top 15 skills from scrape for richer signal
  const top15 = skillFreq.slice(0, 15);

  const present = top15.filter(s => text.includes(s.skill.toLowerCase()));
  const missing = top15.filter(s => !text.includes(s.skill.toLowerCase()));

  const atsScore     = Math.round((present.length / top15.length) * 100);
  // Target 75% (industry ATS pass threshold) — show how many keywords needed
  const TARGET       = 75;
  const targetCount  = Math.ceil(top15.length * TARGET / 100); // = 12 for top15
  const needed       = Math.max(0, targetCount - present.length);
  // atsPotential: what score would be after adding the needed keywords
  const atsPotential = atsScore >= TARGET
    ? Math.min(100, Math.round(((present.length + Math.min(3, missing.length)) / top15.length) * 100))
    : TARGET; // always show 75 as the achievable target when below threshold

  return {
    atsScore,
    atsPotential,
    needed,
    missingTop: missing.slice(0, 5).map(s => s.skill),
    presentTop: present.slice(0, 8).map(s => s.skill)
  };
}

// ═══════════════════════════════════════════════════════
// DETERMINISTIC SKILL & GAP DETECTION
//
// Scans resume text against market data to produce stable
// present/missing skill lists. Same resume + same market data
// = identical output every run. Claude receives these as
// ground truth and must not override them.
// ═══════════════════════════════════════════════════════
function computeSkillsAndGaps(resumeText, skillFreq) {
  if (!skillFreq || !skillFreq.length || !resumeText) {
    return { present: [], missing: [], presentSet: new Set() };
  }

  const text = resumeText.toLowerCase();
  // Use top 20 skills from market data for comprehensive coverage
  const topSkills = skillFreq.slice(0, 20);

  const present = [];
  const missing = [];
  const presentSet = new Set();

  for (const s of topSkills) {
    const skillLower = s.skill.toLowerCase();
    if (text.includes(skillLower)) {
      present.push({ skill: s.skill, pct: s.pct });
      presentSet.add(skillLower);
    } else {
      const entry = { skill: s.skill, pct: s.pct };
      if (s._fromJD) entry._fromJD = true;
      missing.push(entry);
    }
  }

  // Sort present by market frequency descending
  present.sort((a, b) => b.pct - a.pct);
  // Sort missing: market skills by pct descending, then JD-only skills last
  // (JD-only already in appearance order from the merged list)
  missing.sort((a, b) => {
    if (a._fromJD && !b._fromJD) return 1;
    if (!a._fromJD && b._fromJD) return -1;
    return b.pct - a.pct;
  });

  return { present, missing, presentSet };
}

// Deterministic skill level assignment based on frequency of mentions in resume
// Strong: 3+ mentions, Intermediate: 2, Basic: 1
function computeSkillLevel(skillName, resumeText) {
  const text = resumeText.toLowerCase();
  const needle = skillName.toLowerCase();
  let count = 0;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(needle, idx + needle.length);
  }
  if (count >= 3) return 'Strong';
  if (count >= 2) return 'Intermediate';
  return 'Basic';
}

// Deterministic gap priority based on market frequency
// >=60% of postings = Critical, >=35% = Important, else Nice to have
function computeGapPriority(pct) {
  if (pct >= 60) return 'Critical';
  if (pct >= 35) return 'Important';
  return 'Nice to have';
}

// Match score: weighted blend of ATS coverage + skills breadth
// 70% ATS keyword coverage + 30% skills count signal
// Bounded to realistic range — never above 95 or below 5
function computeMatchScore(atsScore, skillsFound, topSkillsRequired) {
  const skillsCoverage = topSkillsRequired > 0
    ? Math.round((skillsFound / topSkillsRequired) * 100)
    : atsScore;
  const raw = Math.round(atsScore * 0.7 + skillsCoverage * 0.3);
  return Math.min(95, Math.max(5, raw));
}

// ═══════════════════════════════════════════════════════
// RESUME ANCHOR EXTRACTION
// Extracts specific facts (companies, metrics) for grounding AI outputs.
// Prevents generic LinkedIn/diagnosis content by giving Claude real anchors.
// ═══════════════════════════════════════════════════════
function extractResumeAnchors(resumeText) {
  if (!resumeText) return { companies: [], metrics: [] };

  const lines = resumeText.split('\n').map(l => l.trim()).filter(Boolean);
  const datePattern = /\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
  const sectionHeaders = /^(experience|education|skills|projects|work history|summary|objective|certifications|awards|publications|interests|activities|languages)\s*$/i;

  // Company/employer extraction: short lines (2-14 words) containing a year or month
  // that don't look like section headers, bullet points, or pure date ranges
  const companies = [];
  for (const line of lines) {
    if (line.startsWith('\u2022') || line.startsWith('-') || line.startsWith('*')) continue;
    if (sectionHeaders.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 14) continue;
    if (!datePattern.test(line)) continue;
    // Extract first segment as company/employer name (before common separators)
    const seg = line.split(/[\|–\u2014\u00b7\t]/)[0].trim();
    if (seg.length >= 2 && seg.length <= 60 && !sectionHeaders.test(seg) && !/^\d/.test(seg)) {
      companies.push(seg);
    }
  }

  // Metrics extraction: numbers with business units (%, x, $, K, M)
  const metricPattern = /\b(\d+(?:\.\d+)?%|\d+[xX]|\$\d+(?:[kmb]|k\+?|m\+?)?|\d{1,3}(?:,\d{3})+|\d+[km]\+?)\b/gi;
  const rawMetrics = resumeText.match(metricPattern) || [];
  const metrics = [...new Set(rawMetrics)].slice(0, 6);

  return {
    companies: [...new Set(companies)].slice(0, 4),
    metrics
  };
}

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
// ── Cert normaliser — parses combined "Provider · Cost · Duration · URL · Why" string ──
function normalizeCerts(certPicks, certReasons) {
  if (!certPicks || !certPicks.length) return [];
  return certPicks.slice(0, 3).map(name => {
    const raw      = certReasons?.[name] || '';
    const parts    = raw.split('·').map(p => p.trim());
    // Format: "Provider · Cost · Duration · URL · Why: ..."
    const provider = parts[0] || '';
    const cost     = parts[1] || '';
    const duration = parts[2] || '';
    const url      = (parts[3] || '').startsWith('http') ? parts[3] : '';
    const why      = parts.slice(url ? 4 : 3).join('·').replace(/^Why:\s*/i,'').trim()
                  || raw || 'Closes your top gap for this role.';
    return { name, provider, cost, duration, url, why };
  }).filter(c => c.name.length > 2);
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
        ats_missing_keyword: { type: 'string',  description: 'Single most impactful missing keyword for this role from market data' },
        salary_range:        { type: 'string',  description: 'Salary range for this role e.g. "$75k – $145k". Only output when no salary data was provided from postings. Use your training knowledge for the specific role and location.' }
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
        bullet_quality: { type: 'number', description: '0-10: how well the bullets demonstrate skills and outcomes that a recruiter for THIS specific target role would value. Strong backend system bullet on an SDE resume = high. Analytics dashboard bullet on an SDE resume = low even if well-written.' },
        impact_metrics: { type: 'number', description: '0-10: how well the quantified outcomes in the resume map to the metrics and outcomes this target role actually cares about. Revenue, uptime, scale, performance for engineering. DAU, retention, experiment velocity for product. Role-specific impact, not general writing quality.' },
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
          description: 'Format: [Core identity] | [Named tool from resume] | [Concrete outcome type]. Under 160 chars. [Core identity]: what this person actually does based on resume content, not a generic job title. [Named tool]: must be a specific real tool named in the resume text (e.g. Python, dbt, Mixpanel, Snowflake, Tableau, Spark — not "analytics" or "technology"). [Concrete outcome]: the type of result this person delivers, grounded in their experience. Example: Data Analyst | dbt + Snowflake | Turning warehouse data into decisions product teams actually use. Never use "seeking", "open to", or any status phrase.'
        },
        linkedin_about: {
          type: 'string',
          description: 'Exactly 3 sentences. MAXIMUM 80 WORDS TOTAL. SENTENCE 1: Start with a specific action at a named company from the resume — e.g. "At [Company], built [specific thing] using [tool] that [specific result or outcome]." If no metric exists, name the tool and the scope. Do NOT start with "I am" or any forbidden opener. SENTENCE 2: Write the 2-3 skills most demanded for this role from market data as active capabilities — what you do, not what you know. SENTENCE 3: The type of problem you want to work on next, stated as a capability or approach, not a job title or aspiration. FORBIDDEN OPENERS: I am a, As a, With X years, Passionate about, Dedicated, Results-driven, Looking for, Seeking. Sound like a smart person wrote this for themselves — specific, grounded, direct.'
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
    description: 'Recommend exactly 3 certifications that close the most critical gaps for this specific role.',
    input_schema: {
      type: 'object',
      properties: {
        cert_picks: {
          type: 'array',
          items: { type: 'string' },
          minItems: 3,
          maxItems: 3,
          description: 'Exactly 3 certification names. Must be real, verifiable credentials from official vendors.'
        },
        cert_reasons: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Map cert name to a single string: "Provider · Cost · Duration · URL · Why: one sentence on which gap it closes." Example: "AWS · $150 · 2-3 months · aws.amazon.com/certification · Java appears in 95% of SDE postings and this cert demonstrates backend system knowledge."'
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
              ats_keywords:  { type: 'array', items: { type: 'string' }, maxItems: 3, description: '2-3 ATS keywords (verbatim from market data top-10) that recruiters and hiring systems will find demonstrated by this project. Choose the highest-frequency missing skills this project directly proves.' },
              time_hours:    { type: 'number' },
              ai_prompt:     {
                type: 'string',
                description: 'A complete 4-phase AI prompt the student can paste into Claude or ChatGPT. EXACT STRUCTURE REQUIRED for ALL THREE projects: Line 1: Act as a senior [specific role matching tech stack]. We are building [exact project title] together from scratch using [specific free API or dataset] and [exact tool stack]. The final output will be [specific visual description of deliverable]. PHASE 1 — PLAN: Ask me 3 targeted questions: what this will do, who will use it, and what the most important metric I want to show a recruiter is. Say ready to design when done. PHASE 2 — DESIGN: Show the exact folder structure, every file name, and every function as a stub with typed inputs and outputs. Get my approval before writing any implementation code. Say ready to build when done. PHASE 3 — BUILD: Implement one function at a time starting with data fetching. Show actual output after each function. Never advance until the current function works. PHASE 4 — RESUME VALUE: Once the project is complete, generate 2 resume bullets. Strong action verb first. Include [the top ATS keyword for this role]. Under 20 words each. Format: [Verb] [what you built] [metric placeholder]. Under 250 words total. No dashes. This exact structure and quality is required for project 1, 2, AND 3.'
              },
              bullets: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 2,
                description: 'Two resume bullets assuming project complete. Strong action verb. Metric placeholders [X] [Y] [Z]. Include the most in-demand ATS keyword for this role from market data. Under 20 words each.'
              }
            },
            required: ['market_signal','title','justification','description','skills','ats_keywords','time_hours','ai_prompt','bullets']
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
skill_relevance: The server will override your values using the actual scraped data. Still output your best estimate using the EXACT percentages listed — it helps validation. If SQL appears at 82% in the data, output 82 for SQL. Never output a value higher than what the market data shows for that skill.
set_gaps how_often: EXACT % from market data. Only name skills that appear in the market data list. Do NOT invent skill name variations like "Advanced SQL" if the market data shows "sql". Use the exact skill name from the market data.
set_gaps skills: ONLY use skill names that appear verbatim in the market data list provided. If a skill is not in the market data list, do not include it as a gap.
set_gaps count: ALWAYS output exactly 5 gaps. If fewer than 5 critical gaps exist, add Important or Nice to have items to reach exactly 5. Never output fewer than 5.

ATS SCORING:
ats_pass_rate and ats_potential are pre-computed and injected above as PRE-COMPUTED ATS KEYWORD MATCH. Use those EXACT numbers. Do not recalculate.
ats_missing_keyword: use the top missing keyword from the pre-computed data above.
CONSISTENCY RULE: The ats_alignment score in set_scores (0-10 scale) MUST equal ats_pass_rate ÷ 10, rounded. If ats_pass_rate is 40%, ats_alignment must be 4. Never let these two numbers contradict each other.

ROLE-SPECIFIC SCORING — CRITICAL:
bullet_quality and impact_metrics must reflect how well this resume serves the TARGET ROLE, not general writing quality.
bullet_quality: score low if bullets describe work irrelevant to the target role, even if they are well-written.
impact_metrics: score based on whether the quantified results are the type this role cares about. An SDE role cares about scale, latency, uptime, shipped features. A Product Analyst role cares about DAU, retention, experiment results, revenue impact. Dashboard metrics mean nothing on an SDE resume.
Example: a beautifully written analytics bullet on an SDE resume scores 2-3/10 on both metrics, not 8/10.

VERDICT QUALITY:
verdict_headline must name something SPECIFIC from this resume. A company, a tool, a number, a gap. If you could apply the same sentence to a different resume without changing a word, rewrite it. GROUNDING CHECK: does it name a real company from this resume, OR a specific gap by exact skill name, OR a specific metric from the resume? If none of these, name the most unusual or differentiating aspect of this person's experience. Generic phrases like "strong potential but gaps remain" are forbidden.
brutal_honey: MAXIMUM 3 SENTENCES. No dashes. Sentence 1: quote or directly reference the specific verb or claim from this exact bullet — not a generic observation like "this bullet lacks impact." Sentence 2: what is salvageable from the bullet text itself. Sentence 3: one concrete direction for the rewrite. Nothing more.
rewrite: ONE sentence under 25 words. Strong verb first. Most relevant ATS keyword from market data. [X][Y][Z] only where numbers are genuinely missing. Self-check before outputting: strong verb? keyword? under 25 words? Revise once if any check fails.
NEVER output <REMOVE>, <DELETE>, or any meta-instruction as the rewrite value. If a bullet is completely irrelevant to the target role and cannot be salvaged, set rewrite to null and explain in brutal_honey why the bullet should be removed or replaced with a role-relevant one.

TOOL ORDER: set_verdict, set_skills, set_gaps, set_scores, add_bullet_group once per company, set_jd_breakdown only if JD provided.
Call EVERY tool. Never stop after set_verdict.`,
      cache_control: { type: 'ephemeral' }
    }
  ];
}

function buildSystemPromptB() {
  return [
    {
      type: 'text',
      text: `You are GradLaunch's senior career strategist. You have personally reviewed 10,000 resumes and written LinkedIn profiles for candidates who got hired at Google, Stripe, and early-stage startups. You can spot a generic AI-generated response instantly, and you refuse to produce one.

YOUR STANDARD:
Every output must make the student say how did it know that about me, not this could apply to anyone.
If you write something a recruiter has seen before, you have failed.
Specificity is your only tool. Reference company names from the resume, specific tools they used, specific numbers if present, specific market data percentages.

ANTI-HALLUCINATION RULE — CRITICAL:
You may ONLY reference facts that appear explicitly in the resume text or job description provided. This means:
- Only mention companies that are named in the resume
- Only mention projects that are described in the resume
- Only mention tools, technologies, or skills that appear in the resume
- Only use numbers or metrics that appear in the resume
- If the resume does not contain enough specific detail for a sentence, write a more general capability statement instead
- NEVER invent a project, achievement, company, or metric that is not in the resume
- If you find yourself writing something specific that you cannot point to in the resume text, replace it with a general statement about skills or direction

LINKEDIN ABOUT RULE: Every sentence in linkedin_about must be directly traceable to content in the RESUME TEXT provided. If you cannot cite the source in the resume, do not write it.

QUALITY GATE — NON-NEGOTIABLE:
Before finalising linkedin_about, check each sentence: "Could this sentence appear on a different person's resume without changing a word?" If yes, rewrite it. Every sentence must anchor to at least one of: (a) a company name from this resume, (b) a specific tool + action from this resume, (c) a metric from this resume, or (d) a specific type of problem this person has demonstrably worked on. If the resume lacks metrics, name the tool and the context. Generic phrases like "passionate about data" or "experienced in analytics" are forbidden.

HEADLINE SPECIFICITY — CRITICAL:
The [Core identity] segment must reflect this person's actual work type, not just a job title anyone could claim. The [Specific tool or domain] segment must name a real tool from the resume (e.g. Python, dbt, Mixpanel, Snowflake — not "analytics" or "technology"). The [What you deliver] segment must describe the concrete outcome type this person has demonstrated, grounded in their actual experience.

FORBIDDEN OUTPUTS — if you produce any of these, stop and rewrite before outputting:
LinkedIn About openers: I am a, As a, With X years of experience, Passionate about, Dedicated professional, Results-driven, Dynamic, Innovative, Looking for
Any sentence that could apply to a different person's resume without changing a word
linkedin_headline that does not name at least one specific tool from the resume in the middle segment
Project ai_prompt fields that are vague, short, or do not name specific tools and free datasets
linkedin_skills that include skills already prominent in the resume

MARKET DATA IS LAW:
linkedin_skills: pick from top 10 market data frequency for this role that are absent in the resume.
cert_picks: prioritise certs that address skills at high frequency in market data but missing from resume.

CERTIFICATIONS RULE — CRITICAL:
Recommend REAL, VERIFIABLE certifications from official vendors only (AWS, Google, Microsoft, CompTIA, PMI, Salesforce, dbt Labs, Snowflake, Databricks, Tableau, Scrum.org, CFA Institute, etc.).
Pick certs specific to the target role and the gaps identified — NOT generic tech certs for non-tech roles.
For each cert provide: provider name, approximate cost in USD, time to complete, and the official URL.
If you are not certain a certification exists exactly as named, add "(verify before enrolling)" to the reason.
NEVER recommend a cert that is for a completely different field than the target role.

PROJECT SELECTION RULE — CRITICAL:
Each project must be built around a skill that is BOTH:
1. Missing from the resume (not in confirmed skills list)
2. In the top 10 most frequent skills in the market data

Sort projects by the skill's market data frequency descending — highest frequency gap first.
If a skill doesn't appear in the market data top 10, do NOT build a project around it.
This ensures every project directly addresses a skill that appears in a significant portion of real job postings.

PROJECT SIGNAL FLOOR — CRITICAL:
Only suggest a project if its primary skill appears in 25% or more of postings in the market data. If you have 3 or more skills above 25%, use those. If fewer than 3 skills are above 25%, pick the top 3 by frequency — but always sort highest signal first. Never suggest a project whose primary skill appears in less than 10% of postings if better options exist.

PROJECT QUALITY RULE — CRITICAL:
All 3 projects must have identical depth and length in ai_prompt. If you find yourself writing a shorter or vaguer ai_prompt for project 2 or 3, stop and bring it up to match project 1 quality. All three students are paying equal attention. Treat all 3 projects as equally important. The ai_prompt for project 3 must be as complete and copy-pasteable as project 1.

PROJECT PHASES — CRITICAL:
Each ai_prompt must explicitly cover all 4 phases in order: PHASE 1 — PLAN (ask 3 questions about goals, users, and target recruiter metric), PHASE 2 — DESIGN (full folder structure and function stubs with typed inputs/outputs), PHASE 3 — BUILD (one function at a time, show output before advancing), PHASE 4 — RESUME VALUE (generate 2 ATS-optimized bullets using the top missing keyword for this role). No phase can be omitted.

ATS KEYWORDS — CRITICAL:
ats_keywords must contain 2-3 verbatim strings from the market data top-10 that this project directly demonstrates. These are the exact strings ATS systems match. Never list a skill that is already present in the resume. Never list a skill not in the market data top-10.

OUTPUT CONCISENESS — CRITICAL FOR SPEED:
linkedin_about: MAXIMUM 80 WORDS. Three focused sentences only. No padding. Every word must earn its place.
cert_reasons: ONE sentence per cert maximum. Format: "Provider · Cost · Duration · URL · Why: one sentence."
All outputs must be tight and specific. Verbosity wastes the user's time and yours.

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

  const salaryConf = marketData.salaryData?.confidence || 'low';
  const salaryLine = marketData.salaryData
    ? `Salary from postings (NATIONAL, not location-specific): ${marketData.salaryData.median} (${marketData.salaryData.note}, confidence: ${salaryConf})`
    : null;

  const age = marketData.scrapedAt
    ? Math.round((Date.now() - new Date(marketData.scrapedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return `MARKET DATA: Based on ${marketData.totalJobs || 40} real LinkedIn postings for ${matchedRole} (United States, national)${age !== null ? ` scraped ${age} days ago` : ''}:
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
function buildAnalysisPromptA(role, locationStr, jd, hasJD, sal, marketDataBlock, atsFactLine, serverSkills, anchors) {
  const salaryCtx = sal._fromPostings
    ? `Salary from real postings: ${sal._fromPostings} (${sal._confidence === 'high' ? 'high confidence' : 'moderate confidence'}, ${sal._postingNote || ''}). Use this as the basis for the salary range in set_verdict.`
    : sal._weakPostingData
      ? `Limited salary data from postings (only 1-2 listings): ${sal._weakPostingData}. This is too few data points to trust. Provide a broader salary range estimate for a ${role} based on your training knowledge. Format as a wide range (e.g. $65k – $140k). Do NOT present the weak posting data as precise truth.`
      : `No salary data available from postings. In set_verdict, provide your best salary range estimate for a ${role} based on your training knowledge. Format as entry–senior range (e.g. $65k – $140k). Mark it as an estimate. Be role-specific and realistic.`;

  // Inject server-detected skills and gaps so Claude uses them for writing context
  let skillFactLine = '';
  if (serverSkills && serverSkills.present.length > 0) {
    const presentList = serverSkills.present.slice(0, 6).map(s => `${s.skill} (${s.pct}%)`).join(', ');
    const missingList = serverSkills.missing.slice(0, 5).map(s => `${s.skill} (${s.pct}%)`).join(', ');
    skillFactLine = `PRE-COMPUTED SKILLS DETECTED IN RESUME: ${presentList}
PRE-COMPUTED SKILL GAPS (missing from resume, sorted by market frequency): ${missingList}
USE THESE EXACT SKILLS in set_skills (skills_present) and set_gaps. The server controls skill selection, relevance %, and gap priority. Your role is to provide skill_levels assessment and how_to_fix suggestions for each gap. Include how_to_fix for ALL 5 gaps listed above.`;
  }

  // Resume anchors: specific companies and metrics extracted server-side
  // These ground verdict_headline in real resume content, not generic observations
  let anchorLine = '';
  if (anchors) {
    const parts = [];
    if (anchors.companies && anchors.companies.length > 0) {
      parts.push(`Employers/companies found in resume: ${anchors.companies.join(', ')}`);
    }
    if (anchors.metrics && anchors.metrics.length > 0) {
      parts.push(`Metrics found in resume: ${anchors.metrics.join(', ')}`);
    }
    if (parts.length > 0) {
      anchorLine = `RESUME ANCHORS (server-extracted):\n${parts.join('\n')}\nverdict_headline MUST reference one of these companies, one of these metrics, OR name the most critical gap by exact skill name. Never write a generic verdict.\n`;
    }
  }

  return `Analyze this resume for a ${role} role${locationStr !== 'Nationwide USA' ? ` in ${locationStr}` : ''}.

${marketDataBlock}

${atsFactLine ? atsFactLine + '\n' : ''}${skillFactLine ? skillFactLine + '\n' : ''}${anchorLine}${salaryCtx}

${hasJD ? `JOB DESCRIPTION:\n${jd}\n\nSince a JD was provided, also call set_jd_breakdown.` : ''}

Call ALL tools in order. Never stop after set_verdict. Every output must reference actual content from this specific resume.`;
}

function buildAnalysisPromptB(role, locationStr, jd, hasJD, sal, marketDataBlock, resumeText, confirmedSkills, detectedGaps, anchors) {
  // confirmedSkills comes from Stream A's set_skills output — use these as ground truth
  // for what's already in the resume so Sonnet never recommends adding a skill they have
  const skillsNote = confirmedSkills && confirmedSkills.length
    ? `\nCONFIRMED SKILLS ALREADY IN RESUME (from resume analysis — do NOT recommend adding these to LinkedIn):\n${confirmedSkills.join(', ')}\n`
    : '';

  // Inject detected gaps so certification and project recommendations must address them
  const gapsNote = detectedGaps && detectedGaps.length
    ? `\nDETECTED SKILL GAPS (missing from resume, sorted by market frequency):\n${detectedGaps.map(g => `- ${g.skill} (${g.pct}% of postings)`).join('\n')}\nCertification recommendations MUST address skills from this gap list. Do NOT recommend certs for skills already confirmed in the resume.\n`
    : '';

  // Resume anchors: server-extracted companies and metrics for LinkedIn grounding
  // These are the specific facts linkedin_about and linkedin_headline MUST reference
  let anchorsNote = '';
  if (anchors) {
    const anchorParts = [];
    if (anchors.companies && anchors.companies.length > 0) {
      anchorParts.push(`Companies/employers from this resume: ${anchors.companies.join(', ')}`);
    }
    if (anchors.metrics && anchors.metrics.length > 0) {
      anchorParts.push(`Metrics found in this resume: ${anchors.metrics.join(', ')}`);
    }
    if (anchorParts.length > 0) {
      anchorsNote = `\nRESUME ANCHORS — REQUIRED for linkedin_about and linkedin_headline:\n${anchorParts.join('\n')}\nlinkedin_about sentence 1 MUST name at least one of these companies OR one of these metrics. linkedin_headline middle segment MUST name a real tool found in the RESUME TEXT. If no metric is available, name the specific tool and the context in which it was used at one of the listed companies.\n`;
    }
  }

  return `Write LinkedIn optimization, certifications, and project suggestions for a ${role} candidate.

${marketDataBlock}
${skillsNote}${gapsNote}${anchorsNote}
${resumeText ? `RESUME TEXT:\n${resumeText}\n` : ''}
${hasJD ? `JOB DESCRIPTION:\n${jd}\n` : ''}
Call ALL tools: set_linkedin, set_certifications, set_projects.
Every LinkedIn sentence must reference something specific from this resume — use the RESUME ANCHORS above as your primary grounding points. linkedin_about sentence 1 must name a company or metric from the anchors list. Every cert must close a real gap from the DETECTED SKILL GAPS list above. Every project ai_prompt must cover all 4 phases (PLAN, DESIGN, BUILD, RESUME VALUE) and be complete enough to paste directly into Claude or ChatGPT. All 3 project ai_prompts must have identical depth. Every project ats_keywords must name 2-3 verbatim market-data top-10 skills this project demonstrates.`;
}

// ═══════════════════════════════════════════════════════
// TOOL EMITTERS
// ═══════════════════════════════════════════════════════
// ── Server-side skill relevance lookup ──
// Fuzzy-matches a skill name against the scraped skillFreq array.
// Returns the posting % or null if not found.
// ── Confidence threshold for overriding Claude's knowledge ──
// The scrape is reliable for verbatim engineering keywords (SQL, Python, dbt).
// For qualitative/product skills (Google Analytics, Product Sense), the scrape
// often returns low % because LinkedIn JDs don't use those exact strings.
// Below 30%, we return null and trust Claude's domain knowledge instead.
const SCRAPE_CONFIDENCE_THRESHOLD = 30;

function lookupSkillPct(skillName, skillFreq) {
  if (!skillFreq || !skillFreq.length || !skillName) return null;
  const needle = skillName.toLowerCase().trim();
  // Exact match
  let match = skillFreq.find(s => s.skill === needle);
  if (match) return match.pct >= SCRAPE_CONFIDENCE_THRESHOLD ? match.pct : null;
  // Substring match
  match = skillFreq.find(s => needle.includes(s.skill) || s.skill.includes(needle));
  if (match) return match.pct >= SCRAPE_CONFIDENCE_THRESHOLD ? match.pct : null;
  // Word overlap — at least one meaningful word in common
  const words = new Set(needle.split(/\s+/).filter(w => w.length > 2));
  let best = null, bestScore = 0;
  for (const s of skillFreq) {
    const overlap = s.skill.split(/\s+/).filter(w => words.has(w)).length;
    if (overlap > bestScore) { bestScore = overlap; best = s; }
  }
  if (bestScore > 0 && best.pct >= SCRAPE_CONFIDENCE_THRESHOLD) return best.pct;
  return null; // below threshold — trust Claude
}

function emitToolCallA(name, args, res, sal, role, marketData, atsResult, serverSkills) {
  const skillFreq = marketData?._mergedSkillFreq || marketData?.skillFreq || [];
  switch (name) {
    case 'set_verdict': {
      // Use server-computed ATS if available — overrides Claude's calculation
      const atsPass    = atsResult?.atsScore    !== null ? atsResult.atsScore    : clamp(args.ats_pass_rate, 0, 100);
      const atsPot     = atsResult?.atsPotential !== null ? atsResult.atsPotential : clamp(args.ats_potential, 0, 100);
      const atsMissing = atsResult?.missingTop?.[0] || args.ats_missing_keyword || '';
      // Match score: use server formula — deterministic
      const presentCount = serverSkills ? serverSkills.present.length : ((args.skills_present || []).length || 3);
      const matchScore = atsResult?.atsScore !== null
        ? computeMatchScore(atsResult.atsScore, presentCount, 15)
        : clamp(args.match_score, 0, 100);
      // Salary confidence-gated: only show precise range when confidence is medium+
      const salaryConfidence = sal._confidence || (sal._fromPostings ? 'medium' : 'estimate');
      const salaryRange = sal._fromPostings || args.salary_range || null;
      sendEvent(res, 'verdict', {
        match_score:         matchScore,
        verdict_headline:    args.verdict_headline || `${role} resume analyzed.`,
        verdict_sub:         args.verdict_sub || '',
        ats_pass_rate:       atsPass,
        ats_potential:       atsPot,
        ats_missing_keyword: atsMissing,
        ats_missing_list:    atsResult?.missingTop?.slice(0, 3) || [],
        ats_needed:          atsResult?.needed ?? null,
        salary: {
          range:        salaryRange,
          fromPostings: sal._fromPostings || null,
          confidence:   salaryConfidence
        }
      });
      break;
    }

    case 'set_skills': {
      // DETERMINISTIC SKILL LIST:
      // When server-side skill detection is available, use it as ground truth
      // for skill names and relevance %. Claude's skill_levels are replaced
      // with deterministic mention-count levels. Claude only identifies skills
      // — the server decides relevance and level.
      if (serverSkills && serverSkills.present.length > 0) {
        const topPresent = serverSkills.present.slice(0, 6);
        const skills     = topPresent.map(s => s.skill);
        const levels     = {};
        const relevance  = {};
        for (const s of topPresent) {
          levels[s.skill]    = computeSkillLevel(s.skill, serverSkills._resumeText || '');
          relevance[s.skill] = s.pct; // exact market data %
        }
        emitToolCallA._lastSkills = skills;
        sendEvent(res, 'skills', {
          skills_present:  skills,
          skill_levels:    levels,
          skill_relevance: relevance
        });
      } else {
        // Fallback: no market data — use Claude's output with server overrides
        const skills   = (args.skills_present || []).slice(0, 6);
        const levels   = args.skill_levels || {};
        emitToolCallA._lastSkills = skills;
        const relevance = {};
        for (const s of skills) {
          const scraped = lookupSkillPct(s, skillFreq);
          if (scraped !== null) {
            relevance[s] = scraped;
          } else {
            const claudeVal = (args.skill_relevance || {})[s];
            relevance[s] = (claudeVal > 0 && claudeVal <= 100) ? Math.min(claudeVal, 85) : 0;
          }
        }
        sendEvent(res, 'skills', {
          skills_present:  skills,
          skill_levels:    levels,
          skill_relevance: relevance
        });
      }
      break;
    }

    case 'set_gaps': {
      // DETERMINISTIC GAP LIST:
      // When server-side detection is available, use missing skills from market data
      // as the authoritative gap list. Priority is computed from market frequency.
      // Claude provides how_to_fix text (writing), but the gap selection and ranking
      // are deterministic.
      if (serverSkills && serverSkills.missing.length > 0) {
        const serverGaps = serverSkills.missing.slice(0, 5);
        // Build a lookup of Claude's how_to_fix suggestions keyed by lowercase skill
        const claudeFixes = {};
        for (const g of (args.gaps || [])) {
          if (g.skill && g.how_to_fix) {
            claudeFixes[g.skill.toLowerCase().trim()] = g.how_to_fix;
          }
        }

        const gaps = serverGaps.map(g => {
          const isJDOnly = !!g._fromJD;
          return {
            skill:      g.skill,
            priority:   isJDOnly ? 'Important' : computeGapPriority(g.pct),
            how_often:  isJDOnly ? 0 : g.pct,
            how_to_fix: claudeFixes[g.skill.toLowerCase()] || claudeFixes[g.skill] || '',
            _fromJD:    isJDOnly || undefined
          };
        });

        emitToolCallA._lastGaps = gaps;
        sendEvent(res, 'gaps', { gaps });
      } else {
        // Fallback: no market data — use Claude's gaps with server overrides
        const confirmedSkills = new Set(
          (args.skills_present || emitToolCallA._lastSkills || [])
            .map(s => s.toLowerCase().trim())
        );
        const claudeGaps = (args.gaps || []).slice(0, 7).map(g => {
          let skillName = g.skill || '';
          if (skillFreq.length) {
            const scraped = lookupSkillPct(skillName, skillFreq);
            if (scraped === null) {
              const lower = skillName.toLowerCase();
              const base  = skillFreq.find(s =>
                lower.includes(s.skill) || s.skill.includes(lower.split(' ')[0])
              );
              if (base && base.pct >= SCRAPE_CONFIDENCE_THRESHOLD) skillName = base.skill;
            }
          }
          const marketPct = lookupSkillPct(skillName, skillFreq);
          return {
            skill:      skillName,
            priority:   ['Critical','Important','Nice to have'].includes(g.priority) ? g.priority : 'Important',
            how_often:  marketPct !== null ? marketPct : clamp(g.how_often || 0, 0, 100),
            how_to_fix: g.how_to_fix || ''
          };
        })
        .filter(g => !confirmedSkills.has(g.skill.toLowerCase().trim()))
        .sort((a, b) => b.how_often - a.how_often)
        .slice(0, 5);

        emitToolCallA._lastGaps = claudeGaps;
        sendEvent(res, 'gaps', { gaps: claudeGaps });
      }
      break;
    }

    case 'set_scores': {
      // Use server-computed ATS to derive ats_alignment — keeps Score tab consistent
      // with Profile tab (both sourced from same server calculation)
      const atsAlignServer = atsResult?.atsScore !== null
        ? Math.round(atsResult.atsScore / 10)  // e.g. 40% ATS → 4/10 alignment
        : clamp(args.ats_alignment || 5, 0, 10);
      sendEvent(res, 'scores', {
        bullet_quality: clamp(args.bullet_quality || 5, 0, 10),
        impact_metrics: clamp(args.impact_metrics || 5, 0, 10),
        ats_alignment:  atsAlignServer,
        headline_roast: args.headline_roast || 'Your resume has been through a lot today.'
      });
      break;
    }

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

function emitToolCallB(name, args, res, role, marketData, detectedGaps) {
  detectedGaps = detectedGaps || [];
  const skillFreq = marketData?._mergedSkillFreq || marketData?.skillFreq || [];
  switch (name) {
    case 'set_linkedin':
      sendEvent(res, 'linkedin', {
        linkedin_headline: sanitizeLinkedIn(args.linkedin_headline),
        linkedin_about:    args.linkedin_about   || '',
        linkedin_skills:   (args.linkedin_skills || []).slice(0, 5)
      });
      break;
    case 'set_certifications': {
      const certs = normalizeCerts(args.cert_picks, args.cert_reasons);
      // Tag each cert with the gap skill it addresses (if detectable from reason text)
      const gapSkills = (marketData?._mergedSkillFreq || marketData?.skillFreq || [])
        .slice(0, 20).map(s => s.skill.toLowerCase());
      for (const cert of certs) {
        const whyLower = (cert.why || '').toLowerCase();
        const matched = gapSkills.find(s => whyLower.includes(s));
        if (matched) cert.addressesGap = matched;
      }
      sendEvent(res, 'certifications', { certifications: certs });
      break;
    }
    case 'set_projects': {
      // Composite ranking: weights skill-gap severity, ATS impact, hiring relevance,
      // resume value, and practical feasibility so a low-frequency signal like 13%
      // does not outrank a more actionable, feasible project.
      function projectCompositeScore(signal, primarySkill, timeHours) {
        // Hiring relevance + ATS impact: sqrt-normalize so a 13% skill isn't
        // ranked close to a 60% skill purely on raw frequency ratio
        const normalizedSignal = Math.sqrt(clamp(signal, 0, 100) / 100);

        // Gap severity: rank within the detected gap list drives importance
        const needle = primarySkill.toLowerCase().trim();
        const gapIdx = detectedGaps.findIndex(g => {
          const s = (g.skill || g || '').toLowerCase();
          return s === needle || s.includes(needle) || needle.includes(s);
        });
        // Top-3 gap: highest severity; top-5: medium; not in list: baseline
        const gapSeverity = gapIdx < 0 ? 0.40 : gapIdx < 3 ? 1.0 : 0.70;

        // Practical feasibility: prefer projects completable in a weekend
        const feasibility = timeHours <= 8 ? 1.0 : timeHours <= 16 ? 0.75 : 0.45;

        // Composite: 40% hiring relevance, 35% gap severity, 15% feasibility, 10% ATS
        return 0.40 * normalizedSignal + 0.35 * gapSeverity + 0.15 * feasibility + 0.10 * normalizedSignal;
      }

      let projects = (args.projects || []).map(p => {
        // Override with scrape when confidence >= threshold; trust Claude otherwise
        // This fixes 10% everywhere for product roles where scrape lacks verbatim terms
        const primarySkill = (p.skills || [])[0] || p.title || '';
        const scrapedSignal = lookupSkillPct(primarySkill, skillFreq);
        const signal = scrapedSignal !== null
          ? scrapedSignal
          : clamp(p.market_signal || 0, 0, 100);

        const composite = projectCompositeScore(signal, primarySkill, p.time_hours || 8);

        return {
          market_signal:   signal,
          composite_score: composite,
          title:           p.title         || '',
          justification:   p.justification || '',
          description:     p.description   || '',
          skills:          p.skills        || [],
          ats_keywords:    (p.ats_keywords || []).slice(0, 3),
          time_hours:      p.time_hours    || 8,
          ai_prompt:       p.ai_prompt     || '',
          bullets:         (p.bullets || []).slice(0, 2)
        };
      });

      // Sort by composite score descending — prevents low-frequency signals from dominating
      projects.sort((a, b) => b.composite_score - a.composite_score);

      // Floor: if 3+ projects above 20% signal, drop those below signal floor
      const SIGNAL_FLOOR = 20;
      const aboveFloor = projects.filter(p => p.market_signal >= SIGNAL_FLOOR);
      if (aboveFloor.length >= 3) {
        projects = aboveFloor;
        const dropped = (args.projects || []).length - aboveFloor.length;
        if (dropped > 0) console.log(`Projects: dropped ${dropped} below ${SIGNAL_FLOOR}% floor`);
      } else {
        console.log(`Projects: fewer than 3 above ${SIGNAL_FLOOR}%, keeping top 3 by composite`);
      }

      // career_impact: composite score as 0-100 for UI priority display
      projects = projects.map(p => ({
        ...p,
        career_impact: Math.round(p.composite_score * 100)
      }));

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
function makeStreamRequest({ apiKey, model, system, userContent, tools, fileId, maxTokens, toolChoice }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens || 8000,
      system,
      messages: [{ role: 'user', content: userContent }],
      tools,
      tool_choice: toolChoice || { type: 'any' },
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

  const body       = req.body || {};
  const fileId     = body.fileId   || null;
  const resume     = (body.resume  || '').substring(0, 4000);     // capped for Claude input
  const resumeFull = body.resumeFull || body.resume || '';         // full text for ATS scoring
  const location   = (body.location|| '').substring(0, 50);
  const jd         = (body.jd      || '').substring(0, 1200);
  const hasJD    = jd.trim().length > 50;

  // Per-section retry: skips Stream A and runs only the requested Stream B section
  const SECTION_TOOLS = { linkedin: 'set_linkedin', certifications: 'set_certifications', projects: 'set_projects' };
  const sectionOnly = (body.sectionOnly && SECTION_TOOLS[body.sectionOnly]) ? body.sectionOnly : null;

  // Role: explicit or extracted from JD
  let role         = (body.role || '').substring(0, 80).trim();
  let roleFromJD   = false;
  let detectedRole = null;
  let jdRequirements = [];

  // ── JD parsing: check cache first, then extract ──
  if (hasJD) {
    const cached = getCachedJDParse(jd);
    if (cached) {
      if (!role && cached.role) {
        role         = cached.role;
        roleFromJD   = true;
        detectedRole = cached.matched;
      }
      jdRequirements = cached.requirements || [];
      console.log(`JD cache hit: role="${cached.role}", ${jdRequirements.length} requirements`);
    } else {
      // Extract role deterministically (rule-based, no LLM)
      if (!role) {
        const extracted = extractRoleFromJD(jd);
        if (extracted) {
          role         = extracted.role;
          roleFromJD   = true;
          detectedRole = extracted.matched;
          console.log(`Role extracted from JD: "${role}" matched to "${detectedRole}"`);
        }
      }
      // Extract skill requirements deterministically
      jdRequirements = extractJDRequirements(jd);
      console.log(`JD requirements extracted: ${jdRequirements.length} skills`);

      // Cache the parse result
      setCachedJDParse(jd, {
        role:         roleFromJD ? role : null,
        matched:      detectedRole,
        requirements: jdRequirements
      });
    }
  }

  if ((!resume || resume.length < 100) && !fileId) {
    return res.status(400).json({ error: 'Resume content or file ID is required.' });
  }
  // Allow JD-only analysis — Claude infers the role from the full JD text
  // Only block if both role AND JD are missing/too short
  if (!role && !hasJD) {
    return res.status(400).json({
      error: 'Please enter a target role or paste a job description — we need at least one to run your analysis.'
    });
  }
  // If no role was detected, use a placeholder — Claude will infer from JD
  if (!role) role = 'the role in the job description';

  recordHit(ip);
  const rateAfter   = getRateStatus(ip);
  const locationStr = location.trim() || 'Nationwide USA';

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

  // Salary — scraped posting data when available, otherwise Claude estimates from training
  // Confidence-gated: low-confidence scraped data is suppressed to avoid fake precision
  const sal = {};
  if (marketData?.salaryData) {
    const salConf = marketData.salaryData.confidence || 'low';
    if (salConf !== 'low') {
      // Medium or high confidence — show scraped data
      sal._fromPostings = marketData.salaryData.median;
      sal._postingNote  = marketData.salaryData.note;
      sal._confidence   = salConf;
    } else {
      // Low confidence (1-2 postings) — don't present as precise truth
      // Let Claude estimate instead, which is labeled as an estimate
      sal._weakPostingData = marketData.salaryData.median;
      sal._confidence      = 'low';
    }
  }

  const marketDataBlock = buildMarketDataBlock(marketData, matchedRole || role);
  const systemPromptA   = buildSystemPromptA();
  const systemPromptB   = buildSystemPromptB();

  // ── Merge market data with JD requirements ──
  // When a JD is pasted, its extracted requirements are merged with market
  // data skills. This ensures JD-specific skills (not in the top 20 market
  // data) still feed into deterministic ATS and skill detection.
  const baseSkillFreq   = marketData?.skillFreq || [];
  const mergedSkillFreq = hasJD && jdRequirements.length > 0
    ? mergeMarketAndJDSkills(baseSkillFreq, jdRequirements)
    : baseSkillFreq;

  // Attach merged list to marketData so emitters use JD-enriched skills
  // for lookups without changing every function signature
  if (marketData) {
    marketData._mergedSkillFreq = mergedSkillFreq;
  } else if (mergedSkillFreq.length > 0) {
    // JD-only mode with no market data: create a minimal marketData object
    marketData  = { skillFreq: mergedSkillFreq, _mergedSkillFreq: mergedSkillFreq };
    hasLiveData = false; // still no live scraped data, but we have JD signals
  }

  // ── Server-side ATS + match score ──
  // Computed once from resume text + merged skill list.
  // Injected into both prompts so Claude uses this number,
  // not its own calculation — eliminates run-to-run variance.
  const resumeForATS = resumeFull || resume || '';
  const atsResult = computeATS(resumeForATS, mergedSkillFreq);
  const serverATS  = atsResult.atsScore;
  const serverPotential = atsResult.atsPotential;
  const topMissing = atsResult.missingTop;
  const topPresent = atsResult.presentTop;

  const hasServerATS = serverATS !== null;
  const atsFactLine  = hasServerATS
    ? `PRE-COMPUTED ATS KEYWORD MATCH: ${serverATS}% (${topPresent.length} of 15 top keywords found: ${topPresent.join(', ')}). Top missing: ${topMissing.slice(0,3).join(', ')}. Potential after adding top 3 missing: ${serverPotential}%. USE THESE EXACT NUMBERS in set_verdict (ats_pass_rate=${serverATS}, ats_potential=${serverPotential}, ats_missing_keyword="${topMissing[0]||''}"). DO NOT recalculate.`
    : '';

  // ── Deterministic skill & gap detection ──
  // Computed once from resume text + merged skills. Fed to emitters so
  // skills_present, skill_relevance, gaps, and gap priorities are stable.
  // In JD mode, JD-extracted requirements are included so gaps reflect
  // the specific job, not just general market data.
  const serverSkills = computeSkillsAndGaps(resumeForATS, mergedSkillFreq);
  serverSkills._resumeText = resumeForATS; // attached for skill level computation

  // Resume anchors: server-extracted for grounding both prompts in real resume content
  const resumeAnchors = extractResumeAnchors(resumeForATS);

  // Stream A user content — includes file or resume text
  const promptA    = buildAnalysisPromptA(role, locationStr, jd, hasJD, sal, marketDataBlock, atsFactLine, serverSkills, resumeAnchors);
  const userContentA = fileId
    ? [
        { type: 'document', source: { type: 'file', file_id: fileId } },
        { type: 'text',     text: promptA }
      ]
    : promptA + `\n\nRESUME TEXT:\n${resume}`;

  // Stream B user content built dynamically after Stream A emits set_skills
  const resumeForB = resume || '';

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

  // ── Per-section retry fast-path ──
  // When sectionOnly is set, skip Stream A entirely and run just the requested Stream B tool.
  // confirmedSkills and detectedGaps are passed from the frontend (captured from the original run).
  if (sectionOnly) {
    const targetTool = SECTION_TOOLS[sectionOnly];
    const confirmedSkills = Array.isArray(body.confirmedSkills) ? body.confirmedSkills : [];
    const rawGaps = Array.isArray(body.detectedGaps) ? body.detectedGaps.slice(0, 5) : [];
    const retryGaps = rawGaps.map(g => ({
      skill: g.skill || String(g),
      pct:   typeof g.how_often === 'number' ? g.how_often : (g.pct || 0)
    }));
    const retryResumeAnchors = extractResumeAnchors(resumeFull || resume || '');
    const userContentB = buildAnalysisPromptB(
      role, locationStr, jd, hasJD, sal, marketDataBlock,
      resume, confirmedSkills, retryGaps, retryResumeAnchors
    );
    try {
      const anthropicResB = await makeStreamRequest({
        apiKey,
        model:       MODEL_B,
        system:      systemPromptB,
        userContent: userContentB,
        tools:       TOOLS_B,
        toolChoice:  { type: 'tool', name: targetTool },
        maxTokens:   1200
      });
      await processStream(anthropicResB, (name, args) =>
        emitToolCallB(name, args, res, role, marketData, retryGaps)
      );
      sendEvent(res, 'done', { complete: true });
    } catch (err) {
      console.error('Section retry error:', err.message);
      sendEvent(res, 'error', { message: err.message || 'Retry failed. Please try again.' });
    }
    res.end();
    return;
  }

  let fileDeleted = false;
  const cleanupFile = async () => {
    if (fileId && !fileDeleted) {
      fileDeleted = true;
      await deleteFile(fileId, apiKey);
    }
  };

  // ── Stream A launches immediately ──
  // Stream B waits until Stream A emits set_skills (~4-6s).
  // This gives Stream B the actual skills_present list so it never
  // ── Dual-stream launch ──
  // Stream A launches immediately.
  // Stream B launches after a fixed 4-second delay — enough for Stream A
  // to emit set_verdict + set_skills (arrives ~T+4-6s), so we can inject
  // confirmed skills into Stream B prompt to prevent contradictions.
  // Fixed delay avoids worst-case wait when set_skills is slow.

  let streamASkills = []; // populated when set_skills fires

  const emitA = (name, args) => {
    emitToolCallA(name, args, res, sal, role, marketData, atsResult, serverSkills);
    if (name === 'set_skills') {
      // Use server-detected skills when available for Stream B context
      streamASkills = serverSkills.present.length > 0
        ? serverSkills.present.slice(0, 6).map(s => s.skill)
        : (args.skills_present || []).slice(0, 6);
    }
  };

  try {
    // Launch Stream A immediately
    const anthropicResA = await makeStreamRequest({
      apiKey,
      model:       MODEL_A,
      system:      systemPromptA,
      userContent: userContentA,
      tools:       TOOLS_A,
      fileId,
      maxTokens:   4000
    });

    const streamAPromise = processStream(anthropicResA, emitA);

    // Launch Stream B after 4s — Stream A typically emits set_skills by T+5s
    // so we use whatever skills are available at launch time
    const launchStreamB = async () => {
      await new Promise(r => setTimeout(r, 2000));

      // Use skills captured so far (may be empty if set_skills hasn't fired yet —
      // in that case Stream B gets no confirmed skills, acceptable tradeoff for speed)
      // Pass server-detected gaps so certs and projects target real skill gaps
      const detectedGaps = serverSkills?.missing?.slice(0, 5) || [];
      const userContentB = buildAnalysisPromptB(
        role, locationStr, jd, hasJD, sal, marketDataBlock,
        resumeForB, streamASkills, detectedGaps, resumeAnchors
      );

      const anthropicResB = await makeStreamRequest({
        apiKey,
        model:       MODEL_B,
        system:      systemPromptB,
        userContent: userContentB,
        tools:       TOOLS_B,
        fileId:      null,
        maxTokens:   2200  // tightened — concise prompts + smaller cert schema = sufficient
      });

      return processStream(anthropicResB, (name, args) => emitToolCallB(name, args, res, role, marketData, detectedGaps));
    };

    await Promise.all([streamAPromise, launchStreamB()]);

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
