/**
 * Code.gs — Backend Google Apps Script de l'extension Autoclean Email.
 *
 * Web App (endpoint /exec) déployée par l'utilisateur sur son propre compte
 * Google et appelée par l'extension Chrome. Pour chaque requête POST, le script :
 *   - vérifie le token OAuth transmis par l'extension ;
 *   - gère les règles de rétention (expéditeur → nombre de jours) ;
 *   - exécute le nettoyage Gmail, à la demande (action runCleanup) ou via un
 *     déclencheur planifié (scheduledCleanup).
 *
 * Les règles et paramètres sont stockés via PropertiesService. Tout s'exécute
 * dans le compte Google de l'utilisateur : aucune donnée n'est transmise à un
 * service tiers.
 */

/* --------------------------------------------------------------------------
 * Configuration & constantes
 * -------------------------------------------------------------------------- */
const PROPS_BLOCKLIST_KEY = 'RETENTION_RULES_MAP';           // JSON map { email: {days:number} }
const PROPS_DEFAULT_LABEL_DAYS_KEY = 'DEFAULT_LABEL_DAYS';   // string int
const PROPS_SKIP_UNREAD_KEY = 'SKIP_UNREAD';                // 'true'|'false'
const PROPS_SKIP_SUMMARY_CLEANUP_KEY = 'SKIP_SUMMARY_CLEANUP';
const PROPS_TOTAL_DELETED_KEY = 'TOTAL_DELETED_EMAILS';
const PROPS_LANG_KEY = 'LANG';                              // 'fr' | 'en'
const PROPS_SUMMARY_RECIPIENT_KEY = 'SUMMARY_RECIPIENT';    // email

const MAX_SENDERS_PER_QUERY = 18;             // 15-25 safe
const MAX_THREADS_TO_DELETE_PER_RUN = 200;    // évite timeout
const MAX_RETENTION_DAYS = 999;

// Libellé permettant d'ajouter des expéditeurs à la blocklist via Gmail UI.
// (Conservé tel quel pour compat)
const DEFAULT_ADD_LABEL = 'Add-sender';

// Libellé de traçage apposé sur les threads supprimés.
// (On le laisse stable pour éviter de créer plusieurs labels selon langue.)
const AUTOCLEAN_TRACKING_LABEL = 'Suppression-Autoclean';

// Préfixe stable pour identifier les emails récap (cleanup basé dessus)
const SUBJECT_FR = "Récapitulatif Autoclean-email";
const SUBJECT_EN = "Autoclean-email cleanup summary";


// OAuth configuration
const OAUTH_CLIENT_ID =
  '341298656625-fr6g3nkknabms80t7k63phedjf93mq7b.apps.googleusercontent.com';

function verifyOAuthRequest_(data) {
  const token = data && data.token;
  const result = verifyAccessToken_(token);
  if (!result.ok) {
    return { ok: false, error: result.error || 'unauthorized' };
  }
  return { ok: true };
}

function verifyAccessToken_(token) {
  if (!token) {
    return { ok: false, error: 'missing_token' };
  }
  try {
    var response = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' +
        encodeURIComponent(token),
      { muteHttpExceptions: true }
    );
    var status = response.getResponseCode();
    if (status !== 200) {
      return { ok: false, error: 'invalid_token' };
    }
    var info = JSON.parse(response.getContentText());
    var aud = info.aud || info.audience;
    if (aud !== OAUTH_CLIENT_ID) {
      return { ok: false, error: 'invalid_audience' };
    }
    if (info.expires_in && Number(info.expires_in) <= 0) {
      return { ok: false, error: 'expired_token' };
    }
    return { ok: true, info: info };
  } catch (e) {
    return { ok: false, error: 'token_verification_failed' };
  }
}

/* --------------------------------------------------------------------------
 * WebApp API (doPost)
 * -------------------------------------------------------------------------- */

function doPost(e) {
  const parsed = safeParseJson_(e?.postData?.contents);
  if (!parsed.ok) return respondJsonError_('invalid_json', 'Invalid JSON body');

  const data = parsed.data || {};

  // OAuth verification
  const v = verifyOAuthRequest_(data);
  if (!v.ok) {
    return respondJsonError_(v.error || 'unauthorized', 'Unauthorized');
  }

  // Validation action
  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (!action) return respondJsonError_('missing_action', 'Missing action');

  try {
    return dispatchAction_(action, data);
  } catch (err) {
    return respondJsonError_('server_error', 'Server error', String(err && err.stack ? err.stack : err));
  }
}

/**
 * Dispatcher API (liste blanche).
 */
function dispatchAction_(action, data) {
  switch (action) {
    case 'list':
      return respondJsonOk_({ list: getBlocklistMap_() });

    case 'settings':
      return respondJsonOk_({ settings: getSettings_() });

    case 'setSettings': {
      // Optionnel: set tout d'un coup (compat conservée)
      // NOTE: on accepte lang ici aussi, sans casser l'existant.
      const updates = {};

      if (typeof data.defaultLabelDays !== 'undefined') {
        const ok = setDefaultLabelDays_(data.defaultLabelDays);
        if (!ok) return respondJsonError_('invalid_days', 'Invalid retention days');
        updates.defaultLabelDays = getDefaultLabelDays_();
      }

      if (typeof data.skipUnread !== 'undefined') {
        setSkipUnread_(!!data.skipUnread);
        updates.skipUnread = getSkipUnread_();
      }

      if (typeof data.skipSummaryCleanup !== 'undefined') {
        setSkipSummaryCleanup_(!!data.skipSummaryCleanup);
        updates.skipSummaryCleanup = getSkipSummaryCleanup_();
      }

      if (typeof data.lang !== 'undefined') {
        setLang_(data.lang);
        updates.lang = getLang_();
      }

      return respondJsonOk_({ settings: Object.assign(getSettings_(), updates) });
    }

    case 'labelStatus': {
      const existing = GmailApp.getUserLabelByName(DEFAULT_ADD_LABEL);
      return respondJsonOk_({ exists: Boolean(existing) });
    }

    case 'createLabel': {
      let existing = GmailApp.getUserLabelByName(DEFAULT_ADD_LABEL);
      let created = false;
      if (!existing) {
        GmailApp.createLabel(DEFAULT_ADD_LABEL);
        created = true;
      }
      return respondJsonOk_({ created });
    }

    case 'setLanguage': {
      setLang_(data.lang);
      // Optionnel: renvoyer settings pour éviter un call de plus côté extension
      return respondJsonOk_({ lang: getLang_(), settings: getSettings_() });
    }

    case 'setDefaultLabelDays': {
      if (typeof data.days === 'undefined') return respondJsonError_('missing_days', 'Missing days');
      const ok = setDefaultLabelDays_(data.days);
      if (!ok) return respondJsonError_('invalid_days', 'Invalid retention days');
      return respondJsonOk_({ defaultLabelDays: getDefaultLabelDays_() });
    }

    case 'add': {
      if (!data.email || typeof data.days === 'undefined') {
        return respondJsonError_('missing_email_or_days', 'Missing email or days');
      }
      const email = normalizeEmail_(data.email);
      const days = parseRetentionDays_(data.days);
      if (!email) return respondJsonError_('invalid_email', 'Invalid email');
      if (days == null) return respondJsonError_('invalid_days', 'Invalid retention days');
      addBlockedSender_(email, days);
      return respondJsonOk_({ list: getBlocklistMap_() });
    }

    case 'remove': {
      if (!data.email) return respondJsonError_('missing_email', 'Missing email');
      removeBlockedSender_(data.email);
      return respondJsonOk_({ list: getBlocklistMap_() });
    }

    case 'clearAll': {
      withScriptLock_(function () {
        saveBlocklistMap_({});
      });
      return respondJsonOk_({ list: getBlocklistMap_() });
    }

    case 'runCleanup': {
      const result = deleteOldEmailsNow_();
      return respondJsonOk_({ result });
    }

    case 'setSkipUnread': {
      setSkipUnread_(Boolean(data.skipUnread));
      return respondJsonOk_({ skipUnread: getSkipUnread_() });
    }

    case 'setSkipSummaryCleanup': {
      setSkipSummaryCleanup_(Boolean(data.skipSummaryCleanup));
      return respondJsonOk_({ skipSummaryCleanup: getSkipSummaryCleanup_() });
    }

    default:
      return respondJsonError_('unknown_action', 'Unknown action');
  }
}

/* --------------------------------------------------------------------------
 * Settings / Store (ScriptProperties)
 * -------------------------------------------------------------------------- */

function getSettings_() {
  return {
    defaultLabelDays: getDefaultLabelDays_(),
    skipUnread: getSkipUnread_(),
    skipSummaryCleanup: getSkipSummaryCleanup_(),
    lang: getLang_()
  };
}

function getSkipUnread_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROPS_SKIP_UNREAD_KEY);
  // Par défaut: on protège les messages non lus (true)
  if (raw == null) return true;
  return String(raw) === 'true';
}

function setSkipUnread_(val) {
  return withScriptLock_(function () {
    PropertiesService.getScriptProperties().setProperty(PROPS_SKIP_UNREAD_KEY, val ? 'true' : 'false');
    return true;
  });
}

function getSkipSummaryCleanup_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROPS_SKIP_SUMMARY_CLEANUP_KEY);
  // Par défaut: on nettoie les mails récap (false)
  if (raw == null) return false;
  return String(raw) === 'true';
}

function setSkipSummaryCleanup_(val) {
  return withScriptLock_(function () {
    PropertiesService.getScriptProperties().setProperty(PROPS_SKIP_SUMMARY_CLEANUP_KEY, val ? 'true' : 'false');
    return true;
  });
}

function normalizeLang_(lang) {
  const s = String(lang || '').toLowerCase().trim();
  return (s === 'en' || s === 'fr') ? s : 'fr';
}

function getLang_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROPS_LANG_KEY);
  return normalizeLang_(raw);
}

function setLang_(lang) {
  return withScriptLock_(function () {
    PropertiesService.getScriptProperties().setProperty(PROPS_LANG_KEY, normalizeLang_(lang));
    return true;
  });
}

function getDefaultLabelDays_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROPS_DEFAULT_LABEL_DAYS_KEY);
  const d = parseRetentionDays_(raw);
  return d ?? 10;
}

function setDefaultLabelDays_(days) {
  return withScriptLock_(function () {
    const n = parseRetentionDays_(days);
    if (n == null) return false;
    PropertiesService.getScriptProperties().setProperty(PROPS_DEFAULT_LABEL_DAYS_KEY, String(n));
    return true;
  });
}

function getTotalDeleted_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROPS_TOTAL_DELETED_KEY);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function incrementTotalDeleted_(count) {
  return withScriptLock_(function () {
    const total = getTotalDeleted_() + count;
    PropertiesService.getScriptProperties().setProperty(PROPS_TOTAL_DELETED_KEY, String(total));
    return total;
  });
}

function getRecipient_() {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty(PROPS_SUMMARY_RECIPIENT_KEY);
  if (stored) return stored;

  // fallback: effectiveUser, puis activeUser
  const email = Session.getEffectiveUser().getEmail();
  if (email) return email;
  return Session.getActiveUser().getEmail();
}

/* --------------------------------------------------------------------------
 * I18N
 * -------------------------------------------------------------------------- */

function I18N_(lang) {
  const L = normalizeLang_(lang);
  const dict = {
    fr: {
      locale: 'fr-FR',
      htmlLang: 'fr',
      title: 'Autoclean Email · Récapitulatif',
      subtitle: 'Nettoyage automatique effectué',
      todayLabel: 'Aujourd’hui',
      deletedLabel: 'e-mails supprimés',
      timeSavedLabel: 'Temps gagné',
      approxPerEmail: (seconds) => `≈ ${seconds}s / e-mail`,
      sinceInstall: 'Depuis l’installation:',
      saved: 'gagnés',
      deleted: 'e-mails supprimés',
      details: 'Détails',
      tableSender: 'Expéditeur',
      tableSubject: 'Sujet',
      tableDate: 'Date',
      emptyStateTitle: 'Aucun e-mail supprimé aujourd’hui !',
      emptyStateHint: `Vous pouvez ajouter des expéditeurs via l'extension ou le libellé`,
      footer1: "Ce nettoyage a été effectué automatiquement selon vos règles d'exécution.",
      footerLink: "Modifier la fréquence d’exécution",
      madeBy: "Réalisé par l’extension",
      repoName: "Autoclean-email",
      preheader: (count, timeSavedTodayLabel) => `${count} e-mails supprimés, soit ${timeSavedTodayLabel} économisés !`
    },
    en: {
      locale: 'en-US',
      htmlLang: 'en',
      title: 'Autoclean Email · Summary',
      subtitle: 'Automatic cleanup completed',
      todayLabel: 'Today',
      deletedLabel: 'emails deleted',
      timeSavedLabel: 'Time saved',
      approxPerEmail: (seconds) => `≈ ${seconds}s / email`,
      sinceInstall: 'Since installation:',
      saved: 'saved',
      deleted: 'emails deleted',
      details: 'Details',
      tableSender: 'Sender',
      tableSubject: 'Subject',
      tableDate: 'Date',
      emptyStateTitle: 'No emails deleted today!',
      emptyStateHint: `You can add senders via the extension or the label`,
      footer1: 'This cleanup was performed automatically based on your rules.',
      footerLink: 'Change run frequency',
      madeBy: 'Powered by the extension',
      repoName: 'Autoclean-email',
      preheader: (count, timeSavedTodayLabel) => `${count} emails deleted, about ${timeSavedTodayLabel} saved!`
    }
  };
  return dict[L] || dict.fr;
}

/* --------------------------------------------------------------------------
 * Logique métier principale (cleanup)
 * -------------------------------------------------------------------------- */

/**
 * Déclencheur horaire
 */
function scheduledCleanup() {
  deleteOldEmailsNow_();
}

/**
 * Nettoyage immédiat (appelé par trigger ou action runCleanup).
 * - Nettoie anciens récaps (si activé)
 * - Ingestion via label DEFAULT_ADD_LABEL
 * - Recherche threads à supprimer
 * - Envoi récap i18n + suppression
 */
function deleteOldEmailsNow_() {
  return withScriptLock_(function () {
    const lang = getLang_();

    // 1) Nettoyer anciens récaps (si activé)
    if (!getSkipSummaryCleanup_()) {
      cleanupOldSummaries_();
    }

    // 2) Charger blocklist
    const blockMap = getBlocklistMap_();

    // 3) Ingestion via label
    ingestLabelAdditions_(blockMap);

    // 4) Construire les requêtes Gmail
    const skipUnread = getSkipUnread_();
    const emails = Object.keys(blockMap);

    if (emails.length === 0) {
      // Rien à faire, on n’envoie pas de récap inutile
      return { deleted: 0, note: 'no blocked senders configured' };
    }

    const chunks = chunkArray_(emails, MAX_SENDERS_PER_QUERY);

    // 5) Collecter + dédupliquer threads
    const threadById = {};
    let collected = 0;

    for (let c = 0; c < chunks.length; c++) {
      if (collected >= MAX_THREADS_TO_DELETE_PER_RUN) break;

      const parts = [];
      for (let i = 0; i < chunks[c].length; i++) {
        const email = chunks[c][i];
        const days = blockMap[email]?.days;
        if (!Number.isFinite(days) || days <= 0) continue;
        parts.push(buildGmailClause_(email, days, skipUnread));
      }

      if (parts.length === 0) continue;

      const q = parts.join(' OR ');
      const found = GmailApp.search(q, 0, Math.min(500, MAX_THREADS_TO_DELETE_PER_RUN - collected));

      for (let k = 0; k < found.length; k++) {
        const id = found[k].getId();
        if (!threadById[id]) {
          threadById[id] = found[k];
          collected++;
          if (collected >= MAX_THREADS_TO_DELETE_PER_RUN) break;
        }
      }
    }

    const threads = Object.keys(threadById).map(id => threadById[id]);

    // Trier du plus récent au plus ancien (utile pour le tableau récap)
    threads.sort(function (a, b) {
      return b.getLastMessageDate() - a.getLastMessageDate();
    });

    // 6) Construire email (subject + html) i18n
    const emailPayload = buildSummaryEmail_(threads, lang);

    // 7) Label de traçage + suppression
    const autoLabel = getOrCreateLabel_(AUTOCLEAN_TRACKING_LABEL);

    for (let i = 0; i < threads.length; i++) {
      autoLabel.addToThread(threads[i]);
      threads[i].moveToTrash();
    }

    const deletedCount = threads.length;
    incrementTotalDeleted_(deletedCount);

    // Envoi: MailApp conservé (compat + scopes simples)
    MailApp.sendEmail({
      to: getRecipient_(),
      subject: emailPayload.subject,
      htmlBody: emailPayload.html
    });

    return { deleted: deletedCount };
  });
}

function buildGmailClause_(email, days, skipUnread) {
  return '(from:' + email + ' older_than:' + days + 'd' + (skipUnread ? ' -is:unread' : '') + ')';
}

/**
 * Ingestion des expéditeurs via le libellé DEFAULT_ADD_LABEL.
 * Ajoute au blockMap (en mémoire) puis persiste si ajout.
 */
function ingestLabelAdditions_(blockMap) {
  const label = GmailApp.getUserLabelByName(DEFAULT_ADD_LABEL);
  if (!label) return { added: 0 };

  const defaultDays = getDefaultLabelDays_();
  const threads = GmailApp.search('label:"' + DEFAULT_ADD_LABEL + '"');

  let added = 0;
  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    const msgs = t.getMessages();
    if (!msgs || !msgs.length) continue;

    let from = extractEmail_(msgs[0].getFrom());
    from = normalizeEmail_(from);
    if (!from) continue;

    if (!blockMap[from]) {
      blockMap[from] = { days: defaultDays };
      added++;
    }

    label.removeFromThread(t);
  }

  if (added > 0) saveBlocklistMap_(blockMap);

  return { added };
}

/* --------------------------------------------------------------------------
 * Blocklist (persistante)
 * -------------------------------------------------------------------------- */

function getBlocklistMap_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROPS_BLOCKLIST_KEY);
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch (err) {
    Logger.log('JSON parse error blocklist: ' + err);
  }
  return {};
}

function saveBlocklistMap_(map) {
  PropertiesService.getScriptProperties().setProperty(PROPS_BLOCKLIST_KEY, JSON.stringify(map));
}

function addBlockedSender_(email, days) {
  return withScriptLock_(function () {
    const e = normalizeEmail_(email);
    const d = parseRetentionDays_(days);
    if (!e || d == null) return;

    const map = getBlocklistMap_();
    map[e] = { days: d };
    saveBlocklistMap_(map);
  });
}

function removeBlockedSender_(email) {
  return withScriptLock_(function () {
    const e = normalizeEmail_(email);
    const map = getBlocklistMap_();
    delete map[e];
    saveBlocklistMap_(map);
  });
}

/* --------------------------------------------------------------------------
 * Summary email (subject + html) + HTML builder i18n
 * -------------------------------------------------------------------------- */
// Marqueur stable (ne dépend pas du subject)
const SUMMARY_BODY_MARKER = "AUTOCLEAN_SUMMARY_EMAIL_v1";

function buildSummaryEmail_(threads, lang) {
  const L = normalizeLang_(lang);
  
  // On utilise directement les constantes définies plus haut sans préfixe
  const subject = (L === 'fr') ? SUBJECT_FR : SUBJECT_EN;
  
  const html = buildSummaryHtml_(threads, L);
  return { subject, html };
}

/**
 * HTML Gmail-friendly (inline) + strings i18n + dates localisées.
 */
function buildSummaryHtml_(threads, lang) {
  const T = I18N_(lang);
  const locale = T.locale;

  const countToday = threads.length;

  // Stats: total "depuis installation" inclut ce run (même si on incrémente après)
  const totalDeletedForStats = getTotalDeleted_() + countToday;

  const secondsPerEmail = 10;
  const totalSecondsAllTime = totalDeletedForStats * secondsPerEmail;
  const totalSecondsToday = countToday * secondsPerEmail;

  const timeSavedAllTimeLabel = formatDurationCeil_(totalSecondsAllTime, lang);
  const timeSavedTodayLabel = formatDurationCeil_(totalSecondsToday, lang);

  const preheaderText = T.preheader(countToday, timeSavedTodayLabel);
  const snippetPad = Array(200).fill('&nbsp;&zwnj;').join('');

 // ✅ ajoute un marqueur texte (invisible) pour cleanupOldSummaries_
  const marker = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${SUMMARY_BODY_MARKER}</div>`;

  const dateStr = new Date().toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const c = {
    bg: '#f5f5f5',
    card: '#ffffff',
    text: '#111827',
    subtext: '#6b7280',
    border: '#e5e7eb',
    soft: '#f9fafb',
    shadow: 'rgba(0,0,0,0.03)',
    radius: '12px',
    accentGreen: '#16a34a',
    accentBlue: '#4338ca',
    accentGreenDark: '#15803d',
    accentBlueDark: '#1e40af'
  };

  const maxWidthMobile = 680;
  const maxWidthDesktop = 980;

  let rowsHtml = '';

  if (threads.length === 0) {
    rowsHtml =
      `<tr style="background-color:${c.card};">
        <td colspan="3" style="padding:18px 12px; text-align:center; color:${c.subtext};">
          <div style="font-weight:700; color:${c.text}; margin-bottom:6px;">${escapeHtml_(T.emptyStateTitle)}</div>
          <div style="font-size:13px; line-height:1.4;">
            ${escapeHtml_(T.emptyStateHint)} <strong>${escapeHtml_(DEFAULT_ADD_LABEL)}</strong>.
          </div>
        </td>
      </tr>`;
  } else {
    for (let i = 0; i < threads.length; i++) {
      const msg = threads[i].getMessages()[0];

      const from = escapeHtml_(extractEmail_(msg.getFrom()));
      let subject = escapeHtml_(msg.getSubject() || '');
      if (subject.length > 72) subject = subject.substring(0, 72) + '...';

      const dateRaw = msg.getDate();
      const dateDisplay = formatDateTime_(dateRaw, locale);

      const bgRow = i % 2 === 0 ? c.card : c.soft;

      rowsHtml +=
        `<tr style="background-color:${bgRow};">
          <td style="padding:10px 12px; border-bottom:1px solid ${c.border}; vertical-align:top; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            <span style="display:block; color:${c.text}; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${from}
            </span>
          </td>
          <td style="padding:10px 12px; border-bottom:1px solid ${c.border}; vertical-align:top; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            <span style="display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:${c.text};">
              ${subject}
            </span>
          </td>
          <td style="padding:10px 12px; border-bottom:1px solid ${c.border}; vertical-align:top; white-space:nowrap; color:${c.subtext}; font-size:12px;">
            ${escapeHtml_(dateDisplay)}
          </td>
        </tr>`;
    }
  }

  // HTML
  const html = `<!DOCTYPE html>
<html lang="${escapeHtml_(T.htmlLang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml_(T.title)}</title>
  <style>
    @media (prefers-color-scheme: dark) {
      .bg-page { background: #1f2937 !important; }
      .card { background: #111827 !important; }
      .text { color: #f9fafb !important; }
      .subtext { color: #9ca3af !important; }
      .border { border-color: #374151 !important; }
      .soft { background: #1f2937 !important; }
    }
    @media screen and (min-width: 900px) {
      .container { max-width: ${maxWidthDesktop}px !important; }
    }
  </style>
</head>

<body style="margin:0; padding:0; background:${c.bg}; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Inter',Segoe UI,Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr style="display:none;">
      <td style="display:none!important; visibility:hidden!important; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all; font-size:1px; line-height:1px;">
        ${escapeHtml_(preheaderText)}${snippetPad}
      </td>
    </tr>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" style="background:${c.bg};">
    <tr>
      <td align="center" style="padding:16px 14px 14px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="max-width:${maxWidthMobile}px; width:100%; background:${c.card}; border:1px solid ${c.border}; border-radius:${c.radius}; overflow:hidden; box-shadow:0 2px 6px ${c.shadow};"
          class="container card border">

          <!-- Header -->
          <tr>
            <td style="padding:16px 20px; border-bottom:1px solid ${c.border}; background:${c.card};" class="border card">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="44" style="width:44px; vertical-align:middle;">
                    <img src="https://mincom3python.github.io/LogoAutoclean/icon48.png?v=1"
                      width="52" height="52" alt="Autoclean Email"
                      style="display:block; width:52px; height:52px; border-radius:14px;">
                  </td>
                  <td style="vertical-align:middle; text-align:center;">
                    <div style="font-size:24px; font-weight:600; color:${c.text}; line-height:1.2;" class="text">
                      Autoclean Email
                    </div>
                    <div style="margin-top:4px; font-size:16px; color:${c.subtext}; line-height:1.3;" class="subtext">
                      ${escapeHtml_(T.subtitle)}
                    </div>
                  </td>
                  <td width="44" style="width:44px;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- KPI cards -->
          <tr>
            <td style="padding:16px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top" style="padding:0 6px 10px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                      style="background:${c.card}; border:1px solid ${c.border}; border-radius:${c.radius};">
                      <tr>
                        <td align="center" style="padding:14px 14px 12px 14px; text-align:center;">
                          <div style="font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:${c.subtext};" class="subtext">
                            ${escapeHtml_(T.todayLabel)}
                          </div>
                          <div style="margin-top:8px; font-size:34px; font-weight:800; color:${countToday === 0 ? c.subtext : c.accentGreen}; line-height:1.05;">
                            ${countToday}
                          </div>
                          <div style="margin-top:6px; font-size:13px; color:${c.text};" class="text">
                            ${escapeHtml_(T.deletedLabel)}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>

                  <td valign="top" style="padding:0 0 10px 6px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                      style="background:${c.card}; border:1px solid ${c.border}; border-radius:${c.radius};">
                      <tr>
                        <td align="center" style="padding:14px 14px 12px 14px; text-align:center;">
                          <div style="font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:${c.subtext};" class="subtext">
                            ${escapeHtml_(T.timeSavedLabel)}
                          </div>
                          <div style="margin-top:8px; font-size:34px; font-weight:800; color:${countToday === 0 ? c.subtext : c.accentBlue}; line-height:1.05;">
                            ${escapeHtml_(timeSavedTodayLabel)}
                          </div>
                          <div style="margin-top:6px; font-size:12px; color:${c.subtext}; line-height:1.35;" class="subtext">
                            ${escapeHtml_(T.approxPerEmail(secondsPerEmail))}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Since install -->
              <div style="margin-top:10px; padding:10px 12px; background:${c.soft}; border:1px solid ${c.border}; border-radius:10px; font-size:13px; color:${c.subtext}; line-height:1.4;"
                class="soft border subtext">
                ${escapeHtml_(T.sinceInstall)}
                <b style="color:${c.accentBlueDark};">${escapeHtml_(timeSavedAllTimeLabel)}</b> ${escapeHtml_(T.saved)},
                ${escapeHtml_(' ')}
                <b style="color:${c.accentGreenDark};">${totalDeletedForStats}</b> ${escapeHtml_(T.deleted)}.
              </div>
            </td>
          </tr>

          <!-- Details header -->
          <tr>
            <td style="padding:10px 20px; background:${c.soft}; border-top:1px solid ${c.border}; border-bottom:1px solid ${c.border};"
              class="soft border">
              <div style="font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:${c.subtext};" class="subtext">
                ${escapeHtml_(T.details)} · ${escapeHtml_(dateStr)}
              </div>
            </td>
          </tr>

          <!-- Table -->
          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                style="font-size:13px; color:${c.text}; table-layout:fixed;" class="text">
                <tr style="background:${c.card};">
                  <th align="left" width="34%"
                    style="padding:10px 12px; border-bottom:1px solid ${c.border}; color:${c.subtext}; font-size:11px; text-transform:uppercase; letter-spacing:.08em;">
                    ${escapeHtml_(T.tableSender)}
                  </th>
                  <th align="left" width="46%"
                    style="padding:10px 12px; border-bottom:1px solid ${c.border}; color:${c.subtext}; font-size:11px; text-transform:uppercase; letter-spacing:.08em;">
                    ${escapeHtml_(T.tableSubject)}
                  </th>
                  <th align="left" width="20%"
                    style="padding:10px 12px; border-bottom:1px solid ${c.border}; color:${c.subtext}; font-size:11px; text-transform:uppercase; letter-spacing:.08em;">
                    ${escapeHtml_(T.tableDate)}
                  </th>
                </tr>

                ${rowsHtml}

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 18px 28px; text-align: center; background-color:${c.bg};">
              <div style="font-size: 12px; color:${c.subtext}; line-height: 1.5;">
                ${escapeHtml_(T.footer1)}<br>
                <a href="https://script.google.com/home/triggers" style="color:${c.subtext}; text-decoration: underline;">
                  ${escapeHtml_(T.footerLink)}
                </a>
              </div>
              <div style="margin-top: 10px; font-size: 11px; color: #9ca3af;">
                ${escapeHtml_(T.madeBy)}
                <a href="https://github.com/Snake-Angel/Autoclean-email"
                  style="color:#9ca3af; text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 3px;">
                  ${escapeHtml_(T.repoName)}
                </a>.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return html;
}

/* --------------------------------------------------------------------------
 * Cleanup des anciens récap
 * -------------------------------------------------------------------------- */

/**
 * Supprime les anciens emails récap envoyés par ce script.
 * Basé sur le marqueur stable SUMMARY_BODY_MARKER injecté dans le corps HTML,
 * indépendant du sujet (donc résilient aux changements de libellé / langue).
 */

function cleanupOldSummaries_() {
  const skip = PropertiesService.getScriptProperties().getProperty(PROPS_SKIP_SUMMARY_CLEANUP_KEY);
  if (skip === 'true') return;

  const searchQuery = `"${SUMMARY_BODY_MARKER}"`;

  const threads = GmailApp.search(searchQuery, 0, 10); // Limite à 10 pour la performance
  for (const thread of threads) {
    thread.moveToTrash();
  }
}

/* --------------------------------------------------------------------------
 * Labels
 * -------------------------------------------------------------------------- */

function getOrCreateLabel_(labelName) {
  let existing = GmailApp.getUserLabelByName(labelName);
  if (!existing) existing = GmailApp.createLabel(labelName);
  return existing;
}

/* --------------------------------------------------------------------------
 * Retention days parsing
 * -------------------------------------------------------------------------- */

function parseRetentionDays_(val) {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || !Number.isInteger(val)) return null;
    if (val < 1 || val > MAX_RETENTION_DAYS) return null;
    return val;
  }

  const s = String(val ?? '').trim();
  if (!/^\d+$/.test(s)) return null;

  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1 || n > MAX_RETENTION_DAYS) return null;
  return n;
}

/* --------------------------------------------------------------------------
 * Time saved formatting (i18n-friendly)
 * -------------------------------------------------------------------------- */

function formatDurationCeil_(totalSeconds, lang) {
  const L = normalizeLang_(lang);
  if (totalSeconds < 60) return (L === 'en') ? '< 1 min' : '< 1 min';
  if (totalSeconds < 3600) return Math.ceil(totalSeconds / 60) + ' min';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.ceil((totalSeconds % 3600) / 60);
  if (minutes <= 0) return hours + ' h';
  return hours + ' h ' + minutes + ' min';
}

/* --------------------------------------------------------------------------
 * Setup (initialisation token + recipient + url)
 * -------------------------------------------------------------------------- */

/**
 * À lancer uniquement APRÈS déploiement Web App (versionné).
 * - Génère un token
 * - Stocke hash
 * - Stocke recipient
 * - Log l'URL /exec
 */
function setup() {
  const rawUrl = ScriptApp.getService().getUrl();
  if (!rawUrl) return { status: 'error', message: 'WebApp not deployed (no URL)' };

  const execUrl = rawUrl.replace(/\/dev$/, '/exec');

  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROPS_SUMMARY_RECIPIENT_KEY, getRecipient_());

  try {
    getOrCreateLabel_(DEFAULT_ADD_LABEL);
  } catch (e) {
    // deliberately silent
  }

  Logger.log('Copy this : ' + execUrl);
  return { status: 'ok', url: execUrl };
}

/* --------------------------------------------------------------------------
 * Utils
 * -------------------------------------------------------------------------- */

function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  const ok = lock.tryLock(10000);
  if (!ok) throw new Error('lock_timeout');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function safeParseJson_(text) {
  try {
    const data = JSON.parse(text || '{}');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function respondJsonOk_(obj) {
  return respondJson_(Object.assign({ status: 'ok' }, obj || {}));
}

function respondJsonError_(error, message, details) {
  const payload = { status: 'error', error };
  if (message) payload.message = message;
  if (details) payload.details = details;
  return respondJson_(payload);
}

function respondJson_(obj) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function extractEmail_(fromStr) {
  if (!fromStr) return '';
  const match = String(fromStr).match(/<([^>]+)>/);
  if (match && match[1]) return match[1].replace(/"/g, '').trim().toLowerCase();
  return String(fromStr).replace(/"/g, '').trim().toLowerCase();
}

function normalizeEmail_(email) {
  if (!email) return '';
  return String(email).trim().toLowerCase().replace(/"/g, '');
}

function chunkArray_(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function escapeHtml_(s) {
  const str = String(s ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime_(dateObj, locale) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const datePart = d.toLocaleDateString(locale);
  // toLocaleTimeString en V8 est OK; on force hh:mm lisible
  const timePart = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return datePart + ' ' + timePart;
}