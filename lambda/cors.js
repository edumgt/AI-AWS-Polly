function buildCorsHeaders(event, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

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
