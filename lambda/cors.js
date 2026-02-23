// cors.js
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://polly-bucket-edumgt.s3-website.ap-northeast-2.amazonaws.com",
];

function normalizeOrigin(o = "") {
  return String(o).trim().replace(/\/$/, "");
}

function parseAllowedOrigins(envValue) {
  // CORS_ALLOW_ORIGINS="http://a.com,http://b.com" 형태 지원
  if (!envValue) return DEFAULT_ALLOWED_ORIGINS;
  return String(envValue)
    .split(",")
    .map((v) => normalizeOrigin(v))
    .filter(Boolean);
}

function getRequestOrigin(event) {
  // API Gateway는 보통 Origin 또는 origin으로 들어옴
  return (
    event?.headers?.origin ||
    event?.headers?.Origin ||
    event?.headers?.ORIGIN ||
    ""
  );
}

function getCorsOrigin(event, allowedOrigins) {
  const reqOrigin = normalizeOrigin(getRequestOrigin(event));
  if (!reqOrigin) return ""; // Origin 헤더 자체가 없으면 CORS 헤더를 굳이 주지 않음

  const ok = allowedOrigins.some((o) => normalizeOrigin(o) === reqOrigin);
  return ok ? reqOrigin : "";
}

function buildCorsHeaders(event, extraHeaders = {}) {
  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOW_ORIGINS);
  const corsOrigin = getCorsOrigin(event, allowedOrigins);

  const headers = {
    "Content-Type": "application/json",
    // 필요 시 PUT/GET도 추가 가능
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    ...extraHeaders,
  };

  if (corsOrigin) {
    headers["Access-Control-Allow-Origin"] = corsOrigin;
    headers["Vary"] = "Origin"; // 캐시가 Origin 별로 분리되게
  }

  return headers;
}

function corsResponse(event, statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: buildCorsHeaders(event, extraHeaders),
    body: payload === "" ? "" : JSON.stringify(payload),
  };
}

function handlePreflight(event) {
  return {
    statusCode: 204,
    headers: buildCorsHeaders(event),
    body: "",
  };
}

module.exports = {
  buildCorsHeaders,
  corsResponse,
  handlePreflight,
};