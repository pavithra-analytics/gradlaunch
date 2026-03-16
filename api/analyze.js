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

// Tool use schema — enforces exact JSON structure every time
function buildTool(role, locationStr, needsVisa, hasJD, sal, salNote) {
  const baseProperties = {
    match_score: { type: 'integer', description: 'How well the resume matches current ' + role + ' requirements, 0-100' },
    summary: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: '8-12 word honest assessment of their profile' },
        description: { type: 'string', description: '2 sentences about where they stand and what they need' },
        goal: { type: 'string', description: '2-3 word goal e.g. Interview ready' }
      },
      required: ['headline', 'description', 'goal']
    },
    skills_present: {
      type: 'array',
      description: 'Skills found in the resume, max 8',
      items: { type: 'string' }
    },
    skill_levels: {
      type: 'object',
      description: 'Map of skill name to Strong, Intermediate, or Beginner',
      additionalProperties: { type: 'string' }
    },
    gaps: {
      type: 'array',
      description: '3-5 missing skills with specific fixes',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          priority: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          how_to_fix: { type: 'string', description: 'Specific fix with exact resource name and URL' }
        },
        required: ['skill', 'priority', 'how_to_fix']
      }
    },
    priority_actions: {
      type: 'array',
      description: 'Top 3 specific actions with exact URLs',
      items: { type: 'string' },
      maxItems: 3
    },
    plan_30: {
      type: 'object',
      description: '30-day weekly action plan',
      properties: {
        weeks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'e.g. Week 1' },
              steps: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    action: { type: 'string', description: 'What to do' },
                    detail: { type: 'string', description: 'How to do it with URL and time estimate' },
                    link: { type: 'string', description: 'URL or null' },
                    link_label: { type: 'string', description: 'Link button text or null' }
                  },
                  required: ['action', 'detail']
                }
              }
            },
            required: ['label', 'steps']
          }
        },
        callout: { type: 'string', description: '1-2 sentences about what this plan achieves' }
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
          why: { type: 'string', description: 'Why this cert closes a specific gap for this person' }
        },
        required: ['name', 'provider', 'level', 'cost', 'duration', 'free', 'url', 'why']
      },
      maxItems: 3
    },
    salary: {
      type: 'object',
      properties: {
        entry: { type: 'string' },
        mid: { type: 'string' },
        senior: { type: 'string' },
        note: { type: 'string' },
        tips: { type: 'array', items: { type: 'string' } }
      },
      required: ['entry', 'mid', 'senior', 'note', 'tips']
    },
    ats_rewrites: {
      type: 'array',
      description: '2 resume bullets rewritten with ATS keywords',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string', description: 'Weak bullet from their actual resume' },
          rewritten: { type: 'string', description: 'Stronger version with action verb, metrics, keywords' },
          keywords_added: { type: 'array', items: { type: 'string' } }
        },
        required: ['original', 'rewritten', 'keywords_added']
      },
      maxItems: 2
    },
    linkedin_headline: {
      type: 'string',
      description: 'LinkedIn headline under 220 chars: Role | Skill1 Skill2 Skill3 | Cert | Company or University. Use real resume data. No visa. No location.'
    }
  };

  // Add JD breakdown or trending skills based on whether JD was provided
  if (hasJD) {
    baseProperties.jd_breakdown = {
      type: 'array',
      description: 'Requirements from the job description with met/not met status',
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
  } else {
    baseProperties.trending_skills = {
      type: 'array',
      description: '5 trending skills for this role right now',
      items: {
        type: 'object',
        properties: {
          skill: { type: 'string' },
          have: { type: 'boolean', description: 'Whether the candidate has this skill' }
        },
        required: ['skill', 'have']
      },
      maxItems: 5
    };
    baseProperties.top_companies = {
      type: 'array',
      description: '4 companies actively hiring for this role',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          detail: { type: 'string', description: 'Role type and approximate openings' }
        },
        required: ['name', 'detail']
      },
      maxItems: 4
    };
  }

  // Add visa-specific fields
  if (needsVisa) {
    baseProperties.sponsors = {
      type: 'array',
      description: 'Mix of 6 companies that sponsor H-1B visas and are hiring for this role. Include Large, Mid, and Small companies. Not just FAANG.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          roles: { type: 'string', description: 'Relevant roles they hire' },
          why: { type: 'string', description: 'One reason why good fit for this candidate' },
          size: { type: 'string', enum: ['Large', 'Mid', 'Small'] }
        },
        required: ['name', 'roles', 'why', 'size']
      },
      maxItems: 6
    };
    baseProperties.opt_timeline = {
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

  const requiredFields = [
    'match_score', 'summary', 'skills_present', 'skill_levels', 'gaps',
    'priority_actions', 'plan_30', 'certifications', 'salary',
    'ats_rewrites', 'linkedin_headline'
  ];
  if (hasJD) requiredFields.push('jd_breakdown');
  else { requiredFields.push('trending_skills'); requiredFields.push('top_companies'); }
  if (needsVisa) { requiredFields.push('sponsors'); requiredFields.push('opt_timeline'); }

  return {
    name: 'career_analysis',
    description: 'Returns a complete career analysis for a graduate student',
    input_schema: {
      type: 'object',
      properties: baseProperties,
      required: requiredFields
    }
  };
}

async function runAnalysis(apiKey, prompt, tool) {
  return httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'career_analysis' },
      system: 'You are an expert career advisor for new graduates. Analyze the resume carefully and provide specific, actionable advice. Always use real data from the resume.',
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
    'Google Data Analytics Certificate (Google/Coursera, Entry, Free-$49/mo, 6 months, free, https://grow.google/certificates/data-analytics/)',
    'AWS Cloud Practitioner (AWS, Entry, $100, 1 month, paid, https://aws.amazon.com/certification/certified-cloud-practitioner/)',
    'Google Project Management (Google/Coursera, Entry, Free-$49/mo, 6 months, free, https://grow.google/certificates/project-management/)',
    'Tableau Desktop Specialist (Tableau, Associate, $250, 1 month, paid, https://www.tableau.com/learn/certification/desktop-specialist)',
    'Microsoft Power BI PL-300 (Microsoft, Associate, $165, 2 months, paid, https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/)',
    'Google UX Design (Google/Coursera, Entry, Free-$49/mo, 6 months, free, https://grow.google/certificates/ux-design/)',
    'AWS Solutions Architect Associate (AWS, Associate, $150, 2-3 months, paid, https://aws.amazon.com/certification/certified-solutions-architect-associate/)',
    'PMP (PMI, Professional, $405, 3+ months, paid, https://www.pmi.org/certifications/project-management-pmp)',
    'Google IT Support (Google/Coursera, Entry, Free-$49/mo, 6 months, free, https://grow.google/certificates/it-support/)',
    'Salesforce Admin (Salesforce, Associate, $200, 2 months, paid, https://trailhead.salesforce.com/credentials/administrator)',
    'CFA Level 1 (CFA Institute, Professional, $700-$1000, 6 months, paid, https://www.cfainstitute.org/en/programs/cfa)',
    'dbt Analytics Engineering (dbt Labs, Associate, $200, 1 month, paid, https://www.getdbt.com/certifications)',
    'Scrum Master PSM I (Scrum.org, Entry, $150, 2 weeks, paid, https://www.scrum.org/assessments/professional-scrum-master-i-certification)',
    'CompTIA Security+ (CompTIA, Associate, $370, 2 months, paid, https://www.comptia.org/certifications/security)'
  ].join('\n');

  // ── CALL 1: Small web search for live market data ──
  let liveData = '';
  try {
    const searchR = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Search and return 2 plain text sentences. No JSON. No lists.',
        messages: [{
          role: 'user',
          content: 'What skills do ' + role + ' jobs in ' + locationStr + ' require in 2025, and which ' + (needsVisa ? 'H-1B sponsoring ' : '') + 'companies are hiring? 2 sentences only.'
        }]
      }
    );
    if (searchR.status === 200 && Array.isArray(searchR.body.content)) {
      liveData = searchR.body.content
        .filter(b => b.type === 'text').map(b => b.text).join('').trim().substring(0, 300);
    }
  } catch (e) {
    console.log('Web search skipped:', e.message);
  }

  // ── CALL 2: Main analysis using tool use ──
  const tool = buildTool(role, locationStr, needsVisa, hasJD, sal, salNote);

  const prompt = `Analyze this resume for a ${role} role in ${locationStr}.
Visa: ${visa}. Needs sponsorship: ${needsVisa ? 'yes' : 'no'}.

RESUME:
${resume}
${hasJD ? '\nJOB DESCRIPTION:\n' + jd : ''}
${liveData ? '\nLIVE MARKET DATA: ' + liveData : ''}

SALARY TO USE (use these exact values):
entry: ${sal.e}, mid: ${sal.m}, senior: ${sal.s}
note: ${salNote}
tips: ["Do not reveal expected salary first, let employer make the opening offer", "Negotiate total compensation including bonus equity and benefits not just base pay"${needsVisa ? ', "H-1B sponsorship costs employers $5-10k, fair to acknowledge if it comes up in negotiation"' : ''}, "Research this role on Glassdoor and Levels.fyi before any salary conversation"]

CERTIFICATIONS (pick 3 most relevant to their specific gaps):
${CERTS}

${needsVisa ? `OPT TIMELINE GUIDANCE for ${visa}:
title: "${visa} Timeline"
duration: "${visa === 'F-1 OPT' ? 'Duration: 12 months' : visa === 'STEM OPT' ? 'Duration: 24 additional months' : 'Duration: 3 years renewable to 6'}"
Steps should cover: graduation/application, EAD arrival, active job search, extension deadline (if F-1/STEM), expiry date
important_note: critical advice specific to ${visa} including H-1B lottery rate of ~25%` : ''}

Use the career_analysis tool to return your analysis. Be specific — use real skills from the resume, real company names, exact URLs in plan steps.`;

  // Run analysis with auto retry (Option B)
  let result = null;
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await runAnalysis(apiKey, prompt, tool);

      if (r.status !== 200) {
        const msg = r.body && r.body.error ? r.body.error.message : 'Analysis failed.';
        lastError = msg;
        if (attempt === 1) continue; // retry
        return res.status(502).json({ error: msg });
      }

      // Extract tool use result
      const content = r.body && r.body.content;
      if (!Array.isArray(content)) {
        lastError = 'Unexpected response format.';
        if (attempt === 1) continue;
        return res.status(502).json({ error: lastError });
      }

      // Find the tool_use block
      const toolBlock = content.find(b => b.type === 'tool_use' && b.name === 'career_analysis');
      if (!toolBlock || !toolBlock.input) {
        lastError = 'Tool response missing.';
        if (attempt === 1) continue;
        return res.status(502).json({ error: 'Analysis incomplete. Please try again.' });
      }

      result = toolBlock.input;
      result._live = liveData.length > 0;
      return res.status(200).json(result);

    } catch (err) {
      lastError = err.message;
      console.error('Attempt', attempt, 'error:', err.message);
      if (attempt === 2) {
        return res.status(500).json({ error: 'Server error. Please try again.' });
      }
    }
  }

  return res.status(502).json({ error: lastError || 'Analysis failed. Please try again.' });
};
