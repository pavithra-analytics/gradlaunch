const { upstashGet } = require('./warmcache');

// Read raw Upstash keys without JSON.parse (stored as plain integers/floats by INCRBY)
async function upstashRaw(key) {
  try {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    return json?.result != null ? Number(json.result) : null;
  } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const [total, atsSum, atsCount, matchCount, highMatch] = await Promise.all([
    upstashRaw('impact:total'),
    upstashRaw('impact:ats_sum'),
    upstashRaw('impact:ats_count'),
    upstashRaw('impact:match_count'),
    upstashRaw('impact:high_match'),
  ]);

  const avgATS       = atsCount > 0 ? Math.round(atsSum / atsCount) : null;
  const highMatchPct = matchCount > 0 ? Math.round((highMatch / matchCount) * 100) : null;

  res.status(200).json({
    total:        total        ?? 0,
    avgATS:       avgATS       ?? null,
    highMatchPct: highMatchPct ?? null,
    // Round numbers that feel honest — never fake precision
    totalDisplay:        total        != null ? formatCount(total)        : '—',
    avgATSDisplay:       avgATS       != null ? avgATS + '%'              : '—',
    highMatchPctDisplay: highMatchPct != null ? highMatchPct + '%'        : '—',
  });
};

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(n);
}
