# Autoclean-email — Complete Technical and Functional Documentation

> Updated documentation for the Chrome extension **Autoclean-email** (v1.0.6).
> Source of truth for this revision: the complete, up-to-date source of the extension (`manifest.json`, `popup.html`, `popup.js`, `i18n.js`, `background.js`, `api.js`, `auth.js`, `settings.js`) and the backend (`Code.gs`), together with the privacy policy.

---

## Revision notes — 2026-06-03

Changes in version **1.0.6**:

- **Anti-spam cooldown on the "Delete emails now" button**: a manual cleanup can now be triggered **at most once per minute**. After a click, the button is disabled and shows a countdown. The last-cleanup timestamp is stored in `chrome.storage.local` (key `last_cleanup_at`), so the cooldown survives closing and reopening the popup.
- **Version shown in the UI**: the extension version number is displayed in small text, right below the title, in the popup header. It is read dynamically from `manifest.json` via `chrome.runtime.getManifest().version` — no duplicated value to maintain.
- **Background progress is restored on reopen**: if the popup is closed and reopened while a CSV import / mass add is still running, the "Processing…" status is now **restored** and tracked to completion. The popup reads the persisted state (`chrome.storage.local.batchState`) on bootstrap and listens to `chrome.storage.onChanged` for subsequent updates.
- **Updated GitHub link**: the repository referenced in the popup (and in the summary email) now points to `https://github.com/Snake-Angel/Autoclean-email`.
- **Trimmed `Code.gs` header**: the long, outdated introductory comment was replaced with a concise, up-to-date header.
- **Manifest**: bumped to version `1.0.6`.

---

## Revision notes — 2026-05-25

This version integrates the latest declared product/code changes:

- Apps Script retention rules are stored in `RETENTION_RULES_MAP`.
- Summary email subjects are now neutral and professional:
  - FR: `Récapitulatif Autoclean-email`
  - EN: `Autoclean-email cleanup summary`
- Old summary cleanup relies on the stable HTML marker `AUTOCLEAN_SUMMARY_EMAIL_v1`, not on subject matching.
- The privacy section has been simplified and aligned with the updated privacy policy.

## Table of contents

1. [Extension overview](#1-extension-overview)
2. [Complete technical architecture](#2-complete-technical-architecture)
3. [Detailed frontend behavior](#3-detailed-frontend-behavior)
4. [Detailed background worker behavior](#4-detailed-background-worker-behavior)
5. [Detailed Google Apps Script behavior](#5-detailed-google-apps-script-behavior)
6. [Gmail behavior](#6-gmail-behavior)
7. [Complete user journey](#7-complete-user-journey)
8. [Business logic](#8-business-logic)
9. [Storage and data](#9-storage-and-data)
10. [Inter-component communication](#10-inter-component-communication)
11. [Security](#11-security)
12. [Complete feature list](#12-complete-feature-list)
13. [Privacy policy alignment](#13-privacy-policy-alignment)
14. [Removed outdated diagram notes](#14-removed-outdated-diagram-notes)
15. [Technical limitations, constraints and trade-offs](#15-technical-limitations-constraints-and-trade-offs)

---

## 1. Extension overview

### 1.1 Product objective

**Autoclean-email** is a Chrome extension (Manifest V3) designed to automate Gmail cleanup for a professional user. It does not delete emails by substituting a third-party service: it drives a **Google Apps Script** deployed as a "Web App" on the user's own Google account, and that script performs the deletions on Gmail through the native `GmailApp` API.

The user defines, **per sender**, **how many days** an email should be kept. Once that period is exceeded, the script deletes (moves to trash) the affected threads at its next execution.

### 1.2 Problem solved

Inboxes of professional Gmail users (founders, freelancers, recruiters, operators…) get cluttered with:

- recurring newsletters,
- product notifications,
- follow-up emails from outbound tools (HubSpot, Lemlist, Apollo, etc.),
- LinkedIn or various SaaS digest emails.

These emails lose value quickly. Autoclean-email allows users to express a **per-sender retention policy** instead of dealing with emails one by one, and automates their cleanup on a regular schedule.

### 1.3 Typical use cases

- Keep Substack newsletters 7 days, then auto-delete.
- Keep outbound notifications 3 days.
- Keep LinkedIn notifications 14 days.
- Perform a one-shot "big clean" via the **"Delete emails now"** button.
- Add a sender to the list **directly from Gmail** by applying the `Add-sender` label on an email from that sender.

### 1.4 Target users

Based on the extension's copy and code:
- Founders / operators / freelancers / recruiters.
- Anyone managing a large volume of newsletters and notifications.
- Bilingual audience: **FR + EN** are natively supported (i18n in the UI and in the summary emails).

### 1.5 General philosophy

- **Privacy by design**: no data is sent to a third-party server operated by the developer. The extension talks exclusively to an Apps Script Web App deployed on the user's own Google account (so within their own environment).
- **Owner-only data**: retention rules live in the user's `ScriptProperties`. The sender list is not synchronized anywhere else (apart from local cache and `chrome.storage.sync` for preferences).
- **Manifest V3, minimal OAuth scope**: only `userinfo.email` is requested. The Gmail scope (which might seem natural) is **not** requested by the extension, because it's the Apps Script (running as the user) that holds the Gmail permissions.
- **Simple security**: the OAuth token obtained by Chrome is forwarded to the Web App, which verifies it against Google (`tokeninfo`) and accepts the request only if the audience matches the extension's `client_id`.

### 1.6 Architecture at a glance (30 seconds)

```
Chrome Extension (MV3)
├── popup.html / popup.js   ← Main UI (list, add, settings)
├── config.html / config.js ← Installation guide + Web App URL entry
├── background.js           ← Service Worker, processes batches (CSV / mass add)
├── api.js                  ← HTTP layer + validation + retries
├── auth.js                 ← OAuth via chrome.identity
├── settings.js             ← chrome.storage.sync (Web App URL)
└── i18n.js                 ← Translations FR/EN

Google Apps Script (Web App deployed by the user)
└── Code.gs                 ← doPost, action dispatcher, Gmail deletion,
                              label ingestion, summary email, ScriptProperties
```

---

## 2. Complete technical architecture

### 2.1 Manifest V3 (`manifest.json`)

```json
{
  "manifest_version": 3,
  "name": "Autoclean Email",
  "version": "1.0.6",
  "description": "Automated Gmail cleanup with sender-based retention rules and scheduled runs.",
  "permissions": ["storage", "identity"],
  "host_permissions": [
    "https://script.google.com/macros/s/*/exec",
    "https://www.gstatic.com/generate_204",
    "https://oauth2.googleapis.com/*"
  ],
  "oauth2": {
    "client_id": "341298656625-fr6g3nkknabms80t7k63phedjf93mq7b.apps.googleusercontent.com",
    "scopes": ["https://www.googleapis.com/auth/userinfo.email"]
  },
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_title": "Autoclean-email" },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

Key points:

- **Manifest V3** strict; the background is an **ES module** (`"type": "module"`), which lets `background.js` cleanly import `api.js` and `auth.js`.
- **Minimal permissions**: `storage` (for `chrome.storage.local` and `chrome.storage.sync`) and `identity` (for `chrome.identity.getAuthToken`).
- **`host_permissions`**:
  - `script.google.com/macros/s/*/exec`: allows requests to any deployed Apps Script Web App (the exact URL is entered by the user).
  - `oauth2.googleapis.com/*`: for the OAuth flow.
  - `www.gstatic.com/generate_204`: used as a **real connectivity probe** (empty HTTP 204) by `isReallyOnline()` in `api.js`, in addition to `navigator.onLine`.
- **OAuth2**: a **single scope** is declared, `userinfo.email`. This is intentional: the extension has no direct Gmail access; it is the Apps Script (executed on the Google side under the user's identity) that holds the real Gmail permissions.

### 2.2 Main components

| Component | File | Type | Responsibility |
|---|---|---|---|
| Popup UI | `popup.html` + `popup.js` | ES module | Whole management UI (list, simple add, settings, CSV import/export, manual cleanup). |
| Config page | `config.html` + `config.js` | ES module | Step-by-step install guide, Web App URL input, `Code.gs` copy. |
| Service Worker | `background.js` | ES module | Drives **batches** (mass add + CSV import), state persistence, progress events. |
| API layer | `api.js` | ES module | `apiPost()` with timeout, 401/403 retries, `email` and `days` validation, network failure tracking. |
| Auth | `auth.js` | ES module | `chrome.identity` — `getAuthToken` (silent then interactive), `removeCachedAuthToken`. |
| Config storage | `settings.js` | ES module | Promise wrappers for `chrome.storage.sync`. Validation of the `script.google.com/.../exec` URL. |
| i18n | `i18n.js` | ES module | `t(lang, key, params)`, `applyI18nToDom(lang)`, language getter/setter in `chrome.storage.sync`. |
| GAS backend | `Code.gs` | Google Apps Script | `doPost`, dispatcher, Gmail deletion, label ingestion, summary email, `ScriptProperties`. |

> ⚠️ The `Code.gs` file is **bundled inside the extension** (loaded via `fetch(chrome.runtime.getURL("Code.gs"))` in `config.js`) **only so the user can copy it into their Apps Script project**. It is not executed in the browser; it is just a text "asset" displayed on the config page.

### 2.3 Dynamic view: who talks to whom

```
 ┌───────────────────────── CHROME EXTENSION ─────────────────────────┐
 │                                                                    │
 │  popup.html  ──►  popup.js  ──►  api.js   ──fetch POST──► Apps    │
 │                       ▲             │                      Script  │
 │                       │             ▼                      Web App │
 │                       │       auth.js (chrome.identity)            │
 │                       │             │                              │
 │                       │             ▼                              │
 │                       │      Google OAuth (token)                  │
 │                       │                                            │
 │                       │  chrome.runtime.sendMessage                │
 │                       └───────────────────────────► background.js  │
 │                                                       │            │
 │                                                       │ apiPost()  │
 │                                                       ▼            │
 │                                              api.js  ─► Apps Script│
 │                                                                    │
 │  settings.js  ◄────►  chrome.storage.sync (Web App URL, lang, thm) │
 │  popup.js     ◄────►  chrome.storage.local (caches, batch state)   │
 │                                                                    │
 └────────────────────────────────────────────────────────────────────┘

                                  │ HTTPS POST {action, token, ...}
                                  ▼

 ┌───────────────────── GOOGLE APPS SCRIPT (Code.gs) ──────────────────┐
 │                                                                     │
 │  doPost ── verifyOAuthRequest_ (tokeninfo + aud == CLIENT_ID)       │
 │            └─► dispatchAction_(action, data)                        │
 │                  ├─ list / add / remove / clearAll                  │
 │                  ├─ settings / setSkipUnread / ...                  │
 │                  ├─ labelStatus / createLabel                       │
 │                  └─ runCleanup ──► deleteOldEmailsNow_()            │
 │                                       ├─ ingestLabelAdditions_()    │
 │                                       ├─ GmailApp.search(...)       │
 │                                       ├─ moveToTrash + label trace  │
 │                                       └─ MailApp.sendEmail (summary)│
 │                                                                     │
 │  ScriptProperties (persistence)                                     │
 │    RETENTION_RULES_MAP, DEFAULT_LABEL_DAYS, SKIP_UNREAD,             │
 │    SKIP_SUMMARY_CLEANUP, TOTAL_DELETED_EMAILS, LANG,                 │
 │    SUMMARY_RECIPIENT                                                 │
 └─────────────────────────────────────────────────────────────────────┘
```

### 2.4 Network communications

| Direction | Protocol | Endpoint |
|---|---|---|
| popup/background → GAS | HTTPS POST | Web App URL `script.google.com/.../exec` (entered by the user) |
| popup/background → Google OAuth | HTTPS (internal `chrome.identity`) | `accounts.google.com/o/oauth2/...` |
| GAS → Google OAuth | HTTPS GET | `https://oauth2.googleapis.com/tokeninfo?access_token=...` |
| GAS → Gmail / Mail | Internal Google Apps Script API | `GmailApp`, `MailApp` |

No third-party server is contacted. The only "third party" is Google itself.

### 2.5 Persistence

| Storage | Keys | Content |
|---|---|---|
| `chrome.storage.sync` | `autocleanConfig` | `{ webAppUrl: string }` |
| `chrome.storage.sync` | `themeChoice` | `"auto" \| "light" \| "dark"` |
| `chrome.storage.sync` | `languageChoice` | `"fr" \| "en"` |
| `chrome.storage.local` | `cached_senders_list` | Snapshot of the senders map (UI cache) |
| `chrome.storage.local` | `cached_global_settings` | Snapshot of GAS settings (UI cache) |
| `chrome.storage.local` | `batchState` | Current batch state (jobId, total, processed, ok, ko, status) |
| `chrome.storage.local` | `ac_netfail` | Sliding-window count of technical failures (diagnostic) |
| `localStorage` (config.html) | `ac_theme` | Theme of the config page (separate from the popup) |
| GAS `ScriptProperties` | `RETENTION_RULES_MAP` | JSON `{ email: { days: number } }` |
| GAS `ScriptProperties` | `DEFAULT_LABEL_DAYS` | Integer (string) |
| GAS `ScriptProperties` | `SKIP_UNREAD` | `"true" \| "false"` (default `true`) |
| GAS `ScriptProperties` | `SKIP_SUMMARY_CLEANUP` | `"true" \| "false"` (default `false`) |
| GAS `ScriptProperties` | `TOTAL_DELETED_EMAILS` | Cumulative integer (string) |
| GAS `ScriptProperties` | `LANG` | `"fr" \| "en"` |
| GAS `ScriptProperties` | `SUMMARY_RECIPIENT` | Email address for the summary recipient |

### 2.6 Batch system (mass add and CSV import)

The service worker hosts a batch system:

- Each batch is assigned a `jobId = Date.now().toString()`.
- State is persisted in `chrome.storage.local` (`batchState`) at every processed entry.
- On every processed entry, a `batchAddProgress` message is broadcast via `chrome.runtime.sendMessage`. The popup listens to it (filtering on `jobId`) and updates its UI.
- Each `add` API call gets **up to 3 attempts** (`addOne`) with linear backoff (`500ms × attempt`).
- Between two calls, the worker sleeps `75ms` to avoid hammering the Apps Script quota.
- Once finished, the state is kept for **15 more seconds** then cleared.

### 2.7 Retries and error handling

- **Generic API (`api.js`)**: 2 attempts on `401/403` (token revoked then re-requested). Other HTTP errors propagate (`http_<status>`).
- **Batch (`background.js`)**: 3 attempts per address, independently, with backoff `500ms × attempt`.
- **Timeout**: `AbortController` at 120,000 ms (2 min). Aligned with the Apps Script Web App execution limit.
- **Network errors**:
  - Offline detection uses `isReallyOnline()`: fast short-circuit on `navigator.onLine === false`, otherwise a `fetch` to `https://www.gstatic.com/generate_204` guarded by an `AbortController` with `CONNECTIVITY_TIMEOUT_MS` (4 s). If the probe fails (timeout, DNS, captive portal, etc.), `Error("network_offline")` is thrown.
  - This probe runs **only in the error path** of `apiPost`, so the happy path keeps zero added latency.
  - Otherwise, the real error propagates (`api_error`, `http_500`, `invalid_json_response`, etc.).
- **In the popup**, `handleApiError` (and its equivalent in bootstrap) translates certain errors into **purge + redirect to `config.html`**:
  - `tech_fail_reset`, `connection_failed`, `invalid_json_response`, `http_*`, `not_configured` ⇒ `chrome.storage.sync.remove("autocleanConfig")` then open `config.html`.

### 2.8 Gmail labels (server side)

- `Add-sender` (constant `DEFAULT_ADD_LABEL`): label a user can apply on an email inside Gmail to add its sender to the retention list automatically (with the default duration).
- `Suppression-Autoclean` (constant `AUTOCLEAN_TRACKING_LABEL`): traceability label applied to **every deleted thread** right before `moveToTrash()`. Allows tracing the deletion history (and, if needed, recovering threads while they are still in the Gmail trash).

---

## 3. Detailed frontend behavior

### 3.1 Popup overview

The popup is deliberately **narrow (`min-width: 500px`)** with a constrained height (`min-height: 400px`, `max-height: 585px`). It is built around three main zones:

1. **Header** (GitHub logo, `Autoclean-email` title with the version number shown below it, settings gear).
2. **Scrollable content** (sender list, add form, "Delete now" button).
3. **Footer** (help hint about the `Add-sender` label).

Plus a **`settingsMenu`** floating overlay containing:
- theme (auto/light/dark),
- language (FR/EN),
- toggle "Keep summaries",
- toggle "Ignore unread emails",
- "Default retention via label" input + save button,
- "Export (CSV)" / "Import (CSV)" / "Clear list" buttons.

### 3.2 Anti-flicker (boot gating)

`popup.html` starts with `data-boot="loading"` on `<html>`. CSS hides `#uiRoot` and shows `#bootCover` ("Initializing…"). Once the `popup.js` bootstrap (§3.10) completes, `setBootState("ready")` flips the attribute and reveals the UI. This avoids the "flash" between the initial DOM rendering and the application of theme/i18n.

### 3.3 Theming system

Three choices: `auto`, `light`, `dark`. The choice is persisted to `chrome.storage.sync.themeChoice`. `applyTheme(choice)` sets:
- `data-theme="<choice>"` on `<html>`,
- `data-theme-effective="<dark|light>"` (resolved via `matchMedia('(prefers-color-scheme: dark)')` when `choice === "auto"`).

CSS variables (`--bg-page`, `--text-main`, etc.) are defined by composed selectors `[data-theme="..."][data-theme-effective="..."]`.

### 3.4 i18n system

- Default language: browser detection if nothing is stored in `chrome.storage.sync.languageChoice`, otherwise fallback to **`"en"`** (`DEFAULT_LANG` constant in `i18n.js`).
- `applyI18nToDom(lang)` iterates:
  - all `[data-i18n]` → injects the translation as `innerHTML` (intentional to support `<br/>`),
  - all `[data-i18n-attr]` → JSON format (`{"title":"key","aria-label":"key"}`) or legacy format (`"title:key|aria-label:key"`).
- The FR↔EN toggle also calls `syncLanguageToServer()` on the Apps Script side (action `setLanguage`) → the language affects the **summary email** (subject, GAS i18n dictionary).

### 3.5 Sender list rendering

`renderList(map)`:
- Sorts emails alphabetically.
- Paginates to **2 visible items** (`LIMIT = 2`), with a "Show +N senders" / "Show less" toggle.
- Each card shows the email (with CSS ellipsis if too long) and `Delete after {days} d`, plus a **Remove** button (`btn-remove`).
- Empty state: a dashed placeholder "No sender configured".
- The in-memory `lastListMap` allows instant re-rendering on language change without a fetch.

### 3.6 Add form

Two inputs:
- `#newEmail`: `maxlength=100`, `inputmode="email"`. On `input`, newlines are stripped and the value trimmed. May contain **multiple addresses** (separated by `, ; space, newline`), thanks to `extractValidEmails(raw)`.
- `#newDays`: `inputmode="numeric"`, `maxlength=4`. `attachDaysGuard()` strips non-numeric characters and **clamps to `RETENTION_DAYS_MAX = 999`**.

**Add sender email** button:
- Validates the presence of at least one valid address and one valid day count.
- Sends a `batchAdd` message to the background via `chrome.runtime.sendMessage`.
- Listens to `batchAddProgress` (filters by `jobId`) and updates the UI via `renderProgress`.
- On completion, clears `#newEmail`, refreshes the list, displays `Done. {ok} added, {ko} failed.`.

### 3.7 Settings menu — exact behavior

| Element | Action |
|---|---|
| **Theme** (3 pills) | `setThemeChoice(choice)` → `chrome.storage.sync.set({ themeChoice })` then `applyTheme(choice)`. No network call. |
| **Language** (FR/EN button) | `setLanguageChoice(next)` → `chrome.storage.sync.set({ languageChoice })`, `applyI18nToDom`, re-render list, **then** `syncLanguageToServer` (POST `setLanguage`) non-blocking. |
| **Keep summaries** (switch) | `apiPost({ action: 'setSkipSummaryCleanup', skipSummaryCleanup })`, then local cache update. |
| **Ignore unread emails** (switch) | `apiPost({ action: 'setSkipUnread', skipUnread })`, then local cache update. |
| **Default retention (label)** (input + 💾) | `parseRetentionDays`, then `apiPost({ action: 'setDefaultLabelDays', days })`. Status "Settings saved." on success. |
| **Export (CSV)** | Generates a `text/csv;charset=utf-8` Blob from `lastListMap` (or via API if no cache). Format: `email;days`, separator `;`. Filename: `Autoclean_e-mail_YYYY-MM-DD.csv`. |
| **Import (CSV)** | Opens the file picker (`accept=".csv,text/csv"`), reads the file, parses via `parseCsvSenders()`, and sends `batchAdd` to the background. |
| **Clear list** (red) | Native `confirm(...)`, then `apiPost({ action: 'clearAll' })`, then `renderList({})` + local cache cleared. |

The menu auto-closes on outside click (`document.addEventListener('click', ...)`).

### 3.8 "Delete emails now" button

- Loading status: `"Cleaning up your emails…"` (can be long; up to 2 min API timeout).
- `apiPost({ action: 'runCleanup' })`.
- Server-side, the action is `deleteOldEmailsNow_()` (see §5.5).
- On completion, `await refreshList_()` then `Cleanup complete. {count} threads deleted.`.

**Anti-spam cooldown (1 minute).** To prevent repeated triggers, the button enforces a minimum delay of one minute between two manual cleanups:

- on click, the current timestamp is saved to `chrome.storage.local` (key `last_cleanup_at`);
- the button is immediately disabled and shows a countdown (`"Please wait Ns…"`) until the cooldown expires (`RUN_CLEANUP_COOLDOWN_MS = 60000 ms`);
- because the state is persisted, the cooldown is correctly restored if the popup is closed and reopened (`refreshCleanupCooldown_()` is called again during bootstrap);
- on expiry, the original label is restored and the button is re-enabled.

### 3.9 CSV parsing

`parseCsvSenders(text)`:
- Strips the UTF-8 BOM (`﻿`) at the start.
- Splits into lines (`\n`), trims and removes empty lines.
- Detects an **optional header**: if the first line contains `email`, it is skipped.
- Splits each line on `;`.
- 1st field = email, 2nd field = day count (fallback `10` if invalid).
- Extracts the email via `extractValidEmails(raw, { max: 1 })`.
- Returns an array `[{ email, days }, ...]`.

⚠️ **The separator is hard-coded (`;`)**. Comma-separated CSVs won't be parsed correctly.

### 3.10 Popup bootstrap (`(async () => { ... })()`)

```
1. setStatus("Initializing…", loading)
2. setBootState("loading")
3. renderAppVersion_()                  // shows the version (from manifest) under the title
4. await Promise.all([loadThemeChoice(), loadLanguage()])
5. const configured = await renderSetupOrApp_()
   ├─ if (!configured) → chrome.tabs.create('config.html') + window.close()
   └─ else continue
6. await loadCacheAndRender_()         // instant render from local cache
7. await refreshCleanupCooldown_()     // restore "Delete now" cooldown if still active
8. setBootState("ready")               // UI is now visible
9. try {
     await syncAllData_()              // parallel network sync (list + settings)
     setStatus("")                     // clears the init status
     await restoreBatchProgress_()     // restore "Processing…" if a batch is still running
   } catch (err) {
     - "network_offline"               → offline message (8s)
     - "tech_fail_reset" | "http_*" |  → purge config + redirect to config.html
       "invalid_json_response" | ...
     - default                         → "Error: <message>"
   }
```

### 3.11 "Not configured" state → redirect to `config.html`

If the config does not contain a valid `webAppUrl`:
- `popup.js` opens `config.html` in a new tab (`chrome.tabs.create`),
- then `window.close()` closes the popup.
- In parallel, `background.js` opens `config.html` on `chrome.runtime.onInstalled` with `reason === "install"` (and only if no config is stored yet).

### 3.12 Config page (`config.html` + `config.js`)

UI in 3 "step" cards:
1. **Apps Script setup**: create a project, copy-paste `Code.gs`, deploy as Web App.
2. **Automations (triggers)**: add a trigger on `scheduledCleanup()`.
3. **Connect the extension**: run `setup()`, copy the `/exec` URL into the input, then click **Save**.

The `Code.gs` source is loaded in the background via `fetch(chrome.runtime.getURL("Code.gs"))` and displayed inside `<pre id="codePreview">`. The **Copy code** button calls `navigator.clipboard.writeText()` (with a fallback `document.execCommand('copy')`).

URL validation via `isValidWebAppUrl()` (strict HTTPS, hostname `script.google.com`, pathname ending in `/exec`). As long as the URL isn't valid, the **Save** button is disabled.

A `<ac-tip>` Web Component dynamically loads help images from `assets/<id>.png` on hover. List of help tooltips (all present in `assets/`): `deploy.png`, `new-deployment.png`, `webapp.png`, `access.png`, `google.png`, `declencheur.png`, `declencheurs.png`, `scheduledcleanup.png`, `conditions.png`, `enregistrer.png`, `setup.png`, `executer.png`, `logs.png`.

> The theme on `config.html` is stored in `localStorage` (key `ac_theme`), separately from the popup (`chrome.storage.sync.themeChoice`). This is intentional (the config page can be opened before the storage permissions are fully active; `localStorage` is immediate).

---

## 4. Detailed background worker behavior

### 4.1 Role

The service worker (`background.js`) is deliberately minimalist. It has two main responsibilities:

1. **First-install detection**: open `config.html` on the first `onInstalled`.
2. **`batchAdd` execution**: mass adds (multi-email form or CSV import) without blocking the popup.

It does **not** directly process Gmail cleanup (the user clicks "Delete now" from the popup, and it's `popup.js` that calls GAS directly).

### 4.2 Lifecycle

Like any MV3 service worker, it can be killed between activations. However, in-flight batch state is **persisted to `chrome.storage.local.batchState`**, which survives a possible worker restart (the popup can then reconstruct the display from this snapshot).

### 4.3 Main listener

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender?.id && sender.id !== chrome.runtime.id) return;  // anti-spoof
  if (msg?.action === "batchAdd") {
    runBatchAdd(msg, sendResponse).catch(() => {
      sendResponse({ done: true, status: "error", error: "tech_fail" });
      clearBatchState();
    });
    return true;  // important: sendResponse will be called async
  }
});
```

Filters:
- The `sender.id` must match the extension (`chrome.runtime.id`), to reject messages from other extensions.
- Only the `batchAdd` action is processed. All other requests (settings, list, runCleanup, etc.) are handled **directly by popup.js** (which calls `api.js` itself).

### 4.4 `runBatchAdd(msg, sendResponse)`

Two accepted shapes:
- `msg.entries = [{ email, days }, ...]` (used by **CSV import**, each entry has its own duration).
- `msg.emails = [...]` + `msg.days = <number>` (used by the **simple add form**, with a common duration).

Steps:

1. Generates `jobId = Date.now().toString()`.
2. Normalizes and validates:
   - `entries`: `normalizeEmail(email)` + `parseRetentionDays(days)`, keeps only valid entries (`isValidEmail`, `days > 0`).
   - `emails`: `normalizeEmail` + `isValidEmail`.
3. If total = 0 → returns `{ done: true, status: "error", error: "no_emails" }` and clears state.
4. Otherwise, persists initial state `{ jobId, status: "running", total, processed: 0, ok: 0, ko: 0 }` to `chrome.storage.local.batchState`.
5. Iterates sequentially:
   - For each entry, calls `addOne(email, days)` (up to 3 attempts, see §4.5).
   - Increments `ok` or `ko`.
   - Emits a `batchAddProgress` event (fire-and-forget) and persists the updated state.
   - **Sleeps 75ms** between two calls (Apps Script rate-limit guard).
6. Final state: `status: "done"`, `sendResponse({ done: true, ...finalState })`.
7. Schedules a `setTimeout(clearBatchState, 15000)` to clear the state after 15s.

### 4.5 `addOne(email, days, attempt=1)`

```js
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
```

- 3 attempts per address.
- Linear backoff (`500ms`, `1000ms`, `1500ms`).
- Reuses the `apiPost` layer (so it also benefits from the 401/403 retry).

### 4.6 Progress broadcasting

```js
chrome.runtime.sendMessage({ type: "batchAddProgress", ...state }, () => {
  void chrome.runtime.lastError;  // if no popup is listening, swallow the error
});
```

Important: MV3 doesn't guarantee a receiver is listening. If the user closed the popup, the message is lost — but the full state remains readable through `chrome.storage.local.batchState`. On reopen, the popup reads that snapshot and subscribes to `chrome.storage.onChanged` (see §4.8 and §3.10), so an in-progress batch ("Processing…") is restored and followed to completion.

### 4.7 `onInstalled`

```js
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  chrome.storage.sync.get("autocleanConfig", (res) => {
    if (res?.autocleanConfig?.webAppUrl) return;
    chrome.tabs.create({ url: chrome.runtime.getURL("config.html") });
  });
});
```

Only `"install"` triggers the open (not `"update"` nor `"chrome_update"`), and only if no `webAppUrl` is already registered (useful in dev environment with hot-reloads).

### 4.8 Notable optimizations

- `Promise.all` is not used for batch adds: sequencing is intentional (Apps Script limits + progress readability).
- The 75ms sleep is deliberately short (UX-friendly), enough to avoid bursts that are too fast.
- The persistent `batchState` lets a reopened popup resume the display of an in-progress batch. On bootstrap, `restoreBatchProgress_()` reads `chrome.storage.local.batchState`; if a batch is still `running`, it re-renders the progress and locks the **Add** button. It then attaches a one-time `chrome.storage.onChanged` watcher that follows the batch to completion (re-enables **Add**, refreshes the list, shows the "Done" message). The watcher stays passive (`localBatchActive`) while the same popup owns the batch, to avoid double UI updates with the per-click handler.

---

## 5. Detailed Google Apps Script behavior

The full backend is in `Code.gs`. It is **provided by the extension** but **deployed by the user** in their own Apps Script project. The user therefore holds the necessary Gmail/Mail permissions.

### 5.1 Main constants

```js
const PROPS_RETENTION_RULES_KEY = 'RETENTION_RULES_MAP'; // property storing retention rules
const PROPS_DEFAULT_LABEL_DAYS_KEY = 'DEFAULT_LABEL_DAYS';
const PROPS_SKIP_UNREAD_KEY = 'SKIP_UNREAD';
const PROPS_SKIP_SUMMARY_CLEANUP_KEY = 'SKIP_SUMMARY_CLEANUP';
const PROPS_TOTAL_DELETED_KEY = 'TOTAL_DELETED_EMAILS';
const PROPS_LANG_KEY = 'LANG';
const PROPS_SUMMARY_RECIPIENT_KEY = 'SUMMARY_RECIPIENT';

const MAX_SENDERS_PER_QUERY = 18;             // chunk size for the Gmail query
const MAX_THREADS_TO_DELETE_PER_RUN = 200;    // anti-timeout cap
const MAX_RETENTION_DAYS = 999;

const DEFAULT_ADD_LABEL = 'Add-sender';
const AUTOCLEAN_TRACKING_LABEL = 'Suppression-Autoclean';

const SUBJECT_FR = "Récapitulatif Autoclean-email";
const SUBJECT_EN = "Autoclean-email cleanup summary";

const OAUTH_CLIENT_ID = '341298656625-fr6g3nkknabms80t7k63phedjf93mq7b.apps.googleusercontent.com';
```

### 5.2 Authentication (`verifyOAuthRequest_` + `verifyAccessToken_`)

The script **does not rely on a static shared secret** (old random-token schemes were dropped). It validates every received token:

1. Reads `data.token` from the POST body.
2. Calls `https://oauth2.googleapis.com/tokeninfo?access_token=<token>` (via `UrlFetchApp.fetch`, `muteHttpExceptions: true`).
3. If status ≠ 200 → `invalid_token`.
4. Checks `info.aud === OAUTH_CLIENT_ID` (otherwise `invalid_audience`).
5. Checks `info.expires_in > 0` (otherwise `expired_token`).

The client_id is **hard-coded** in the script (so only requests originating from **the official extension** are accepted — any other OAuth app holding a valid user token would be rejected by `invalid_audience`).

### 5.3 `doPost(e)` and `dispatchAction_`

```js
function doPost(e) {
  const parsed = safeParseJson_(e?.postData?.contents);
  if (!parsed.ok) return respondJsonError_('invalid_json', 'Invalid JSON body');

  const data = parsed.data || {};
  const v = verifyOAuthRequest_(data);
  if (!v.ok) return respondJsonError_(v.error || 'unauthorized', 'Unauthorized');

  const action = String(data.action || '').trim();
  if (!action) return respondJsonError_('missing_action', 'Missing action');

  try { return dispatchAction_(action, data); }
  catch (err) { return respondJsonError_('server_error', 'Server error', String(err?.stack || err)); }
}
```

#### Supported actions (allowlist)

| Action | Input | Response |
|---|---|---|
| `list` | – | `{ list: { email: { days } } }` |
| `settings` | – | `{ settings: { defaultLabelDays, skipUnread, skipSummaryCleanup, lang } }` |
| `setSettings` | `{ defaultLabelDays?, skipUnread?, skipSummaryCleanup?, lang? }` | `{ settings: {...} }` (partial update) |
| `labelStatus` | – | `{ exists: boolean }` (`Add-sender` label) |
| `createLabel` | – | `{ created: boolean }` (`Add-sender` label) |
| `setLanguage` | `{ lang }` | `{ lang, settings }` |
| `setDefaultLabelDays` | `{ days }` | `{ defaultLabelDays }` |
| `add` | `{ email, days }` | `{ list }` (whole map, after add) |
| `remove` | `{ email }` | `{ list }` (whole map, after remove) |
| `clearAll` | – | `{ list: {} }` |
| `runCleanup` | – | `{ result: { deleted: number } }` |
| `setSkipUnread` | `{ skipUnread }` | `{ skipUnread }` |
| `setSkipSummaryCleanup` | `{ skipSummaryCleanup }` | `{ skipSummaryCleanup }` |

All responses carry `{ status: "ok", ... }` or `{ status: "error", error: "<code>", message?, details? }`.

### 5.4 `setup()` (to be manually executed by the user)

```js
function setup() {
  const rawUrl = ScriptApp.getService().getUrl();
  if (!rawUrl) return { status: 'error', message: 'WebApp not deployed (no URL)' };

  const execUrl = rawUrl.replace(/\/dev$/, '/exec');
  PropertiesService.getScriptProperties().setProperty(
    PROPS_SUMMARY_RECIPIENT_KEY, getRecipient_()
  );

  try { getOrCreateLabel_(DEFAULT_ADD_LABEL); } catch {}

  Logger.log('Copy this : ' + execUrl);
  return { status: 'ok', url: execUrl };
}
```

Goal: display the `/exec` URL in the Apps Script logs (to be pasted into the extension), and bootstrap the recipient + `Add-sender` label.

### 5.5 Gmail cleanup — `deleteOldEmailsNow_()`

This is the central business function. Called by:
- The `runCleanup` action ("Delete now" button in the popup).
- `scheduledCleanup()` (hourly/daily trigger set up by the user in Apps Script).

Exact execution (inside `withScriptLock_`, lock max 10s):

1. Reads the language (`getLang_()`).
2. If `SKIP_SUMMARY_CLEANUP === false` (default), calls `cleanupOldSummaries_()` — deletes old summary emails using the stable `SUMMARY_BODY_MARKER` marker, capped at 10 threads per run.
3. Loads the retention rules map from `RETENTION_RULES_MAP`.
4. **Label ingestion**: for each thread carrying the `Add-sender` label, extracts the sender from the **first message** and adds it to the map with `DEFAULT_LABEL_DAYS`. Removes the label after ingestion.
5. If the map is empty → returns `{ deleted: 0, note: 'no retention rules configured' }` (and **does not send** a summary).
6. Reads `skipUnread` and splits emails into chunks of up to **18 senders** (`MAX_SENDERS_PER_QUERY`).
7. For each chunk, builds a single Gmail query:
   ```
   (from:a@x older_than:7d -is:unread) OR (from:b@y older_than:30d -is:unread) ...
   ```
8. `GmailApp.search(q, 0, min(500, remaining))` — collects threads, **deduplicates** by `id`, caps at **200 threads per run** (`MAX_THREADS_TO_DELETE_PER_RUN`).
9. Sorts threads by `getLastMessageDate()` descending (useful for the summary table).
10. Builds the summary email (`buildSummaryEmail_(threads, lang)`).
11. For each thread:
    - Applies the `Suppression-Autoclean` label (`addToThread`).
    - Calls `moveToTrash()` (moves to Gmail trash, not immediately purged).
12. Increments `TOTAL_DELETED_EMAILS` (lifetime cumulative).
13. Sends the summary via `MailApp.sendEmail({ to, subject, htmlBody })`.
14. Returns `{ deleted: <count> }`.

### 5.6 Gmail query building (`buildGmailClause_`)

```js
function buildGmailClause_(email, days, skipUnread) {
  return '(from:' + email + ' older_than:' + days + 'd' + (skipUnread ? ' -is:unread' : '') + ')';
}
```

Semantics:
- `from:<email>`: threads where **at least one message** is from this sender.
- `older_than:<days>d`: threads whose **last message** is older than N days.
- `-is:unread` (conditional): excludes unread threads if `skipUnread` is active.

### 5.7 Label ingestion (`ingestLabelAdditions_`)

```js
function ingestLabelAdditions_(rulesMap) {  // simplified representation
  const label = GmailApp.getUserLabelByName(DEFAULT_ADD_LABEL);
  if (!label) return { added: 0 };

  const defaultDays = getDefaultLabelDays_();
  const threads = GmailApp.search('label:"' + DEFAULT_ADD_LABEL + '"');

  let added = 0;
  for (const t of threads) {
    const msgs = t.getMessages();
    if (!msgs?.length) continue;
    const from = normalizeEmail_(extractEmail_(msgs[0].getFrom()));
    if (!from) continue;
    if (!rulesMap[from]) {
      rulesMap[from] = { days: defaultDays };
      added++;
    }
    label.removeFromThread(t);
  }

  if (added > 0) saveRetentionRulesMap_(rulesMap); // helper name may differ in source
  return { added };
}
```

Key points:
- The email extractor parses `"Display Name" <email@x>` or `email@x` directly.
- Only the **first message** of the thread is read to retrieve the sender.
- The label is **removed** after ingestion (the thread is not deleted, just used as a trigger).
- If the email was already in the map, its duration is **not overwritten** (preserves user choices).

### 5.8 Old summary cleanup (`cleanupOldSummaries_`)

The cleanup no longer depends on the exact email subject. This is important because summary subjects can change for product, wording or language reasons.

Current behavior:

```js
const SUMMARY_BODY_MARKER = "AUTOCLEAN_SUMMARY_EMAIL_v1";
```

- Each summary email contains the stable invisible marker `AUTOCLEAN_SUMMARY_EMAIL_v1` in its HTML body.
- `cleanupOldSummaries_()` uses that marker to identify previous summary emails created by Autoclean-email.
- If `SKIP_SUMMARY_CLEANUP === true`, old summaries are preserved.
- Otherwise, the script can remove old summary threads, capped at 10 threads per cleanup run.
- This is more robust than subject-based cleanup because the subject may change while the marker remains stable.

### 5.9 Summary email (`buildSummaryEmail_` + `buildSummaryHtml_`)

#### Subject
- FR: `"Récapitulatif Autoclean-email"`
- EN: `"Autoclean-email cleanup summary"`

#### HTML body
Inline HTML (Gmail-compatible), `@media (prefers-color-scheme: dark)` to adapt to the mail client's theme, structure:

1. **Hidden preheader** (`display:none`, etc.) — shown in Gmail's preview pane: `"{count} emails deleted, about {time_saved} saved!"`.
2. **Header** with logo (image hosted at `https://mincom3python.github.io/LogoAutoclean/icon48.png?v=1`) + `Autoclean-email` title + `Automatic cleanup completed` subtitle.
3. **2 KPI cards**:
   - `Today: {countToday} emails deleted` (green if > 0).
   - `Time saved: {time_saved_today}` (blue if > 0), with mention `≈ 10s / email`.
4. **"Since installation" banner**: `{time_saved_all_time}` saved and `{total_deleted}` emails deleted.
5. **Deletion table**: for each thread, sender (extracted email), subject (truncated to 72 chars), formatted date+time per locale.
6. **Footer** with a link to the triggers management page (`https://script.google.com/home/triggers`) and a GitHub link to the repo.

#### Time calculations
```js
const secondsPerEmail = 10;
const totalSecondsAllTime = (TOTAL_DELETED_EMAILS + countToday) * 10;
const timeSavedAllTimeLabel = formatDurationCeil_(totalSecondsAllTime, lang);
```

`formatDurationCeil_`:
- `< 60s` → `"< 1 min"`.
- `< 3600s` → `"<n> min"` (ceil).
- Otherwise → `"<h> h <m> min"` (`m = ceil` of the remainder).

#### Empty state
If no thread was deleted on this run, one table row displays the title `"Aucun e-mail supprimé aujourd'hui !"` / `"No emails deleted today!"` with a hint about the `Add-sender` label.

⚠️ **Edge case**: `deleteOldEmailsNow_` returns directly `{ deleted: 0, note: 'no retention rules configured' }` **without sending a summary** if the retention rules map is empty. So the "empty state" summary is sent **only if** there are configured senders but no thread matched.

### 5.10 Locks and concurrency (`withScriptLock_`)

```js
function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  const ok = lock.tryLock(10000);
  if (!ok) throw new Error('lock_timeout');
  try { return fn(); } finally { lock.releaseLock(); }
}
```

Used for every operation that touches `ScriptProperties` (settings + retention rules map) and for `deleteOldEmailsNow_`. Prevents two concurrent executions (e.g. trigger + user click) from clobbering the retention rules map.

### 5.11 Apps Script quotas and limits (trade-offs)

| Limit | Value (code) | Why |
|---|---|---|
| `MAX_SENDERS_PER_QUERY` | 18 | Bounds the Gmail query length (Gmail truncates queries that are too long). |
| `MAX_THREADS_TO_DELETE_PER_RUN` | 200 | Avoids Web App / Apps Script trigger 6-minute timeout. |
| `MAX_RETENTION_DAYS` | 999 | Aligned with extension-side validation. |
| Client API timeout | 120,000 ms | 2 min — enough for a normal run, not for 200 threads on a heavily loaded account. |
| Lock timeout | 10,000 ms | 10s — avoids stalls. |

---

## 6. Gmail behavior

### 6.1 How emails are found

For each chunk of senders, the script builds a Gmail query (using `from:`, `older_than:`, `-is:unread` syntax) and calls:

```js
GmailApp.search(query, 0, min(500, remaining))
```

`GmailApp.search` returns a list of **`GmailThread`** objects (not individual emails). This matters: a thread groups the entire conversation. If a thread contains an email from a targeted sender **and** other emails from other people, **the whole thread will be deleted**.

### 6.2 How rules are applied

For each sender `E` with `days = D`:
- Clause: `(from:E older_than:Dd [-is:unread])`.
- All clauses are OR'ed together in the same query (`A OR B OR C`).

### 6.3 How labels are used

| Label | Role | Action |
|---|---|---|
| `Add-sender` (`DEFAULT_ADD_LABEL`) | Sender ingestion from Gmail | The user labels a received email with this; on the next cleanup, the sender is added to the retention rules map (with `DEFAULT_LABEL_DAYS`), then the label is removed. |
| `Suppression-Autoclean` (`AUTOCLEAN_TRACKING_LABEL`) | Deletion traceability | Applied to each thread right before `moveToTrash`. Allows finding the deleted threads (up to 30 days in Gmail trash). |

### 6.4 How threads are selected

Exact algorithm:

```js
for chunk in chunks(senders, 18):
  query = " OR ".join("(from:e older_than:Dd -is:unread)" for e in chunk)
  threads = GmailApp.search(query, 0, min(500, 200 - collected))
  for thread in threads:
    if not seen[thread.id]:
      seen[thread.id] = thread
      collected += 1
      if collected >= 200: break
```

Safeguards:
- Hard cap of 200 threads per run.
- ID-based deduplication (the same thread returned across chunks is only deleted once).

### 6.5 How deletions are performed

- `thread.moveToTrash()`: moves the thread to Gmail's trash (no immediate permanent delete).
- Gmail auto-purges trash **after 30 days**. The user can therefore restore a deleted thread during that window.

### 6.6 How unread emails are protected

If `SKIP_UNREAD === true` (default), the `-is:unread` clause is added to every Gmail query. No unread email is included in search results, so **none can be deleted**.

> Note: protection is applied at the **thread level** (by Gmail syntax). A thread containing at least one unread message **won't appear** in the results. Conversely, a thread where every message has been read is eligible.

### 6.7 How summary emails are managed

- On every cleanup, the script sends a summary email to the user's account (`SUMMARY_RECIPIENT`, fallback `effectiveUser`).
- On the next cleanup, unless disabled via the "Keep summaries" toggle (`SKIP_SUMMARY_CLEANUP`), `cleanupOldSummaries_()` identifies previous summaries via `SUMMARY_BODY_MARKER` and deletes up to 10 of them.
- This prevents summary emails from accumulating in the user's inbox.

### 6.8 How retentions work

Retention is expressed in **days per sender**. The computation uses `older_than:Nd` in Gmail, which means "the thread's last message is older than N days". Therefore:
- As long as a new message arrives in the thread, **the counter resets for the entire thread**.
- Consequence: if a sender posts a message every week into the same conversation (rare in practice), the thread will never be deleted while it remains active.

---

## 7. Complete user journey

### 7.1 Installation

1. The user installs the extension from the Chrome Web Store.
2. On the first `onInstalled`, `background.js` detects no `webAppUrl` is configured and opens **`config.html`** in a new tab.

### 7.2 Configuration (the `config.html` page)

3 guided steps:

**Step 1 — Apps Script setup**
- Open [script.google.com/home/projects/create](https://script.google.com/home/projects/create).
- Replace the default code with the one shown in the `<pre id="codePreview">` block (click **Copy code**).
- Deploy as Web App:
  - `Deploy → New deployment → Web app`.
  - Settings: `Execute as: Me`, `Who has access: Anyone` (anyone with the link).
- Accept the requested Google permissions (Gmail, Mail).

**Step 2 — Automations (optional)**
- In the Apps Script sidebar → **Triggers**.
- Add a trigger: `scheduledCleanup()`, conditions of your choice (hourly, daily…).
- Enables the automated cleanup.

**Step 3 — Connect the extension**
- Run the `setup()` function in Apps Script.
- Copy the `/exec` URL displayed in the logs.
- Paste the URL into the `config.html` input.
- Click **Save** → `chrome.storage.sync.autocleanConfig = { webAppUrl }`.
- The tab closes automatically (`window.close()`).

### 7.3 OAuth connection (transparent)

On first use, `chrome.identity.getAuthToken({ interactive: true })` opens the Google OAuth pop-up to request the `userinfo.email` scope. The user approves. The token is cached by Chrome (auto-refreshed).

### 7.4 Adding a sender (manually via the popup)

- Open the extension (Chrome puzzle icon).
- Type one (or several) email addresses into `#newEmail`.
- Set the day count in `#newDays`.
- Click **Add sender email**.
- The background processes the request as a batch (1 entry → 1 `add` call), updates the list, and displays `Done. 1 added, 0 failed.`.

### 7.5 Adding a sender via the Gmail `Add-sender` label

- In Gmail, select an email from a sender to add.
- Apply the `Add-sender` label (already created by `setup()`, or via the `createLabel` action; the user can also create it manually).
- On the next cleanup (manual or scheduled), `ingestLabelAdditions_` processes the email:
  - extracts the sender,
  - adds it to the retention rules map with `DEFAULT_LABEL_DAYS`,
  - removes the `Add-sender` label from the thread.

### 7.6 Removing a sender

- In the popup, click the red **Remove** button on the sender's card.
- `apiPost({ action: 'remove', email })` → the retention rules map is updated server-side, the popup re-renders the list.

### 7.7 Triggering a manual cleanup

- Click **Delete emails now!**.
- "Cleaning up your emails…" loading status is shown during execution (can take up to 2 min).
- On completion, status: `Cleanup complete. {count} threads deleted.`.
- A summary email is sent to the user.

### 7.8 Reading the summary

The email is sent to the user's account (`SUMMARY_RECIPIENT` or `effectiveUser`). Subject:
- FR: `Récapitulatif Autoclean-email`
- EN: `Autoclean-email cleanup summary`

Content: 2 KPIs (today + time saved), cumulative stats, detailed table of deleted threads.

### 7.9 CSV export

- Settings → **Export (CSV)**.
- Generates a file `Autoclean_e-mail_YYYY-MM-DD.csv` with:
  ```
  email;days
  newsletter@example.com;7
  notifications@linkedin.com;14
  ```
- Downloaded via a `<a download>` link in the DOM, no external resource.

### 7.10 CSV import

- Settings → **Import (CSV)** → file picker.
- Selects a CSV file (`.csv` or `text/csv`).
- Parse, validation, batch send through the service worker.
- Progress shown at the bottom of the popup (`Processing (12/45) • Success: 12 • Failed: 0`).
- On completion: `Import done • Success: 45 • Failed: 0`.

### 7.11 Automation (Apps Script triggers)

- Set up during step 2 of installation, **on the Apps Script side** (not in the extension).
- The trigger calls `scheduledCleanup()` which calls `deleteOldEmailsNow_()`.
- The user can change the frequency anytime via [script.google.com/home/triggers](https://script.google.com/home/triggers).

### 7.12 Clearing the list

- Settings → **Clear list**.
- Native `confirm()`.
- `apiPost({ action: 'clearAll' })` → the Apps Script retention rules map becomes `{}`.
- The local cache is cleared, the UI re-renders the empty state.

### 7.13 Changing the language

- Settings → globe button (FR ↔ EN).
- The choice is locally persisted (`chrome.storage.sync.languageChoice`).
- The UI is re-internationalized instantly.
- The server is notified (non-blocking) via `setLanguage`; this affects the language of the **summary email** and the table's empty state.

### 7.14 Changing the theme

- Settings → 3 pills (System / Light / Dark).
- Persisted in `chrome.storage.sync.themeChoice` (popup) and `localStorage.ac_theme` (config.html).

---

## 8. Business logic

### 8.1 Rule philosophy

- **Granularity = sender** (no regex, no allowlists, no subject filters).
- Each rule = one email address + a day count (1–999).
- All rules are OR'ed into the same Gmail search query (chunked by 18).
- **No concept of "sort" / "move" / "mark as read"**: the only action is `moveToTrash`.

### 8.2 Cleanup strategy

- The cleanup is **batched** (up to 200 threads per run) to stay within Apps Script limits.
- The cleanup is **idempotent**: if nothing has aged since the previous run, no thread is deleted.
- The cleanup **always emits** a summary email (except for the "empty retention rules map" edge case — see §5.9).

### 8.3 Built-in safeguards

1. **No deletion without an explicit rule**: without senders in the retention rules map, no thread can be deleted.
2. **Unread protection** (on by default): `SKIP_UNREAD = true` → `-is:unread` clause in every query.
3. **`older_than:Nd`** guarantees no recent email is touched.
4. **`moveToTrash`** (not `delete`) → 30-day recovery window in Gmail.
5. **`Suppression-Autoclean` tracking label** is applied before deletion → allows filtering deleted threads in the Gmail trash.
6. **Apps Script lock** on critical operations (cleanup + retention rules map writes).
7. **Strict validation on both sides** (extension AND GAS): `parseRetentionDays` + `isValidEmail` (regex). Invalid values are rejected on input.

### 8.4 Priorities and edge cases

| Case | Behavior |
|---|---|
| Email already in the retention rules map + re-added via popup | The duration **is overwritten** (`map[e] = { days: d }`). |
| Email already in the retention rules map + ingested via the `Add-sender` label | The duration is **not overwritten** (user choices preserved). |
| Unread email from a targeted sender | Not deleted (if `SKIP_UNREAD` is active). |
| Thread containing multiple messages where only the 1st is from the targeted sender | Deleted entirely (Gmail `from:` matches at thread level). |
| Retention rules map empty at run time | Nothing happens, no summary email. |
| `Add-sender` label not created | `ingestLabelAdditions_` returns silently. |
| Apps Script lock already taken | `withScriptLock_` throws `Error('lock_timeout')` after 10s, the error bubbles up to the client. |

### 8.5 Technical trade-offs

- **Thread-level granularity**: Gmail doesn't allow deleting a single message from a thread without breaking the thread integrity. AutoClean accepts deleting the whole thread as soon as one message matches.
- **200/run limit**: chosen to avoid Web App timeouts (Apps Script ~6 min limit). On a very large backlog, several successive runs are required.
- **No audit log on the extension side**: only the summary email is the user's trace. If the user deletes their summaries, the trace is lost (apart from the `Suppression-Autoclean` label, which lives until trash auto-purges).
- **Old-summary cleanup is marker-based**: summary cleanup relies on `SUMMARY_BODY_MARKER`, which is safer than matching a mutable subject line.

### 8.6 Known limitations

- **No "dry run"**: it's not possible to preview what will be deleted without actually deleting it.
- **No history viewable from the extension**: only the summary email retains a record.
- **No pause/cancel** of an in-progress run.
- **No fine-grained multi-language handling on the list**: the summary is in FR or EN, but a list mixing FR+EN has no specific behavior.

---

## 9. Storage and data

### 9.1 `chrome.storage.sync` (3 keys)

```ts
{
  autocleanConfig: { webAppUrl: "https://script.google.com/.../exec" },
  themeChoice: "auto" | "light" | "dark",
  languageChoice: "fr" | "en"
}
```

Synchronized across the Chromes where the user is signed in.

### 9.2 `chrome.storage.local` (4 keys)

```ts
{
  cached_senders_list: { [email]: { days: number } },   // snapshot for instant render
  cached_global_settings: {
    defaultLabelDays: number,
    skipUnread: boolean,
    skipSummaryCleanup: boolean,
    lang: "fr" | "en"
  },
  batchState: {
    jobId: string,
    status: "running" | "done",
    total: number,
    processed: number,
    ok: number,
    ko: number
  } | null,
  ac_netfail: { count: number, last: number }            // internal diagnostic
}
```

### 9.3 `localStorage` (`config.html` page only)

```ts
{
  ac_theme: "auto" | "light" | "dark"
}
```

### 9.4 Apps Script — `ScriptProperties`

```ts
{
  RETENTION_RULES_MAP: '{"a@x.com":{"days":7}, "b@y.com":{"days":14}, ...}',  // stringified JSON
  DEFAULT_LABEL_DAYS: "10",
  SKIP_UNREAD: "true",                       // default
  SKIP_SUMMARY_CLEANUP: "false",             // default
  TOTAL_DELETED_EMAILS: "1234",              // cumulative since installation
  LANG: "fr",                                // default "fr" via normalizeLang_
  SUMMARY_RECIPIENT: "user@gmail.com"        // set by setup()
}
```

All values are stored as `string` (`PropertiesService` limitation); conversion to `boolean`/`number` happens at read time.

### 9.5 Gmail data manipulated (transient, never persisted outside GAS)

- `GmailApp.search()` returns `GmailThread`s.
- Reading the **first message** of some threads (for label ingestion).
- No Gmail data is stored locally; `extractEmail_(msg.getFrom())`, `msg.getSubject()`, `msg.getDate()` are used on the fly to build the summary, then forgotten.

### 9.6 Formats used

- **Email**: normalized `lowercase`, no `\r\n`, regex validation `/^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i`.
- **Days**: integer `[1..999]`, rejected otherwise.
- **CSV export**: `email;days`, separator `;`, UTF-8, headers via i18n.
- **CSV import**: optional `email[...]` header, separator `;`, one row per sender.
- **API JSON**: `{ action, token, ...payload }` request side, `{ status, ... }` response side.

---

## 10. Inter-component communication

### 10.1 Popup → Background (`chrome.runtime.sendMessage`)

| Action | From | To | Payload | Response |
|---|---|---|---|---|
| `batchAdd` (form) | popup.js | background.js | `{ action: "batchAdd", emails: string[], days: number }` | `{ done, status, total, processed, ok, ko, jobId }` |
| `batchAdd` (CSV import) | popup.js | background.js | `{ action: "batchAdd", entries: [{email, days}] }` | same |

During the batch, the background broadcasts `{ type: "batchAddProgress", jobId, status, total, processed, ok, ko }` messages. The popup listens via `chrome.runtime.onMessage.addListener`.

### 10.2 Popup → GAS (via `api.js`)

All actions other than `batchAdd` are sent **directly** through `apiPost({ action, ... })` from `popup.js`. The background is not involved.

```
popup.js → api.js → auth.js (ensureAuthToken) → fetch POST → GAS
                                                  ↑
                                                  body: { ...payload, token }
```

### 10.3 Background → GAS

The background uses GAS **only for the `add` action** (within a batch). It directly imports `apiPost` from `api.js`.

### 10.4 GAS → Gmail / Mail

Server-side on Google:
- `GmailApp.search(query, start, max)` → thread search.
- `GmailApp.getUserLabelByName(name)` / `createLabel(name)`.
- `label.addToThread(t)` / `label.removeFromThread(t)`.
- `thread.moveToTrash()`.
- `MailApp.sendEmail({ to, subject, htmlBody })`.

### 10.5 GAS → Google OAuth

`UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + token)` to validate the received token.

### 10.6 Progress and synchronization

```
popup.js                                      background.js                        GAS
   │                                              │                                  │
   │── sendMessage({action:"batchAdd",...})───────►│                                  │
   │                                              │── apiPost(add) ──fetch POST────►│ ◄── tokeninfo
   │                                              │                                  │
   │ (event)                                      │◄── { status:ok, list }───────────│
   │◄────── { type:"batchAddProgress", ok:1 } ────│                                  │
   │                                              │── apiPost(add) ──fetch POST────►│
   │                                              │... (loop)                        │
   │◄────── { type:"batchAddProgress", ok:N }─────│                                  │
   │◄────── sendResponse({done:true, ok, ko}) ────│                                  │
   │                                              │                                  │
   │── apiPost(list) ──────────fetch POST────────────────────────────────────────────►│
   │◄──────── { status:ok, list } ─────────────────────────────────────────────────────│
```

### 10.7 Cache synchronization

- **At popup startup**: reads local cache (instant render), then performs a network fetch (`Promise.all` of `refreshList_` + `loadServerSettings_`). On divergence, the network wins and overwrites the cache.
- **After each mutation** (add/remove/clearAll, settings): the local cache is updated from the server response.
- **Language change**: in-memory `lastListMap` enables an instant re-render without a re-fetch.

---

## 11. Security

### 11.1 Threat model

The extension handles:
- the senders list (potentially sensitive: who contacts the user),
- a Google OAuth token (scope `userinfo.email`),
- global settings.

It **never** reads email content (the OAuth scope doesn't permit it); the Apps Script does, using the permissions granted by the user upon deployment.

### 11.2 Token system

- The extension acquires a token via `chrome.identity.getAuthToken`.
- The token is included in **every** POST request to the Web App (`{ token, ... }` in the body).
- Server-side, `verifyAccessToken_` calls `oauth2.googleapis.com/tokeninfo` and checks:
  - HTTP status 200,
  - `aud === OAUTH_CLIENT_ID` (verifies the token was indeed issued for **this** extension),
  - `expires_in > 0`.

Consequences:
- An attacker who obtains the `/exec` URL (deployed as "Anyone with the link") **can do nothing** without a valid token issued to this exact extension.
- Another OAuth client (e.g. another app installed by the user) cannot impersonate AutoClean: `aud` won't match.
- The attack window is bounded by the token's lifetime (~1h on Google).

### 11.3 Chrome permissions

- `storage`: required to persist config and caches.
- `identity`: required to obtain the OAuth token.
- **No Gmail / mail / activeTab / tabs permission** is requested. The extension is **unable** to directly read or alter your emails.

### 11.4 Host permissions

- `https://script.google.com/macros/s/*/exec`: required to `fetch` the deployed Web App.
- `https://oauth2.googleapis.com/*`: OAuth flow.
- `https://www.gstatic.com/generate_204`: real connectivity probe used by `isReallyOnline()` in `api.js`. Returns an empty 204 response; only pinged in the error path of `apiPost` to distinguish a real network outage from an application-level error.

### 11.5 Security limits

- **`Anyone` Web App access**: the install guide recommends this setting because the script must accept requests from the extension. Security then **entirely** rests on OAuth token + audience verification. No shared secret is exchanged between extension and script.
- **Token visible in the request body**: transmitted over HTTPS, but present in clear text in the payload. Normal exposure for a Bearer token.
- **`oauth2.googleapis.com/tokeninfo` is called on every request server-side**: an attacker holding the `/exec` URL could spam the script and exhaust the `tokeninfo` quota. No caching is done on the GAS side in the current code.
- **No origin validation on the response side from the extension**: the JSON response is consumed as-is. `host_permissions` already restricts the reachable hosts.
- **The OAuth client_id is hardcoded** in two places (manifest + Code.gs): this seals the extension ↔ script binding. It also prevents a "wild fork" from working if only one of the two is modified.

### 11.6 Attack surface

| Surface | Risk | Mitigation |
|---|---|---|
| `Anyone`-accessible Web App | The `/exec` URL could be discovered | OAuth token verification + audience |
| Token leak (devtools, memory) | Token reusable for up to ~1h | No persistent token storage on the extension side |
| Spoofed message to background | Fake `chrome.runtime.sendMessage` | `sender.id === chrome.runtime.id` filter |
| XSS via user input | If email contains `<script>` | `escapeHtml` on render (popup.js and Code.gs) |
| Malformed JSON injection | Corrupt body | `safeParseJson_` server-side, `try/catch` client-side |
| Poorly validated Web App URL | Non-`script.google.com` URL | `isValidWebAppUrl` (strict HTTPS + hostname + `/exec`) |

### 11.7 Privacy-driven architectural choices

1. **No third-party server**: the developer operates no backend.
2. **User data stays in the user's environment**: everything is in their own Apps Script project.
3. **Minimal OAuth scope**: `userinfo.email` does not allow reading emails (the Apps Script holds the Gmail permissions and runs as the user, not as the extension).
4. **No telemetry**: no analytics calls, no external URL not listed in `host_permissions`.

---

## 12. Complete feature list

Exhaustive list of features detected in code, grouped by surface.

### 12.1 Main popup

- ✅ Senders list rendering (with pagination of 2 visible + "Show +N").
- ✅ Adding one or several senders in one action (multi-email parsing).
- ✅ Removing a sender (per card).
- ✅ Triggering an immediate cleanup ("Delete emails now").
- ✅ Status/toast at the bottom, with persistent "loading" mode.
- ✅ Anti-flicker gating at startup (`data-boot="loading"`).
- ✅ Instant refresh from local cache on startup, then network sync.
- ✅ Redirect to `config.html` if the configuration is invalid.
- ✅ GitHub button on the top-left (external link to the repo).

### 12.2 Settings menu (overlay)

- ✅ Theme: System / Light / Dark (3 pills).
- ✅ Language: FR ↔ EN toggle.
- ✅ "Keep summaries" toggle (`SKIP_SUMMARY_CLEANUP`).
- ✅ "Ignore unread emails" toggle (`SKIP_UNREAD`).
- ✅ Default retention via label (`DEFAULT_LABEL_DAYS`).
- ✅ CSV export.
- ✅ CSV import (with progress).
- ✅ Clear list (with confirmation).
- ✅ Auto-close on outside click.

### 12.3 Config page

- ✅ 3-step installation guide.
- ✅ Display of the `Code.gs` to copy.
- ✅ "Copy code" button (with "Copied" feedback for 1.2s).
- ✅ Help tooltips (`<ac-tip>`) with PNG images.
- ✅ Real-time Web App URL validation.
- ✅ "Save" button that closes the tab on success.
- ✅ Independent theme selector.
- ✅ Language toggle.

### 12.4 Apps Script backend

- ✅ OAuth authentication (token + audience).
- ✅ Retention rules map CRUD (`list`, `add`, `remove`, `clearAll`).
- ✅ Get/set settings (granular + bulk via `setSettings`).
- ✅ Manual cleanup (`runCleanup`).
- ✅ Automated cleanup (`scheduledCleanup`, fired by triggers).
- ✅ Ingestion via the `Add-sender` label.
- ✅ Gmail deletion with `Suppression-Autoclean` tracking label.
- ✅ Responsive bilingual HTML summary email.
- ✅ Cumulative stats (total deleted, time saved).
- ✅ Old-summary cleanup.
- ✅ Concurrency lock (`LockService`).
- ✅ Normalized JSON responses.
- ✅ `setup()` bootstrap function (`Add-sender` label, `SUMMARY_RECIPIENT`, `/exec` URL log).

### 12.5 Service worker

- ✅ Auto-open `config.html` on first install.
- ✅ Batch adds (form and CSV import).
- ✅ 3 attempts per address with backoff.
- ✅ State persistence (`batchState`).
- ✅ Progress event broadcasting.
- ✅ Anti-spoof message filtering.

### 12.6 i18n

- ✅ FR and EN supported.
- ✅ Automatic browser language detection on first launch.
- ✅ Parameterized strings (function templates).
- ✅ DOM application via `data-i18n` and `data-i18n-attr` attributes.
- ✅ Language sync with GAS (impacts the summary).

---

## 13. Privacy policy alignment

The updated privacy policy is now aligned with the current technical behavior of the extension.

### 13.1 Core privacy model

Autoclean-email does not operate a developer-owned backend. Data flows between:

- the Chrome extension running locally in the user's browser;
- the user's own Google Apps Script Web App endpoint;
- Google OAuth for token validation;
- Gmail and Mail services inside the user's own Google account.

The extension itself does not directly read Gmail messages. Gmail operations are executed by the Apps Script deployed by the user.

### 13.2 Data stored by the extension

In Chrome:

- configured Apps Script Web App URL;
- language and theme preferences;
- cached sender list and cached global settings;
- transient batch state for CSV import or multi-address additions;
- local network-failure counter `ac_netfail`.

### 13.3 Data stored by Apps Script

In `PropertiesService`:

| Key | Purpose |
|---|---|
| `RETENTION_RULES_MAP` | Retention rules per sender, stored as JSON `{ email: { days } }`. |
| `DEFAULT_LABEL_DAYS` | Default retention used when adding senders through the Gmail label. |
| `SKIP_UNREAD` | Whether unread threads are protected from cleanup. |
| `SKIP_SUMMARY_CLEANUP` | Whether previous summary emails are preserved. |
| `TOTAL_DELETED_EMAILS` | Cumulative deletion counter used for summary statistics. |
| `LANG` | Summary email language. |
| `SUMMARY_RECIPIENT` | Recipient of the cleanup summary email. |

### 13.4 Gmail data handled during cleanup

The Apps Script reads Gmail data only when needed for cleanup and summary generation:

- sender header of the first message when processing the `Add-sender` label;
- thread subject and date for deleted-thread summaries;
- matching Gmail threads found through Gmail search queries.

This data is not persisted by the extension. The summary email itself remains in Gmail unless deleted by the user or by the summary-cleanup mechanism.

### 13.5 Summary email behavior

Current summary subjects:

| Language | Subject |
|---|---|
| French | `Récapitulatif Autoclean-email` |
| English | `Autoclean-email cleanup summary` |

Old summary cleanup is based on the stable HTML body marker:

```txt
AUTOCLEAN_SUMMARY_EMAIL_v1
```

This avoids coupling cleanup to the email subject.

### 13.6 Privacy guarantees reflected in the implementation

- No telemetry.
- No analytics.
- No remote logging controlled by the developer.
- No developer-operated server.
- OAuth token not stored by the extension itself; Chrome Identity manages the token cache.
- Gmail permissions are held by the user's own Apps Script deployment, not directly by the Chrome extension.

## 14. Removed outdated diagram notes

The previous documentation included a section comparing the implementation with an older Mermaid diagram. That section has been removed from the main body because it was not useful for users or maintainers once the documentation became the source of operational reference.

Keep architecture diagrams separately if needed. The useful rule is simple: diagrams must be regenerated from the current implementation, not treated as evidence when the code and policy have moved on. Humanity may one day learn this. Probably not soon.

## 15. Technical limitations, constraints and trade-offs

### 15.1 Apps Script limits

- Maximum execution timeout: **6 minutes** (full run duration). The code caps at 200 threads/run and uses a 2-min client timeout to prevent issues.
- Gmail quotas: the daily number of `GmailApp.search` and `moveToTrash` calls is limited based on the account type (free/Workspace).
- `LockService.tryLock(10000)`: max 10s wait before `lock_timeout`.

### 15.2 Chrome MV3 limits

- Volatile service worker: can be killed at any moment. State must be persisted.
- `chrome.storage.sync`: quota-limited (100 KB total, 8 KB per item, 1,800 ops/h). Storing the retention rules map in `sync` would be risky, which is why the retention rules map lives in **GAS** (ScriptProperties), not in `sync`.
- `chrome.storage.local`: no hard quota (but bounded by disk space).

### 15.3 CSV trade-offs

- Hard-coded `;` separator (consistent with the export, but not universal).
- No support for comma- or tab-separated CSVs.
- No escaping of values containing `;` (unlikely in a valid email).

### 15.4 API trade-offs

- No pagination on the list: if a user has 5,000 senders, the API returns everything at once. Can become heavy on the `setProperty` side (Apps Script limits ~500 KB per property).
- No diff: every mutation returns the entire list.

### 15.5 UX trade-offs

- **No undo** on sender removal or email deletion.
- **No filter/search** in the senders list.
- **No grouping** by domain (`@linkedin.com`, `@github.com`…).
- **No drag-and-drop** to reorder.
- **List paginated to 2 visible**: aggressive UX choice (the popup stays very compact, but forces the user to click "Show +N" to see the rest).

### 15.6 Security trade-offs

- The `userinfo.email` scope is minimal. Any extension can technically obtain a token with this scope; security rests on the `aud` check server-side.
- The `Anyone with the link` Web App URL is **publicly accessible** but protected by token verification. Any attack depends on having a valid token for this specific extension.

---

## Appendix A — Complete API action reference

| Action | Method | Auth | Input validation | Effect | Typical response |
|---|---|---|---|---|---|
| `list` | POST | OAuth | – | – | `{ status: "ok", list }` |
| `settings` | POST | OAuth | – | – | `{ status: "ok", settings }` |
| `setSettings` | POST | OAuth | `defaultLabelDays?`, `skipUnread?`, `skipSummaryCleanup?`, `lang?` | Updates the matching properties | `{ status: "ok", settings }` |
| `labelStatus` | POST | OAuth | – | – | `{ status: "ok", exists }` |
| `createLabel` | POST | OAuth | – | Creates the `Add-sender` label if it doesn't exist | `{ status: "ok", created }` |
| `setLanguage` | POST | OAuth | `lang ∈ {"fr","en"}` | Persists the language | `{ status: "ok", lang, settings }` |
| `setDefaultLabelDays` | POST | OAuth | `days ∈ [1..999]` | Persists the default duration | `{ status: "ok", defaultLabelDays }` |
| `add` | POST | OAuth | valid `email` + `days ∈ [1..999]` | Adds to the retention rules map | `{ status: "ok", list }` |
| `remove` | POST | OAuth | `email` | Removes from the retention rules map | `{ status: "ok", list }` |
| `clearAll` | POST | OAuth | – | Clears the retention rules map | `{ status: "ok", list: {} }` |
| `runCleanup` | POST | OAuth | – | Executes `deleteOldEmailsNow_()` | `{ status: "ok", result: { deleted } }` |
| `setSkipUnread` | POST | OAuth | `skipUnread: boolean` | Persists | `{ status: "ok", skipUnread }` |
| `setSkipSummaryCleanup` | POST | OAuth | `skipSummaryCleanup: boolean` | Persists | `{ status: "ok", skipSummaryCleanup }` |

Possible errors (returned with `status: "error"`): `invalid_json`, `unauthorized`, `missing_token`, `invalid_token`, `invalid_audience`, `expired_token`, `token_verification_failed`, `missing_action`, `unknown_action`, `missing_email_or_days`, `missing_email`, `missing_days`, `invalid_email`, `invalid_days`, `server_error`, `lock_timeout`.

---

## Appendix B — Complete `ScriptProperties` keys reference

| Key | Stored type | Logical type | Default | Read | Write |
|---|---|---|---|---|---|
| `RETENTION_RULES_MAP` | `string` (JSON) | `{ [email]: { days } }` | `{}` | Retention rules read helper | Retention rules write helper |
| `DEFAULT_LABEL_DAYS` | `string` | `number` `[1..999]` | `10` | `getDefaultLabelDays_` | `setDefaultLabelDays_` |
| `SKIP_UNREAD` | `string "true"\|"false"` | `boolean` | `true` | `getSkipUnread_` | `setSkipUnread_` |
| `SKIP_SUMMARY_CLEANUP` | `string` | `boolean` | `false` | `getSkipSummaryCleanup_` | `setSkipSummaryCleanup_` |
| `TOTAL_DELETED_EMAILS` | `string` | `integer` | `0` | `getTotalDeleted_` | `incrementTotalDeleted_` |
| `LANG` | `string "fr"\|"en"` | string | `"fr"` (via `normalizeLang_`) | `getLang_` | `setLang_` |
| `SUMMARY_RECIPIENT` | `string` (email) | string | `effectiveUser().getEmail()` | `getRecipient_` | `setup()` |

---

## Appendix C — Constants glossary

| Constant (`Code.gs`) | Value | Role |
|---|---|---|
| `MAX_SENDERS_PER_QUERY` | 18 | Chunk size for Gmail queries |
| `MAX_THREADS_TO_DELETE_PER_RUN` | 200 | Cap on per-run deletions |
| `MAX_RETENTION_DAYS` | 999 | Upper bound for retention |
| `DEFAULT_ADD_LABEL` | `"Add-sender"` | Ingestion label |
| `AUTOCLEAN_TRACKING_LABEL` | `"Suppression-Autoclean"` | Traceability label |
| `SUBJECT_FR` | `"Récapitulatif Autoclean-email"` | FR summary subject |
| `SUBJECT_EN` | `"Autoclean-email cleanup summary"` | EN summary subject |
| `OAUTH_CLIENT_ID` | `341298656625-...` | Extension's OAuth Client ID |
| `SUMMARY_BODY_MARKER` | `"AUTOCLEAN_SUMMARY_EMAIL_v1"` | Stable invisible marker used to identify summary emails during cleanup |

| Constant (`api.js`) | Value | Role |
|---|---|---|
| `RETENTION_DAYS_MIN` | 1 | Lower bound |
| `RETENTION_DAYS_MAX` | 999 | Upper bound |
| `API_TIMEOUT_MS` | 120,000 | Fetch timeout (2 min) |
| `EMAIL_MAX_LEN` | 100 | Max email length |
| `EMAIL_REGEX` | (see §9.6) | Validation regex |
| `NETFAIL_KEY` | `"ac_netfail"` | Failure counter key |
| `CONNECTIVITY_PROBE_URL` | `"https://www.gstatic.com/generate_204"` | Endpoint pinged by `isReallyOnline()` to confirm real internet access |
| `CONNECTIVITY_TIMEOUT_MS` | 4,000 | Abort timeout for the connectivity probe (ms) |

---

*End of document.*
