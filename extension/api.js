
import { requireConfig } from "./settings.js";
import { ensureAuthToken, revokeToken } from "./auth.js";

// Limites et configurations
export const RETENTION_DAYS_MAX = 999;
export const RETENTION_DAYS_MIN = 1;

const API_TIMEOUT_MS = 120000; // Timeout Apps Script (2mn soit 120000ms)
const NETFAIL_KEY = "ac_netfail";

// Sonde de connectivité réelle (gstatic renvoie un 204 vide, très léger)
const CONNECTIVITY_PROBE_URL = "https://www.gstatic.com/generate_204";
const CONNECTIVITY_TIMEOUT_MS = 4000;

/**
 * Vérifie une vraie connexion internet (pas juste navigator.onLine, qui ment
 * dès qu'une interface réseau existe). Ping gstatic.com/generate_204 avec
 * timeout court.
 * @returns {Promise<boolean>}
 */
async function isReallyOnline() {
  if (navigator.onLine === false) return false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT_MS);
  try {
    await fetch(CONNECTIVITY_PROBE_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// -----------------------------
// Storage helpers (chrome.storage.local)
// -----------------------------

/**
 * @param {string} key
 * @returns {Promise<any>}
 */
async function localGet(key) {
  return new Promise((resolve) =>
    chrome.storage.local.get(key, (r) => resolve(r?.[key]))
  );
}

/**
 * @param {Object} obj
 * @returns {Promise<void>}
 */
async function localSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
async function localRemove(key) {
  return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
}

/**
 * Note: util tech interne (pas d'UI/log).
 * Pourquoi: on peut compter les échecs techniques rapprochés pour diagnostics futurs,
 * sans impacter le flow principal.
 * @returns {Promise<number>} count sur la fenêtre glissante
 */
async function recordTechFail() {
  const now = Date.now();
  const prev = (await localGet(NETFAIL_KEY)) || { count: 0, last: 0 };

  const WINDOW_MS = 2 * 60 * 1000;
  const count = now - prev.last <= WINDOW_MS ? prev.count + 1 : 1;

  await localSet({ [NETFAIL_KEY]: { count, last: now } });
  return count;
}

/** @returns {Promise<void>} */
async function clearTechFail() {
  await localRemove(NETFAIL_KEY);
}

// -----------------------------
// Validation / normalisation
// -----------------------------

/**
 * Valide et nettoie les jours de rétention.
 * Invariant: retourne un entier safe [RETENTION_DAYS_MIN..RETENTION_DAYS_MAX] ou null.
 * @param {string|number} raw
 * @returns {number|null}
 */
export function parseRetentionDays(raw) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return null;
    if (raw < RETENTION_DAYS_MIN || raw > RETENTION_DAYS_MAX) return null;
    return raw;
  }

  const s = String(raw ?? "").trim();
  if (!s || !/^\d+$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isSafeInteger(n)) return null;
  if (n < RETENTION_DAYS_MIN || n > RETENTION_DAYS_MAX) return null;
  return n;
}

// Configuration Email
export const EMAIL_MAX_LEN = 100;
export const EMAIL_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/**
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase().replace(/[\r\n]+/g, "");
}

/**
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  const e = normalizeEmail(email);
  if (!e || e.length > EMAIL_MAX_LEN) return false;
  return EMAIL_REGEX.test(e);
}

/**
 * Extrait les emails valides d'une chaîne brute (séparateurs: , ; espace saut de ligne).
 * @param {string} raw
 * @param {{max?: number}} opts
 * @returns {{valid: string[], invalid: string[]}}
 */
export function extractValidEmails(raw, { max = 200 } = {}) {
  const cleaned = String(raw || "").replace(/[\r\n\t]+/g, " ").trim();
  const parts = cleaned.split(/[,\s;]+/).filter(Boolean);

  const seen = new Set();
  const valid = [];
  const invalid = [];

  for (const p of parts) {
    // Tolère le format <email@x.com>
    const e = normalizeEmail(p.replace(/^<|>$/g, ""));
    if (!e || seen.has(e)) continue;

    seen.add(e);
    if (isValidEmail(e)) valid.push(e);
    else invalid.push(e);

    if (valid.length + invalid.length >= max) break;
  }

  return { valid, invalid };
}

// -----------------------------
// API Apps Script
// -----------------------------

async function internalApiPost(payload) {
  const { webAppUrl } = await requireConfig();

  // Helper fetch avec timeout
  async function doFetch(accessToken) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(webAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, token: accessToken }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  // Obtient un token et retente en cas de 401/403
  let accessToken = await ensureAuthToken();
  let attempt = 0;
  while (attempt < 2) {
    const res = await doFetch(accessToken);
    // Retente en cas de token invalide
    if (res.status === 401 || res.status === 403) {
      await revokeToken(accessToken);
      attempt++;
      if (attempt < 2) {
        accessToken = await ensureAuthToken();
        continue;
      }
      throw new Error("unauthorized");
    }
    // Autres erreurs HTTP
    if (!res.ok) {
      throw new Error("http_" + res.status);
    }
    // Vérifie et renvoie la réponse JSON
    const data = await res.json().catch(() => {
      throw new Error("invalid_json_response");
    });
    if (data?.error) throw new Error(data.error);
    clearTechFail().catch(() => {});
    return data;
  }
  throw new Error("unauthorized");
}

// Cette version empaquette la logique du dessus et gère les erreurs réseau.
export async function apiPost(payload) {
  try {
    return await internalApiPost(payload);
  } catch (err) {
    // Test de connectivité réel via gstatic — plus fiable que navigator.onLine
    if (!(await isReallyOnline())) {
      throw new Error("network_offline");
    }
    // Note l’échec technique sans effacer la configuration
    recordTechFail().catch(() => {});
    throw err instanceof Error ? err : new Error(err?.message || "api_error");
  }
}