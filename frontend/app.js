// app.js (refactored)

const el = {
  apiUrl: document.getElementById("apiUrl"),
  text: document.getElementById("text"),
  voiceId: document.getElementById("voiceId"),
  engine: document.getElementById("engine"),
  button: document.getElementById("synthesizeBtn"),
  status: document.getElementById("status"),
  player: document.getElementById("player"),
};

const cacheKey = "polly-lambda-url";
const DEFAULT_TIMEOUT_MS = 25_000;

el.apiUrl.value = localStorage.getItem(cacheKey) || "";

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.style.color = isError ? "#b91c1c" : "#1f2937";
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function preview(text, n = 500) {
  const s = String(text ?? "");
  return s.length > n ? s.slice(0, n) + "..." : s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 안전한 fetch:
 * - 항상 res.text()로 받고,
 * - content-type이 JSON이면 JSON 파싱 시도,
 * - 아니면 raw 그대로 둠
 */
async function fetchSmart(url, options = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const raw = await res.text();

    let json = null;
    if (contentType.includes("application/json")) {
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        // content-type은 json인데 파싱 실패 → json=null로 유지
        json = null;
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      contentType,
      raw,
      json, // JSON이면 object, 아니면 null
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildPayload() {
  const text = el.text.value.trim();
  const voiceId = el.voiceId.value;
  const engine = el.engine.value;

  return {
    text,
    textType: "text",
    voiceId,
    engine,
    format: "mp3",
  };
}

function validateInputs() {
  const apiUrl = normalizeUrl(el.apiUrl.value);
  const text = el.text.value.trim();

  if (!apiUrl) return { ok: false, message: "Lambda Function URL을 입력하세요." };
  if (!/^https?:\/\//i.test(apiUrl)) return { ok: false, message: "URL 형식이 올바르지 않습니다. (http/https)" };
  if (!text) return { ok: false, message: "텍스트를 입력하세요." };

  return { ok: true, apiUrl };
}

function lockUI(locked) {
  el.button.disabled = locked;
  el.apiUrl.disabled = locked;
  el.text.disabled = locked;
  el.voiceId.disabled = locked;
  el.engine.disabled = locked;
}

async function synthesize() {
  const v = validateInputs();
  if (!v.ok) return setStatus(v.message, true);

  const apiUrl = v.apiUrl;
  localStorage.setItem(cacheKey, apiUrl);

  lockUI(true);
  setStatus("음성 생성 중...");

  // (선택) 아주 짧은 딜레이로 UI 반응 보장
  await sleep(30);

  try {
    const payload = buildPayload();

    const result = await fetchSmart(
      apiUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { timeoutMs: DEFAULT_TIMEOUT_MS }
    );

    // 실패 처리: JSON이면 error 필드 우선, 아니면 raw 프리뷰
    if (!result.ok) {
      const serverMsg =
        (result.json && (result.json.error || result.json.message)) ||
        preview(result.raw, 500) ||
        "(empty body)";

      setStatus(
        [
          `요청 실패: HTTP ${result.status} ${result.statusText}`,
          `content-type: ${result.contentType || "(none)"}`,
          `body: ${serverMsg}`,
        ].join("\n"),
        true
      );
      return;
    }

    // 성공인데 JSON이 아닐 때
    if (!result.json) {
      setStatus(
        [
          `성공 응답이지만 JSON이 아닙니다.`,
          `HTTP ${result.status} ${result.statusText}`,
          `content-type: ${result.contentType || "(none)"}`,
          `body: ${preview(result.raw, 500)}`,
        ].join("\n"),
        true
      );
      return;
    }

    const data = result.json;

    if (!data.audioUrl) {
      setStatus(
        [
          `성공 응답(JSON)인데 audioUrl이 없습니다.`,
          `JSON: ${preview(JSON.stringify(data, null, 2), 800)}`,
        ].join("\n"),
        true
      );
      return;
    }

    el.player.src = data.audioUrl;

    try {
      await el.player.play();
    } catch {
      // 자동재생 정책 때문에 play()가 막힐 수 있음
    }

    setStatus(`완료: ${data.s3Key || "(no key)"}\n재생 URL 만료(초): ${data.expiresIn || "(unknown)"}`);
  } catch (err) {
    const msg =
      err?.name === "AbortError"
        ? `요청 시간 초과 (${DEFAULT_TIMEOUT_MS / 1000}s)`
        : (err?.message || String(err));

    setStatus(`오류: ${msg}`, true);
  } finally {
    lockUI(false);
  }
}

el.button.addEventListener("click", synthesize);