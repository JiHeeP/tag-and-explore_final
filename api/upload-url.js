const {
  MAX_DIRECT_UPLOAD_BYTES,
  createObjectKey,
  createPresignedPutUrl,
  getPublicUrl,
  isAllowedMimeType,
} = require("./r2");

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error("Request is too large");
  }
  return JSON.parse(raw || "{}");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = await readJsonBody(req);
    const fileName = typeof body.fileName === "string" ? body.fileName : "upload.bin";
    const contentType = typeof body.contentType === "string" ? body.contentType : "application/octet-stream";
    const size = Number(body.size);

    if (!Number.isFinite(size) || size <= 0) return json(res, 400, { error: "Missing file size" });
    if (size > MAX_DIRECT_UPLOAD_BYTES) return json(res, 413, { error: "Upload is too large" });
    if (!isAllowedMimeType(contentType)) return json(res, 400, { error: "Unsupported file type" });

    const key = createObjectKey(fileName, contentType);

    return json(res, 200, {
      key,
      uploadUrl: createPresignedPutUrl({ key, contentType }),
      url: getPublicUrl(key),
    });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Could not prepare upload" });
  }
};
