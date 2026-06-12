const CACHE_KEY = "polly-api-url";
const DEFAULT_API = "http://localhost:3001";
const TIMEOUT_MS = 180_000; // 3 min — Tortoise/Bark can be slow

// ─── State ───
const state = {
  apiUrl: localStorage.getItem(CACHE_KEY) || DEFAULT_API,
  provider: "polly",
  // Polly-specific
  voice: "Seoyeon",
  engine: "neural",
  // Open-source engine params
  language: "ko",
  speaker: "",
  // Runtime
  loading: false,
  engines: [],   // engine info list from /engines
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
  providerGrid:   $("providerGrid"),
  // Polly
  pollySettings:  $("pollySettings"),
  voiceChips:     $("voiceChips"),
  engineChips:    $("engineChips"),
  // OSS engines
  ossSettings:    $("ossSettings"),
  languageGroup:  $("languageGroup"),
  languageChips:  $("languageChips"),
  speakerGroup:   $("speakerGroup"),
  speakerSelect:  $("speakerSelect"),
  engineNote:     $("engineNote"),
  // Chat
  chatArea:       $("chatArea"),
  emptyState:     $("emptyState"),
  emptySubtitle:  $("emptySubtitle"),
  messages:       $("messages"),
  textInput:      $("textInput"),
  charCount:      $("charCount"),
  sendBtn:        $("sendBtn"),
  inputHint:      $("inputHint"),
  historyList:    $("historyList"),
};

// ─── Init ───
async function init() {
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
    fetchEngines();
  });

  setupChips(dom.voiceChips, "voice");
  setupChips(dom.engineChips, "engine");
  setupChips(dom.languageChips, "language");

  dom.speakerSelect.addEventListener("change", () => {
    state.speaker = dom.speakerSelect.value;
    updateHint();
  });

  document.querySelectorAll(".suggestion-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      dom.textInput.value = btn.dataset.text;
      onTextInput();
      dom.textInput.focus();
    });
  });

  await fetchEngines();
}

// ─── Engine list from backend ───
async function fetchEngines() {
  try {
    const res = await fetch(`${state.apiUrl}/engines`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.engines = await res.json();
  } catch {
    // Fallback: show static providers, all marked unavailable except Polly
    state.engines = [
      { id: "polly",    name: "AWS Polly",     available: true,  description: "Amazon 관리형 신경망 TTS" },
      { id: "bark",     name: "Bark",           available: false, description: "비언어 표현 지원 TTS" },
      { id: "coqui",    name: "Coqui XTTS v2", available: false, description: "음성 복제 TTS" },
      { id: "vits",     name: "VITS",           available: false, description: "경량 고속 TTS" },
      { id: "chattts",  name: "ChatTTS",        available: false, description: "대화형 TTS" },
      { id: "tortoise", name: "Tortoise TTS",   available: false, description: "고품질 TTS" },
    ];
  }
  renderProviderGrid();
}

function renderProviderGrid() {
  dom.providerGrid.innerHTML = "";
  state.engines.forEach((eng) => {
    const btn = document.createElement("button");
    btn.className = "provider-btn" + (eng.available ? "" : " unavailable") + (eng.id === state.provider ? " selected" : "");
    btn.disabled = !eng.available;
    btn.dataset.id = eng.id;
    btn.title = eng.available ? eng.description : `미설치 — pip install 필요`;

    const statusText = eng.available ? "사용 가능" : "미설치";
    btn.innerHTML = `
      <span class="provider-name">${escapeHtml(eng.name)}</span>
      <span class="provider-status ${eng.available ? "ok" : "na"}">${statusText}</span>`;

    btn.addEventListener("click", () => onProviderChange(eng.id));
    dom.providerGrid.appendChild(btn);
  });
}

function onProviderChange(id) {
  state.provider = id;

  // Update button selection
  dom.providerGrid.querySelectorAll(".provider-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.id === id);
  });

  // Show/hide settings panels
  const isPolly = id === "polly";
  dom.pollySettings.style.display = isPolly ? "" : "none";
  dom.ossSettings.style.display  = isPolly ? "none" : "";

  if (!isPolly) {
    updateOssSettings(id);
  }

  updateHint();
  updateEmptySubtitle();
}

function updateOssSettings(providerId) {
  const eng = state.engines.find((e) => e.id === providerId);
  if (!eng) return;

  // Language chips — show only supported languages
  const supportedLangs = eng.languages || ["ko", "en"];
  dom.languageChips.querySelectorAll(".chip").forEach((chip) => {
    const supported = supportedLangs.includes(chip.dataset.value);
    chip.style.display = supported ? "" : "none";
  });

  // Pick first supported language if current not supported
  if (!supportedLangs.includes(state.language)) {
    state.language = supportedLangs[0] || "en";
    dom.languageChips.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("selected", chip.dataset.value === state.language);
    });
  }

  // Language group: hide if only one language
  dom.languageGroup.style.display = supportedLangs.length > 1 ? "" : "none";

  // Speaker select
  const speakers = eng.speakers || [];
  dom.speakerSelect.innerHTML = "";
  speakers.forEach((spk) => {
    const opt = document.createElement("option");
    opt.value = spk.id;
    opt.textContent = spk.name;
    dom.speakerSelect.appendChild(opt);
  });

  // Default speaker selection
  state.speaker = speakers.length > 0 ? speakers[0].id : "";
  dom.speakerGroup.style.display = speakers.length > 0 ? "" : "none";

  // Note
  if (eng.note) {
    dom.engineNote.textContent = `ℹ️ ${eng.note}`;
    dom.engineNote.style.display = "";
  } else {
    dom.engineNote.style.display = "none";
  }
}

function updateEmptySubtitle() {
  const eng = state.engines.find((e) => e.id === state.provider);
  dom.emptySubtitle.textContent = eng
    ? `${eng.name} — ${eng.description}`
    : "TTS 엔진을 선택하고 텍스트를 입력하면 음성으로 변환합니다";
}

// ─── Chip setup ───
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
  if (state.provider === "polly") {
    dom.inputHint.textContent = `AWS Polly · ${state.voice} · ${state.engine}`;
  } else {
    const eng = state.engines.find((e) => e.id === state.provider);
    const name = eng ? eng.name : state.provider;
    const speakerLabel = dom.speakerSelect.options[dom.speakerSelect.selectedIndex]?.text || state.speaker;
    const langLabel = { ko: "한국어", en: "English", ja: "日本語", "zh-cn": "中文" }[state.language] || state.language;
    dom.inputHint.textContent = `${name} · ${langLabel}${speakerLabel ? " · " + speakerLabel : ""}`;
  }
}

// ─── Sidebar ───
function isMobile() { return window.innerWidth <= 768; }

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

// ─── Text input ───
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

function appendLoadingCard(providerName) {
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
        <div class="loading-wrap">
          <div class="loading-dots"><span></span><span></span><span></span></div>
          <span class="loading-label">${escapeHtml(providerName)} 합성 중…</span>
        </div>
      </div>
    </div>`;
  dom.messages.appendChild(el);
  scrollBottom();
  return el;
}

function replaceWithAudioCard(el, data) {
  const meta = el.querySelector(".assistant-card");
  const s3Key = data.s3Key || "";
  const keyShort = s3Key ? (s3Key.split("/").pop() || s3Key) : "(로컬 임시)";
  const expires = data.expiresIn ? `${Math.floor(data.expiresIn / 60)}분` : "60분";
  const providerLabel = data.provider || data.engine || "";
  const voiceLabel = data.voiceId || "";

  meta.innerHTML = `
    <div class="card-meta">
      <span class="card-badge provider-${escapeAttr(providerLabel)}">${escapeHtml(providerLabel)}</span>
      ${voiceLabel ? `<span class="card-badge">${escapeHtml(voiceLabel)}</span>` : ""}
      ${data.savedToS3 ? `<span>${escapeHtml(keyShort)}</span><span>· URL 만료 ${expires}</span>` : `<span>로컬 임시 파일</span>`}
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
  requestAnimationFrame(() => { dom.chatArea.scrollTop = dom.chatArea.scrollHeight; });
}

// ─── Core action ───
async function handleSend() {
  const text = dom.textInput.value.trim();
  if (!text || state.loading) return;

  const apiUrl = state.apiUrl;
  const currentProvider = state.provider;
  const eng = state.engines.find((e) => e.id === currentProvider);
  const providerName = eng ? eng.name : currentProvider;

  dom.textInput.value = "";
  dom.textInput.style.height = "auto";
  onTextInput();

  appendUserMessage(text);
  addToHistory(text);

  state.loading = true;
  dom.sendBtn.disabled = true;

  const loadingEl = appendLoadingCard(providerName);

  let payload;
  if (currentProvider === "polly") {
    payload = {
      text,
      provider: "polly",
      textType: "text",
      voiceId: state.voice,
      engine: state.engine,
      format: "mp3",
    };
  } else {
    payload = {
      text,
      provider: currentProvider,
      language: state.language,
      speaker: state.speaker,
    };
  }

  try {
    const data = await callApi(apiUrl, payload);
    replaceWithAudioCard(loadingEl, data);
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
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(
      e?.name === "AbortError"
        ? `요청 시간 초과 (${TIMEOUT_MS / 1000}s) — 모델 로딩 중이거나 서버가 응답하지 않습니다.`
        : (e?.message || String(e))
    );
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let json = null;
  try { json = JSON.parse(raw); } catch { /* not json */ }

  if (!res.ok) {
    const msg = json?.error || json?.message || raw.slice(0, 400) || `HTTP ${res.status}`;
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
