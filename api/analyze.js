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

  const body = req.body || {};
  const resume = (body.resume || '').substring(0, 2500);
  const role = (body.role || '').substring(0, 80);
  const location = (body.location || '').substring(0, 80);
  const visa = body.visa || 'F-1 OPT';
  const needsVisa = body.needsVisa === true || body.needsVisa === 'true';
  const jd = (body.jd || '').substring(0, 1500);

  if (!resume || !role) {
    return res.status(400).json({ error: 'Resume and target role are required.' });
  }

  const hasJD = jd.trim().length > 20;
  const locationStr = location.trim() || 'Nationwide USA';
  const isNational = !location.trim() || /^(usa|us|united states)$/i.test(location.trim());

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
  const salNote = isNational
    ? 'National averages. NYC, SF, and Seattle typically pay 20-40% above these figures.'
    : 'Adjusted for ' + locationStr + ' market.';

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
    { name:'Salesforce Certified Administrator', provider:'Salesforce', level:'Associate', cost:'$200', duration:'2 months', false:false, url:'https://trailhead.salesforce.com/credentials/administrator' },
    { name:'CFA Level 1', provider:'CFA Institute', level:'Professional', cost:'$700-$1000', duration:'6 months', free:false, url:'https://www.cfainstitute.org/en/programs/cfa' },
    { name:'dbt Analytics Engineering', provider:'dbt Labs', level:'Associate', cost:'$200', duration:'1 month', free:false, url:'https://www.getdbt.com/certifications' },
    { name:'Professional Scrum Master PSM I', provider:'Scrum.org', level:'Entry', cost:'$150', duration:'2 weeks', free:false, url:'https://www.scrum.org/assessments/professional-scrum-master-i-certification' },
    { name:'CompTIA Security+', provider:'CompTIA', level:'Associate', cost:'$370', duration:'2 months', free:false, url:'https://www.comptia.org/certifications/security' }
  ];

  const visaTimelineSteps = visa === 'H-1B'
    ? '[{"period":"Now","action":"Ensure your employer files H-1B renewal well before expiry. Start tracking your I-94 and visa stamp dates.","urgent":true},{"period":"Year 1-3","action":"Focus on job performance and promotions. Build relationships with your immigration attorney.","urgent":false},{"period":"Year 3","action":"Begin PERM labor certification process for green card as early as possible.","urgent":true},{"period":"Year 6","action":"H-1B cap reached. Must have I-140 approved or extension will not be possible without it.","urgent":true}]'
    : visa === 'STEM OPT'
    ? '[{"period":"Now","action":"Confirm your employer is E-Verify enrolled — required for STEM OPT extension.","urgent":true},{"period":"60 days before F-1 OPT expires","action":"Submit STEM OPT extension application through your DSO. Do not wait.","urgent":true},{"period":"Month 1-12","action":"Active job search and applications. Target H-1B sponsoring employers.","urgent":false},{"period":"April each year","action":"H-1B lottery registration opens. Your employer must register you by late March.","urgent":true}]'
    : '[{"period":"Graduation","action":"Apply for OPT through your DSO immediately. Submit I-765 to USCIS.","urgent":true},{"period":"Month 1-2","action":"EAD card arrives. You can legally start working once you have it in hand.","urgent":false},{"period":"Month 3-6","action":"Active job search. Target companies with strong H-1B sponsorship history.","urgent":false},{"period":"Month 9","action":"No job yet? Apply for STEM OPT extension immediately if your degree qualifies. Do not wait.","urgent":true},{"period":"Month 12","action":"OPT expires. Must have a job offer with sponsorship or STEM extension approved by this date.","urgent":true}]';

  const visaDuration = visa === 'F-1 OPT' ? 'Duration: 12 months'
    : visa === 'STEM OPT' ? 'Duration: 24 additional months after F-1 OPT'
    : 'Duration: 3 years renewable to 6';

  const lines = [
    'You are GradLaunch, an expert career advisor. Analyze the resume below and return ONLY a valid JSON object.',
    'Critical rules: return pure JSON only. No text before the opening brace. No text after the closing brace. No markdown. No code fences. No comments inside JSON.',
    '',
    'RESUME: ' + resume,
    'TARGET ROLE: ' + role,
    'LOCATION: ' + locationStr,
    'VISA: ' + visa,
    'NEEDS SPONSORSHIP: ' + (needsVisa ? 'yes' : 'no'),
    hasJD ? 'JOB DESCRIPTION: ' + jd : 'NO JOB DESCRIPTION PROVIDED',
    '',
    'USE THESE EXACT SALARY VALUES:',
    'entry=' + sal.entry + ' mid=' + sal.mid + ' senior=' + sal.senior,
    '',
    'CHOOSE 5 MOST RELEVANT CERTS FROM THIS LIST: ' + JSON.stringify(CERTS),
    '',
    'Return this JSON with all placeholder values replaced by real analysis data based on the resume:',
    '{',
    '"role":"' + role + '",',
    '"location":"' + locationStr + '",',
    '"match_score":65,',
    '"summary":{"headline":"REPLACE with 8-12 word honest assessment","description":"REPLACE with 2-3 sentence honest assessment of where they stand and what they need","goal":"Interview ready"},',
    '"skills_present":["skill1","skill2","skill3"],',
    '"skill_levels":{"skill1":"Strong","skill2":"Intermediate"},',
    '"gaps":[{"skill":"missing skill","priority":"High","how_to_fix":"specific fix with exact resource and URL"},{"skill":"missing skill 2","priority":"Medium","how_to_fix":"specific fix"}],',
    hasJD
      ? '"jd_breakdown":[{"requirement":"requirement from JD","met":true,"note":"one sentence note"},{"requirement":"requirement 2","met":false,"note":"one sentence note"}],'
      : '"trending_skills":[{"skill":"trending skill name","have":false},{"skill":"trending skill 2","have":true}],"top_companies":[{"name":"company name","detail":"role type and openings"},{"name":"company 2","detail":"role type and openings"}],',
    '"priority_actions":["specific action with exact URL","second specific action with URL","third specific action"],',
    '"plan_30":{"weeks":[',
    '{"label":"Week 1","steps":[{"action":"specific action","detail":"exact how-to with URL and time estimate","link":"https://example.com","link_label":"Visit site"},{"action":"second action","detail":"details and why","link":null,"link_label":null}]},',
    '{"label":"Week 2","steps":[{"action":"specific action week 2","detail":"details with URL","link":null,"link_label":null}]},',
    '{"label":"Week 3","steps":[{"action":"specific action week 3","detail":"details with URL","link":null,"link_label":null}]},',
    '{"label":"Week 4","steps":[{"action":"specific action week 4","detail":"details with URL","link":null,"link_label":null}]}',
    '],"callout":"one to two sentences about what this plan prioritizes and trades off"},',
    '"plan_60":{"weeks":[',
    '{"label":"Week 1-2","steps":[{"action":"specific action","detail":"details with URL","link":null,"link_label":null}]},',
    '{"label":"Week 3-4","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]},',
    '{"label":"Week 5-6","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]},',
    '{"label":"Week 7-8","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]}',
    '],"callout":"one to two sentences about this plan"},',
    '"plan_90":{"weeks":[',
    '{"label":"Week 1-2","steps":[{"action":"specific action","detail":"details with URL","link":null,"link_label":null}]},',
    '{"label":"Week 3-4","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]},',
    '{"label":"Week 5-6","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]},',
    '{"label":"Week 7-8","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]},',
    '{"label":"Week 9-10","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]},',
    '{"label":"Week 11-12","steps":[{"action":"specific action","detail":"details","link":null,"link_label":null}]}',
    '],"callout":"one to two sentences about this plan"},',
    '"certifications":[',
    '{"name":"cert from list","provider":"provider","level":"level","cost":"cost","duration":"duration","free":false,"url":"https://url","why":"why this cert closes a specific gap"},',
    '{"name":"cert 2","provider":"p","level":"l","cost":"c","duration":"d","free":true,"url":"https://url","why":"why relevant"},',
    '{"name":"cert 3","provider":"p","level":"l","cost":"c","duration":"d","free":false,"url":"https://url","why":"why relevant"},',
    '{"name":"cert 4","provider":"p","level":"l","cost":"c","duration":"d","free":false,"url":"https://url","why":"why relevant"},',
    '{"name":"cert 5","provider":"p","level":"l","cost":"c","duration":"d","free":false,"url":"https://url","why":"why relevant"}',
    '],',
    '"salary":{"entry":"' + sal.entry + '","mid":"' + sal.mid + '","senior":"' + sal.senior + '","note":"' + salNote + '","tips":["Do not reveal expected salary first let employer make the opening offer","Negotiate total compensation including bonus equity and benefits not just base"' + (needsVisa ? ',"H-1B sponsorship costs employers $5-10k this context is fair to acknowledge if salary negotiation comes up"' : '') + ',"Research this role on Glassdoor and Levels.fyi before any salary conversation"]},',
    needsVisa ? '"sponsors":[{"name":"REPLACE with real company hiring ' + role + ' that sponsors H-1B","roles":"relevant roles they hire","why":"one reason why good fit for this candidate","size":"Large"},{"name":"REPLACE mid size company","roles":"roles","why":"reason","size":"Mid"},{"name":"REPLACE consulting firm","roles":"roles","why":"reason","size":"Mid"},{"name":"REPLACE smaller company","roles":"roles","why":"reason","size":"Small"},{"name":"REPLACE another company","roles":"roles","why":"reason","size":"Large"},{"name":"REPLACE another mid","roles":"roles","why":"reason","size":"Mid"}],' : '',
    needsVisa ? '"opt_timeline":{"title":"' + visa + ' Timeline","duration":"' + visaDuration + '","steps":' + visaTimelineSteps + ',"important_note":"REPLACE with 2-3 sentences of critical advice specific to ' + visa + '"},' : '',
    '"ats_rewrites":[{"original":"REPLACE with a weak bullet copied from their actual resume","rewritten":"REPLACE with stronger version using action verb quantified impact and ATS keywords","keywords_added":["keyword1","keyword2","keyword3"]},{"original":"REPLACE with second weak bullet from resume","rewritten":"REPLACE with improved version","keywords_added":["keyword1","keyword2"]}],',
    '"linkedin_headline":"REPLACE with headline under 220 chars using format Role | Skill1 Skill2 Skill3 | Cert name or in progress | Company or University - use real resume data no visa no location"',
    '}'
  ];

  const prompt = lines.join('\n');

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
        system: 'You are a career advisor. You must return ONLY valid JSON. No markdown. No code fences. No text before or after the JSON object. Start your response with { and end with }.',
        messages: [{ role: 'user', content: prompt }]
      }
    );

    if (result.status !== 200) {
      console.error('Anthropic error:', result.status, JSON.stringify(result.body).substring(0, 300));
      const errMsg = (result.body && result.body.error && result.body.error.message)
        ? result.body.error.message
        : 'AI analysis failed. Please try again.';
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

    // robust JSON extraction
    let cleaned = text.trim();
    // strip markdown fences if present
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    // find outermost JSON object
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) {
      console.error('No JSON braces. Sample:', cleaned.substring(0, 300));
      return res.status(502).json({ error: 'Could not parse analysis. Please try again.' });
    }
    cleaned = cleaned.substring(start, end + 1);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse error:', e.message, 'Sample:', cleaned.substring(0, 300));
      // last resort: try to fix common issues
      try {
        const fixed = cleaned
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']')
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
        parsed = JSON.parse(fixed);
      } catch (e2) {
        return res.status(502).json({ error: 'Analysis format error. Please try again.' });
      }
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
