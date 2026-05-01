const crypto = require("node:crypto");

const MAX_PROXY_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_DIRECT_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_TYPES = new Set(["model/gltf-binary", "model/gltf+json", "application/octet-stream"]);

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

function encodeQueryValue(value) {
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

function createObjectKey(fileName, contentType) {
  const extension = safeExtension(fileName, contentType);
  return `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

function getPublicUrl(key) {
  const publicBaseUrl = getRequiredEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");
  return `${publicBaseUrl}/${key}`;
}

function getR2Config() {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");
  return {
    accountId,
    accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
    bucket: getRequiredEnv("R2_BUCKET"),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    host: `${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    service: "s3",
  };
}

function sign({ secretAccessKey, dateStamp, region, service, stringToSign }) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  return hmac(signingKey, stringToSign, "hex");
}

async function putObjectToR2({ key, body, contentType }) {
  const { accessKeyId, secretAccessKey, bucket, endpoint, host, region, service } = getR2Config();
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
  const signature = sign({ secretAccessKey, dateStamp, region, service, stringToSign });
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

function createPresignedPutUrl({ key, contentType, expiresIn = 900 }) {
  const { accessKeyId, secretAccessKey, bucket, endpoint, host, region, service } = getR2Config();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = `/${encodePathSegment(bucket)}/${key.split("/").map(encodePathSegment).join("/")}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signedHeaders = "content-type;host";
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((name) => `${encodeQueryValue(name)}=${encodeQueryValue(params[name])}`)
    .join("&");
  const canonicalHeaders = [`content-type:${contentType}`, `host:${host}`].join("\n");
  const canonicalRequest = ["PUT", canonicalUri, canonicalQuery, canonicalHeaders + "\n", signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hash(canonicalRequest)].join("\n");
  const signature = sign({ secretAccessKey, dateStamp, region, service, stringToSign });

  return `${endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

module.exports = {
  MAX_DIRECT_UPLOAD_BYTES,
  MAX_PROXY_UPLOAD_BYTES,
  createObjectKey,
  createPresignedPutUrl,
  getPublicUrl,
  isAllowedMimeType,
  putObjectToR2,
};
