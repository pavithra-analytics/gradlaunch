const https = require('https');

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

// Robust JSON repair — handles common Haiku output issues
function extractJSON(text) {
  if (!text) return null;

  // Strip markdown fences
  let cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Find outermost braces
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  cleaned = cleaned.substring(start, end + 1);

  // Attempt 1 — parse as-is
  try { return JSON.parse(cleaned); } catch (e) {}

  // Attempt 2 — fix trailing commas and control chars
  try {
    const fixed = cleaned
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u001F\u007F]/g, ' ');
    return JSON.parse(fixed);
  } catch (e) {}

  // Attempt 3 — truncated JSON, try to close open structures
  try {
    let f = cleaned.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F\u007F]/g, ' ');
    // Count unclosed braces and brackets
    let braces = 0, brackets = 0, inStr = false, escape = false;
    for (const ch of f) {
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inStr) { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') braces++;
      if (ch === '}') braces--;
      if (ch === '[') brackets++;
      if (ch === ']') brackets--;
    }
    // Close any open structures
    f += ']'.repeat(Math.max(0, brackets));
    f += '}'.repeat(Math.max(0, braces));
    return JSON.parse(f);
  } catch (e) {}

  return null;
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
  const locKey = Object.keys(SALARY).find(k => k !== 'default' && locationStr.toLowerCase().includes(k)) || 'default';
  const sal = SALARY[locKey];
  const salNote = isNational
    ? 'National averages. NYC, SF, Seattle pay 20-40% more.'
    : locationStr + ' market rates.';

  const CERTS = [
    'Google Data Analytics Certificate | Google/Coursera | Entry | Free-$49/mo | 6mo | free | https://grow.google/certificates/data-analytics/',
    'AWS Cloud Practitioner | AWS | Entry | $100 | 1mo | paid | https://aws.amazon.com/certification/certified-cloud-practitioner/',
    'Google Project Management | Google/Coursera | Entry | Free-$49/mo | 6mo | free | https://grow.google/certificates/project-management/',
    'Tableau Desktop Specialist | Tableau | Associate | $250 | 1mo | paid | https://www.tableau.com/learn/certification/desktop-specialist',
    'Microsoft Power BI PL-300 | Microsoft | Associate | $165 | 2mo | paid | https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/',
    'Google UX Design | Google/Coursera | Entry | Free-$49/mo | 6mo | free | https://grow.google/certificates/ux-design/',
    'AWS Solutions Architect Associate | AWS | Associate | $150 | 2-3mo | paid | https://aws.amazon.com/certification/certified-solutions-architect-associate/',
    'PMP | PMI | Professional | $405 | 3+mo | paid | https://www.pmi.org/certifications/project-management-pmp',
    'Google IT Support | Google/Coursera | Entry | Free-$49/mo | 6mo | free | https://grow.google/certificates/it-support/',
    'Salesforce Admin | Salesforce | Associate | $200 | 2mo | paid | https://trailhead.salesforce.com/credentials/administrator',
    'CFA Level 1 | CFA Institute | Professional | $700-$1000 | 6mo | paid | https://www.cfainstitute.org/en/programs/cfa',
    'dbt Analytics Engineering | dbt Labs | Associate | $200 | 1mo | paid | https://www.getdbt.com/certifications',
    'Scrum Master PSM I | Scrum.org | Entry | $150 | 2wk | paid | https://www.scrum.org/assessments/professional-scrum-master-i-certification',
    'CompTIA Security+ | CompTIA | Associate | $370 | 2mo | paid | https://www.comptia.org/certifications/security'
  ].join('\n');

  // Web search — Haiku, company data only, fast
  let liveData = '';
  try {
    const searchR = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Search and return 2 plain text sentences only. No JSON.',
        messages: [{
          role: 'user',
          content: 'Which companies are hiring ' + role + ' in ' + locationStr + ' right now' + (needsVisa ? ' and sponsor H-1B' : '') + '? 2 sentences only.'
        }]
      }
    );
    if (searchR.status === 200 && Array.isArray(searchR.body.content)) {
      liveData = searchR.body.content
        .filter(b => b.type === 'text').map(b => b.text).join('').trim().substring(0, 200);
    }
  } catch (e) {
    console.log('Web search skipped:', e.message);
  }

  // Build the prompt — small fields first, plan last
  const visaSponsorSection = needsVisa ? `
  "sponsors": [
    {"name": "company name", "roles": "relevant roles", "why": "one reason good fit", "size": "Large"},
    {"name": "company name", "roles": "relevant roles", "why": "one reason", "size": "Mid"},
    {"name": "company name", "roles": "relevant roles", "why": "one reason", "size": "Mid"},
    {"name": "company name", "roles": "relevant roles", "why": "one reason", "size": "Small"},
    {"name": "company name", "roles": "relevant roles", "why": "one reason", "size": "Large"},
    {"name": "company name", "roles": "relevant roles", "why": "one reason", "size": "Mid"}
  ],
  "opt_timeline": {
    "title": "${visa} Timeline",
    "duration": "${visa === 'F-1 OPT' ? 'Duration: 12 months' : visa === 'STEM OPT' ? 'Duration: 24 additional months' : 'Duration: 3 years renewable'}",
    "steps": [
      {"period": "Graduation", "action": "Apply for OPT through DSO immediately", "urgent": true},
      {"period": "Month 1-2", "action": "EAD arrives, begin job search", "urgent": false},
      {"period": "Month 3-6", "action": "Active applications, target STEM employers", "urgent": false},
      {"period": "Month 9", "action": "No offer yet? Apply for STEM extension now", "urgent": true},
      {"period": "Month 12", "action": "OPT expires — must have job or extension", "urgent": true}
    ],
    "important_note": "write 2 sentences of critical advice for ${visa}"
  },` : '';

  const jdSection = hasJD ? `
  "jd_breakdown": [
    {"requirement": "requirement from JD", "met": true, "note": "one sentence"},
    {"requirement": "requirement from JD", "met": false, "note": "one sentence"},
    {"requirement": "requirement from JD", "met": true, "note": "one sentence"}
  ],` : `
  "trending_skills": [
    {"skill": "skill name", "have": false},
    {"skill": "skill name", "have": true},
    {"skill": "skill name", "have": false},
    {"skill": "skill name", "have": true},
    {"skill": "skill name", "have": false}
  ],
  "top_companies": [
    {"name": "company name", "detail": "role type and openings"},
    {"name": "company name", "detail": "role type and openings"},
    {"name": "company name", "detail": "role type and openings"},
    {"name": "company name", "detail": "role type and openings"}
  ],`;

  const prompt = `You are a career advisor API. Analyze this resume and return ONLY a JSON object.
Return pure JSON. Start with { and end with }. No markdown. No explanation. No text outside JSON.

RESUME: ${resume}
ROLE: ${role}
LOCATION: ${locationStr}
VISA: ${visa}
NEEDS SPONSORSHIP: ${needsVisa ? 'yes' : 'no'}
${hasJD ? 'JOB DESCRIPTION: ' + jd : ''}
${liveData ? 'LIVE COMPANY DATA: ' + liveData : ''}
SALARY: entry=${sal.e} mid=${sal.m} senior=${sal.s}
CERTS LIST (pick 3 most relevant, format: name|provider|level|cost|duration|free|url):
${CERTS}

Fill this JSON with real data from the resume. Replace ALL placeholder text:

{
  "match_score": 0,
  "summary": {
    "headline": "write 8-12 words reflecting actual seniority — never call experienced professionals graduates",
    "description": "write 2 honest sentences about where they stand"
  },
  "skills_present": ["skill from resume", "skill", "skill"],
  "skill_levels": {"skill": "Strong"},
  "gaps": [
    {"skill": "missing skill", "priority": "High", "how_to_fix": "specific resource with exact URL"},
    {"skill": "missing skill", "priority": "Medium", "how_to_fix": "specific resource with URL"},
    {"skill": "missing skill", "priority": "Low", "how_to_fix": "specific resource with URL"}
  ],
  ${jdSection}
  "priority_actions": [
    "specific action with exact URL",
    "specific action with URL",
    "specific action"
  ],
  "salary": {
    "entry": "${sal.e}",
    "mid": "${sal.m}",
    "senior": "${sal.s}",
    "note": "${salNote}"
  },
  "certifications": [
    {"name": "cert from list", "provider": "provider", "level": "level", "cost": "cost", "duration": "duration", "free": false, "url": "https://url", "why": "why this closes a specific gap"},
    {"name": "cert from list", "provider": "provider", "level": "level", "cost": "cost", "duration": "duration", "free": true, "url": "https://url", "why": "why relevant"},
    {"name": "cert from list", "provider": "provider", "level": "level", "cost": "cost", "duration": "duration", "free": false, "url": "https://url", "why": "why relevant"}
  ],
  "ats_rewrites": [
    {"original": "copy a weak bullet from their actual resume word for word", "rewritten": "stronger version with action verb metrics and ATS keywords", "keywords_added": ["keyword1", "keyword2", "keyword3"]},
    {"original": "copy second weak bullet from resume", "rewritten": "improved version", "keywords_added": ["keyword1", "keyword2"]}
  ],
  "linkedin_headline": "Role | Skill1 Skill2 Skill3 | Cert or in progress | Company or University — under 220 chars, use real resume data",
  ${visaSponsorSection}
  "plan_30": {
    "weeks": [
      {"label": "Week 1", "steps": [
        {"action": "specific action", "detail": "how with exact URL and time estimate", "link": "https://url", "link_label": "Visit site"},
        {"action": "specific action", "detail": "how with URL", "link": "", "link_label": ""}
      ]},
      {"label": "Week 2", "steps": [
        {"action": "specific action", "detail": "how with exact URL", "link": "https://url", "link_label": "Visit site"},
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""}
      ]},
      {"label": "Week 3", "steps": [
        {"action": "specific action", "detail": "how with URL", "link": "", "link_label": ""},
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""}
      ]},
      {"label": "Week 4", "steps": [
        {"action": "specific action", "detail": "how with URL", "link": "", "link_label": ""},
        {"action": "specific action", "detail": "how", "link": "", "link_label": ""}
      ]}
    ],
    "callout": "1-2 sentences about what this plan achieves"
  }
}`;

  // Auto retry with prefill — Layer 1 + Layer 3
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await httpsPost(
        'api.anthropic.com',
        '/v1/messages',
        { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          system: 'You are a career advisor API. Return ONLY valid JSON. Start with { and end with }. No markdown. No explanation.',
          messages: [
            { role: 'user', content: prompt },
            { role: 'assistant', content: '{' }  // LAYER 1: prefill forces JSON start
          ]
        }
      );

      if (r.status !== 200) {
        const msg = r.body && r.body.error ? r.body.error.message : 'Analysis failed.';
        console.error('API error attempt', attempt, ':', msg);
        if (attempt < 2) continue;
        return res.status(502).json({ error: msg });
      }

      const content = r.body && r.body.content;
      if (!Array.isArray(content)) {
        if (attempt < 2) continue;
        return res.status(502).json({ error: 'Unexpected response. Please try again.' });
      }

      const rawText = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (!rawText) {
        if (attempt < 2) continue;
        return res.status(502).json({ error: 'Empty response. Please try again.' });
      }

      // Prepend the prefilled { since Claude continues from after it
      const fullText = '{' + rawText;

      // LAYER 2: robust JSON repair
      const parsed = extractJSON(fullText);
      if (!parsed) {
        console.error('JSON parse failed attempt', attempt, '. Sample:', fullText.substring(0, 200));
        if (attempt < 2) continue;
        return res.status(502).json({ error: 'Analysis format error. Please try again.' });
      }

      parsed.role = role;
      parsed.location = locationStr;
      parsed._live = liveData.length > 0;
      return res.status(200).json(parsed);

    } catch (err) {
      console.error('Attempt', attempt, 'error:', err.message);
      if (attempt < 2) continue;
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
  }
};
