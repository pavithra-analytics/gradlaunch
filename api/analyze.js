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

  // Embedded salary — no search needed
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

  // Compact cert list
  const CERTS = [
    'Google Data Analytics|Google/Coursera|Entry|Free-$49/mo|6mo|true|https://grow.google/certificates/data-analytics/',
    'AWS Cloud Practitioner|AWS|Entry|$100|1mo|false|https://aws.amazon.com/certification/certified-cloud-practitioner/',
    'Google Project Management|Google/Coursera|Entry|Free-$49/mo|6mo|true|https://grow.google/certificates/project-management/',
    'Tableau Desktop Specialist|Tableau|Associate|$250|1mo|false|https://www.tableau.com/learn/certification/desktop-specialist',
    'Power BI PL-300|Microsoft|Associate|$165|2mo|false|https://learn.microsoft.com/certifications/power-bi-data-analyst-associate/',
    'Google UX Design|Google/Coursera|Entry|Free-$49/mo|6mo|true|https://grow.google/certificates/ux-design/',
    'AWS Solutions Architect|AWS|Associate|$150|2-3mo|false|https://aws.amazon.com/certification/certified-solutions-architect-associate/',
    'PMP|PMI|Professional|$405|3+mo|false|https://www.pmi.org/certifications/project-management-pmp',
    'Google IT Support|Google/Coursera|Entry|Free-$49/mo|6mo|true|https://grow.google/certificates/it-support/',
    'Salesforce Admin|Salesforce|Associate|$200|2mo|false|https://trailhead.salesforce.com/credentials/administrator',
    'CFA Level 1|CFA Institute|Professional|$700-$1000|6mo|false|https://www.cfainstitute.org/en/programs/cfa',
    'dbt Analytics|dbt Labs|Associate|$200|1mo|false|https://www.getdbt.com/certifications',
    'Scrum Master PSM I|Scrum.org|Entry|$150|2wk|false|https://www.scrum.org/assessments/professional-scrum-master-i-certification',
    'CompTIA Security+|CompTIA|Associate|$370|2mo|false|https://www.comptia.org/certifications/security'
  ].join('\n');

  // ── CALL 1: Targeted web search (small, fast) ──
  // Only fetches what we actually need live data for
  let liveData = '';
  try {
    const searchR = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Search the web and return a 3-sentence plain text summary. No JSON. No lists. Plain sentences only.',
        messages: [{
          role: 'user',
          content: 'What are the top 5 skills required for ' + role + ' jobs in ' + locationStr + ' in 2025, and which ' + (needsVisa ? 'H-1B sponsoring ' : '') + 'companies are actively hiring for this role? Give me a plain text summary in 3 sentences.'
        }]
      }
    );
    if (searchR.status === 200 && Array.isArray(searchR.body.content)) {
      liveData = searchR.body.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().substring(0, 500);
    }
  } catch (e) {
    console.log('Web search skipped:', e.message);
  }

  // ── CALL 2: Main analysis — short natural language prompt ──
  const prompt = `Analyze this resume for a ${role} position in ${locationStr}.
Visa: ${visa}. Needs sponsorship: ${needsVisa ? 'yes' : 'no'}.

RESUME:
${resume}
${hasJD ? '\nJOB DESCRIPTION:\n' + jd : ''}
${liveData ? '\nCURRENT MARKET DATA:\n' + liveData : ''}

SALARY (use exactly): entry=${sal.e} mid=${sal.m} senior=${sal.s} note="${salNote}"

CERTS (name|provider|level|cost|duration|free|url — pick 5 most relevant):
${CERTS}

Return a JSON object with these exact keys. Output ONLY the JSON, nothing else.

Keys required:
- role, location, match_score (0-100 integer)
- summary: {headline, description, goal}
- skills_present: array of strings
- skill_levels: object mapping skill to Strong/Intermediate/Beginner
- gaps: array of {skill, priority (High/Medium/Low), how_to_fix}
${hasJD
  ? '- jd_breakdown: array of {requirement, met (boolean), note}'
  : '- trending_skills: array of {skill, have (boolean)}\n- top_companies: array of {name, detail}'
}
- priority_actions: array of 3 specific strings with URLs
- plan_30: {weeks: array of {label, steps: array of {action, detail, link, link_label}}, callout}
- plan_60: same structure with 4 bi-weekly blocks
- plan_90: same structure with 6 bi-weekly blocks
- certifications: array of 5 objects {name, provider, level, cost, duration, free, url, why}
- salary: {entry, mid, senior, note, tips: array of strings}
${needsVisa ? '- sponsors: array of 6 objects {name, roles, why, size (Large/Mid/Small)}\n- opt_timeline: {title, duration, steps: array of {period, action, urgent}, important_note}' : ''}
- ats_rewrites: array of 2 objects {original, rewritten, keywords_added}
- linkedin_headline: string under 220 chars

Rules:
1. Plans must have specific URLs and time estimates, not vague advice
2. Use real data from the resume for skills_present and ats_rewrites
3. linkedin_headline format: Role | Skill1 Skill2 Skill3 | Cert | Company or University
4. match_score must reflect how well this resume matches current ${role} requirements`;

  try {
    const mainR = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2500,
        system: 'You are a career advisor API. Return ONLY valid JSON. Start with { end with }. No markdown, no code fences, no explanation.',
        messages: [{ role: 'user', content: prompt }]
      }
    );

    if (mainR.status !== 200) {
      const msg = mainR.body && mainR.body.error ? mainR.body.error.message : 'Analysis failed.';
      return res.status(502).json({ error: msg });
    }

    const content = mainR.body && mainR.body.content;
    if (!Array.isArray(content)) return res.status(502).json({ error: 'Unexpected response. Please try again.' });

    let text = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (!text) return res.status(502).json({ error: 'Empty response. Please try again.' });

    // clean markdown fences
    text = text.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();

    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s === -1 || e === -1) return res.status(502).json({ error: 'Could not parse analysis. Please try again.' });

    let parsed;
    try {
      parsed = JSON.parse(text.substring(s, e + 1));
    } catch (err) {
      try {
        // repair trailing commas and control chars
        const fixed = text.substring(s, e + 1)
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/[\u0000-\u001F\u007F]/g, ' ');
        parsed = JSON.parse(fixed);
      } catch (err2) {
        console.error('Parse failed:', err.message, text.substring(s, s + 200));
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
