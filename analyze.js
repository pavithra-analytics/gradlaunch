export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // rate limiting via in-memory (Vercel edge resets, good enough for basic protection)
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (!global._rl) global._rl = {};
  const entry = global._rl[ip];
  if (entry && entry.count >= 3 && now - entry.ts < 3600000) {
    return res.status(429).json({ error: 'Too many requests. Please wait an hour before trying again.' });
  }
  if (!entry || now - entry.ts >= 3600000) global._rl[ip] = { count: 1, ts: now };
  else global._rl[ip].count++;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured. Please contact the site owner.' });

  const { resume, role, location, visa, needsVisa, jd } = req.body;
  if (!resume || !role) return res.status(400).json({ error: 'Resume and target role are required.' });

  const hasJD = !!(jd && jd.trim().length > 20);
  const locationStr = location && location.trim() ? location.trim() : 'Nationwide (USA)';
  const isNational = !location || location.trim() === '' || location.trim().toUpperCase().match(/^(USA|US|UNITED STATES|UNITED STATES OF AMERICA)$/);

  // Embedded salary ranges (avoids web search for this)
  const SALARY_RANGES = {
    default: { entry: '$55k–$75k', mid: '$75k–$110k', senior: '$110k–$160k' },
    'new york': { entry: '$69k–$94k', mid: '$95k–$130k', senior: '$130k–$175k' },
    'san francisco': { entry: '$85k–$115k', mid: '$115k–$155k', senior: '$155k–$220k' },
    'austin': { entry: '$62k–$85k', mid: '$85k–$120k', senior: '$120k–$165k' },
    'chicago': { entry: '$60k–$82k', mid: '$82k–$115k', senior: '$115k–$155k' },
    'seattle': { entry: '$78k–$105k', mid: '$105k–$145k', senior: '$145k–$200k' },
    'boston': { entry: '$70k–$95k', mid: '$95k–$130k', senior: '$130k–$175k' },
    'los angeles': { entry: '$68k–$92k', mid: '$92k–$125k', senior: '$125k–$170k' },
    'dallas': { entry: '$60k–$82k', mid: '$82k–$115k', senior: '$115k–$155k' },
    'washington': { entry: '$68k–$92k', mid: '$92k–$128k', senior: '$128k–$172k' },
  };

  const locKey = Object.keys(SALARY_RANGES).find(k => locationStr.toLowerCase().includes(k)) || 'default';
  const salaryData = SALARY_RANGES[locKey];

  // Embedded certifications database (top 15 most universally relevant)
  const CERTS_DB = [
    { name: 'Google Data Analytics Certificate', provider: 'Google / Coursera', level: 'Entry', cost: 'Free–$49/mo', duration: '6 months', free: true, url: 'https://grow.google/certificates/data-analytics/', tags: ['data','analyst','sql','tableau'] },
    { name: 'AWS Cloud Practitioner', provider: 'Amazon Web Services', level: 'Entry', cost: '$100', duration: '1 month', free: false, url: 'https://aws.amazon.com/certification/certified-cloud-practitioner/', tags: ['cloud','aws','tech','data','engineer'] },
    { name: 'Google Project Management Certificate', provider: 'Google / Coursera', level: 'Entry', cost: 'Free–$49/mo', duration: '6 months', free: true, url: 'https://grow.google/certificates/project-management/', tags: ['project','management','pm','business'] },
    { name: 'Tableau Desktop Specialist', provider: 'Tableau', level: 'Associate', cost: '$250', duration: '1 month', free: false, url: 'https://www.tableau.com/learn/certification/desktop-specialist', tags: ['data','analyst','visualization','tableau'] },
    { name: 'Microsoft Power BI (PL-300)', provider: 'Microsoft', level: 'Associate', cost: '$165', duration: '2 months', free: false, url: 'https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/', tags: ['data','analyst','power bi','microsoft','finance'] },
    { name: 'Google UX Design Certificate', provider: 'Google / Coursera', level: 'Entry', cost: 'Free–$49/mo', duration: '6 months', free: true, url: 'https://grow.google/certificates/ux-design/', tags: ['ux','design','product'] },
    { name: 'AWS Solutions Architect Associate', provider: 'Amazon Web Services', level: 'Associate', cost: '$150', duration: '2–3 months', free: false, url: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/', tags: ['cloud','aws','engineer','architect'] },
    { name: 'PMP — Project Management Professional', provider: 'PMI', level: 'Professional', cost: '$405', duration: '3+ months', free: false, url: 'https://www.pmi.org/certifications/project-management-pmp', tags: ['project','management','senior','operations'] },
    { name: 'Certified Business Analysis Professional (CBAP)', provider: 'IIBA', level: 'Professional', cost: '$325', duration: '3 months', free: false, url: 'https://www.iiba.org/certifications/cbap/', tags: ['business','analyst','requirements'] },
    { name: 'Google IT Support Certificate', provider: 'Google / Coursera', level: 'Entry', cost: 'Free–$49/mo', duration: '6 months', free: true, url: 'https://grow.google/certificates/it-support/', tags: ['it','support','tech','helpdesk'] },
    { name: 'Salesforce Certified Administrator', provider: 'Salesforce', level: 'Associate', cost: '$200', duration: '2 months', free: false, url: 'https://trailhead.salesforce.com/credentials/administrator', tags: ['salesforce','crm','business','sales','admin'] },
    { name: 'CFA Level 1', provider: 'CFA Institute', level: 'Professional', cost: '$700–$1000', duration: '6 months', free: false, url: 'https://www.cfainstitute.org/en/programs/cfa', tags: ['finance','investment','analyst','banking'] },
    { name: 'dbt Analytics Engineering', provider: 'dbt Labs', level: 'Associate', cost: '$200', duration: '1 month', free: false, url: 'https://www.getdbt.com/certifications', tags: ['data','engineer','analytics','sql','dbt'] },
    { name: 'Professional Scrum Master (PSM I)', provider: 'Scrum.org', level: 'Entry', cost: '$150', duration: '2 weeks', free: false, url: 'https://www.scrum.org/assessments/professional-scrum-master-i-certification', tags: ['agile','scrum','project','management','software'] },
    { name: 'CompTIA Security+', provider: 'CompTIA', level: 'Associate', cost: '$370', duration: '2 months', free: false, url: 'https://www.comptia.org/certifications/security', tags: ['security','cybersecurity','it','tech'] },
  ];

  const prompt = `You are GradLaunch, an expert career advisor for new graduates. Analyze the provided resume and return a comprehensive career analysis as a single JSON object. Be specific, actionable, and honest.

INPUTS:
- Resume: ${resume.substring(0,2500)}
- Target Role: ${role}
- Location: ${locationStr}
- Visa Status: ${visa}
- Needs Visa Sponsorship: ${needsVisa}
- Job Description Provided: ${hasJD}
${hasJD ? `- Job Description: ${jd.substring(0,1500)}` : ''}

SALARY DATA FOR THIS LOCATION (use exactly these values):
- Entry level (0-2 yrs): ${salaryData.entry}
- Mid level (3-5 yrs): ${salaryData.mid}  
- Senior (6+ yrs): ${salaryData.senior}

CERTIFICATIONS DATABASE (choose the most relevant 5 from this list based on the target role):
${JSON.stringify(CERTS_DB)}

Return ONLY a valid JSON object with this exact structure. No markdown, no explanation, just JSON:

{
  "role": "${role}",
  "location": "${locationStr}",
  "match_score": <number 0-100, based on ${hasJD ? 'the provided JD' : 'typical ' + role + ' requirements found via web search'}>,
  "summary": {
    "headline": "<8-12 word headline summarizing their profile, e.g. 'Strong SQL foundation, missing visualization tools for NYC market'>",
    "description": "<2-3 sentence honest assessment of where they stand and what they need>",
    "goal": "<2-3 word goal e.g. 'Interview ready' or 'Offer in hand'>"
  },
  "skills_present": ["<skill1>","<skill2>","<max 8 skills found in resume>"],
  "skill_levels": {"<skill>":"Strong|Intermediate|Beginner"},
  "gaps": [
    {"skill":"<missing skill>","priority":"High|Medium|Low","how_to_fix":"<specific 1 sentence fix with resource name>"},
    "<3-6 gaps total>"
  ],
  ${hasJD ? `"jd_breakdown": [
    {"requirement":"<exact requirement from JD>","met":true|false,"note":"<1 sentence specific note>"},
    "<6-10 requirements from the JD>"
  ],` : `"trending_skills": [
    {"skill":"<trending skill for this role>","have":true|false},
    "<5 skills total>"
  ],
  "top_companies": [
    {"name":"<company name>","detail":"<role type> · <number> openings"},
    "<4 companies currently hiring for this role in this location>"
  ],`}
  "priority_actions": [
    "<specific action 1 with exact resource — e.g. Go to coursera.org/google-data-analytics and enroll today — free to audit>",
    "<specific action 2>",
    "<specific action 3 — no more than 3 actions>"
  ],
  "plan_30": {
    "weeks": [
      {
        "label": "Week 1",
        "steps": [
          {"action":"<specific what>","detail":"<specific how + why, exact URLs>","link":"<https://url or null>","link_label":"<link text or null>"},
          "<2-4 steps per week>"
        ]
      },
      {"label":"Week 2","steps":[...]},
      {"label":"Week 3","steps":[...]},
      {"label":"Week 4","steps":[...]}
    ],
    "callout": "<1-2 sentence honest note about this plan's tradeoffs>"
  },
  "plan_60": {
    "weeks": [
      {"label":"Week 1–2","steps":[...]},
      {"label":"Week 3–4","steps":[...]},
      {"label":"Week 5–6","steps":[...]},
      {"label":"Week 7–8","steps":[...]}
    ],
    "callout": "<1-2 sentence honest note>"
  },
  "plan_90": {
    "weeks": [
      {"label":"Week 1–2","steps":[...]},
      {"label":"Week 3–4","steps":[...]},
      {"label":"Week 5–6","steps":[...]},
      {"label":"Week 7–8","steps":[...]},
      {"label":"Week 9–10","steps":[...]},
      {"label":"Week 11–12","steps":[...]}
    ],
    "callout": "<1-2 sentence honest note>"
  },
  "certifications": [
    "<select 5 most relevant from the database provided, using exact fields from the database>",
    "<add a why field: 'why':'<1 sentence why this cert is important for their specific gaps and target role>'>"
  ],
  "salary": {
    "entry": "${salaryData.entry}",
    "mid": "${salaryData.mid}",
    "senior": "${salaryData.senior}",
    "note": "${isNational ? 'National averages. Salaries vary by city — NYC, SF, and Seattle typically pay 20–40% above these figures.' : 'Adjusted for ' + locationStr + ' market rates.'}",
    "tips": [
      "Don't reveal your expected salary first — let the employer make the opening offer",
      "Negotiate total compensation: salary + bonus + equity + benefits — not just base pay",
      ${needsVisa ? '"Visa sponsorship costs employers $5–10k — this is standard and fair to acknowledge in negotiation if brought up",' : ''}
      "Research the role on Glassdoor and Levels.fyi before any salary conversation"
    ]
  },
  ${needsVisa ? `"sponsors": [
    {"name":"<company name>","roles":"<relevant roles they hire>","why":"<1 short reason why good for this person>","size":"Large|Mid|Small"},
    "<use web search to find 6-8 companies actually hiring for ${role} that sponsor H-1B — mix of Large, Mid, and Small companies, NOT just FAANG>"
  ],` : ''}
  ${needsVisa ? `"opt_timeline": {
    "title": "${visa} Timeline",
    "duration": "${visa === 'F-1 OPT' ? 'Duration: 12 months' : visa === 'STEM OPT' ? 'Duration: 24 additional months (36 total)' : 'Duration: 3 years, renewable'}",
    "steps": [
      {"period":"<time period>","action":"<specific action>","urgent":true|false},
      "<5-6 timeline steps relevant to ${visa}>"
    ],
    "important_note": "<2-3 sentences of critical visa advice specific to ${visa}>"
  },` : ''}
  "ats_rewrites": [
    {"original":"<a weak bullet from their resume>","rewritten":"<stronger ATS-optimized version with quantified impact and keywords>","keywords_added":["<kw1>","<kw2>","<kw3>"]},
    "<2-3 rewrites using actual bullets from their resume>"
  ],
  "linkedin_headline": "<sharp LinkedIn headline under 220 chars: Role | Top 3-4 skills | Current cert or cert in progress | Current company or University — no visa, no location. Use their ACTUAL skills and experience from the resume. Make it recruiter-ready.>"
}

IMPORTANT RULES:
1. Plans must be SPECIFIC — include exact URLs, platform names, time estimates. Never say "get a certification" — say exactly which cert, where, how long, why.
2. Use web search to find companies actually hiring for ${role} in ${locationStr} that sponsor visas (if needed). Mix company sizes.
3. Certifications: pick 5 most relevant from the provided database. Add a "why" field explaining relevance to their specific gaps.
4. LinkedIn headline: use their actual skills from the resume. Under 220 characters. No visa mention. No location.
5. Return ONLY valid JSON. No text before or after.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('Anthropic error:', errData);
      return res.status(502).json({ error: 'AI analysis failed. Please try again in a moment.' });
    }

    const data = await response.json();

    // extract text from response (handles tool use blocks)
    const textContent = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    if (!textContent) {
      return res.status(502).json({ error: 'No response from AI. Please try again.' });
    }

    // parse JSON — strip any accidental markdown
    let cleaned = textContent.replace(/```json/g,'').replace(/```/g,'').trim();
    // find first { and last }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(502).json({ error: 'Analysis could not be parsed. Please try again.' });
    }
    cleaned = cleaned.substring(start, end + 1);

    const result = JSON.parse(cleaned);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
