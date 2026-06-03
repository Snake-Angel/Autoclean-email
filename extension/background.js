/**
 * background.js
 *
 * Script de service (Service Worker) de l’extension.
 *
 * Rôle :
 * - Gérer les événements globaux de l’extension (installation, mise à jour).
 * - Effectuer des actions en arrière-plan indépendamment du popup.
 * - Servir de point central pour la coordination interne si nécessaire.
 *
 * Fonctionnement :
 * - S’exécute en tant que Service Worker (Manifest V3).
 * - N’a pas d’interface utilisateur.
 * - Ne manipule pas directement les règles d’expéditeurs ni les paramètres métier.
 *
 * Données :
 * - Peut accéder à chrome.storage si nécessaire.
 * - Ne stocke aucun token OAuth.
 * - Ne réalise aucun traitement de données Gmail directement.
 *
 * Réseau :
 * - Aucun appel réseau direct n’est effectué ici.
 * - Les communications avec le backend Apps Script sont gérées ailleurs
 *   (principalement dans popup.js via api.js).
 *
 * Remarque :
 * - Ce fichier doit rester minimal et limité aux responsabilités
 *   globales propres au cycle de vie de l’extension.
 */

import { apiPost, normalizeEmail, isValidEmail, parseRetentionDays } from "./api.js"; // CRITICAL FIX: import API variant for createLabel only

// Ouvre la page de configuration à la première installation (Chrome Web Store ou unpacked).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  chrome.storage.sync.get("autocleanConfig", (res) => {
    const cfg = res?.autocleanConfig;
    if (cfg && cfg.webAppUrl) return;
    chrome.tabs.create({ url: chrome.runtime.getURL("config.html") });
  });
});

/**
 * Sleep util (Promise-based).
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -----------------------------
// Storage helpers (chrome.storage.local)
// -----------------------------

/**
 * @param {string|string[]} keys
 * @returns {Promise<Object>}
 */
function localGet(keys) {
  return new Promise((resolve) =>
    chrome.storage.local.get(keys, (res) => resolve(res || {}))
  );
}

/**
 * @param {Object} obj
 * @returns {Promise<void>}
 */
function localSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

/**
 * @param {string|string[]} keys
 * @returns {Promise<void>}
 */
function localRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

// -----------------------------
// Batch state (persisté)
// -----------------------------

const BATCH_STATE_KEY = "batchState";

/**
 * @param {Object|null} state
 * @returns {Promise<void>}
 */
async function setBatchState(state) {
  await localSet({ [BATCH_STATE_KEY]: state });
}

/**
 * @returns {Promise<Object|null>}
 */
async function getBatchState() {
  const { [BATCH_STATE_KEY]: batchState } = await localGet(BATCH_STATE_KEY);
  return batchState || null;
}

/** @returns {Promise<void>} */
async function clearBatchState() {
  await localRemove(BATCH_STATE_KEY);
}

// -----------------------------
// Batch add
// -----------------------------

/**
 * Ajoute un email à la rétention, avec validation + retries.
 * @param {string} email
 * @param {string|number} days
 * @param {number} [attempt=1]
 * @returns {Promise<boolean>} true si succès, false sinon
 */
async function addOne(email, days, attempt = 1) {
  const d = parseRetentionDays(days);
  if (d == null) return false;

  try {
    await apiPost({ action: "add", email, days: d });
    return true;
  } catch {
    if (attempt < 3) {
      await sleep(500 * attempt);
      return addOne(email, days, attempt + 1);
    }
    return false;
  }
}

/**
 * Exécute la commande batchAdd.
 * @param {any} msg
 * @param {(payload:any)=>void} sendResponse
 * @returns {Promise<void>}
 */
async function runBatchAdd(msg, sendResponse) {
  const jobId = Date.now().toString();

  const entries = Array.isArray(msg.entries)
    ? msg.entries
        .map((e) => ({
          email: normalizeEmail(e?.email),
          days: parseRetentionDays(e?.days),
        }))
        .filter((e) => isValidEmail(e.email) && Number.isFinite(e.days) && e.days > 0)
    : [];

  const emails = Array.isArray(msg.emails)
    ? msg.emails.map(normalizeEmail).filter(isValidEmail)
    : [];

  const total = entries.length ? entries.length : emails.length;
  if (!total) {
    try {
      sendResponse({ done: true, status: "error", error: "no_emails" });
    } catch {}
    await clearBatchState();
    return;
  }

  // days par défaut requis uniquement quand on reçoit une liste "emails"
  let defaultDays = null;
  if (!entries.length) {
    defaultDays = parseRetentionDays(msg.days);
    if (defaultDays == null) {
      try {
        sendResponse({ done: true, status: "error", error: "invalid_days" });
      } catch {}
      await clearBatchState();
      return;
    }
  }

  let ok = 0;
  let ko = 0;

  await setBatchState({ jobId, status: "running", total, processed: 0, ok, ko });

  const emitProgress = async () => {
    const processed = ok + ko;
    const state = { jobId, status: "running", total, processed, ok, ko };
    await setBatchState(state);

// Fire-and-forget: si aucun popup n'écoute, on avale l'erreur proprement.
chrome.runtime.sendMessage({ type: "batchAddProgress", ...state }, () => {
  void chrome.runtime.lastError; // évite "Receiving end does not exist."
});
};
  const iter = entries.length ? entries : emails.map((email) => ({ email, days: defaultDays }));

  for (const it of iter) {
    const done = await addOne(it.email, it.days);
    if (done) ok++;
    else ko++;

    await emitProgress();
    await sleep(75);
  }

  const finalState = { jobId, status: "done", total, processed: ok + ko, ok, ko };
  await setBatchState(finalState);

  try {
    sendResponse({ done: true, ...finalState });
  } catch {}

  setTimeout(clearBatchState, 15000);
}

// -----------------------------
// Message router (un seul listener)
// -----------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ne traiter que les messages venant de notre propre extension
  if (sender && sender.id && sender.id !== chrome.runtime.id) {
    return;
  }

  const action = msg?.action;

  // ---- batchAdd ----
  if (action === "batchAdd") {
    runBatchAdd(msg, sendResponse).catch(() => {
      // Silence: comportement existant = pas de logs.
      try {
        sendResponse({ done: true, status: "error", error: "tech_fail" });
      } catch {}
      clearBatchState().catch(() => {});
    });

    // indispensable: sendResponse sera appelé en async
    return true;
  }

  // Ignorer le reste
  return;
});

// (optionnel) Expose getBatchState si d'autres scripts en ont besoin plus tard.
// Actuellement non utilisé ici, mais gardé pour compat potentielle.
export { getBatchState };