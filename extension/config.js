import { getConfig, setConfig, isValidWebAppUrl } from "./settings.js";
import { getLanguageChoice, setLanguageChoice, applyI18nToDom } from "./i18n.js";

const THEME_SVGS = {
  auto: `
<svg viewBox="0 0 300 300" aria-hidden="true">
  <rect x="50" y="50" width="200" height="200" rx="12" ry="12" fill="currentColor"/>
  <rect x="50" y="50" width="200" height="200" rx="12" ry="12"
        transform="rotate(45 150 150)" fill="currentColor"/>
  <circle cx="150" cy="150" r="55" fill="currentColor"/>
  <circle cx="110" cy="150" r="55" fill="var(--bg-card)"/>
</svg>
  `,
  light: `
<svg viewBox="0 0 300 300" aria-hidden="true">
  <defs>
    <mask id="hole-mask">
      <rect width="100%" height="100%" fill="white"/>
      <circle cx="150" cy="150" r="65" fill="black"/>
    </mask>
  </defs>

  <g mask="url(#hole-mask)" fill="currentColor">
    <rect x="50" y="50" width="200" height="200" rx="12" ry="12"/>
    <rect x="50" y="50" width="200" height="200" rx="12" ry="12"
          transform="rotate(45 150 150)"/>
  </g>
</svg>

  `,
  dark: `
<svg viewBox="0 0 300 300" aria-hidden="true">
  <defs>
    <mask id="moon-mask">
      <rect width="100%" height="100%" fill="white"/>
      <circle cx="110" cy="150" r="55" fill="black"/>
    </mask>
  </defs>
  <circle cx="150" cy="150" r="55" fill="currentColor" mask="url(#moon-mask)"/>
</svg>
  `,
};

function updateThemeToggleUi(themeChoice) {
  const iconHost = document.getElementById("themeToggleIcon");
  if (iconHost) {
    iconHost.innerHTML = THEME_SVGS[themeChoice] || THEME_SVGS.auto;
  }

  // Optionnel: texte dynamique (si tu veux)
  const label = document.getElementById("themeToggleLabel");
  if (label) {
    label.textContent =
      themeChoice === "auto" ? "Système" :
      themeChoice === "light" ? "Clair" :
      "Sombre";
  }

  // Bonus: aria-label/title (accessibilité + feedback)
  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    const t =
      themeChoice === "auto" ? "Thème : Système" :
      themeChoice === "light" ? "Thème : Clair" :
      "Thème : Sombre";
    btn.setAttribute("aria-label", t);
    btn.setAttribute("title", t);
  }
}

const LOCAL_CODE_URL = chrome.runtime.getURL("Code.gs");
const $ = (id) => document.getElementById(id);

function applyTheme(themeChoice){
  const root = document.documentElement;
  root.setAttribute("data-theme", themeChoice);

  let effective = themeChoice;
  if(themeChoice === "auto"){
    effective = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  root.setAttribute("data-theme-effective", effective);
  localStorage.setItem("ac_theme", themeChoice);

  // NEW: UI du bouton
  updateThemeToggleUi(themeChoice);
}

  (function initTheme(){
    const saved = localStorage.getItem("ac_theme") || "auto";
    applyTheme(saved);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq && mq.addEventListener && mq.addEventListener("change", () => {
      if((localStorage.getItem("ac_theme") || "auto") === "auto") applyTheme("auto");
    });
  })();

  $("themeToggleBtn").addEventListener("click", () => {
    const current = localStorage.getItem("ac_theme") || "auto";
    const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
    applyTheme(next);
  });

let currentLang = "fr";

async function initLanguage() {
  currentLang = await getLanguageChoice();
  applyI18nToDom(currentLang);
}

async function toggleLanguage() {
  const next = currentLang === "fr" ? "en" : "fr";
  await setLanguageChoice(next);
  currentLang = next;
  applyI18nToDom(currentLang);
}
  async function copyToClipboard(text){
    if(!text) return false;
    try{
      await navigator.clipboard.writeText(text);
      return true;
    }catch(e){
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

 function safeUrlParse(str){
  try { return new URL(str); } catch { return null; }
}

// Parse user input containing only the WebApp URL.
function parseUserInput(mixed) {
  const raw = String(mixed || "").trim();
  if (!raw) return { webAppUrl: "" };

  const execIdx = raw.indexOf("/exec");
  if (execIdx !== -1) {
    const urlPart = raw.slice(0, execIdx + 5);
    const u = safeUrlParse(urlPart);
    if (u) {
      u.hash = "";
      return { webAppUrl: u.toString() };
    }
  }

  const u = safeUrlParse(raw);
  if (u) {
    u.hash = "";
    return { webAppUrl: u.toString() };
  }
  return { webAppUrl: "" };
}

// Après vos helpers existants (safeUrlParse, parseUserInput, etc.)

function canSave(webAppUrl) {
  return isValidWebAppUrl(webAppUrl);
}

async function syncSaveState() {
  const { webAppUrl } = parseUserInput(document.getElementById("execOrTokenInput").value);
  let finalUrl = webAppUrl;
  if (!finalUrl) {
    const cfg = await getConfig();
    finalUrl = cfg.webAppUrl || "";
  }
  document.getElementById("saveBtn").disabled = !canSave(finalUrl);
}

// Seul le champ URL est pris en compte ; on supprime toute logique token ici.
document.getElementById("saveBtn").addEventListener("click", async () => {
  const { webAppUrl } = parseUserInput(document.getElementById("execOrTokenInput").value);
  let finalUrl = webAppUrl;
  if (!finalUrl) {
    const cfg = await getConfig();
    finalUrl = cfg.webAppUrl || "";
  }
  if (!canSave(finalUrl)) return;
  await setConfig({ webAppUrl: finalUrl });
  window.close();
});

// IIFE d’init qui récupère la langue, remplit l’URL et prépare le bouton
(async function init() {
  const cfg = await getConfig();
  await initLanguage();
  if (cfg.webAppUrl) {
    document.getElementById("execOrTokenInput").value = cfg.webAppUrl;
  }
  await syncSaveState();
})();

// Toggle de langue
const langBtn = document.getElementById("languageToggleBtn");
langBtn?.addEventListener("click", () => {
  toggleLanguage();
});

// Activation du bouton en temps réel
document.getElementById("execOrTokenInput").addEventListener("input", () => {
  syncSaveState();
});

// Gestion du bouton « Copier le code »
document.getElementById("copyCodeBtn").addEventListener("click", async () => {
  const preview = document.getElementById("codePreview");
  if (!preview || !preview.textContent) return;
  const ok = await copyToClipboard(preview.textContent);
  if (ok) {
    const lbl = document.getElementById("copyCodeLabel");
    const prev = lbl?.textContent || "";
    if (lbl) {
      lbl.textContent = "Copié";
      setTimeout(() => (lbl.textContent = prev), 1200);
    }
  }
});

  // ============================
// Tooltip component <ac-tip>
// Usage: <ac-tip data-id="saucisse"></ac-tip>
// Loads: assets/saucisse.png
// ============================
class AcTip extends HTMLElement {
  connectedCallback() {
    const idRaw = (this.getAttribute("data-id") || "").trim();
    if (!idRaw) return;

    // "Saucisse" -> "saucisse"
    const id = idRaw.toLowerCase();
    const src = `assets/${id}.png`;

    // Optionnel: alt custom, sinon alt automatique
    const alt = this.getAttribute("data-alt") || `Aide ${idRaw}`;

    // Tu rends ce composant "inline" et propre
    this.style.display = "inline";

    this.innerHTML = `
      <span class="tipWrap">
        <button
          class="infoBtn"
          type="button"
          aria-label="${escapeHtml(alt)}"
          title="${escapeHtml(alt)}"
        >
          ${AcTip.svgIcon()}
        </button>
        <div class="tip" aria-hidden="true">
          <img src="${src}" alt="${escapeHtml(alt)}" />
        </div>
      </span>
    `;
  }

static svgIcon() {
    // On ajoute stroke="currentColor" pour qu'il hérite du CSS
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 10v6"></path>
        <path d="M12 7h.01"></path>
      </svg>
    `;
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadLocalCode() {
  try {
    const res = await fetch(LOCAL_CODE_URL, { cache: "no-store" });
    if (!res.ok) return;

    const code = await res.text();
    if (!code) return;

    const preview = document.getElementById("codePreview");
    if (!preview) return;

    preview.textContent = code;
  } catch (e) {
    console.error("Impossible de charger Code.gs", e);
  }
}

loadLocalCode();
customElements.define("ac-tip", AcTip);