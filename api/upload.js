const crypto = require("node:crypto");

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_TYPES = new Set(["model/gltf-binary", "model/gltf+json", "application/octet-stream"]);

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function hash(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function safeExtension(fileName, mimeType) {
  const fromName = (fileName || "").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 8) return fromName;
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "model/gltf-binary") return "glb";
  if (mimeType === "model/gltf+json") return "gltf";
  return "bin";
}

function isAllowedMimeType(mimeType) {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) || ALLOWED_MIME_TYPES.has(mimeType);
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_UPLOAD_BYTES * 1.4) throw new Error("Upload is too large");
  }
  return JSON.parse(raw || "{}");
}

async function putObjectToR2({ key, body, contentType }) {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = getRequiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("R2_SECRET_ACCESS_KEY");
  const bucket = getRequiredEnv("R2_BUCKET");
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${encodePathSegment(bucket)}/${key.split("/").map(encodePathSegment).join("/")}`;
  const payloadHash = hash(body);
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", canonicalUri, "", canonicalHeaders + "\n", signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hash(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`${endpoint}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "X-Amz-Content-Sha256": payloadHash,
      "X-Amz-Date": amzDate,
    },
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`R2 upload failed: ${response.status} ${message}`);
  }
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
    const base64 = typeof body.base64 === "string" ? body.base64 : "";

    if (!base64) return json(res, 400, { error: "Missing file data" });
    if (!isAllowedMimeType(contentType)) return json(res, 400, { error: "Unsupported file type" });

    const fileBuffer = Buffer.from(base64, "base64");
    if (!fileBuffer.length) return json(res, 400, { error: "Empty file" });
    if (fileBuffer.length > MAX_UPLOAD_BYTES) return json(res, 413, { error: "Upload is too large" });

    const publicBaseUrl = getRequiredEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
    const extension = safeExtension(fileName, contentType);
    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;

    await putObjectToR2({ key, body: fileBuffer, contentType });

    return json(res, 200, {
      key,
      url: `${publicBaseUrl}/${key}`,
    });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : "Upload failed" });
  }
};
