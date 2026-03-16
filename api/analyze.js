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

  if (!resume || !role) {
    return res.status(400).json({ error: 'Resume and target role are required.' });
  }

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
    { name:'Google Data Analytics Certificate', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/data-analytics/' },
    { name:'AWS Cloud Practitioner', provider:'AWS', level:'Entry', cost:'$100', duration:'1 month', free:false, url:'https://aws.amazon.com/certification/certified-cloud-practitioner/' },
    { name:'Google Project Management', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/project-management/' },
    { name:'Tableau Desktop Specialist', provider:'Tableau', level:'Associate', cost:'$250', duration:'1 month', free:false, url:'https://www.tableau.com/learn/certification/desktop-specialist' },
    { name:'Microsoft Power BI PL-300', provider:'Microsoft', level:'Associate', cost:'$165', duration:'2 months', free:false, url:'https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/' },
    { name:'Google UX Design', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/ux-design/' },
    { name:'AWS Solutions Architect Associate', provider:'AWS', level:'Associate', cost:'$150', duration:'2-3 months', free:false, url:'https://aws.amazon.com/certification/certified-solutions-architect-associate/' },
    { name:'PMP', provider:'PMI', level:'Professional', cost:'$405', duration:'3+ months', free:false, url:'https://www.pmi.org/certifications/project-management-pmp' },
    { name:'Google IT Support', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/it-support/' },
    { name:'Salesforce Admin', provider:'Salesforce', level:'Associate', cost:'$200', duration:'2 months', free:false, url:'https://trailhead.salesforce.com/credentials/administrator' },
    { name:'CFA Level 1', provider:'CFA Institute', level:'Professional', cost:'$700-$1000', duration:'6 months', free:false, url:'https://www.cfainstitute.org/en/programs/cfa' },
    { name:'dbt Analytics Engineering', provider:'dbt Labs', level:'Associate', cost:'$200', duration:'1 month', free:false, url:'https://www.getdbt.com/certifications' },
    { name:'Scrum Master PSM I', provider:'Scrum.org', level:'Entry', cost:'$150', duration:'2 weeks', free:false, url:'https://www.scrum.org/assessments/professional-scrum-master-i-certification' },
    { name:'CompTIA Security+', provider:'CompTIA', level:'Associate', cost:'$370', duration:'2 months', free:false, url:'https://www.comptia.org/certifications/security' }
  ];

  // ── CALL 1: Small targeted web search ──
  let liveData = '';
  try {
    const searchR = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Search and return 2 plain text sentences only. No JSON. No lists. No markdown.',
        messages: [{
          role: 'user',
          content: 'What are the top skills required for ' + role + ' jobs in ' + locationStr + ' in 2025, and which ' + (needsVisa ? 'H-1B sponsoring ' : '') + 'companies are actively hiring? Answer in 2 sentences only.'
        }]
      }
    );
    if (searchR.status === 200 && Array.isArray(searchR.body.content)) {
      liveData = searchR.body.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim()
        .substring(0, 300);
    }
  } catch (e) {
    console.log('Web search skipped:', e.message);
  }

  // ── CALL 2: Main analysis — lean prompt, small JSON output ──
  const prompt = `Analyze this resume for a ${role} role in ${locationStr}.
Visa: ${visa}. Needs sponsorship: ${needsVisa ? 'yes' : 'no'}.

RESUME: ${resume}
${hasJD ? 'JOB DESCRIPTION: ' + jd : ''}
${liveData ? 'LIVE MARKET DATA: ' + liveData : ''}

SALARY: entry=${sal.e}, mid=${sal.m}, senior=${sal.s}

CERTIFICATIONS (pick 3 most relevant, name|provider|level|cost|duration|free|url):
${CERTS.map(c => c.name + '|' + c.provider + '|' + c.level + '|' + c.cost + '|' + c.duration + '|' + c.free + '|' + c.url).join('\n')}

Return ONLY this JSON object. No extra text.

{
  "role": "${role}",
  "location": "${locationStr}",
  "match_score": <0-100 integer>,
  "summary": {
    "headline": "<8-12 words summarizing their profile honestly>",
    "description": "<2 sentences about where they stand and what they need>",
    "goal": "<3 words max>"
  },
  "skills_present": ["<skill from resume>", "<skill>", "<skill>"],
  "skill_levels": {"<skill>": "Strong"},
  "gaps": [
    {"skill": "<missing skill>", "priority": "High", "how_to_fix": "<specific fix with exact URL>"},
    {"skill": "<missing skill>", "priority": "Medium", "how_to_fix": "<specific fix>"},
    {"skill": "<missing skill>", "priority": "Low", "how_to_fix": "<specific fix>"}
  ],
  ${hasJD
    ? '"jd_breakdown": [{"requirement": "<from JD>", "met": true, "note": "<one sentence>"}, {"requirement": "<from JD>", "met": false, "note": "<one sentence>"}, {"requirement": "<from JD>", "met": true, "note": "<one sentence>"}],'
    : '"trending_skills": [{"skill": "<skill>", "have": false}, {"skill": "<skill>", "have": true}, {"skill": "<skill>", "have": false}, {"skill": "<skill>", "have": true}, {"skill": "<skill>", "have": false}], "top_companies": [{"name": "<company>", "detail": "<role and openings>"}, {"name": "<company>", "detail": "<role and openings>"}, {"name": "<company>", "detail": "<role and openings>"}, {"name": "<company>", "detail": "<role and openings>"}],'
  }
  "priority_actions": [
    "<specific action with exact URL>",
    "<specific action with exact URL>",
    "<specific action>"
  ],
  "plan_30": {
    "weeks": [
      {"label": "Week 1", "steps": [{"action": "<what>", "detail": "<how with URL and time>", "link": "<https://url>", "link_label": "<text>"}, {"action": "<what>", "detail": "<how>", "link": null, "link_label": null}]},
      {"label": "Week 2", "steps": [{"action": "<what>", "detail": "<how with URL>", "link": "<https://url>", "link_label": "<text>"}]},
      {"label": "Week 3", "steps": [{"action": "<what>", "detail": "<how>", "link": null, "link_label": null}]},
      {"label": "Week 4", "steps": [{"action": "<what>", "detail": "<how>", "link": null, "link_label": null}]}
    ],
    "callout": "<1-2 sentences about what this plan achieves>"
  },
  "certifications": [
    {"name": "<from list>", "provider": "<provider>", "level": "<level>", "cost": "<cost>", "duration": "<duration>", "free": true, "url": "<url>", "why": "<one sentence why this closes their specific gap>"},
    {"name": "<from list>", "provider": "<provider>", "level": "<level>", "cost": "<cost>", "duration": "<duration>", "free": false, "url": "<url>", "why": "<why relevant>"},
    {"name": "<from list>", "provider": "<provider>", "level": "<level>", "cost": "<cost>", "duration": "<duration>", "free": false, "url": "<url>", "why": "<why relevant>"}
  ],
  "salary": {
    "entry": "${sal.e}",
    "mid": "${sal.m}",
    "senior": "${sal.s}",
    "note": "${salNote}",
    "tips": [
      "Do not reveal your expected salary first — let the employer make the opening offer",
      "Negotiate total compensation including bonus equity and benefits not just base pay",
      "Research this role on Glassdoor and Levels.fyi before any salary conversation"
    ]
  },
  ${needsVisa ? `"sponsors": [
    {"name": "<company hiring ${role} with H-1B>", "roles": "<roles>", "why": "<why good fit>", "size": "Large"},
    {"name": "<mid-size company>", "roles": "<roles>", "why": "<why>", "size": "Mid"},
    {"name": "<consulting or services firm>", "roles": "<roles>", "why": "<why>", "size": "Mid"},
    {"name": "<smaller company>", "roles": "<roles>", "why": "<why>", "size": "Small"},
    {"name": "<company>", "roles": "<roles>", "why": "<why>", "size": "Large"},
    {"name": "<company>", "roles": "<roles>", "why": "<why>", "size": "Mid"}
  ],
  "opt_timeline": {
    "title": "${visa} Timeline",
    "duration": "${visa === 'F-1 OPT' ? 'Duration: 12 months' : visa === 'STEM OPT' ? 'Duration: 24 additional months' : 'Duration: 3 years renewable to 6'}",
    "steps": [
      {"period": "Graduation", "action": "Apply for OPT through your DSO immediately. Submit I-765 to USCIS. Processing takes 90 days.", "urgent": true},
      {"period": "Month 1-2", "action": "EAD card arrives. You can start working once you have it. Begin active job search.", "urgent": false},
      {"period": "Month 3-6", "action": "Active applications. Target STEM-eligible employers so you have the option to extend.", "urgent": false},
      {"period": "Month 9", "action": "No offer yet? Apply for STEM OPT extension immediately if your degree qualifies. Do not wait.", "urgent": true},
      {"period": "Month 12", "action": "OPT expires. Must have active employment with sponsorship or approved STEM extension.", "urgent": true}
    ],
    "important_note": "<2 sentences of critical advice specific to ${visa}>"
  },` : ''}
  "ats_rewrites": [
    {"original": "<weak bullet from their actual resume>", "rewritten": "<stronger version with action verb, metrics, keywords>", "keywords_added": ["<kw>", "<kw>", "<kw>"]},
    {"original": "<second weak bullet>", "rewritten": "<improved version>", "keywords_added": ["<kw>", "<kw>"]}
  ],
  "linkedin_headline": "<under 220 chars: Role | Skill1 Skill2 Skill3 | Cert or in progress | Company or University>"
}`;

  try {
    const mainR = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: 'You are a career advisor API. Return ONLY a valid JSON object. Start your response with { and end with }. No markdown, no code fences, no explanation outside the JSON.',
        messages: [{ role: 'user', content: prompt }]
      }
    );

    if (mainR.status !== 200) {
      const msg = mainR.body && mainR.body.error ? mainR.body.error.message : 'Analysis failed. Please try again.';
      return res.status(502).json({ error: msg });
    }

    const content = mainR.body && mainR.body.content;
    if (!Array.isArray(content)) return res.status(502).json({ error: 'Unexpected response. Please try again.' });

    let text = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) return res.status(502).json({ error: 'Empty response. Please try again.' });

    text = text.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
      console.error('No JSON found:', text.substring(0, 200));
      return res.status(502).json({ error: 'Could not parse analysis. Please try again.' });
    }

    let parsed;
    try {
      parsed = JSON.parse(text.substring(start, end + 1));
    } catch (e) {
      try {
        const fixed = text.substring(start, end + 1)
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/[\u0000-\u001F\u007F]/g, ' ');
        parsed = JSON.parse(fixed);
      } catch (e2) {
        console.error('Parse failed:', e.message, text.substring(start, start + 300));
        return res.status(502).json({ error: 'Analysis format error. Please try again.' });
      }
    }

    parsed._live = liveData.length > 0;
    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
