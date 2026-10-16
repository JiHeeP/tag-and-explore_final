// Serves 360° panorama images from the app's own origin so WebGL can use them
// as textures without the R2 bucket needing a CORS rule for every site domain.
// Only images on the project's public R2 host are proxied.

const DEFAULT_PUBLIC_HOST = "pub-b6a81f0a6fd448998e4c7f92d5ddb388.r2.dev";
// Vercel functions cannot return much more than 4.5 MB; larger images fall back
// to a direct load in the browser.
const MAX_BYTES = 4.4 * 1024 * 1024;

function allowedHosts() {
  const hosts = new Set([DEFAULT_PUBLIC_HOST]);
  try {
    if (process.env.R2_PUBLIC_BASE_URL) hosts.add(new URL(process.env.R2_PUBLIC_BASE_URL).host);
  } catch {
    // Ignore a malformed env value; the default host still works.
  }
  return hosts;
}

function fail(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(message);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(res, 405, "Method not allowed");
  }

  let target;
  try {
    target = new URL(String(req.query?.url || ""));
  } catch {
    return fail(res, 400, "Invalid url");
  }
  if (target.protocol !== "https:" || !allowedHosts().has(target.host)) {
    return fail(res, 403, "Host not allowed");
  }

  try {
    const upstream = await fetch(target, { redirect: "error" });
    if (!upstream.ok) return fail(res, upstream.status === 404 ? 404 : 502, `Upstream ${upstream.status}`);
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return fail(res, 415, "Not an image");
    if (Number(upstream.headers.get("content-length")) > MAX_BYTES) return fail(res, 413, "Image too large to proxy");
    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length > MAX_BYTES) return fail(res, 413, "Image too large to proxy");

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(body.length));
    // Uploaded files get unique names, so the CDN can keep them for a long time.
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
    return res.end(body);
  } catch (error) {
    return fail(res, 502, `Fetch failed: ${error.message}`);
  }
};
