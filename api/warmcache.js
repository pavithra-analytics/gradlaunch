// ═══════════════════════════════════════════════════════
// WARMCACHE — called daily by GitHub Actions at 3am UTC
// Pre-warms Apify cache for top 20 role+location combos
// so the majority of students get cached results instantly
// ═══════════════════════════════════════════════════════

const { runApify } = require('./apify');

// Top 20 most common role + location combinations
// Based on typical GradLaunch student search patterns
// Update this list as you gather real usage data
const PREWARM_COMBOS = [
  { role: 'Data Analyst',              location: 'New York' },
  { role: 'Data Analyst',              location: 'San Francisco' },
  { role: 'Data Analyst',              location: 'Chicago' },
  { role: 'Data Analyst',              location: 'Seattle' },
  { role: 'Data Analyst',              location: 'Austin' },
  { role: 'Software Engineer',         location: 'New York' },
  { role: 'Software Engineer',         location: 'San Francisco' },
  { role: 'Software Engineer',         location: 'Seattle' },
  { role: 'Business Analyst',          location: 'New York' },
  { role: 'Business Analyst',          location: 'Chicago' },
  { role: 'Data Engineer',             location: 'New York' },
  { role: 'Data Engineer',             location: 'San Francisco' },
  { role: 'Data Engineer',             location: 'Seattle' },
  { role: 'Data Scientist',            location: 'New York' },
  { role: 'Data Scientist',            location: 'San Francisco' },
  { role: 'Product Manager',           location: 'New York' },
  { role: 'Product Manager',           location: 'San Francisco' },
  { role: 'Machine Learning Engineer', location: 'San Francisco' },
  { role: 'Analytics Engineer',        location: 'New York' },
  { role: 'Business Intelligence Analyst', location: 'New York' }
];

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Accept both GET (from GitHub Actions curl) and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results = {
    started:   new Date().toISOString(),
    total:     PREWARM_COMBOS.length,
    succeeded: 0,
    failed:    0,
    cached:    0,
    details:   []
  };

  console.log(`Warmcache starting: ${PREWARM_COMBOS.length} combinations`);

  for (const { role, location } of PREWARM_COMBOS) {
    const label = `${role} | ${location}`;
    try {
      const result = await runApify(role, location);

      if (!result) {
        results.failed++;
        results.details.push({ label, status: 'failed' });
        console.log(`✗ ${label}`);
      } else if (result.fromCache) {
        results.cached++;
        results.details.push({ label, status: 'already_cached', jobs: result.totalJobs });
        console.log(`⊙ ${label} (already cached, ${result.totalJobs} jobs)`);
      } else {
        results.succeeded++;
        results.details.push({ label, status: 'warmed', jobs: result.totalJobs });
        console.log(`✓ ${label} (${result.totalJobs} jobs)`);
      }
    } catch (e) {
      results.failed++;
      results.details.push({ label, status: 'error', error: e.message });
      console.error(`✗ ${label}: ${e.message}`);
    }

    // Stagger requests — 2 second delay between each
    // Prevents Apify rate limiting and spreads cost evenly
    await sleep(2000);
  }

  results.completed = new Date().toISOString();
  console.log(`Warmcache complete: ${results.succeeded} warmed, ${results.cached} already cached, ${results.failed} failed`);

  return res.status(200).json(results);
};
