const CACHE_KEY = "polly-api-url";
const DEFAULT_API = "http://localhost:3001";
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── State ───
const state = {
  apiUrl: localStorage.getItem(CACHE_KEY) || DEFAULT_API,
  voice: "Seoyeon",
  engine: "neural",
  loading: false,
  history: [],
};

// ─── DOM refs ───
const $ = (id) => document.getElementById(id);
const dom = {
  sidebar:        $("sidebar"),
  backdrop:       $("sidebarBackdrop"),
  menuBtn:        $("menuBtn"),
  topbarMenuBtn:  $("topbarMenuBtn"),
  newChatBtn:     $("newChatBtn"),
  apiUrl:         $("apiUrl"),
  voiceChips:     $("voiceChips"),
  engineChips:    $("engineChips"),
  chatArea:       $("chatArea"),
  emptyState:     $("emptyState"),
  messages:       $("messages"),
  textInput:      $("textInput"),
  charCount:      $("charCount"),
  sendBtn:        $("sendBtn"),
  historyList:    $("historyList"),
  currentVoice:   $("currentVoice"),
  currentEngine:  $("currentEngine"),
};

// ─── Init ───
function init() {
  dom.apiUrl.value = state.apiUrl;

  dom.textInput.addEventListener("input", onTextInput);
  dom.textInput.addEventListener("keydown", onKeyDown);
  dom.sendBtn.addEventListener("click", handleSend);
  dom.newChatBtn.addEventListener("click", clearChat);
  dom.menuBtn.addEventListener("click", toggleSidebar);
  dom.topbarMenuBtn.addEventListener("click", toggleSidebar);
  dom.backdrop.addEventListener("click", closeSidebar);
  dom.apiUrl.addEventListener("change", () => {
    state.apiUrl = dom.apiUrl.value.trim().replace(/\/+$/, "") || DEFAULT_API;
    localStorage.setItem(CACHE_KEY, state.apiUrl);
  });

  // Chip groups
  setupChips(dom.voiceChips, "voice");
  setupChips(dom.engineChips, "engine");

  // Suggestion chips
  document.querySelectorAll(".suggestion-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      dom.textInput.value = btn.dataset.text;
      onTextInput();
      dom.textInput.focus();
    });
  });

  updateHint();
}

function setupChips(container, key) {
  container.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      container.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
      chip.classList.add("selected");
      state[key] = chip.dataset.value;
      updateHint();
    });
  });
}

function updateHint() {
  dom.currentVoice.textContent = state.voice;
  dom.currentEngine.textContent = state.engine;
}

function isMobile() {
  return window.innerWidth <= 768;
}

function toggleSidebar() {
  if (isMobile()) {
    const opening = !dom.sidebar.classList.contains("open");
    dom.sidebar.classList.toggle("open");
    dom.backdrop.classList.toggle("active", opening);
  } else {
    document.body.classList.toggle("sidebar-collapsed");
  }
}

function closeSidebar() {
  dom.sidebar.classList.remove("open");
  dom.backdrop.classList.remove("active");
}

function onTextInput() {
  const len = dom.textInput.value.length;
  dom.charCount.textContent = `${len} / 3000`;
  dom.sendBtn.disabled = len === 0 || state.loading;
  autoResize(dom.textInput);
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 200) + "px";
}

function onKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!dom.sendBtn.disabled) handleSend();
  }
}

function clearChat() {
  dom.messages.innerHTML = "";
  dom.emptyState.style.display = "";
  state.history = [];
  dom.historyList.innerHTML = "";
}

// ─── Message rendering ───
function showEmpty(show) {
  dom.emptyState.style.display = show ? "" : "none";
}

function appendUserMessage(text) {
  showEmpty(false);
  const el = document.createElement("div");
  el.className = "message";
  el.innerHTML = `
    <div class="msg-avatar user">나</div>
    <div class="msg-content">
      <div class="user-bubble">${escapeHtml(text)}</div>
    </div>`;
  dom.messages.appendChild(el);
  scrollBottom();
  return el;
}

function appendLoadingCard() {
  showEmpty(false);
  const el = document.createElement("div");
  el.className = "message";
  el.innerHTML = `
    <div class="msg-avatar assistant">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#fff" stroke-width="2" fill="none"/>
        <path d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/>
      </svg>
    </div>
    <div class="msg-content">
      <div class="assistant-card">
        <div class="loading-dots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  dom.messages.appendChild(el);
  scrollBottom();
  return el;
}

function replaceWithAudioCard(el, data, voiceId, engine) {
  const meta = el.querySelector(".assistant-card");
  const s3Key = data.s3Key || "";
  const keyShort = s3Key.split("/").pop() || s3Key;
  const expires = data.expiresIn ? `${Math.floor(data.expiresIn / 60)}분` : "60분";

  meta.innerHTML = `
    <div class="card-meta">
      <span class="card-badge">${escapeHtml(engine)}</span>
      <span class="card-badge">${escapeHtml(voiceId)}</span>
      <span>${escapeHtml(keyShort)}</span>
      <span>· URL 만료 ${expires}</span>
    </div>
    <div class="audio-player-wrap">
      <audio controls src="${escapeAttr(data.audioUrl)}"></audio>
    </div>
    <div class="card-actions">
      <button class="card-action-btn" onclick="copyUrl('${escapeAttr(data.audioUrl)}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/></svg>
        URL 복사
      </button>
      <a class="card-action-btn" href="${escapeAttr(data.audioUrl)}" download>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 15V3M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        다운로드
      </a>
    </div>`;

  const audio = meta.querySelector("audio");
  audio.play().catch(() => {});
  scrollBottom();
}

function replaceWithError(el, msg) {
  const card = el.querySelector(".assistant-card");
  card.outerHTML = `
    <div class="error-card">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#B91C1C" stroke-width="2"/><path d="M12 8v4M12 16h.01" stroke="#B91C1C" stroke-width="2" stroke-linecap="round"/></svg>
      <span>${escapeHtml(msg)}</span>
    </div>`;
  scrollBottom();
}

function addToHistory(text) {
  const item = document.createElement("div");
  item.className = "history-item";
  item.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    ${escapeHtml(text.slice(0, 60))}${text.length > 60 ? "…" : ""}`;
  item.addEventListener("click", () => {
    dom.textInput.value = text;
    onTextInput();
    dom.textInput.focus();
  });
  dom.historyList.prepend(item);
}

function scrollBottom() {
  requestAnimationFrame(() => {
    dom.chatArea.scrollTop = dom.chatArea.scrollHeight;
  });
}

// ─── Core action ───
async function handleSend() {
  const text = dom.textInput.value.trim();
  if (!text || state.loading) return;

  const apiUrl = state.apiUrl;
  const voiceId = state.voice;
  const engine = state.engine;

  dom.textInput.value = "";
  dom.textInput.style.height = "auto";
  onTextInput();

  appendUserMessage(text);
  addToHistory(text);

  state.loading = true;
  dom.sendBtn.disabled = true;

  const loadingEl = appendLoadingCard();

  try {
    const data = await callApi(apiUrl, { text, textType: "text", voiceId, engine, format: "mp3" });
    replaceWithAudioCard(loadingEl, data, voiceId, engine);
  } catch (err) {
    replaceWithError(loadingEl, err.message || String(err));
  } finally {
    state.loading = false;
    onTextInput();
  }
}

async function callApi(baseUrl, payload) {
  const url = `${baseUrl.replace(/\/+$/, "")}/synthesize`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(e?.name === "AbortError" ? `요청 시간 초과 (${DEFAULT_TIMEOUT_MS / 1000}s)` : (e?.message || String(e)));
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* not json */ }

  if (!res.ok) {
    const msg = json?.error || json?.message || raw.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`서버 오류 (${res.status}): ${msg}`);
  }
  if (!json?.audioUrl) {
    throw new Error("응답에 audioUrl이 없습니다: " + raw.slice(0, 300));
  }
  return json;
}

// ─── Helpers ───
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

window.copyUrl = function (url) {
  navigator.clipboard.writeText(url).catch(() => {});
};

init();
