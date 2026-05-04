const { requireAuthenticatedUser } = require("./maps-auth");

const STREETVIEW_METADATA_ENDPOINT = "https://maps.googleapis.com/maps/api/streetview/metadata";

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8 * 1024) throw new Error("Request is too large");
  }
  return JSON.parse(raw || "{}");
}

function isValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function googleErrorMessage(status, fallback) {
  if (status === "ZERO_RESULTS") return "이 위치에는 Street View 이미지가 없습니다.";
  if (status === "OVER_QUERY_LIMIT") return "Google Maps 사용량 한도에 도달했습니다.";
  if (status === "REQUEST_DENIED") return "Google Maps API 키 설정을 확인해 주세요.";
  if (status === "INVALID_REQUEST") return "좌표를 다시 확인해 주세요.";
  return fallback || "Street View 정보를 확인하지 못했습니다.";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedUser(req);

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return json(res, 500, { error: "GOOGLE_MAPS_API_KEY is not configured" });

    const body = await readJsonBody(req);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!isValidCoordinate(lat, lng)) return json(res, 400, { error: "올바른 위도/경도가 필요합니다." });

    const url = new URL(STREETVIEW_METADATA_ENDPOINT);
    url.searchParams.set("location", `${lat},${lng}`);
    url.searchParams.set("key", apiKey);

    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return json(res, response.status, { error: "Google Street View 요청에 실패했습니다." });

    return json(res, 200, {
      status: payload.status,
      ok: payload.status === "OK",
      error: payload.status === "OK" ? null : googleErrorMessage(payload.status, payload.error_message),
      panoId: payload.pano_id || null,
      lat: payload.location?.lat ?? null,
      lng: payload.location?.lng ?? null,
      copyright: payload.copyright || null,
      date: payload.date || null,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return json(res, statusCode, { error: error instanceof Error ? error.message : "Street View 정보를 확인하지 못했습니다." });
  }
};
