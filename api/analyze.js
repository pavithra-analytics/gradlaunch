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

function extractText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
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
  const resume = (body.resume || '').substring(0, 2000);
  const role = (body.role || '').substring(0, 60);
  const location = (body.location || '').substring(0, 60);
  const visa = body.visa || 'F-1 OPT';
  const needsVisa = body.needsVisa === true || body.needsVisa === 'true';
  const jd = (body.jd || '').substring(0, 1000);

  if (!resume || !role) return res.status(400).json({ error: 'Resume and target role are required.' });

  const hasJD = jd.trim().length > 20;
  const locationStr = location.trim() || 'Nationwide USA';
  const isNational = !location.trim() || /^(usa|us|united states)$/i.test(location.trim());

  // ── SALARY (embedded, no search needed) ──
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

  // ── CERTIFICATIONS (embedded, no search needed) ──
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

  // ── CALL 1: WEB SEARCH for live market data ──
  // Only searches for: current job requirements + hiring companies with sponsorship
  // Returns plain text — no JSON involved so it cannot break
  let liveMarketData = '';
  try {
    const searchQuery = needsVisa
      ? role + ' jobs ' + locationStr + ' requirements skills 2025 AND ' + role + ' H-1B visa sponsor companies hiring 2025'
      : role + ' jobs ' + locationStr + ' requirements skills 2025 AND top companies hiring ' + role + ' ' + locationStr;

    const searchResult = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'You are a job market researcher. Search the web and return a concise plain text summary only. No JSON. No markdown. Just plain sentences.',
        messages: [{
          role: 'user',
          content: 'Search for: 1) What skills and requirements do ' + role + ' jobs in ' + locationStr + ' require right now in 2025? 2) Which companies are actively hiring ' + role + 's in ' + locationStr + (needsVisa ? ' and sponsor H-1B visas?' : '?') + ' Include a mix of large, mid-size, and small companies. Return a plain text summary of your findings in 3-4 sentences.'
        }]
      }
    );

    if (searchResult.status === 200 && searchResult.body && searchResult.body.content) {
      liveMarketData = extractText(searchResult.body.content);
    }
  } catch (err) {
    // web search failed — continue without it, analysis still works
    console.log('Web search skipped:', err.message);
    liveMarketData = '';
  }

  // ── CALL 2: MAIN ANALYSIS using live data as context ──
  const visaTips = needsVisa
    ? ',"H-1B sponsorship costs employers $5-10k - this is standard and fair to acknowledge if negotiation comes up"'
    : '';

  const sponsorsSection = needsVisa
    ? `,"sponsors":[{"name":"Cognizant","roles":"Data Analyst, Business Analyst, IT","why":"Top H-1B sponsor, actively hires new grads, less competitive than FAANG","size":"Large"},{"name":"Infosys","roles":"Data Analyst, Software Engineer","why":"One of highest H-1B sponsors nationally, strong entry-level program","size":"Large"},{"name":"Wipro","roles":"Data Analyst, Business Intelligence","why":"Consistent H-1B sponsor with strong data practice","size":"Large"},{"name":"Booz Allen Hamilton","roles":"Data Analyst, Consultant","why":"Mid-size consulting with active sponsorship, matches this profile well","size":"Mid"},{"name":"CIBC US","roles":"Data Analyst, Financial Analyst","why":"Regional bank, consistent sponsorship, less competitive than FAANG","size":"Mid"},{"name":"Slalom Consulting","roles":"Data Analyst, Business Intelligence","why":"Mid-size consulting firm with active sponsorship and strong data practice","size":"Mid"}]`
    : '';

  const visaTimelineSection = needsVisa
    ? `,"opt_timeline":{"title":"${visa} Timeline","duration":"${visa === 'F-1 OPT' ? 'Duration: 12 months' : visa === 'STEM OPT' ? 'Duration: 24 additional months' : 'Duration: 3 years renewable to 6'}","steps":[{"period":"Graduation","action":"Apply for OPT through your DSO immediately. Submit I-765 to USCIS. Processing takes 90 days.","urgent":true},{"period":"Month 1-2","action":"EAD card arrives. You can legally start working once you have it. Begin job search now.","urgent":false},{"period":"Month 3-6","action":"Active applications. Target STEM-eligible employers so you have the option to extend.","urgent":false},{"period":"Month 9","action":"No offer yet? Apply for STEM OPT extension now if your degree qualifies. Do not wait.","urgent":true},{"period":"Month 12","action":"OPT expires. Must have active employment with sponsorship or approved STEM extension.","urgent":true}],"important_note":"Only STEM CIP codes qualify for the 24-month extension - confirm with your DSO. H-1B lottery is approximately 25% selection rate so apply every year and have a backup plan."}`
    : '';

  const middleSection = hasJD
    ? `"jd_breakdown":[{"requirement":"REPLACE with requirement from JD","met":true,"note":"REPLACE with one sentence note"},{"requirement":"REPLACE with requirement 2","met":false,"note":"REPLACE with note"},{"requirement":"REPLACE with requirement 3","met":true,"note":"REPLACE"},{"requirement":"REPLACE with requirement 4","met":false,"note":"REPLACE"},{"requirement":"REPLACE with requirement 5","met":true,"note":"REPLACE"}]`
    : `"trending_skills":[{"skill":"REPLACE with trending skill","have":false},{"skill":"REPLACE with skill 2","have":true},{"skill":"REPLACE with skill 3","have":false},{"skill":"REPLACE with skill 4","have":true},{"skill":"REPLACE with skill 5","have":false}],"top_companies":[{"name":"REPLACE with company name","detail":"REPLACE with role type and openings"},{"name":"REPLACE company 2","detail":"REPLACE"},{"name":"REPLACE company 3","detail":"REPLACE"},{"name":"REPLACE company 4","detail":"REPLACE"}]`;

  const mainPrompt = `You are a career advisor API. Output ONLY valid JSON. No markdown. No code fences. No extra text. Start with { and end with }.

RESUME: ${resume}
TARGET ROLE: ${role}
LOCATION: ${locationStr}
VISA: ${visa}
NEEDS SPONSORSHIP: ${needsVisa ? 'yes' : 'no'}
${hasJD ? 'JOB DESCRIPTION:\n' + jd + '\n' : ''}
LIVE MARKET DATA FROM WEB SEARCH (use this to inform match score, skill gaps, and company recommendations):
${liveMarketData || 'No live data available - use your training knowledge for ' + role + ' in ' + locationStr}

SALARY VALUES (use exactly): entry=${sal.entry} mid=${sal.mid} senior=${sal.senior}
CERTIFICATIONS (pick 5 most relevant): ${JSON.stringify(CERTS)}

Replace ALL values marked REPLACE with real data from the resume and live market data above.
The match_score must reflect how well this specific resume matches current ${role} requirements.

{"role":"${role}","location":"${locationStr}","match_score":REPLACE_WITH_NUMBER_0_TO_100,"summary":{"headline":"REPLACE with 8-12 word honest assessment of this specific resume","description":"REPLACE with 2-3 sentences about where they stand and what they need based on their actual resume","goal":"REPLACE with 2-3 word goal"},"skills_present":["REPLACE","REPLACE","REPLACE"],"skill_levels":{"REPLACE":"Strong","REPLACE":"Intermediate"},"gaps":[{"skill":"REPLACE with missing skill","priority":"High","how_to_fix":"REPLACE with specific fix including exact URL"},{"skill":"REPLACE missing skill 2","priority":"High","how_to_fix":"REPLACE with specific fix"},{"skill":"REPLACE missing skill 3","priority":"Medium","how_to_fix":"REPLACE"},{"skill":"REPLACE missing skill 4","priority":"Low","how_to_fix":"REPLACE"}],${middleSection},"priority_actions":["REPLACE with specific action including exact URL","REPLACE with second action","REPLACE with third action"],"plan_30":{"weeks":[{"label":"Week 1","steps":[{"action":"REPLACE with specific action","detail":"REPLACE with exact how-to including URL and time estimate","link":"https://REPLACE","link_label":"REPLACE"},{"action":"REPLACE second action","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 2","steps":[{"action":"REPLACE","detail":"REPLACE with URL","link":"https://REPLACE","link_label":"REPLACE"}]},{"label":"Week 3","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 4","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]}],"callout":"REPLACE with 1-2 sentences about this plan"},"plan_60":{"weeks":[{"label":"Week 1-2","steps":[{"action":"REPLACE","detail":"REPLACE with URL","link":"https://REPLACE","link_label":"REPLACE"}]},{"label":"Week 3-4","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 5-6","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 7-8","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]}],"callout":"REPLACE"},"plan_90":{"weeks":[{"label":"Week 1-2","steps":[{"action":"REPLACE","detail":"REPLACE with URL","link":"https://REPLACE","link_label":"REPLACE"}]},{"label":"Week 3-4","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 5-6","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 7-8","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 9-10","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]},{"label":"Week 11-12","steps":[{"action":"REPLACE","detail":"REPLACE","link":null,"link_label":null}]}],"callout":"REPLACE"},"certifications":[{"name":"REPLACE from cert list","provider":"REPLACE","level":"REPLACE","cost":"REPLACE","duration":"REPLACE","free":false,"url":"https://REPLACE","why":"REPLACE with why this cert closes a specific gap for this person"},{"name":"REPLACE","provider":"REPLACE","level":"REPLACE","cost":"REPLACE","duration":"REPLACE","free":true,"url":"https://REPLACE","why":"REPLACE"},{"name":"REPLACE","provider":"REPLACE","level":"REPLACE","cost":"REPLACE","duration":"REPLACE","free":false,"url":"https://REPLACE","why":"REPLACE"},{"name":"REPLACE","provider":"REPLACE","level":"REPLACE","cost":"REPLACE","duration":"REPLACE","free":false,"url":"https://REPLACE","why":"REPLACE"},{"name":"REPLACE","provider":"REPLACE","level":"REPLACE","cost":"REPLACE","duration":"REPLACE","free":false,"url":"https://REPLACE","why":"REPLACE"}],"salary":{"entry":"${sal.entry}","mid":"${sal.mid}","senior":"${sal.senior}","note":"${salNote}","tips":["Do not reveal expected salary first - let employer make the opening offer","Negotiate total compensation including bonus equity and benefits not just base pay"${visaTips},"Research this role on Glassdoor and Levels.fyi before any salary conversation"]}${sponsorsSection}${visaTimelineSection},"ats_rewrites":[{"original":"REPLACE with weak bullet from their actual resume","rewritten":"REPLACE with stronger version using action verb quantified impact and ATS keywords","keywords_added":["REPLACE","REPLACE","REPLACE"]},{"original":"REPLACE with second weak bullet","rewritten":"REPLACE with improved version","keywords_added":["REPLACE","REPLACE"]}],"linkedin_headline":"REPLACE with headline under 220 chars using format Role and Skill1 and Skill2 and Skill3 and Cert name or in progress and Company or University - use real resume data no visa no location"}`;

  try {
    const mainResult = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: 'You are a career advisor API. You output ONLY valid JSON. Your entire response must start with { and end with }. No markdown, no code fences, no extra text of any kind.',
        messages: [{ role: 'user', content: mainPrompt }]
      }
    );

    if (mainResult.status !== 200) {
      const errMsg = (mainResult.body && mainResult.body.error && mainResult.body.error.message)
        ? mainResult.body.error.message : 'AI analysis failed. Please try again.';
      return res.status(502).json({ error: errMsg });
    }

    const content = mainResult.body && mainResult.body.content;
    if (!Array.isArray(content)) return res.status(502).json({ error: 'Unexpected AI response. Please try again.' });

    let text = extractText(content);
    if (!text) return res.status(502).json({ error: 'Empty response from AI. Please try again.' });

    // strip markdown fences if present
    text = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    // find outermost JSON object
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) {
      console.error('No JSON found. Raw sample:', text.substring(0, 200));
      return res.status(502).json({ error: 'Could not parse analysis. Please try again.' });
    }
    const jsonStr = text.substring(start, end + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      // attempt common JSON repairs
      try {
        const fixed = jsonStr
          .replace(/,\s*([}\]])/g, '$1')         // trailing commas
          .replace(/[\u0000-\u001F\u007F]/g, ' '); // control characters
        parsed = JSON.parse(fixed);
      } catch (e2) {
        console.error('JSON parse failed:', e.message, 'Sample:', jsonStr.substring(0, 300));
        return res.status(502).json({ error: 'Analysis format error. Please try again.' });
      }
    }

    // tag response with whether live data was used
    parsed._live_data_used = liveMarketData.length > 0;
    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
};
