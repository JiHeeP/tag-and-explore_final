// Keeps the free-plan Supabase project from pausing after a week without activity.
// Vercel Cron calls this once a day (see `crons` in vercel.json). It runs one tiny
// read-only query against `projects`, which counts as database activity.

const DEFAULT_SUPABASE_URL = "https://bnpxshdnckyubwgkwmpx.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_b9uy6XuIZHKou9z89suVLA_EkOgnGtO";

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed" });
  }

  // When CRON_SECRET is set in Vercel, only Vercel Cron (which sends it) may call this.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return json(res, 401, { error: "Unauthorized" });
  }

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

  try {
    const response = await fetch(`${url}/rest/v1/projects?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return json(res, 502, { ok: false, status: response.status, detail: detail.slice(0, 300) });
    }
    return json(res, 200, { ok: true, checkedAt: new Date().toISOString() });
  } catch (error) {
    return json(res, 502, { ok: false, error: error.message });
  }
};
