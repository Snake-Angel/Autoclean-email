/**
 * popup.js
 *
 * Main controller for the extension popup UI.
 *
 * Responsibilities:
 * - Handle user interactions (add sender, remove sender, import CSV,
 *   run cleanup, update settings).
 * - Communicate with the Apps Script backend via apiPost().
 * - Manage OAuth token retrieval through auth.js.
 * - Load and refresh sender rules and global settings.
 * - Maintain local caches for performance (chrome.storage.local).
 *
 * Data Flow:
 * - Retrieves configuration (Apps Script URL, language, theme)
 *   from chrome.storage.sync.
 * - Sends authenticated requests to the configured Apps Script
 *   Web App endpoint (https://script.google.com/.../exec).
 * - Updates UI state based on backend responses.
 *
 * Storage:
 * - Uses chrome.storage.local for temporary caches
 *   (sender list, global settings, batch state).
 * - Uses chrome.storage.sync for user preferences.
 *
 * Network:
 * - Sends HTTPS POST requests to the configured Apps Script endpoint.
 * - Uses OAuth access tokens obtained via chrome.identity.
 *
 * Notes:
 * - This file contains UI logic only.
 * - Business logic execution (email cleanup, rule persistence)
 *   is handled by the Apps Script backend.
 */

import { apiPost, extractValidEmails, parseRetentionDays, RETENTION_DAYS_MAX } from "./api.js";
import { getConfig, isValidWebAppUrl } from "./settings.js";
import { getLanguageChoice, setLanguageChoice, t, applyI18nToDom } from "./i18n.js";

// ==============================
// 1. Constantes / Configuration
// ==============================

/** Local storage cache keys (performance: render without network latency). */
const CACHE_KEYS = {
  LIST: "cached_senders_list",
  SETTINGS: "cached_global_settings",
  LAST_CLEANUP_AT: "last_cleanup_at",
};

/**
 * Minimum delay between two manual cleanups (anti-spam).
 * The "Delete emails now" button can only be triggered once per minute.
 */
const RUN_CLEANUP_COOLDOWN_MS = 60 * 1000;

/**
 * chrome.storage.local key holding the background batch job state.
 * Must match BATCH_STATE_KEY in background.js so the popup can restore
 * an in-progress import/batch-add after being closed and reopened.
 */
const BATCH_STATE_KEY = "batchState";

/** Current UI language (used by COPY helpers). */
let currentLang = "fr";

/** Interval handle for the cleanup button cooldown countdown. */
let cleanupCooldownTimer = null;

/** UI state: expand/collapse list. */
let showAll = false;

/** Background job tracking for batch operations (import/batch add). */
let currentJobId = null;

/** True while THIS popup owns an in-flight batch (keeps the storage watcher passive to avoid double UI updates). */
let localBatchActive = false;

/** Ensures the persistent batch-progress storage watcher is attached only once. */
let batchWatcherAttached = false;

/** Status message timeout handle (to auto-hide non-loading statuses). */
let statusTimeoutId = null;

/** In-memory last known list, used to re-render (e.g., on language switch) without fetching. */
let lastListMap = null;

/**
 * Centralized i18n getters for dynamic strings.
 * Note: This object must only contain keys used by the remaining features.
 */
const COPY = {
  exportCsvLoading: () => t(currentLang, "exportCsvLoading"),
  exportCsvNoSenders: () => t(currentLang, "exportCsvNoSenders"),
  exportCsvSuccess: () => t(currentLang, "exportCsvSuccess"),
  exportCsvError: () => t(currentLang, "exportCsvError"),
  confirmClearList: () => t(currentLang, "confirmClearList"),
  clearListLoading: () => t(currentLang, "clearListLoading"),
  clearListSuccess: () => t(currentLang, "clearListSuccess"),
  clearListError: () => t(currentLang, "clearListError"),
  analyzeCsv: () => t(currentLang, "analyzeCsv"),
  csvEmptyOrInvalid: () => t(currentLang, "csvEmptyOrInvalid"),
  importInProgress: (n) => t(currentLang, "importInProgress", { n }),
  importError: () => t(currentLang, "importError"),
  importFinished: (ok, ko) => t(currentLang, "importFinished", { ok, ko }),
  importFileError: () => t(currentLang, "importFileError"),
  progressStatus: (processed, total, ok, ko) =>
    t(currentLang, "progressStatus", { processed, total, ok, ko }),
  init: () => t(currentLang, "init"),
  saveSettingsLoading: () => t(currentLang, "saveSettingsLoading"),
  saveSettingsSuccess: () => t(currentLang, "saveSettingsSuccess"),
  saveSettingsError: () => t(currentLang, "saveSettingsError"),
  networkError: () => t(currentLang, "networkError"),
  saveReglageLoading: () => t(currentLang, "saveReglageLoading"),
  saveReglageSuccess: () => t(currentLang, "saveReglageSuccess"),
  appsScriptError: () => t(currentLang, "appsScriptError"),
  networkErrorGeneric: () => t(currentLang, "networkErrorGeneric"),
  invalidDays: () => t(currentLang, "invalidDays"),
  invalidUrl: () => t(currentLang, "invalidUrl"),
  missingToken: () => t(currentLang, "missingToken"),
  configSaved: () => t(currentLang, "configSaved"),
  listNoSenders: () => t(currentLang, "listNoSenders"),
  removeSenderButton: () => t(currentLang, "removeSenderButton"),
  senderDays: (days) => t(currentLang, "senderDays", { days }),
  showLessList: () => t(currentLang, "showLessList"),
  showMoreSenders: (n) => t(currentLang, "showMoreSenders", { n }),
  addSenderLoading: () => t(currentLang, "addSenderLoading"),
  addSenderSuccess: () => t(currentLang, "addSenderSuccess"),
  removeSenderLoading: () => t(currentLang, "removeSenderLoading"),
  removeSenderSuccess: () => t(currentLang, "removeSenderSuccess"),
  runCleanupLoading: () => t(currentLang, "runCleanupLoading"),
  runCleanupSuccess: (count) => t(currentLang, "runCleanupSuccess", { count }),
  runCleanupCooldown: (secs) => t(currentLang, "runCleanupCooldown", { secs }),
  missingEmailOrDays: () => t(currentLang, "missingEmailOrDays"),
  noEmailDetected: () => t(currentLang, "noEmailDetected"),
  addBatchInProgress: (n) => t(currentLang, "addBatchInProgress", { n }),
  addBatchError: () => t(currentLang, "addBatchError"),
  addBatchFinished: (ok, ko) => t(currentLang, "addBatchFinished", { ok, ko }),
  invalidEmails: () => t(currentLang, "invalidEmails"),
};

// =====================
// 2. Sélecteurs DOM
// =====================

const rootEl = document.documentElement;

const listDiv = document.getElementById("list");
const statusDiv = document.getElementById("status");

const newEmailInput = document.getElementById("newEmail");
const newDaysInput = document.getElementById("newDays");
const addBtn = document.getElementById("addBtn");
const runCleanupBtn = document.getElementById("runCleanupBtn");
const appVersionEl = document.getElementById("appVersion");

const settingsBtn = document.getElementById("settingsBtn");
const settingsMenu = document.getElementById("settingsMenu");

const exportSendersBtn = document.getElementById("exportSendersBtn");
const clearSendersBtn = document.getElementById("clearSendersBtn");

const importSendersBtn = document.getElementById("importSendersBtn");
const importSendersInput = document.getElementById("importSendersInput");

const skipUnreadToggle = document.getElementById("skipUnreadToggle");
const skipSummaryCleanupToggle = document.getElementById("skipSummaryCleanupToggle");

const setupSection = document.getElementById("setupSection");
const appSection = document.getElementById("appSection");

const webAppUrlInput = document.getElementById("webAppUrlInput"); // present in config UI if used
const tokenInput = document.getElementById("tokenInput"); // present in config UI if used
const saveConfigBtn = document.getElementById("saveConfigBtn"); // present in config UI if used

const languageSelect = document.getElementById("languageSelect");
const languageToggleBtn = document.getElementById("languageToggleBtn");

const defaultLabelDaysInput = document.getElementById("defaultLabelDaysInput");
const saveDefaultLabelDaysBtn = document.getElementById("saveDefaultLabelDaysBtn");

// =======================
// 3. Helpers génériques
// =======================

/**
 * Escapes HTML entities to prevent injection when rendering user-controlled strings.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return text;
  return text.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}

/**
 * Sets the UI "boot" state attribute on <html> to drive CSS transitions/visibility.
 * @param {"loading"|"ready"} state
 */
function setBootState(state) {
  rootEl.setAttribute("data-boot", state);
}

/**
 * Displays a status message in the popup, optionally in "loading" mode.
 * - If loading: message stays visible until replaced.
 * - If not loading: auto-hides after ttl.
 * @param {string} msg
 * @param {{loading?: boolean, ttl?: number, error?: boolean}} opts
 */
function setStatus(msg, opts = {}) {
  if (statusTimeoutId) {
    clearTimeout(statusTimeoutId);
    statusTimeoutId = null;
  }
  if (!statusDiv) return;

  if (!msg) {
    statusDiv.textContent = "";
    statusDiv.className = "status-hidden";
    return;
  }

  statusDiv.textContent = msg;
  statusDiv.className = opts.loading ? "status-visible status-loading" : "status-visible";

  const ttl = opts.ttl != null ? opts.ttl : 1000;
  if (!opts.loading) {
    statusTimeoutId = setTimeout(() => {
      statusDiv.textContent = "";
      statusDiv.className = "status-hidden";
    }, ttl);
  }
}

/**
 * Adds an input guard that enforces numeric days and caps the value to RETENTION_DAYS_MAX.
 * This prevents invalid values before parseRetentionDays().
 * @param {HTMLInputElement|null} inputEl
 */
function attachDaysGuard(inputEl) {
  if (!inputEl) return;
  inputEl.addEventListener("input", () => {
    const raw = inputEl.value.replace(/[^\d]/g, "");
    if (raw) {
      const n = Math.min(Number(raw), RETENTION_DAYS_MAX);
      if (String(n) !== inputEl.value) inputEl.value = n;
    } else {
      inputEl.value = raw;
    }
  });
}

/**
 * Renders a progress status message for batch background jobs (import/batch add).
 * @param {{status:string, processed:number, total:number, ok:number, ko:number}|null} state
 */
function renderProgress(state) {
  if (!state) return;
  const { status, processed, total, ok, ko } = state;
  const txt = COPY.progressStatus(processed, total, ok, ko);
  setStatus(txt, { loading: status === "running", ttl: 8000 });
}

/**
 * Attaches (once) a persistent watcher on the background batch state.
 * The background worker persists every progress tick to chrome.storage.local,
 * so watching storage changes lets a reopened popup keep displaying
 * "Traitement en cours…" and react to completion — even though it never
 * received the original progress messages.
 *
 * Stays passive while THIS popup owns the batch (`localBatchActive`), so it
 * never conflicts with the per-click progress handler.
 */
function attachBatchWatcher_() {
  if (batchWatcherAttached) return;
  if (!chrome.storage?.onChanged?.addListener) return; // defensive: keep bootstrap safe
  batchWatcherAttached = true;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[BATCH_STATE_KEY]) return;
    if (localBatchActive) return; // the active click flow owns the UI

    const state = changes[BATCH_STATE_KEY].newValue;
    if (!state) return; // state cleared: keep the last message as-is

    if (state.status === "running") {
      if (addBtn) addBtn.disabled = true;
      renderProgress(state);
    } else if (state.status === "done") {
      if (addBtn) addBtn.disabled = false;
      setStatus(COPY.addBatchFinished(state.ok, state.ko));
      refreshList_().catch(() => {});
    } else if (state.status === "error") {
      if (addBtn) addBtn.disabled = false;
      setStatus(COPY.addBatchError());
    }
  });
}

/**
 * Restores an in-progress batch job after the popup is reopened.
 * If a batch is still running, re-renders its progress and locks the add
 * button; then attaches the live watcher to follow it through to completion.
 */
async function restoreBatchProgress_() {
  try {
    const data = await chrome.storage.local.get(BATCH_STATE_KEY);
    const state = data[BATCH_STATE_KEY];
    if (state && state.status === "running" && !localBatchActive) {
      if (addBtn) addBtn.disabled = true;
      renderProgress(state);
    }
  } catch (e) {
    // Non-fatal: progress restore is best-effort.
  }
  attachBatchWatcher_();
}

/**
 * Parses a CSV text into {email, days} entries.
 * - Export uses ";" so we keep ";" for compatibility.
 * - Accepts optional header line starting with "email".
 * @param {string} text
 * @returns {Array<{email:string, days:number}>}
 */
function parseCsvSenders(text) {
  const rawLines = String(text || "")
    .replace(/^\uFEFF/, "") // BOM UTF-8
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) return [];

  const sep = ";";
  const header = rawLines[0].toLowerCase().replace(/^\uFEFF/, "");
  const hasHeader = /^\s*email\b/.test(header) || header.includes("email");

  const startIdx = hasHeader ? 1 : 0;
  const entries = [];

  for (let i = startIdx; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line) continue;

    const parts = line.split(sep).map((s) => s.trim().replace(/^"|"$/g, ""));
    const emailRaw = parts[0] || "";
    const daysRaw = parts[1] || "";

    const { valid } = extractValidEmails(emailRaw, { max: 1 });
    if (!valid.length) continue;

    const email = valid[0];
    const days = parseRetentionDays(daysRaw) ?? 10;

    entries.push({ email, days });
  }

  return entries;
}

// =================
// 4. Gestion API
// =================

/**
 * Handles API errors in a centralized way.
 * - Detects offline/network failures.
 * - Detects fatal Apps Script/config failures and forces a reset + redirect to config.
 * @param {Error} err
 */
function handleApiError(err) {
  // 1) Offline
if (err.message === "network_offline") {
  setStatus("Vous n'êtes pas connecté à internet.", { loading: false, error: true, ttl: 8000 });
  return;
}

  // 2) Server/App Script connection lost or invalid configuration
  if (
    err.message === "tech_fail_reset" ||
    err.message === "connection_failed" ||
    err.message === "invalid_json_response" ||
    err.message.startsWith("http_") ||
    err.message === "not_configured"
  ) {
    setStatus("Connexion au serveur perdue. Redirection...", { loading: false, error: true });

    // Purge configuration and redirect
    chrome.storage.sync.remove("autocleanConfig", () => {
      setTimeout(() => {
        chrome.tabs.create({ url: "config.html" });
        window.close();
      }, 2000);
    });
    return;
  }

  // 3) Generic app error
  setStatus("Erreur : " + err.message, { error: true });
}

/**
 * Fetches the sender list from backend, renders it, and updates local cache.
 * Critical errors are rethrown to allow the bootstrap sync to handle them.
 */
async function refreshList_() {
  try {
    const data = await apiPost({ action: "list" });
    if (data && data.list) {
      renderList(data.list);
      await chrome.storage.local.set({ [CACHE_KEYS.LIST]: data.list });
    }
  } catch (e) {
    if (e.message === "network_offline" || e.message === "tech_fail_reset") throw e;
  }
}

/**
 * Fetches global settings from backend, applies them to the UI, and updates local cache.
 * Critical errors are rethrown to allow the bootstrap sync to handle them.
 */
async function loadServerSettings_() {
  try {
    const data = await apiPost({ action: "settings" });
    const s = data.settings || {};
    applySettingsToDom_(s);
    await chrome.storage.local.set({ [CACHE_KEYS.SETTINGS]: s });
  } catch (e) {
    if (e.message === "network_offline" || e.message === "tech_fail_reset") throw e;
  }
}

/**
 * Sends the current language choice to the backend (non-blocking in most flows).
 * @param {"fr"|"en"} lang
 */
async function syncLanguageToServer(lang) {
  const cfg = await getConfig();
  if (cfg.webAppUrl) await apiPost({ action: "setLanguage", lang });
}

// =================
// 5. Logique UI
// =================

/**
 * Applies settings object to the DOM controls.
 * @param {{skipUnread?: boolean, skipSummaryCleanup?: boolean}} s
 */
function applySettingsToDom_(s) {
  if (!s) return;
  if (skipUnreadToggle) skipUnreadToggle.checked = s.skipUnread !== false;
  if (skipSummaryCleanupToggle) skipSummaryCleanupToggle.checked = s.skipSummaryCleanup === true;

  if (defaultLabelDaysInput && Number.isFinite(s.defaultLabelDays)) {
    defaultLabelDaysInput.value = String(s.defaultLabelDays);
  }
}

/**
 * Renders sender retention list.
 * - Uses `showAll` to paginate to LIMIT entries by default.
 * - Stores `lastListMap` for instant rerender on language changes.
 * @param {Record<string, {days:number}>} map
 */
function renderList(map) {
  lastListMap = map;
  if (!listDiv) return;

  listDiv.innerHTML = "";

  const showMoreEl = document.getElementById("showMoreContainer");
  const emails = Object.keys(map).sort();
  const total = emails.length;

  if (total === 0) {
    if (showMoreEl) showMoreEl.style.display = "none";
    listDiv.innerHTML = `
      <div style="font-size:13px; color:var(--text-dim); text-align:center; padding:24px 12px; border:1px dashed var(--border-soft); border-radius:8px; background:var(--bg-card);">
        ${COPY.listNoSenders()}
      </div>`;
    return;
  }

  const LIMIT = 2;
  const visibleEmails = showAll ? emails : emails.slice(0, LIMIT);

  visibleEmails.forEach((email) => {
    const days = map[email].days;
    const card = document.createElement("div");
    card.className = "sender-card";

    card.innerHTML = `
      <div class="sender-info">
        <div class="sender-email">${escapeHtml(email)}</div>
        <div class="sender-days">${COPY.senderDays(days)}</div>
      </div>
    `;

    const actions = document.createElement("div");
    actions.className = "sender-actions";

    const delBtn = document.createElement("button");
    delBtn.className = "btn-remove";
    delBtn.textContent = COPY.removeSenderButton();
    delBtn.onclick = () => removeSender(email);

    actions.appendChild(delBtn);
    card.appendChild(actions);
    listDiv.appendChild(card);
  });

  if (total > LIMIT && showMoreEl) {
    showMoreEl.style.display = "block";
    const reste = total - LIMIT;
    showMoreEl.textContent = showAll ? COPY.showLessList() : COPY.showMoreSenders(reste);
    showMoreEl.onclick = () => {
      showAll = !showAll;
      renderList(map);
    };
  } else if (showMoreEl) {
    showMoreEl.style.display = "none";
  }
}

/**
 * Applies theme choice to the root element.
 * - `auto` resolves to OS preference (dark/light).
 * @param {"auto"|"dark"|"light"} choice
 */
function applyTheme(choice) {
  rootEl.setAttribute("data-theme", choice);

  let effective = choice;
  if (choice === "auto") {
    effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  rootEl.setAttribute("data-theme-effective", effective);

  highlightThemeChoice(choice);
}

/**
 * Persists the theme choice in chrome.storage.sync, then applies it.
 * @param {"auto"|"dark"|"light"} choice
 */
function setThemeChoice(choice) {
  chrome.storage.sync.set({ themeChoice: choice }, () => applyTheme(choice));
}

/**
 * Highlights the active theme option in the settings menu.
 * @param {"auto"|"dark"|"light"} choice
 */
function highlightThemeChoice(choice) {
  if (!settingsMenu) return;
  settingsMenu.querySelectorAll(".theme-option").forEach((opt) => {
    opt.classList.toggle("is-active", opt.getAttribute("data-theme-choice") === choice);
  });
}

/**
 * Loads theme choice from chrome.storage.sync (fast).
 * Uses callback-based Chrome API, wrapped into a Promise for async/await consistency.
 */
async function loadThemeChoice() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["themeChoice"], (res) => {
      applyTheme(res.themeChoice || "auto");
      resolve();
    });
  });
}

/**
 * Loads the user's language choice, applies i18n to DOM,
 * then syncs language to server in a non-blocking way.
 */
async function loadLanguage() {
  currentLang = await getLanguageChoice();
  if (languageSelect) languageSelect.value = currentLang;

  applyI18nToDom(currentLang);
  updateLangButtonLabel();

  // Non-blocking server sync: avoid delaying popup readiness.
  syncLanguageToServer(currentLang).catch(() => {});
}

/**
 * Updates the language toggle button label (FR/EN).
 */
function updateLangButtonLabel() {
  if (!languageToggleBtn) return;
  const codeEl = languageToggleBtn.querySelector(".lang-code");
  if (codeEl) codeEl.textContent = currentLang === "en" ? "EN" : "FR";
  else languageToggleBtn.textContent = currentLang === "en" ? "EN" : "FR";
}

/**
 * Shows setup UI if not configured, otherwise shows app UI.
 * If not configured: opens config.html (once per session) and closes the popup.
 * @returns {Promise<boolean>} true if configured, false otherwise
 */
async function renderSetupOrApp_() {
  const cfg = await getConfig();
  const configured = !!cfg.webAppUrl;

  if (setupSection) setupSection.style.display = configured ? "none" : "block";
  if (appSection) appSection.style.display = configured ? "block" : "none";

  if (!configured) {
    // chrome.tabs.create est fiable depuis un popup d'extension,
    // contrairement à window.open suivi immédiatement d'un window.close.
    chrome.tabs.create({ url: chrome.runtime.getURL("config.html") });
    window.close();
    return false;
  }

  return true;
}

/**
 * Loads cached data (list + settings) from chrome.storage.local and renders it.
 * This is used for instant UI rendering before network sync completes.
 */
async function loadCacheAndRender_() {
  try {
    const data = await chrome.storage.local.get([CACHE_KEYS.LIST, CACHE_KEYS.SETTINGS]);

    if (data[CACHE_KEYS.LIST]) {
      renderList(data[CACHE_KEYS.LIST]);
    }

    const s = data[CACHE_KEYS.SETTINGS];
    if (s) {
      applySettingsToDom_(s);
    }
  } catch (e) {
  }
}

/**
 * Reads cached settings from chrome.storage.local (used for merging updates).
 * @returns {Promise<object>}
 */
async function getCachedSettings_() {
  const data = await chrome.storage.local.get(CACHE_KEYS.SETTINGS);
  return data[CACHE_KEYS.SETTINGS] || {};
}

/**
 * Performs all network sync operations in parallel.
 * Using Promise.all ensures critical errors are surfaced to the bootstrap error handler.
 */
async function syncAllData_() {
  await Promise.all([refreshList_(), loadServerSettings_()]);
}

/**
 * Displays the extension version (read from the manifest) under the title.
 * Single source of truth: manifest.json -> no value to maintain here.
 */
function renderAppVersion_() {
  if (!appVersionEl) return;
  try {
    const v = chrome.runtime.getManifest()?.version;
    appVersionEl.textContent = v ? `v${v}` : "";
  } catch {
    appVersionEl.textContent = "";
  }
}

/**
 * Enforces the anti-spam cooldown on the "Delete emails now" button.
 * - Reads the last cleanup timestamp from chrome.storage.local so the cooldown
 *   survives popup close/reopen.
 * - While the cooldown is active: disables the button and shows a live countdown.
 * - When it expires: restores the button label and re-enables it.
 */
async function refreshCleanupCooldown_() {
  if (!runCleanupBtn) return;

  // Reset any previous countdown to avoid stacking intervals.
  if (cleanupCooldownTimer) {
    clearInterval(cleanupCooldownTimer);
    cleanupCooldownTimer = null;
  }

  const data = await chrome.storage.local.get(CACHE_KEYS.LAST_CLEANUP_AT);
  const lastAt = Number(data[CACHE_KEYS.LAST_CLEANUP_AT]) || 0;

  const tick = () => {
    const remaining = RUN_CLEANUP_COOLDOWN_MS - (Date.now() - lastAt);

    if (remaining <= 0) {
      runCleanupBtn.disabled = false;
      runCleanupBtn.textContent = t(currentLang, "run_cleanup_btn");
      if (cleanupCooldownTimer) {
        clearInterval(cleanupCooldownTimer);
        cleanupCooldownTimer = null;
      }
      return;
    }

    runCleanupBtn.disabled = true;
    runCleanupBtn.textContent = COPY.runCleanupCooldown(Math.ceil(remaining / 1000));
  };

  tick();
  if (runCleanupBtn.disabled) {
    cleanupCooldownTimer = setInterval(tick, 1000);
  }
}

// =======================
// 6. Event listeners
// =======================

/**
 * Adds a single sender (or multiple emails pasted) via background batch job.
 * Background sends progress events; popup listens and renders progress.
 */
addBtn?.addEventListener("click", async () => {
  const raw = String(newEmailInput?.value || "");
  const days = parseRetentionDays(newDaysInput?.value);

  if (!raw.trim() || days == null) {
    setStatus(COPY.missingEmailOrDays());
    return;
  }

  const { valid: emails } = extractValidEmails(raw);
  if (!emails.length) {
    setStatus(COPY.invalidEmails());
    return;
  }

  addBtn.disabled = true;
  localBatchActive = true; // this popup owns the batch UI; storage watcher stays passive
  setStatus(COPY.addBatchInProgress(emails.length), { loading: true });

  let progressHandler = null;
  currentJobId = null;

  progressHandler = (msg) => {
    if (msg?.type !== "batchAddProgress") return;
    if (!currentJobId && msg.jobId) currentJobId = msg.jobId;
    if (msg.jobId !== currentJobId) return;
    renderProgress(msg);
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  chrome.runtime.sendMessage({ action: "batchAdd", emails, days }, async (res) => {
    chrome.runtime.onMessage.removeListener(progressHandler);
    localBatchActive = false;
    addBtn.disabled = false;

    if (chrome.runtime.lastError || !res || !res.done) {
      setStatus(COPY.addBatchError());
      return;
    }

    if (newEmailInput) newEmailInput.value = "";

    await refreshList_();
    setStatus(COPY.addBatchFinished(res.ok, res.ko));
  });
});

/**
 * Removes a sender retention rule.
 * @param {string} email
 */
async function removeSender(email) {
  setStatus(COPY.removeSenderLoading(), { loading: true });
  try {
    const data = await apiPost({ action: "remove", email });
    if (data.list) {
      renderList(data.list);
      await chrome.storage.local.set({ [CACHE_KEYS.LIST]: data.list });
    }
    setStatus(COPY.removeSenderSuccess());
  } catch (e) {
    setStatus(COPY.networkError());
  }
}

/**
 * Runs cleanup immediately on the backend.
 * Then refreshes list because cleanup may change sender stats.
 *
 * Anti-spam: a 1-minute cooldown is started as soon as the button is pressed,
 * so the cleanup cannot be triggered more than once per minute.
 */
runCleanupBtn?.addEventListener("click", async () => {
  // Defensive guard: the button is normally disabled during the cooldown,
  // so this only protects against a programmatic/edge-case click.
  if (runCleanupBtn.disabled) return;

  // Lock synchronously to close any double-click race before the awaits below.
  runCleanupBtn.disabled = true;

  // Persist the timestamp (survives popup close/reopen), then start the countdown.
  await chrome.storage.local.set({ [CACHE_KEYS.LAST_CLEANUP_AT]: Date.now() });
  await refreshCleanupCooldown_();

  setStatus(COPY.runCleanupLoading(), { loading: true });
  try {
    const data = await apiPost({ action: "runCleanup" });
    await refreshList_();
    setStatus(COPY.runCleanupSuccess(data.result.deleted));
  } catch (e) {
    setStatus(COPY.networkError());
  }
});

/**
 * Normalizes email input by replacing newlines with spaces.
 */
newEmailInput?.addEventListener("input", () => {
  const v = newEmailInput.value.replace(/[\r\n]+/g, " ").trim();
  if (v !== newEmailInput.value) newEmailInput.value = v;
});

/** Guard numeric day inputs. */
attachDaysGuard(newDaysInput);
attachDaysGuard(defaultLabelDaysInput);

/**
 * Settings menu toggle.
 */
let settingsOpen = false;
settingsBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  settingsOpen = !settingsOpen;
  if (settingsMenu) settingsMenu.style.display = settingsOpen ? "block" : "none";
});

/**
 * Closes settings menu when clicking outside.
 */
document.addEventListener("click", (e) => {
  if (settingsMenu && settingsBtn && !settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
    settingsOpen = false;
    settingsMenu.style.display = "none";
  }
});

/**
 * Toggle: skip unread.
 * Persists on backend, then updates local cache to keep UI in sync.
 */
skipUnreadToggle?.addEventListener("change", async () => {
  setStatus(COPY.saveSettingsLoading(), { loading: true });
  try {
    await apiPost({ action: "setSkipUnread", skipUnread: !!skipUnreadToggle.checked });

    await chrome.storage.local.set({
      [CACHE_KEYS.SETTINGS]: { ...(await getCachedSettings_()), skipUnread: skipUnreadToggle.checked },
    });

    setStatus(COPY.saveSettingsSuccess());
  } catch (e) {
    setStatus(COPY.networkError());
  }
});

/**
 * Toggle: skip summary cleanup.
 * Persists on backend, then updates local cache to keep UI in sync.
 */
skipSummaryCleanupToggle?.addEventListener("change", async () => {
  setStatus(COPY.saveReglageLoading(), { loading: true });
  try {
    await apiPost({
      action: "setSkipSummaryCleanup",
      skipSummaryCleanup: !!skipSummaryCleanupToggle.checked,
    });

    await chrome.storage.local.set({
      [CACHE_KEYS.SETTINGS]: {
        ...(await getCachedSettings_()),
        skipSummaryCleanup: skipSummaryCleanupToggle.checked,
      },
    });

    setStatus(COPY.saveReglageSuccess());
  } catch (e) {
    setStatus(COPY.networkErrorGeneric());
  }
});

/**
 * Theme choice buttons inside settings menu.
 */
settingsMenu?.querySelectorAll(".theme-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    setThemeChoice(opt.getAttribute("data-theme-choice"));
  });
});

/**
 * Language toggle (FR <-> EN).
 * - Saves locally (via i18n.js), updates DOM, rerenders list texts, then syncs to backend.
 */
languageToggleBtn?.addEventListener("click", async () => {
  const next = currentLang === "fr" ? "en" : "fr";
  await setLanguageChoice(next);

  currentLang = next;
  applyI18nToDom(currentLang);
  updateLangButtonLabel();

  // applyI18nToDom reset the cleanup button label: re-apply the cooldown state.
  refreshCleanupCooldown_();

  if (lastListMap) renderList(lastListMap);

  syncLanguageToServer(currentLang).catch(() => {});
});

/**
 * Exports current list to CSV.
 * - Uses cached in-memory list if available, otherwise fetches it.
 */
exportSendersBtn?.addEventListener("click", async () => {
  setStatus(COPY.exportCsvLoading(), { loading: true });
  try {
    let list = lastListMap;
    if (!list) {
      const data = await apiPost({ action: "list" });
      list = data.list;
    }

    const emails = Object.keys(list || {}).sort();
    if (!emails.length) {
      setStatus(COPY.exportCsvNoSenders());
      return;
    }

    const lines = emails.map((e) => `${e};${list[e]?.days ?? ""}`);
    const csv = t(currentLang, "exportCsvHeader") + "\n" + lines.join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const d = new Date();
    const filename = t(currentLang, "exportCsvFilename", {
      yyyy: d.getFullYear(),
      mm: String(d.getMonth() + 1).padStart(2, "0"),
      dd: String(d.getDate()).padStart(2, "0"),
    });

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(COPY.exportCsvSuccess());
  } catch {
    setStatus(COPY.exportCsvError());
  }
});

saveDefaultLabelDaysBtn?.addEventListener("click", async () => {
  const raw = defaultLabelDaysInput?.value ?? "";
  const days = parseRetentionDays(raw); // tu l’utilises déjà ailleurs

  if (days == null) {
    setStatus(COPY.invalidDays());
    return;
  }

  setStatus(COPY.saveReglageLoading(), { loading: true });
  try {
    const res = await apiPost({ action: "setDefaultLabelDays", days });

    // met à jour le cache local
    await chrome.storage.local.set({
      [CACHE_KEYS.SETTINGS]: {
        ...(await getCachedSettings_()),
        defaultLabelDays: res.defaultLabelDays ?? days,
      },
    });

    setStatus(COPY.saveReglageSuccess());
  } catch (e) {
    setStatus(COPY.networkErrorGeneric());
  }
});

/**
 * CSV import flow:
 * - User selects a file -> parse -> normalize -> send to background (batchAdd).
 * - Listen to progress events -> show progress -> refresh list on completion.
 */
if (importSendersBtn && importSendersInput) {
  importSendersBtn.addEventListener("click", () => {
    importSendersInput.value = ""; // allow re-importing same file
    importSendersInput.click();
  });

  importSendersInput.addEventListener("change", async () => {
    const file = importSendersInput.files?.[0];
    if (!file) return;

    setStatus(COPY.analyzeCsv(), { loading: true });

    addBtn && (addBtn.disabled = true);

    let progressHandler = null;
    currentJobId = null;

    try {
      const text = await file.text();
      const rawEntries = parseCsvSenders(text);

      if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        addBtn && (addBtn.disabled = false);
        setStatus(COPY.csvEmptyOrInvalid());
        return;
      }

      const entries = rawEntries
        .map((e) => ({
          email: e?.email,
          days: typeof e?.days === "string" ? parseRetentionDays(e.days) : e?.days,
        }))
        .filter((e) => !!e.email && Number.isFinite(e.days) && e.days > 0);

      if (!entries.length) {
        addBtn && (addBtn.disabled = false);
        setStatus(COPY.csvEmptyOrInvalid());
        return;
      }

      setStatus(COPY.importInProgress(entries.length), { loading: true });

      progressHandler = (msg) => {
        if (msg?.type !== "batchAddProgress") return;

        if (!currentJobId && msg.jobId) currentJobId = msg.jobId;
        if (currentJobId && msg.jobId !== currentJobId) return;

        renderProgress(msg);
      };
      chrome.runtime.onMessage.addListener(progressHandler);
      localBatchActive = true; // this popup owns the batch UI; storage watcher stays passive

      chrome.runtime.sendMessage({ action: "batchAdd", entries }, async (res) => {
        if (progressHandler) chrome.runtime.onMessage.removeListener(progressHandler);
        localBatchActive = false;
        addBtn && (addBtn.disabled = false);

        if (chrome.runtime.lastError || !res || !res.done) {
          setStatus(COPY.importError());
          return;
        }

        await refreshList_();
        setStatus(COPY.importFinished(res.ok, res.ko));
      });
    } catch (e) {
      if (progressHandler) chrome.runtime.onMessage.removeListener(progressHandler);
      localBatchActive = false;
      addBtn && (addBtn.disabled = false);
      setStatus(COPY.importFileError());
    }
  });
}

/**
 * Clears all senders from backend and resets local cache.
 */
clearSendersBtn?.addEventListener("click", async () => {
  if (!confirm(COPY.confirmClearList())) return;

  setStatus(COPY.clearListLoading(), { loading: true });
  try {
    await apiPost({ action: "clearAll" });

    renderList({});
    await chrome.storage.local.set({ [CACHE_KEYS.LIST]: {} });

    setStatus(COPY.clearListSuccess());
  } catch {
    setStatus(COPY.clearListError());
  }
});

// =====================
// 7. Initialisation
// =====================

/**
 * Bootstrap flow:
 * 1) Immediately show "loading" status.
 * 2) Load theme + language (fast).
 * 3) Check configuration; if missing, open config and close popup.
 * 4) Render cached list/settings immediately.
 * 5) Run network sync; handle critical failures (offline or server reset) cleanly.
 */
(async () => {
  // Immediate visual feedback
  setStatus("Initialisation en cours...", { loading: true });
  setBootState("loading");

  // Show the extension version under the title (read from the manifest).
  renderAppVersion_();

  // Fast local init: theme + language
  await Promise.all([loadThemeChoice(), loadLanguage()]);

  // Config check: show app or redirect to setup
  const configured = await renderSetupOrApp_();
  if (!configured) {
    setBootState("ready");
    return;
  }

  // Instant render from local cache (no network latency)
  await loadCacheAndRender_();

  // Restore the cleanup button cooldown if a cleanup ran in the last minute.
  await refreshCleanupCooldown_();

  // UI can be considered ready now
  setBootState("ready");

  // Network sync: keep errors explicit and safe
  try {
    await syncAllData_();
    setStatus(""); // remove "initialisation..." once done

    // Restore an in-progress batch (import/add) if one is still running in the
    // background, so "Traitement en cours…" survives popup close/reopen.
    await restoreBatchProgress_();
  } catch (err) {

    // Keep the original behavior: explicit offline message, otherwise redirect on fatal.
   if (err.message === "network_offline") {
  setStatus("Vous n'êtes pas connecté à internet.", { loading: false, error: true, ttl: 8000 });
  return;
}

    if (
      err.message === "tech_fail_reset" ||
      err.message === "connection_failed" ||
      err.message === "invalid_json_response" ||
      err.message.startsWith("http_") ||
      err.message === "not_configured"
    ) {
      setStatus("Connexion au serveur perdue. Redirection...", { loading: false, error: true });

      chrome.storage.sync.remove("autocleanConfig", () => {
        setTimeout(() => {
          chrome.tabs.create({ url: "config.html" });
          window.close();
        }, 2000);
      });
      return;
    }

    setStatus("Erreur: " + err.message, { error: true });
  }
})();