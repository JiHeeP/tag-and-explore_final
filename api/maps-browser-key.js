const { requireAuthenticatedUser } = require("./maps-auth");

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedUser(req);

    const apiKey = process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
    if (!apiKey) return json(res, 500, { error: "GOOGLE_MAPS_BROWSER_KEY is not configured" });

    return json(res, 200, { apiKey });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return json(res, statusCode, { error: error instanceof Error ? error.message : "Google Maps key를 불러오지 못했습니다." });
  }
};
