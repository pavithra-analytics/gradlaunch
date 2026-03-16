const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
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
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured. Add ANTHROPIC_API_KEY in Vercel environment variables then redeploy.' });
  }

  const { resume, role, location, visa, needsVisa, jd } = req.body || {};
  if (!resume || !role) {
    return res.status(400).json({ error: 'Resume and target role are required.' });
  }

  const hasJD = !!(jd && jd.trim().length > 20);
  const locationStr = (location && location.trim()) ? location.trim() : 'Nationwide (USA)';
  const isNational = !location || location.trim() === '' ||
    /^(usa|us|united states|united states of america)$/i.test(location.trim());

  const SALARY = {
    'new york':     { entry:'$69k-$94k',  mid:'$95k-$130k',  senior:'$130k-$175k' },
    'san francisco':{ entry:'$85k-$115k', mid:'$115k-$155k', senior:'$155k-$220k' },
    'seattle':      { entry:'$78k-$105k', mid:'$105k-$145k', senior:'$145k-$200k' },
    'austin':       { entry:'$62k-$85k',  mid:'$85k-$120k',  senior:'$120k-$165k' },
    'chicago':      { entry:'$60k-$82k',  mid:'$82k-$115k',  senior:'$115k-$155k' },
    'boston':       { entry:'$70k-$95k',  mid:'$95k-$130k',  senior:'$130k-$175k' },
    'los angeles':  { entry:'$68k-$92k',  mid:'$92k-$125k',  senior:'$125k-$170k' },
    'dallas':       { entry:'$60k-$82k',  mid:'$82k-$115k',  senior:'$115k-$155k' },
    'washington':   { entry:'$68k-$92k',  mid:'$92k-$128k',  senior:'$128k-$172k' },
    'default':      { entry:'$55k-$75k',  mid:'$75k-$110k',  senior:'$110k-$160k' }
  };
  const locKey = Object.keys(SALARY).find(k => k !== 'default' && locationStr.toLowerCase().includes(k)) || 'default';
  const sal = SALARY[locKey];

  const CERTS = [
    { name:'Google Data Analytics Certificate', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/data-analytics/' },
    { name:'AWS Cloud Practitioner', provider:'Amazon Web Services', level:'Entry', cost:'$100', duration:'1 month', free:false, url:'https://aws.amazon.com/certification/certified-cloud-practitioner/' },
    { name:'Google Project Management Certificate', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/project-management/' },
    { name:'Tableau Desktop Specialist', provider:'Tableau', level:'Associate', cost:'$250', duration:'1 month', free:false, url:'https://www.tableau.com/learn/certification/desktop-specialist' },
    { name:'Microsoft Power BI PL-300', provider:'Microsoft', level:'Associate', cost:'$165', duration:'2 months', free:false, url:'https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/' },
    { name:'Google UX Design Certificate', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/ux-design/' },
    { name:'AWS Solutions Architect Associate', provider:'Amazon Web Services', level:'Associate', cost:'$150', duration:'2-3 months', free:false, url:'https://aws.amazon.com/certification/certified-solutions-architect-associate/' },
    { name:'PMP Project Management Professional', provider:'PMI', level:'Professional', cost:'$405', duration:'3+ months', free:false, url:'https://www.pmi.org/certifications/project-management-pmp' },
    { name:'Google IT Support Certificate', provider:'Google/Coursera', level:'Entry', cost:'Free-$49/mo', duration:'6 months', free:true, url:'https://grow.google/certificates/it-support/' },
    { name:'Salesforce Certified Administrator', provider:'Salesforce', level:'Associate', cost:'$200', duration:'2 months', free:false, url:'https://trailhead.salesforce.com/credentials/administrator' },
    { name:'CFA Level 1', provider:'CFA Institute', level:'Professional', cost:'$700-$1000', duration:'6 months', free:false, url:'https://www.cfainstitute.org/en/programs/cfa' },
    { name:'dbt Analytics Engineering', provider:'dbt Labs', level:'Associate', cost:'$200', duration:'1 month', free:false, url:'https://www.getdbt.com/certifications' },
    { name:'Professional Scrum Master PSM I', provider:'Scrum.org', level:'Entry', cost:'$150', duration:'2 weeks', free:false, url:'https://www.scrum.org/assessments/professional-scrum-master-i-certification' },
    { name:'CompTIA Security+', provider:'CompTIA', level:'Associate', cost:'$370', duration:'2 months', free:false, url:'https://www.comptia.org/certifications/security' }
  ];

  const middleBlock = hasJD
    ? `"jd_breakdown": [{"requirement": "Requirement from JD", "met": true, "note": "One sentence note"}],`
    : `"trending_skills": [{"skill": "Trending skill", "have": false}],
  "top_companies": [{"name": "Company name", "detail": "Role type and openings"}],`;

  const visaNote = needsVisa
    ? '"H-1B sponsorship costs employers $5-10k, this context is fair to acknowledge if salary negotiation comes up",'
    : '';

  const sponsorsBlock = needsVisa ? `"sponsors": [
    {"name": "Company name", "roles": "Relevant roles", "why": "One reason why good fit", "size": "Large"},
    {"name": "Company name", "roles": "Relevant roles", "why": "One reason", "size": "Mid"},
    {"name": "Company name", "roles": "Relevant roles", "why": "One reason", "size": "Small"}
  ],
  "opt_timeline": {
    "title": "${visa} Timeline",
    "duration": "Duration info",
    "steps": [
      {"period": "Graduation", "action": "Apply for OPT through DSO immediately and submit I-765 to USCIS", "urgent": true},
      {"period": "Month 1-2", "action": "EAD card arrives. Begin active job search immediately.", "urgent": false},
      {"period": "Month 3-6", "action": "Active applications. Target STEM extension eligible employers.", "urgent": false},
      {"period": "Month 9", "action": "If no job yet apply for STEM OPT extension immediately. Do not wait.", "urgent": true},
      {"period": "Month 12", "action": "OPT expires. Must have employer or STEM extension by this date.", "urgent": true}
    ],
    "important_note": "Write 2-3 sentences of critical visa advice"
  },` : '';

  const prompt = `You are GradLaunch, an expert career advisor. Analyze this resume and return ONLY a valid JSON object. No explanation, no markdown fences, no text outside the JSON.

RESUME: ${resume.substring(0,2500)}
TARGET ROLE: ${role}
LOCATION: ${locationStr}
VISA: ${visa}
NEEDS SPONSORSHIP: ${needsVisa}
${hasJD ? 'JOB DESCRIPTION: ' + jd.substring(0,1500) : 'NO JD PROVIDED'}

SALARY TO USE EXACTLY — entry: "${sal.entry}", mid: "${sal.mid}", senior: "${sal.senior}"
CERTS TO CHOOSE FROM (pick 5 most relevant): ${JSON.stringify(CERTS)}

Return this JSON (replace all placeholder text with real data based on the resume):

{
  "role": "${role}",
  "location": "${locationStr}",
  "match_score": 72,
  "summary": {
    "headline": "Write 8-12 word honest assessment of their profile here",
    "description": "Write 2-3 sentences about where they stand and what they need",
    "goal": "Interview ready"
  },
  "skills_present": ["Skill1", "Skill2", "Skill3", "Skill4", "Skill5"],
  "skill_levels": {"Skill1": "Strong", "Skill2": "Intermediate", "Skill3": "Beginner"},
  "gaps": [
    {"skill": "Missing skill", "priority": "High", "how_to_fix": "Specific fix with exact resource name and URL"},
    {"skill": "Missing skill 2", "priority": "Medium", "how_to_fix": "Specific fix"},
    {"skill": "Missing skill 3", "priority": "Low", "how_to_fix": "Specific fix"}
  ],
  ${middleBlock}
  "priority_actions": [
    "Specific action with exact URL",
    "Second specific action with URL",
    "Third specific action"
  ],
  "plan_30": {
    "weeks": [
      {"label": "Week 1", "steps": [
        {"action": "What to do this week", "detail": "Exact how-to with URL and time estimate", "link": "https://example.com", "link_label": "Visit site"},
        {"action": "Second action", "detail": "Details", "link": null, "link_label": null}
      ]},
      {"label": "Week 2", "steps": [
        {"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}
      ]},
      {"label": "Week 3", "steps": [
        {"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}
      ]},
      {"label": "Week 4", "steps": [
        {"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}
      ]}
    ],
    "callout": "One to two sentences about what this plan prioritizes and trades off"
  },
  "plan_60": {
    "weeks": [
      {"label": "Week 1-2", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 3-4", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 5-6", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 7-8", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]}
    ],
    "callout": "One to two sentences about this plan"
  },
  "plan_90": {
    "weeks": [
      {"label": "Week 1-2", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 3-4", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 5-6", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 7-8", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 9-10", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]},
      {"label": "Week 11-12", "steps": [{"action": "What to do", "detail": "How with URL", "link": null, "link_label": null}]}
    ],
    "callout": "One to two sentences about this plan"
  },
  "certifications": [
    {"name": "Cert from list", "provider": "Provider", "level": "Level", "cost": "Cost", "duration": "Duration", "free": false, "url": "https://url", "why": "Why this cert closes a specific gap for this person"},
    {"name": "Cert 2", "provider": "Provider", "level": "Level", "cost": "Cost", "duration": "Duration", "free": true, "url": "https://url", "why": "Why relevant"},
    {"name": "Cert 3", "provider": "Provider", "level": "Level", "cost": "Cost", "duration": "Duration", "free": false, "url": "https://url", "why": "Why relevant"},
    {"name": "Cert 4", "provider": "Provider", "level": "Level", "cost": "Cost", "duration": "Duration", "free": false, "url": "https://url", "why": "Why relevant"},
    {"name": "Cert 5", "provider": "Provider", "level": "Level", "cost": "Cost", "duration": "Duration", "free": false, "url": "https://url", "why": "Why relevant"}
  ],
  "salary": {
    "entry": "${sal.entry}",
    "mid": "${sal.mid}",
    "senior": "${sal.senior}",
    "note": "${isNational ? 'National averages. NYC, SF, and Seattle typically pay 20-40% above these figures.' : 'Adjusted for ' + locationStr + ' market.'}",
    "tips": [
      "Do not reveal expected salary first, let employer make the opening offer",
      "Negotiate total compensation including bonus equity and benefits not just base",
      ${visaNote}
      "Research this role on Glassdoor and Levels.fyi before any salary conversation"
    ]
  },
  ${sponsorsBlock}
  "ats_rewrites": [
    {"original": "Copy a weak bullet from their actual resume", "rewritten": "Rewrite with strong verb quantified impact and ATS keywords", "keywords_added": ["keyword1", "keyword2", "keyword3"]},
    {"original": "Copy another weak bullet from resume", "rewritten": "Improved version with metrics and keywords", "keywords_added": ["keyword1", "keyword2"]}
  ],
  "linkedin_headline": "Role | Skill1 and Skill2 and Skill3 | Cert name or Cert in progress | Current Company or University"
}`;

  try {
    const result = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      }
    );

    if (result.status !== 200) {
      console.error('Anthropic error:', result.status, JSON.stringify(result.body).substring(0,300));
      const errMsg = (result.body && result.body.error && result.body.error.message)
        ? result.body.error.message : 'AI analysis failed. Please try again.';
      return res.status(502).json({ error: errMsg });
    }

    const content = result.body && result.body.content;
    if (!Array.isArray(content)) {
      return res.status(502).json({ error: 'Unexpected AI response. Please try again.' });
    }

    const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) {
      return res.status(502).json({ error: 'Empty response from AI. Please try again.' });
    }

    let cleaned = text.trim()
      .replace(/^```json\s*/i,'')
      .replace(/\s*```$/,'')
      .trim();

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) {
      console.error('No JSON found. Raw sample:', cleaned.substring(0,200));
      return res.status(502).json({ error: 'Could not parse analysis. Please try again.' });
    }
    cleaned = cleaned.substring(start, end + 1);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse error:', e.message, 'Sample:', cleaned.substring(0,200));
      return res.status(502).json({ error: 'Analysis format error. Please try again.' });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
