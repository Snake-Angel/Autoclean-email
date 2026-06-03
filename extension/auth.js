// auth.js
// This module centralizes Google OAuth2 authentication using the chrome.identity API.
// It exposes helpers to obtain, refresh and revoke an access token for the
// currently signed‑in user.

const CLIENT_ID =
  "341298656625-fr6g3nkknabms80t7k63phedjf93mq7b.apps.googleusercontent.com";

/** Acquire an OAuth2 access token. */
export function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.getAuthToken({ interactive }, (token) => {
        if (chrome.runtime?.lastError || !token) {
          reject(chrome.runtime?.lastError || new Error("OAuth token unavailable"));
          return;
        }
        resolve(token);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/** Ensures a valid OAuth2 access token. Silent first, then interactive if needed. */
export async function ensureAuthToken() {
  try {
    return await getAuthToken(false);
  } catch (_) {
    return await getAuthToken(true);
  }
}

/** Removes a cached token from the identity API. */
export function revokeToken(token) {
  return new Promise((resolve) => {
    if (!token) {
      resolve();
      return;
    }
    chrome.identity.removeCachedAuthToken({ token }, () => {
      resolve();
    });
  });
}

/** Signs the user out by revoking the currently cached token. */
export async function signOut() {
  try {
    const token = await getAuthToken(false);
    await revokeToken(token);
  } catch (_) {
    // nothing to revoke
  }
}