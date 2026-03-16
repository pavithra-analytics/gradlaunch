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

function buildTool(role, locationStr, needsVisa, hasJD) {
  const props = {
    match_score: { type: 'integer', description: 'How well resume matches current ' + role + ' requirements, 0-100' },
    summary: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: '8-12 word honest assessment of their profile' },
        description: { type: 'string', description: '2 sentences about where they stand and what they need' }
      },
      required: ['headline', 'description']
    },
    skills_present: { type: 'array', items: { type: 'string' }, description: 'Up to 8 skills found in the resume' },
    skill_levels: { type: 'object', additionalProperties: { type: 'string' }, description: 'Skill to Strong/Intermediate/Beginner' },
    gaps: {
      type: 'array',
      description: '3-5 missing skills needed for this role',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          how_to_fix: { type: 'string', description: 'Specific resource with URL' }
        },
        required: ['skill', 'priority', 'how_to_fix']
      }
    },
    trending_skills: {
      type: 'array',
      description: '5 skills trending for this role right now',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          have: { type: 'boolean' }
        },
        required: ['skill', 'have']
      }
    },
    top_companies: {
      type: 'array',
      description: '4 companies actively hiring for this role',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          detail: { type: 'string' }
        },
        required: ['name', 'detail']
      }
    },
    priority_actions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Top 3 specific actions with exact URLs'
    },
    plan_30: {
      type: 'object',
      properties: {
        weeks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    action: { type: 'string' },
                    detail: { type: 'string', description: 'How with URL and time estimate' },
                    link: { type: 'string' },
                    link_label: { type: 'string' }
                  },
                  required: ['action', 'detail', 'link', 'link_label']
                }
              }
            },
            required: ['label', 'steps']
          }
        },
        callout: { type: 'string' }
      },
      required: ['weeks', 'callout']
    },
    certifications: {
      type: 'array',
      description: 'Top 3 certifications most relevant to their gaps',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          provider: { type: 'string' },
          level: { type: 'string' },
          cost: { type: 'string' },
          duration: { type: 'string' },
          free: { type: 'boolean' },
          url: { type: 'string' },
          why: { type: 'string' }
        },
        required: ['name', 'provider', 'level', 'cost', 'duration', 'free', 'url', 'why']
      }
    },
    salary: {
      type: 'object',
      properties: {
        entry: { type: 'string' },
        mid: { type: 'string' },
        senior: { type: 'string' },
        note: { type: 'string' }
      },
      required: ['entry', 'mid', 'senior', 'note']
    },
    ats_rewrites: {
      type: 'array',
      description: '2 weak resume bullets rewritten with ATS keywords',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string', description: 'Weak bullet copied word for word from their resume' },
          rewritten: { type: 'string', description: 'Stronger version with action verb, metrics, keywords' },
          keywords_added: { type: 'array', items: { type: 'string' } }
        },
        required: ['original', 'rewritten', 'keywords_added']
      }
    },
    linkedin_headline: {
      type: 'string',
      description: 'Under 220 chars. Format: Role | Skill1 Skill2 Skill3 | Cert or in progress | Company or University. No visa. No location.'
    }
  };

  if (hasJD) {
    props.jd_breakdown = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string' },
          met: { type: 'boolean' },
          note: { type: 'string' }
        },
        required: ['requirement', 'met', 'note']
      }
    };
  }

  if (needsVisa) {
    props.sponsors = {
      type: 'array',
      description: '6 companies hiring for this role that sponsor H-1B. Mix of Large, Mid, Small.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          roles: { type: 'string' },
          why: { type: 'string' },
          size: { type: 'string', enum: ['Large', 'Mid', 'Small'] }
        },
        required: ['name', 'roles', 'why', 'size']
      }
    };
    props.opt_timeline = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        duration: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              period: { type: 'string' },
              action: { type: 'string' },
              urgent: { type: 'boolean' }
            },
            required: ['period', 'action', 'urgent']
          }
        },
        important_note: { type: 'string' }
      },
      required: ['title', 'duration', 'steps', 'important_note']
    };
  }

  const required = ['match_score','summary','skills_present','skill_levels','gaps','trending_skills','top_companies','priority_actions','plan_30','certifications','salary','ats_rewrites','linkedin_headline'];
  if (hasJD) required.push('jd_breakdown');
  if (needsVisa) { required.push('sponsors'); required.push('opt_timeline'); }

  return {
    name: 'career_analysis',
    description: 'Complete career analysis',
    input_schema: { type: 'object', properties: props, required }
  };
}

async function runAnalysis(apiKey, prompt, tool) {
  return httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'career_analysis' },
      system: 'You are an expert career advisor for new graduates. Use real data from the resume. Be specific — include exact URLs in plan steps.',
      messages: [{ role: 'user', content: prompt }]
    }
  );
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
  const salNote = isNational ? 'National averages. NYC, SF, Seattle pay 20-40% more.' : locationStr + ' market rates.';

  const CERTS = [
    'Google Data Analytics Certificate (Google/Coursera, Entry, Free-$49/mo, 6 months, free=true, https://grow.google/certificates/data-analytics/)',
    'AWS Cloud Practitioner (AWS, Entry, $100, 1 month, free=false, https://aws.amazon.com/certification/certified-cloud-practitioner/)',
    'Google Project Management (Google/Coursera, Entry, Free-$49/mo, 6 months, free=true, https://grow.google/certificates/project-management/)',
    'Tableau Desktop Specialist (Tableau, Associate, $250, 1 month, free=false, https://www.tableau.com/learn/certification/desktop-specialist)',
    'Microsoft Power BI PL-300 (Microsoft, Associate, $165, 2 months, free=false, https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/)',
    'Google UX Design (Google/Coursera, Entry, Free-$49/mo, 6 months, free=true, https://grow.google/certificates/ux-design/)',
    'AWS Solutions Architect Associate (AWS, Associate, $150, 2-3 months, free=false, https://aws.amazon.com/certification/certified-solutions-architect-associate/)',
    'PMP (PMI, Professional, $405, 3+ months, free=false, https://www.pmi.org/certifications/project-management-pmp)',
    'Google IT Support (Google/Coursera, Entry, Free-$49/mo, 6 months, free=true, https://grow.google/certificates/it-support/)',
    'Salesforce Admin (Salesforce, Associate, $200, 2 months, free=false, https://trailhead.salesforce.com/credentials/administrator)',
    'CFA Level 1 (CFA Institute, Professional, $700-$1000, 6 months, free=false, https://www.cfainstitute.org/en/programs/cfa)',
    'dbt Analytics Engineering (dbt Labs, Associate, $200, 1 month, free=false, https://www.getdbt.com/certifications)',
    'Scrum Master PSM I (Scrum.org, Entry, $150, 2 weeks, free=false, https://www.scrum.org/assessments/professional-scrum-master-i-certification)',
    'CompTIA Security+ (CompTIA, Associate, $370, 2 months, free=false, https://www.comptia.org/certifications/security)'
  ].join('\n');

  // Web search — small, targeted, fast
  let liveData = '';
  try {
    const searchR = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Search and return 2 plain text sentences only. No JSON.',
        messages: [{
          role: 'user',
          content: 'Top skills for ' + role + ' jobs in ' + locationStr + ' in 2025 and ' + (needsVisa ? 'H-1B sponsoring ' : '') + 'companies hiring. 2 sentences only.'
        }]
      }
    );
    if (searchR.status === 200 && Array.isArray(searchR.body.content)) {
      liveData = searchR.body.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().substring(0, 250);
    }
  } catch (e) {
    console.log('Web search skipped:', e.message);
  }

  const tool = buildTool(role, locationStr, needsVisa, hasJD);

  const prompt = `Analyze this resume for a ${role} role in ${locationStr}.
Visa: ${visa}. Needs sponsorship: ${needsVisa ? 'yes' : 'no'}.

RESUME: ${resume}
${hasJD ? '\nJOB DESCRIPTION: ' + jd : ''}
${liveData ? '\nLIVE MARKET DATA: ' + liveData : ''}

SALARY (use exactly): entry=${sal.e}, mid=${sal.m}, senior=${sal.s}, note="${salNote}"

CERTIFICATIONS (pick 3 most relevant to their gaps):
${CERTS}

Rules:
- Use real skills and bullet points from the resume
- Plan steps must include specific URLs and time estimates
- ats_rewrites must copy actual bullets from the resume
- trending_skills and top_companies must always be populated`;

  // Auto retry — Option B
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await runAnalysis(apiKey, prompt, tool);

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

      const toolBlock = content.find(b => b.type === 'tool_use' && b.name === 'career_analysis');
      if (!toolBlock || !toolBlock.input) {
        console.error('No tool block attempt', attempt);
        if (attempt < 2) continue;
        return res.status(502).json({ error: 'Analysis incomplete. Please try again.' });
      }

      const result = toolBlock.input;
      result.role = role;
      result.location = locationStr;
      result._live = liveData.length > 0;
      return res.status(200).json(result);

    } catch (err) {
      console.error('Attempt', attempt, 'error:', err.message);
      if (attempt < 2) continue;
      return res.status(500).json({ error: 'Server error. Please try again.' });
    }
  }
};
