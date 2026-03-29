const https = require('https');
const {
  cacheKey, cacheGet, cacheSet,
  extractSkillFrequencies, extractJobListings,
  httpGet
} = require('./apify');

// ═══════════════════════════════════════════════════════
// APIFY POLL HANDLER
// Called by frontend every 3 seconds until complete.
// Each call is a fast ~200ms serverless function.
// No long polling — no timeout risk.
//
// Request body: { runId, role, location, cacheKey }
// Response:
//   { status: 'running' }              — still in progress
//   { status: 'done', ...data }        — complete with results
//   { status: 'failed' }               — run failed
//   { status: 'cached', ...data }      — already in cache (race condition)
// ═══════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body     = req.body || {};
  const runId    = body.runId    || '';
  const role     = (body.role     || '').substring(0, 50).trim();
  const location = (body.location || '').substring(0, 50).trim();
  const key      = body.cacheKey || cacheKey(role, location);

  if (!runId) return res.status(400).json({ error: 'runId required' });

  const token = process.env.APIFY_API_TOKEN;
  if (!token) return res.status(200).json({ status: 'failed' });

  // Check cache first — another request may have already completed this
  const cached = await cacheGet(key);
  if (cached) {
    return res.status(200).json({ status: 'cached', ...cached, fromCache: true });
  }

  try {
    // Check run status — single fast API call
    const statusRes = await httpGet(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
    );
    const status = statusRes?.data?.status;
    console.log(`Apify poll for ${runId}: ${status}`);

    if (status === 'RUNNING' || status === 'READY' || status === 'ABORTING') {
      return res.status(200).json({ status: 'running' });
    }

    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      console.error(`Apify run ${status}: ${runId}`);
      return res.status(200).json({ status: 'failed' });
    }

    if (status === 'SUCCEEDED') {
      // Fetch results
      const items = await httpGet(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&limit=20`
      );

      if (!Array.isArray(items) || !items.length) {
        console.log('Apify: succeeded but no items');
        return res.status(200).json({ status: 'failed' });
      }

      console.log(`Apify: got ${items.length} items for ${role}`);

      const skillFreq = extractSkillFrequencies(items);
      const jobs      = extractJobListings(items);
      const totalJobs = items.length;
      const result    = { skillFreq, jobs, totalJobs, role, location };

      // Store in cache for 24 hours
      await cacheSet(key, result);

      return res.status(200).json({
        status: 'done',
        ...result,
        fromCache: false
      });
    }

    // Unknown status — keep polling
    return res.status(200).json({ status: 'running' });

  } catch (e) {
    console.error('Apify poll error:', e.message);
    // Return running so frontend tries again
    return res.status(200).json({ status: 'running' });
  }
};
