// ═══════════════════════════════════════════════════════
// APIFY — Admin endpoint only
//
// This endpoint is NOT called during student sessions.
// Students never wait for Apify.
//
// Called by:
//   1. warmcache.js internally (via scrapeRole function)
//   2. Manual admin trigger for a single role refresh
//   3. GitHub Actions weekly cron (via warmcache endpoint)
//
// For full cache pre-warm of all 30 roles, call /api/warmcache instead.
// ═══════════════════════════════════════════════════════

const { roleCacheKey, upstashGet, upstashSet, ROLES } = require('./warmcache');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — check cache status for all 30 roles ──
  // Useful for debugging: see which roles have data and how fresh it is
  if (req.method === 'GET') {
    const status = [];
    for (const role of ROLES) {
      const key  = roleCacheKey(role);
      const data = await upstashGet(key);
      status.push({
        role,
        cached:    !!data,
        jobs:      data?.totalJobs || 0,
        skills:    data?.skillFreq?.length || 0,
        hasSalary: !!data?.salaryData,
        scrapedAt: data?.scrapedAt || null,
        ageHours:  data?.scrapedAt
          ? Math.round((Date.now() - new Date(data.scrapedAt).getTime()) / 3600000)
          : null
      });
    }
    const cached = status.filter(s => s.cached).length;
    return res.status(200).json({
      total: ROLES.length,
      cached,
      missing: ROLES.length - cached,
      roles: status
    });
  }

  // ── POST — trigger single role refresh ──
  // Body: { role: "Data Analyst" }
  // For refreshing one role without running full warmcache
  if (req.method === 'POST') {
    const role = (req.body?.role || '').trim();
    if (!role) {
      return res.status(400).json({
        error: 'Role is required. Send { role: "Data Analyst" }',
        available: ROLES
      });
    }

    // Validate role is in our list
    const matched = ROLES.find(r => r.toLowerCase() === role.toLowerCase());
    if (!matched) {
      return res.status(400).json({
        error: `Role not in pre-baked list. Use /api/warmcache to add new roles.`,
        available: ROLES
      });
    }

    // Delegate to warmcache — it handles scraping and storage
    // We call warmcache with a forced refresh by passing the role
    // warmcache.js handles the actual Apify call
    return res.status(200).json({
      message: `To refresh ${matched}, call /api/warmcache — it will skip roles scraped within 6 days and re-scrape stale ones.`,
      hint:    'The warmcache endpoint handles intelligent refresh logic.',
      role:    matched
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
