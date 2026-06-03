/**
 * settings.js
 *
 * Gestion centralisée de la configuration persistée de l’extension.
 *
 * Rôle :
 * - Lire, écrire et supprimer la configuration stockée dans chrome.storage.sync.
 * - Fournir des fonctions utilitaires sécurisées pour accéder à la configuration.
 * - Valider le format de l’URL du Web App Google Apps Script.
 *
 * Important :
 * - Seule l’URL du Web App (webAppUrl) est stockée.
 * - Aucun token OAuth n’est conservé dans le stockage.
 * - Toutes les opérations sont encapsulées dans des Promises.
 */

const CONFIG_KEY = "autocleanConfig";

/**
 * Lecture générique dans chrome.storage.sync.
 * @param {string|string[]} keys - Clé(s) à récupérer.
 * @returns {Promise<Object>} Résultat du stockage.
 */
function syncGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, (res) => {
      const err = chrome.runtime?.lastError;
      if (err) reject(err);
      else resolve(res || {});
    });
  });
}

/**
 * Écriture générique dans chrome.storage.sync.
 * @param {Object} obj - Objet à sauvegarder.
 * @returns {Promise<void>}
 */
function syncSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(obj, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Suppression générique dans chrome.storage.sync.
 * @param {string|string[]} keys - Clé(s) à supprimer.
 * @returns {Promise<void>}
 */
function syncRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(keys, () => {
      const err = chrome.runtime?.lastError;
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Récupère la configuration actuelle de l’extension.
 *
 * Remarque :
 * - Dans le flux OAuth actuel, seul webAppUrl est persisté.
 * - Aucun champ legacy (ex : token) n’est conservé.
 *
 * @returns {Promise<{webAppUrl: string}>}
 */
export async function getConfig() {
  const res = await syncGet(CONFIG_KEY);
  return res[CONFIG_KEY] || { webAppUrl: "" };
}

/**
 * Enregistre la configuration.
 *
 * Nettoie et normalise l’URL avant stockage.
 *
 * @param {Object} param0
 * @param {string} param0.webAppUrl - URL du Web App Apps Script
 */
export async function setConfig({ webAppUrl }) {
  await syncSet({
    [CONFIG_KEY]: {
      webAppUrl: String(webAppUrl || "").trim(),
    },
  });
}

/**
 * Récupère la configuration et vérifie qu’elle est valide.
 *
 * Lève une erreur "not_configured" si l’URL n’est pas définie.
 *
 * @returns {Promise<{webAppUrl: string}>}
 * @throws {Error} si la configuration est absente
 */
export async function requireConfig() {
  const cfg = await getConfig();
  if (!cfg.webAppUrl) {
    throw new Error("not_configured");
  }
  return cfg;
}

/**
 * Vérifie qu’une URL correspond bien à un Web App Google Apps Script valide.
 *
 * Contraintes :
 * - HTTPS obligatoire
 * - Domaine strictement script.google.com
 * - Le chemin doit se terminer par /exec
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isValidWebAppUrl(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "script.google.com" &&
      /\/exec$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}