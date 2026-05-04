const { requireAuthenticatedUser } = require("./maps-auth");

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

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

function googleErrorMessage(status, fallback) {
  if (status === "ZERO_RESULTS") return "검색 결과가 없습니다.";
  if (status === "OVER_QUERY_LIMIT") return "Google Maps 사용량 한도에 도달했습니다.";
  if (status === "REQUEST_DENIED") return "Google Maps API 키 설정을 확인해 주세요.";
  if (status === "INVALID_REQUEST") return "검색어를 다시 확인해 주세요.";
  return fallback || "장소 검색에 실패했습니다.";
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
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 120) {
      return json(res, 400, { error: "검색어는 2자 이상 120자 이하로 입력해 주세요." });
    }

    const url = new URL(GEOCODE_ENDPOINT);
    url.searchParams.set("address", query);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("language", "ko");

    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) return json(res, response.status, { error: "Google Geocoding 요청에 실패했습니다." });
    if (payload.status !== "OK") return json(res, 400, { error: googleErrorMessage(payload.status, payload.error_message) });

    return json(res, 200, {
      results: (payload.results || []).slice(0, 5).map((result) => ({
        formattedAddress: result.formatted_address,
        lat: result.geometry?.location?.lat,
        lng: result.geometry?.location?.lng,
        placeId: result.place_id,
      })),
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return json(res, statusCode, { error: error instanceof Error ? error.message : "장소 검색에 실패했습니다." });
  }
};
