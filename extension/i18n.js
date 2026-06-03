/**
 * i18n.js
 * 
 * Gestion centralisée de l’internationalisation (i18n) de l’extension.
 *
 * Rôle :
 * - Définir les chaînes de traduction utilisées dans l’interface.
 * - Fournir une fonction utilitaire permettant de récupérer la bonne
 *   traduction en fonction de la langue sélectionnée.
 *
 * Fonctionnement :
 * - La langue active est déterminée à partir de chrome.storage.sync
 *   (clé : "languageChoice").
 * - Si aucune langue n’est définie, une langue par défaut est utilisée.
 * - Les clés de traduction sont regroupées dans un objet structuré
 *   par langue (ex : "fr", "en").
 *
 * Portée :
 * - Utilisé par popup.js et config.js pour afficher les textes dynamiques.
 * - Ne réalise aucun appel réseau.
 * - Ne stocke aucune donnée utilisateur autre que la préférence de langue.
 *
 * Bonnes pratiques :
 * - Toute nouvelle chaîne affichée dans l’interface doit être ajoutée ici.
 * - Les clés doivent rester cohérentes entre les différentes langues.
 * - Éviter toute logique métier dans ce fichier (uniquement traduction).
 */

const LANG_KEY = "languageChoice";
const SUPPORTED_LANGS = ["fr", "en"];
const DEFAULT_LANG = "en";

/** Promisified chrome.storage.sync.get with safety (no crash, logs on error). */
function syncGet(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(keys, (res) => {
        if (chrome.runtime?.lastError) {
          console.warn("[i18n] storage.get error:", chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve(res || {});
      });
    } catch (err) {
      console.warn("[i18n] storage.get failed:", err);
      resolve({});
    }
  });
}

/** Promisified chrome.storage.sync.set with safety (no crash, logs on error). */
function syncSet(obj) {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.set(obj, () => {
        if (chrome.runtime?.lastError) {
          console.warn("[i18n] storage.set error:", chrome.runtime.lastError.message);
        }
        resolve();
      });
    } catch (err) {
      console.warn("[i18n] storage.set failed:", err);
      resolve();
    }
  });
}

/** Normalize lang to supported values. */
function normalizeLang(lang) {
  if (typeof lang !== "string") return DEFAULT_LANG;
  const short = lang.trim().toLowerCase().split("-")[0];
  return SUPPORTED_LANGS.includes(short) ? short : DEFAULT_LANG;
}

export const translations = {
  fr: {
    // =========================
    // POPUP (popup.html) - UI
    // =========================
    settings_title: "Réglages",
    settings_button_aria: "Réglages",
    theme_title: "Thème",
    theme_appearance_title: "Apparence",
    theme_appearance_desc: "Système, clair ou sombre.",
    theme_group_aria: "Choix du thème",
    theme_auto: "Système",
    theme_light: "Clair",
    theme_dark: "Sombre",

    language_title: "Langue",
    language_desc: "Langue de l’interface et des emails.",
    language_label: "Langue",
    language_fr: "Français",
    language_en: "English",

    save: "Enregistrer",
    save_title: "Enregistrer",

    popup_title: "Autoclean Email",
    github_logo_alt: "Autoclean Email GitHub",
    app_name: "Autoclean Email",
    language_change_title: "Changer la langue",

    deletion_section_title: "Suppression",

    keep_summaries_title: "Conserver les récapitulatifs",
    keep_summaries_desc: "Le script ne supprime pas les e-mails « Récapitulatif ».",

    skip_unread_title: "Ignorer les e-mails non lus",
    skip_unread_desc: "Ne supprime pas les e-mails non lus.",

    label_retention_title: "Durée de rétention (via libellé)",
    label_retention_desc:
      "Durée par défaut des e-mails ajoutés via le libellé Add-sender.",

    senders_section_title: "Liste des expéditeurs",

    export_csv_btn: "Exporter (CSV)",
    import_csv_btn: "Importer (CSV)",
    clear_senders_btn: "Vider la liste",

    setup_title: "Setup",

    webapp_url_label: "Web App URL",
    webapp_url_placeholder: "https://script.google.com/.../exec",
    webapp_url_hint: "Doit finir par /exec.",

    token_label: "Token",
    token_placeholder: "Coller le token du setup()",

    senders_title: "Expéditeurs",

    add_sender_email_label: "Ajout email expéditeur",
    new_email_placeholder: "ex: autoclean@gmail.com",

    delete_after_days_label: "Supprimer après (jours)",

    add_sender_btn: "Ajouter l’e-mail expéditeur",
    run_cleanup_btn: "Supprimer les e-mails maintenant !",

    help_label_prefix: "Libellez un e-mail '",
    help_label_suffix: "' pour ajouter son expéditeur à la liste.",

    // =========================
    // POPUP (popup.html) - Messages / états
    // =========================
    exportCsvLoading: "Export CSV…",
    exportCsvNoSenders: "Aucun expéditeur à exporter.",
    exportCsvSuccess: "Export du CSV terminé avec succès.",
    exportCsvError: "Échec de l’export du CSV.",

    confirmClearList:
      "Cette action est irréversible. Supprimer tous les expéditeurs enregistrés ?",
    clearListLoading: "Réinitialisation de la liste…",
    clearListSuccess: "Liste des expéditeurs réinitialisée.",
    clearListError: "Impossible de réinitialiser la liste.",

    // etc...
    importInProgress: ({ n }) => `Import des expéditeurs en cours (${n})…`,
    importFinished: ({ ok, ko }) => `Import terminé • Succès : ${ok} • Échecs : ${ko}`,
    senderDays: ({ days }) => `Suppression après ${days} j`,
    showMoreSenders: ({ n }) => `Afficher +${n} expéditeurs`,
    runCleanupSuccess: ({ count }) => `Nettoyage terminé. ${count} conversations supprimées.`,
    runCleanupCooldown: ({ secs }) => `Veuillez patienter ${secs} s…`,

    analyzeCsv: "Analyse du fichier CSV…",
    csvEmptyOrInvalid: "CSV vide ou format invalide (attendu : email;jours).",
    importError: "Une erreur est survenue lors de l’import.",
    importFileError: "Impossible de lire/importer le CSV.",
    progressStatus: ({ processed, total, ok, ko }) =>
      `Traitement en cours (${processed}/${total}) • Succès\u00A0: ${ok} • Échecs\u00A0: ${ko}`,

    init: "Initialisation…",
    saveSettingsLoading: "Enregistrement des paramètres…",
    saveSettingsSuccess: "Paramètres enregistrés.",
    saveSettingsError: "Impossible d’enregistrer les paramètres.",
    networkError: "Connexion impossible. Vérifiez votre accès réseau.",

    saveReglageLoading: "Enregistrement des paramètres…",
    saveReglageSuccess: "Paramètres enregistrés.",
    appsScriptError: "Impossible d’enregistrer (Apps Script).",
    networkErrorGeneric: "Impossible d’enregistrer (réseau).",

    invalidDays: "Valeur invalide (1 à 999 jours, chiffres uniquement).",
    invalidUrl: "URL invalide. Attendu\u00A0: https://script.google.com/.../exec",
    missingToken: "Token manquant.",
    configSaved: "Paramètres enregistrés.",

    labelAlreadyPresent: "Déjà présent",
    labelCreate: "Créer le libellé",
    labelCreatedButton: "Libellé créé",

    createLabelLoading: "Création du libellé…",
    createLabelSuccess: "Libellé créé avec succès.",
    createLabelError: "Impossible de créer le libellé.",

    listNoSenders: "Aucun expéditeur configuré.<br/>\n        Ajoute-en un ci-dessous.",
    removeSenderButton: "Supprimer",
    showLessList: "Réduire la liste",

    addSenderLoading: "Ajout de l’expéditeur…",
    addSenderSuccess: "Adresse(s) ajoutée(s).",
    removeSenderLoading: "Suppression de l’expéditeur…",
    removeSenderSuccess: "Expéditeur supprimé.",

    runCleanupLoading: "Nettoyage de vos emails en cours…",
    missingEmailOrDays: "Email(s) ou jours manquants.",
    noEmailDetected: "Aucune adresse détectée.",

    addBatchInProgress: ({ n }) => `Ajout en arrière-plan de ${n} adresses…`,
    addBatchError: "Erreur pendant l’ajout.",
    addBatchFinished: ({ ok, ko }) => `Terminé. ${ok} ajout(s), ${ko} échec(s).`,

    exportCsvHeader: "email;jours",
    exportCsvFilename: ({ yyyy, mm, dd }) => `Autoclean_e-mail_${yyyy}-${mm}-${dd}.csv`,
    invalidEmails: "Aucune adresse valide (max 100 caractères, format email requis).",

    // =========================
    // CONFIG PAGE (config.html)
    // =========================
    config_page_title: "Autoclean-email · Configuration",
    config_brand_name: "Autoclean-email",
    config_install_guide: "GUIDE D’INSTALLATION",
    config_logo_alt: "Logo",

    theme_toggle_aria: "Changer de thème",

// Bouton langue (UI)
language_toggle_btn: "FR",

step1_title: "Configuration d’Apps Script",
step1_create_project_prefix: "Crée un nouveau projet :",
step1_replace: "Remplace le code déjà présent dans Code.gs par celui ci-dessous.",
copy_code_btn: "Copier le code",
copied_label: "Copié",

step1_list_item_1_prefix: "Colle le code dans",
step1_list_item_1_suffix: ", puis sauvegarde.",
step1_deploy_prefix: "Déploie en application Web :",
help_new_deployment_aria: "Aide : Nouveau déploiement",
help_new_deployment_alt: "Aide Nouveau déploiement",
step1_deploy_path_1: "Déployer",
step1_deploy_path_2: "Nouveau déploiement",
step1_deploy_path_3: "Application Web",
step1_settings_prefix: "Réglages :",
step1_settings_exec_as: "Exécuter en tant que : moi",
step1_settings_access: "Qui a accès : tout le monde",
step1_permissions1:"Acceptez les autorisations Google pour que le script puisse fonctionner sur votre compte.",
step1_permissions2:"(Le script s’exécute uniquement sur votre compte)",

step2_title: "Automatisations (déclencheurs)",
step2_intro_prefix: "Si tu veux automatiser le nettoyage :",
step2_list_item_1_prefix: "Sélectionnez le bouton Déclencheurs dans la barre latérale gauche",
step2_list_item_2_prefix: "Cliquez sur le bouton « Ajouter un déclencheur »",
step2_list_item_3_prefix: "Choisissez « Fonction à exécuter » → scheduledCleanup()",
step2_list_item_4_prefix: "Choisissez vos conditions de déclenchement (modifiables à tout moment).",
step2_list_item_5_prefix: "Enregistre",
step2_ps: 'Vous pouvez retrouver vos automatisations sur <a href="https://script.google.com/home/triggers" target="_blank" rel="noopener noreferrer">https://script.google.com/home/triggers</a>',
step2_cleanup_info: "Chaque nettoyage envoie un email récapitulatif et libelle les emails supprimés.",
step3_title: "Connexion de l’extension",
step3_list_item_1_prefix: "Sélectionnez la fonction",
help_setup_aria: "Aide : setup",
help_setup_alt: "Aide setup",
step3_list_item_1_suffix: ", puis cliquez sur",
step3_run: "Exécuter",
help_google_aria: "Aide : Autorisations Google",
help_google_alt: "Aide autorisations Google",
step3_list_item_3: "Copie l’URL affichée dans les journaux",
help_logs_aria: "Aide : journaux",
help_logs_alt: "Aide journaux",

exec_or_token_label: "URL de déploiement + token",
exec_or_token_placeholder: "Colle l’URL (/exec), puis le token à la suite",
save_btn: "Enregistrer",
  },

  en: {
    // =========================
    // POPUP (popup.html) - UI
    // =========================
    settings_title: "Settings",
    settings_button_aria: "Settings",
    theme_title: "Theme",
    theme_appearance_title: "Appearance",
    theme_appearance_desc: "System, light or dark.",
    theme_group_aria: "Theme choice",
    theme_auto: "System",
    theme_light: "Light",
    theme_dark: "Dark",

    language_title: "Language",
    language_desc: "UI and email language.",
    language_label: "Language",
    language_fr: "Français",
    language_en: "English",

    save: "Save",
    save_title: "Save",

    popup_title: "Autoclean Email",
    github_logo_alt: "Autoclean Email GitHub",
    app_name: "Autoclean Email",
    language_change_title: "Change language",

    deletion_section_title: "Deletion",

    keep_summaries_title: "Keep summaries",
    keep_summaries_desc: "The script does not delete “Summary” emails.",

    skip_unread_title: "Ignore unread emails",
    skip_unread_desc: "Unread emails are not deleted.",

    label_retention_title: "Retention period (via label)",
    label_retention_desc:
      "Default duration for emails added via the Add-sender label.",

    senders_section_title: "Senders list",

    export_csv_btn: "Export (CSV)",
    import_csv_btn: "Import (CSV)",
    clear_senders_btn: "Clear list",

    setup_title: "Setup",

    webapp_url_label: "Web App URL",
    webapp_url_placeholder: "https://script.google.com/.../exec",
    webapp_url_hint: "Must end with /exec.",

    token_label: "Token",
    token_placeholder: "Paste the setup() token",

    senders_title: "Senders",

    add_sender_email_label: "Add sender email",
    new_email_placeholder: "e.g. autoclean@gmail.com",

    delete_after_days_label: "Delete after (days)",

    add_sender_btn: "Add sender email",
    run_cleanup_btn: "Delete emails now!",

    help_label_prefix: "Label an email '",
    help_label_suffix: "' to add the sender to the list.",

    // =========================
    // POPUP (popup.html) - Messages / états
    // =========================
    exportCsvLoading: "Exporting CSV…",
    exportCsvNoSenders: "No senders to export.",
    exportCsvSuccess: "CSV export completed.",
    exportCsvError: "CSV export failed.",

    confirmClearList: "This action is irreversible. Delete all saved senders?",
    clearListLoading: "Resetting the list…",
    clearListSuccess: "Sender list reset.",
    clearListError: "Unable to reset the list.",

    // etc...
    importInProgress: ({ n }) => `Importing senders (${n})…`,
    importFinished: ({ ok, ko }) => `Import done • Success: ${ok} • Failed: ${ko}`,
    senderDays: ({ days }) => `Delete after ${days} d`,
    showMoreSenders: ({ n }) => `Show +${n} senders`,
    runCleanupSuccess: ({ count }) => `Cleanup complete. ${count} threads deleted.`,
    runCleanupCooldown: ({ secs }) => `Please wait ${secs}s…`,

    analyzeCsv: "Analyzing CSV file…",
    csvEmptyOrInvalid: "Empty CSV or invalid format (expected: email;days).",
    importError: "An error occurred during import.",
    importFileError: "Unable to read/import the CSV.",
    progressStatus: ({ processed, total, ok, ko }) =>
      `Processing (${processed}/${total}) • Success: ${ok} • Failed: ${ko}`,

    init: "Initializing…",
    saveSettingsLoading: "Saving settings…",
    saveSettingsSuccess: "Settings saved.",
    saveSettingsError: "Unable to save settings.",
    networkError: "Connection failed. Check your network access.",

    saveReglageLoading: "Saving settings…",
    saveReglageSuccess: "Settings saved.",
    appsScriptError: "Unable to save (Apps Script).",
    networkErrorGeneric: "Unable to save (network).",

    invalidDays: "Invalid value (1 to 999 days, digits only).",
    invalidUrl: "Invalid URL. Expected: https://script.google.com/.../exec",
    missingToken: "Missing token.",
    configSaved: "Settings saved.",

    labelAlreadyPresent: "Already present",
    labelCreate: "Create label",
    labelCreatedButton: "Label created",

    createLabelLoading: "Creating label…",
    createLabelSuccess: "Label created successfully.",
    createLabelError: "Unable to create the label.",

    listNoSenders: "No sender configured.<br/>\n        Add one below.",
    removeSenderButton: "Remove",
    showLessList: "Show less",

    addSenderLoading: "Adding sender…",
    addSenderSuccess: "Address(es) added.",
    removeSenderLoading: "Removing sender…",
    removeSenderSuccess: "Sender removed.",

    runCleanupLoading: "Cleaning up your emails…",
    missingEmailOrDays: "Missing email(s) or days.",
    noEmailDetected: "No address detected.",

    addBatchInProgress: ({ n }) => `Adding ${n} addresses in background…`,
    addBatchError: "Error while adding.",
    addBatchFinished: ({ ok, ko }) => `Done. ${ok} added, ${ko} failed.`,

    exportCsvHeader: "email;days",
    exportCsvFilename: ({ yyyy, mm, dd }) => `Autoclean_e-mail_${yyyy}-${mm}-${dd}.csv`,
    invalidEmails:
      "No valid address (max 100 characters, valid email format required).",

    // =========================
    // CONFIG PAGE (config.html)
    // =========================
    config_page_title: "Autoclean-email · Configuration",
    config_brand_name: "Autoclean-email",
    config_install_guide: "INSTALLATION GUIDE",
    config_logo_alt: "Logo",

    theme_toggle_aria: "Change theme",
    
// Language button (UI)
language_toggle_btn: "EN",

step1_title: "Apps Script Setup",
step1_create_project_prefix: "Create a new project:",
step1_replace: "Replace the existing code in Code.gs with the code below.",
copy_code_btn: "Copy code",
copied_label: "Copied",

step1_list_item_1_prefix: "Paste the code into",
step1_list_item_1_suffix: ", then save.",
step1_deploy_prefix: "Deploy as a Web App:",
help_new_deployment_aria: "Help: New deployment",
help_new_deployment_alt: "Help New deployment",
step1_deploy_path_1: "Deploy",
step1_deploy_path_2: "New deployment",
step1_deploy_path_3: "Web app",
step1_settings_prefix: "Settings:",
step1_settings_exec_as: "Execute as: Me",
step1_settings_access: "Who has access: Anyone",
step1_permissions1:"Accept the Google permissions so the script can run on your account.",
step1_permissions2:"(The script runs only on your own account.)",

step2_title: "Automations (Triggers)",
step2_intro_prefix: "If you want to automate cleanup:",
step2_list_item_1_prefix: "Select the Triggers button in the left sidebar",
step2_list_item_2_prefix: "Click the “Add trigger” button",
step2_list_item_3_prefix: "Choose “Function to run” → scheduledCleanup()",
step2_list_item_4_prefix: "Choose the trigger conditions (editable at any time).",
step2_list_item_5_prefix: "Save",
step2_ps: 'You can find your automations at <a href="https://script.google.com/home/triggers" target="_blank" rel="noopener noreferrer">https://script.google.com/home/triggers</a>',
step2_cleanup_info: "Each cleanup sends a summary email and labels deleted emails.",
step3_title: "Extension Connection",
step3_list_item_1_prefix: "Select the function",
help_setup_aria: "Help: setup",
help_setup_alt: "Help setup",
step3_list_item_1_suffix: ", then click",
step3_run: "Run",
help_google_aria: "Help: Google permissions",
help_google_alt: "Help Google permissions",
step3_list_item_3: "Copy the URL displayed in the logs",
help_logs_aria: "Help: logs",
help_logs_alt: "Help logs",

exec_or_token_label: "Deployment URL + Token",
exec_or_token_placeholder: "Paste the /exec URL, then append the token",
save_btn: "Save",
  },
};

/**
 * Translate a key.
 * - Missing keys return "[missing:key]" (explicit fallback, no silent failure).
 * - Supports function values for templated strings.
 */
export function t(lang, key, params) {
  const safeLang = normalizeLang(lang);
  const dict = translations[safeLang] || translations.fr || {};
  const fallback = translations.fr || {};

  const val = dict[key] ?? fallback[key];
  if (val == null) return `[missing:${key}]`;

  try {
    if (typeof val === "function") return String(val(params || {}));
    return String(val);
  } catch (err) {
    console.warn(`[i18n] error in key "${key}" for lang "${safeLang}":`, err);
    return `[missing:${key}]`;
  }
}

export async function getLanguageChoice() {
  const res = await syncGet([LANG_KEY]);
  if (typeof res?.[LANG_KEY] === "string" && res[LANG_KEY].trim()) {
    return normalizeLang(res[LANG_KEY]);
  }

  // Détection navigateur
  const navLang = (navigator.language || navigator.userLanguage || DEFAULT_LANG).toString();
  return normalizeLang(navLang);
}

export async function setLanguageChoice(lang) {
  const v = normalizeLang(lang);
  await syncSet({ [LANG_KEY]: v });
}

/** Parse data-i18n-attr specs (JSON preferred; legacy pipe format supported). */
function parseAttrSpec(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  // Preferred JSON object: {"title":"key","aria-label":"key"}
  if (s.startsWith("{")) {
    try {
      const obj = JSON.parse(s);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
      return obj;
    } catch (err) {
      console.warn("[i18n] invalid JSON in data-i18n-attr:", s, err);
      // fallback to legacy attempt
    }
  }

  // Legacy: "aria-label:key|title:key|placeholder:key"
  const out = {};
  const parts = s.split("|").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const attr = part.slice(0, idx).trim();
    const key = part.slice(idx + 1).trim();
    if (attr && key) out[attr] = key;
  }
  return Object.keys(out).length ? out : null;
}

export function applyI18nToDom(lang) {
  const safeLang = normalizeLang(lang);

  try {
    document.documentElement.lang = safeLang;
  } catch (err) {
    console.warn("[i18n] unable to set <html lang>:", err);
  }

  // Texte simple
  try {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      el.innerHTML = t(safeLang, key); // innerHTML volontaire: support <br/>
    });
  } catch (err) {
    console.warn("[i18n] failed applying data-i18n:", err);
  }

  // Attributs (aria-label, title, placeholder, etc.)
  try {
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      const specRaw = el.getAttribute("data-i18n-attr");
      const spec = parseAttrSpec(specRaw);
      if (!spec) return;

      for (const [attr, key] of Object.entries(spec)) {
        if (!attr || !key) continue;
        try {
          el.setAttribute(attr, t(safeLang, key));
        } catch (err) {
          console.warn(`[i18n] failed setting attribute "${attr}" on`, el, err);
        }
      }
    });
  } catch (err) {
    console.warn("[i18n] failed applying data-i18n-attr:", err);
  }
}