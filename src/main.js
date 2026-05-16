// /src/main.js — V3.2.1 FULL + PUBLICATION KIT V1
// Flow: Boot -> Permissions Mac -> (Tuto bypass) -> Login -> Dashboard
// Key rules restored:
// - 1 certificat BROUILLON par session (même volume faible, confirmation)
// - 1 certificat FINAL par session si gate OK
// - 1 certificat FINAL projet via finalize_project (toujours accessible)
// - Historique affiche CERTIFIED + CERTIFIED_TEMP
// - DeepLink macOS fiable via `tauri://open-url` + buffer pending
// Publication Kit V1:
// - CERTIFICAT_FINAL.html
// - CERTIFICAT_FINALfichier de vérification
// - HumanOrigin_STAMP.svg / .png
// - HumanOrigin_BADGE.svg / .png
// - HumanOrigin_CARTOUCHE.svg / .png
// - HumanOrigin_CARTOUCHE_COMPACT.svg / .png
// - HumanOrigin_VERIFY.txt

import { invoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/api/dialog";
import { writeTextFile, createDir, copyFile, removeDir } from "@tauri-apps/api/fs";
import { createClient } from "@supabase/supabase-js";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import * as app from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/api/process";
import QRCode from "qrcode";
import { Command } from "@tauri-apps/api/shell";

console.log("HumanOrigin main.js V3.2.1 FULL + Publication Kit V1 loaded ✅");

async function hoGetSessionSafe(timeoutMs = 1800) {
  return await Promise.race([
    supabase.auth.getSession(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("getSession timeout")), timeoutMs)
    ),
  ]);
}

function hoBootMark(step) {
  try {
    console.log("[BOOT]", step);
    window.__hoLastBootStep = step;
  } catch {}
}

// =========================================================
// CONFIG
// =========================================================
const supabaseUrl = "https://bhlisgvozsgqxugrfsiu.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJobGlzZ3ZvenNncXh1Z3Jmc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTI5NDEsImV4cCI6MjA4MzcyODk0MX0.L43rUuDFtg-QH7lVCFTFkJzMTjNUX7BWVXqmVMvIwZ0";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// =========================================================
// STATE
// =========================================================
let currentUser = null;
let currentProjectId = null;
let currentProjectName = null;
let currentProjectPath = null;

let currentSessionId = null;
let currentSessionStartedAt = null;
let restoredDraftSessionId = null;
let lastSnapshot = null;

let scanInterval = null;
let isScanningUI = false;

let draftsCache = [];
let pasteStats = { paste_events: 0, pasted_chars: 0, max_paste_chars: 0 };

// Anti-fantômes
let uiEpoch = 0;
const bumpEpoch = () => (uiEpoch += 1);
const epochIsStale = (e) => e !== uiEpoch;

// Permissions wall (macOS)
let permissionsPollTimer = null;
let inputWatchdogTimer = null;
let lastInputTs = 0;
let inputTsStableCount = 0;
let currentScreenName = null;
let __permissionsContinueInFlight = false;

// Viewer
let currentCertAssetUrl = null;
let currentCertHtmlPath = null;

// DeepLink buffer + guard
let __pendingDeepLinkUrl = null;
let __deepLinkListenersReady = false;
let __deepLinkHandling = false;

// =========================================================
// UI HELPERS
// =========================================================
const $ = (id) => document.getElementById(id);

const safeText = (id, text) => {
  const el = $(id);
  if (el) el.innerText = text ?? "";
};

const on = (id, fn) => {
  const el = $(id);
  if (el) el.onclick = fn;
};

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.innerText = msg ?? "";
  el.style.display = "block";
  setTimeout(() => {
    if (el) el.style.display = "none";
  }, 3000);
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function resetPasteStats() {
  pasteStats = { paste_events: 0, pasted_chars: 0, max_paste_chars: 0 };
}

function verdictFromScp(scp) {
  if (scp === null || scp === undefined) {
    return { label: "—", color: "rgba(11,18,32,0.55)" };
  }
  if (scp <= 0) return { label: "INSUFFISANT", color: "#9ca3af" };
  if (scp >= 80) return { label: "COHÉRENT", color: "#10b981" };
  if (scp >= 50) return { label: "ATYPIQUE", color: "#f59e0b" };
  return { label: "SUSPECT", color: "#ef4444" };
}

function basenameAnyPath(p) {
  return String(p ?? "").split(/[\\/]/).pop() || "document";
}

function dirnameAnyPath(p) {
  const s = String(p ?? "");
  const parts = s.split(/[\\/]/);
  parts.pop();
  const sep = s.includes("\\") ? "\\" : "/";
  return parts.join(sep);
}

function guessMime(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    htm: "text/html",
    json: "application/json",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}
function fileExtLower(filename) {
  const ext = (String(filename || "").split(".").pop() || "").toLowerCase();
  return ext || "bin";
}

async function pickDocumentToBind() {
  const selected = await open({
    multiple: false,
    directory: false,
  });

  if (!selected) return null;

  const path = Array.isArray(selected) ? selected[0] : selected;
  const filename = basenameAnyPath(path);
  const mime = guessMime(filename);
  const sha256 = await invoke("sha256_file", { path });

  return { path, filename, mime, sha256 };
}

// =========================================================
// SCREEN ROUTER
// =========================================================
function showScreen(screenName) {
  hoBootMark("showScreen:" + screenName);
  currentScreenName = screenName;
  if (screenName === "LOGIN" && typeof applyLoginScreenCopy === "function") applyLoginScreenCopy();
  if (screenName === "PERMISSIONS" && typeof applyPermissionsScreenCopy === "function") applyPermissionsScreenCopy();
  if (screenName === "PROJECT_SELECT" && typeof applyProjectScreenCopy === "function") applyProjectScreenCopy();
  if (screenName === "DASHBOARD" && typeof applySessionScreenCopy === "function") applySessionScreenCopy();
  try { document.body.setAttribute("data-screen", screenName); } catch {}

  const loginScreen = $("login-screen");
  const appScreen = $("app-screen");
  const projectSec = $("project-section");
  const controlsSec = $("controls-section");
  const permScreen = $("permissions-screen");
  const onboardScreen = $("onboarding-screen");

  if (loginScreen) loginScreen.style.display = "none";
  if (appScreen) appScreen.style.display = "none";
  if (projectSec) projectSec.style.display = "none";
  if (controlsSec) controlsSec.classList.add("hidden");
  if (permScreen) permScreen.style.display = "none";
  if (onboardScreen) onboardScreen.style.display = "none";

  switch (screenName) {
    case "PERMISSIONS":
      if (permScreen) permScreen.style.display = "flex";
      break;

    case "ONBOARDING":
      if (onboardScreen) onboardScreen.style.display = "flex";
      break;

    case "LOGIN":
      if (loginScreen) loginScreen.style.display = "block";
      break;

    case "PROJECT_SELECT":
      if (appScreen) appScreen.style.display = "block";
      if (projectSec) projectSec.style.display = "block";
      safeText("current-project-title", "Que voulez-vous certifier ?");
      break;

    case "DASHBOARD":
      if (appScreen) appScreen.style.display = "block";
      if (controlsSec) controlsSec.classList.remove("hidden");
      safeText("current-project-title", currentProjectName || "Workspace HumanOrigin");
      break;
  }
}

// =========================================================
// RESET HELPERS
// =========================================================
function resetProjectStateOnly() {
  currentProjectId = null;
  currentProjectName = null;
  currentProjectPath = null;

  currentSessionId = null;
  currentSessionStartedAt = null;
  restoredDraftSessionId = null;
  lastSnapshot = null;

  const tbody = $("certs-tbody");
  if (tbody) tbody.innerHTML = "";
}

function stopPermissionTimers() {
  try {
    if (permissionsPollTimer) clearInterval(permissionsPollTimer);
  } catch {}
  permissionsPollTimer = null;

  try {
    if (inputWatchdogTimer) clearInterval(inputWatchdogTimer);
  } catch {}
  inputWatchdogTimer = null;

  lastInputTs = 0;
  inputTsStableCount = 0;

  const warn = $("perm-warn-input");
  if (warn) warn.style.display = "none";
}

function resetAllStateToLogin() {
  try {
    if (scanInterval) clearInterval(scanInterval);
  } catch {}
  scanInterval = null;

  stopPermissionTimers();

  isScanningUI = false;
  resetProjectStateOnly();

  currentUser = null;
  draftsCache = [];
  resetPasteStats();

  showScreen("LOGIN");
}

// =========================================================
// PERMISSIONS WALL (macOS)
// =========================================================
function isPermissionsScreenVisible() {
  return currentScreenName === "PERMISSIONS";
}

async function getInputPermissionEvidence() {
  try {
    const raw = await invoke("get_input_status");
    const ts =
      Number(
        raw?.last_input_ts ??
        raw?.lastInputTs ??
        raw?.timestamp ??
        raw?.ts ??
        0
      ) || 0;

    const granted = Boolean(
      raw?.input_monitoring_granted ??
      raw?.inputMonitoringGranted ??
      raw?.permission_granted ??
      raw?.granted ??
      raw?.ok ??
      raw?.permission_ok ??
      (ts > 0)
    );

    return { granted, ts, raw };
  } catch {
    return { granted: false, ts: 0, raw: null };
  }
}

function setPermissionsHint(message) {
  safeText("perm-help-text", message || "");
  safeText("perm-manual-hint", message || "");
}

function updatePermissionBadge(accessOk, inputOk) {
  const badge = $("perm-badge");
  if (!badge) return;

  const warn = $("perm-warn-input");

  if (accessOk && inputOk) {
    badge.innerText = "Accessibilité + Surveillance de l’entrée : OK ✅";
    badge.style.color = "#166534";
    badge.style.background = "#ecfdf3";
    badge.style.borderColor = "#bbf7d0";
    if (warn) warn.style.display = "none";
    return;
  }

  if (accessOk && !inputOk) {
    badge.innerText = "Accès incomplet : Surveillance de l’entrée manquante";
    badge.style.color = "#9a3412";
    badge.style.background = "#fff7ed";
    badge.style.borderColor = "#fed7aa";
    if (warn) {
      warn.style.display = "block";
      warn.innerHTML =
        "⚠️ <strong>Il manque encore Surveillance de l’entrée.</strong> HumanOrigin peut s’ouvrir, mais n’enregistrera pas correctement la session. Activez aussi cette autorisation, puis appuyez sur une touche et relancez la vérification.";
    }
    return;
  }

  if (!accessOk && inputOk) {
    badge.innerText = "Accès incomplet : Accessibilité manquante";
    badge.style.color = "#9a3412";
    badge.style.background = "#fff7ed";
    badge.style.borderColor = "#fed7aa";
    if (warn) warn.style.display = "none";
    return;
  }

  badge.innerText = "Accessibilité + Surveillance de l’entrée : à activer";
  badge.style.color = "#b91c1c";
  badge.style.background = "#fff";
  badge.style.borderColor = "rgba(0,0,0,0.1)";
  if (warn) warn.style.display = "none";
}

async function isMacPermissionsOk() {
  try {
    const accessOk = await invoke("is_accessibility_trusted");
    return !!accessOk;
  } catch {
    return true;
  }
}

async function openMacSettings(kind) {
  try {
    await invoke("open_mac_settings", { kind });

    if (kind === "accessibility") {
      setPermissionsHint(
        "Si Réglages s’ouvre sur Général : allez manuellement dans Confidentialité et sécurité > Accessibilité, puis activez HumanOrigin."
      );
      toast("Réglages Système ouverts");
    } else {
      setPermissionsHint(
        "Si Réglages ne va pas au bon endroit : ouvrez manuellement Confidentialité et sécurité, puis vérifiez les autorisations nécessaires."
      );
      toast("Réglages Système ouverts");
    }
  } catch (e) {
    console.warn("open_mac_settings failed", e);
    setPermissionsHint(
      "Ouvrez manuellement Réglages Système > Confidentialité et sécurité > Accessibilité, puis activez HumanOrigin."
    );
    toast("Ouverture Réglages impossible, faites-le manuellement.");
  }
}

function hoUiLang() {
  try {
    const saved = (localStorage.getItem("ho_lang") || "").toLowerCase();
    if (saved in {"fr": 1, "en": 1}) return saved;
  } catch {}
  const nav = String(navigator.language || "fr").toLowerCase();
  return nav.startsWith("fr") ? "fr" : "en";
}

function hoPerm(fr, en) {
  return hoUiLang() === "fr" ? fr : en;
}

function ensureProjectLangToggle() {
  const root = $("app-screen");
  if (!root) return;

  let bar = document.getElementById("project-lang-toggle");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "project-lang-toggle";
    bar.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px;";
    bar.innerHTML = `
      <button id="project-lang-fr" class="btn btn-ghost btn-mini" type="button">FR</button>
      <button id="project-lang-en" class="btn btn-ghost btn-mini" type="button">EN</button>
    `;
    const host = root.querySelector(".workspace-utility");
    if (host) host.insertBefore(bar, host.firstChild);

    bar.querySelector("#project-lang-fr")?.addEventListener("click", () => {
      try { localStorage.setItem("ho_lang", "fr"); } catch {}
      applyProjectScreenCopy();
      if (typeof applySessionScreenCopy === "function") applySessionScreenCopy();
      if (typeof applyLoginScreenCopy === "function") applyLoginScreenCopy();
      if (typeof applyPermissionsScreenCopy === "function") applyPermissionsScreenCopy();
    });

    bar.querySelector("#project-lang-en")?.addEventListener("click", () => {
      try { localStorage.setItem("ho_lang", "en"); } catch {}
      applyProjectScreenCopy();
      if (typeof applySessionScreenCopy === "function") applySessionScreenCopy();
      if (typeof applyLoginScreenCopy === "function") applyLoginScreenCopy();
      if (typeof applyPermissionsScreenCopy === "function") applyPermissionsScreenCopy();
    });
  }

  const fr = document.getElementById("project-lang-fr");
  const en = document.getElementById("project-lang-en");
  const lang = hoUiLang();

  if (fr) {
    fr.style.opacity = lang == "fr" ? "1" : "0.65";
    fr.style.fontWeight = lang == "fr" ? "800" : "700";
  }
  if (en) {
    en.style.opacity = lang == "en" ? "1" : "0.65";
    en.style.fontWeight = lang == "en" ? "800" : "700";
  }
}

function applyProjectScreenCopy() {
  const projectRoot = $("project-section");
  const appRoot = $("app-screen");
  if (!projectRoot || !appRoot) return;

  ensureProjectLangToggle();

  const workspaceKicker = appRoot.querySelector(".workspace-hero .ritual-kicker");
  if (workspaceKicker) workspaceKicker.innerText = "HumanOrigin Workspace";

  const workspaceTitle = appRoot.querySelector(".workspace-title");
  if (workspaceTitle) workspaceTitle.innerText = hoPerm(
    "Un espace de preuve humaine",
    "A human certification workspace"
  );

  const workspaceSub = appRoot.querySelector(".workspace-sub");
  if (workspaceSub) workspaceSub.innerText = hoPerm(
    "Ici, le travail humain ne se contente pas d’être produit : il est mesuré, certifié, puis préparé pour circuler comme une preuve lisible, signée et liée à un document précis.",
    "Here, human work is not simply produced: it is measured, certified, then prepared to circulate as readable proof, signed and linked to a specific document."
  );

  const updateBtn = $("check-update-btn");
  if (updateBtn) updateBtn.innerText = hoPerm("⬆️ Mise à jour", "⬆️ Update");

  const changeBtn = $("change-project-btn");
  if (changeBtn) changeBtn.innerText = hoPerm("Changer", "Change");

  const logoutBtn = $("logout-btn");
  if (logoutBtn) logoutBtn.innerText = hoPerm("Sortir", "Sign out");

  const projectLineLabel = appRoot.querySelector(".workspace-project-label");
  if (projectLineLabel) projectLineLabel.innerText = hoPerm("Projet actif", "Active project");

  const currentTitle = $("current-project-title");
  if (currentTitle) {
    const t = (currentTitle.innerText || "").trim();
    if (t === "Projet" || t === "Que voulez-vous certifier ?" || t === "Project" || t === "Project selection") {
      currentTitle.innerText = hoPerm("Que voulez-vous certifier ?", "Project selection");
    }
  }

  const kicker = projectRoot.querySelector(".ritual-kicker");
  if (kicker) kicker.innerText = hoPerm("Projet", "Project");

  const title = projectRoot.querySelector(".section-title");
  if (title) title.innerText = hoPerm(
    "Choisissez votre projet",
    "Open a working folder"
  );

  const lead = projectRoot.querySelector(".section-lead");
  if (lead) lead.innerText = hoPerm(
    "Reprenez un projet existant ou créez un nouvel espace de travail.",
    "Each project becomes a structured space for your certified sessions, drafts, history, and final export."
  );

  const labels = projectRoot.querySelectorAll(".project-picker-label");
  if (labels[0]) labels[0].innerText = hoPerm("Projet existant", "Existing project");
  if (labels[1]) labels[1].innerText = hoPerm("Nouveau projet", "New project");

  const notes = projectRoot.querySelectorAll(".project-picker-note");
  if (notes[0]) notes[0].innerText = hoPerm(
    "Rouvrez un projet déjà lié à une trajectoire de travail et à un historique certifié.",
    "Reopen a project already linked to a work trajectory and certified history."
  );
  if (notes[1]) notes[1].innerText = hoPerm(
    "Créez un nouveau cadre de travail quand vous commencez une nouvelle œuvre, étude, ou série de documents.",
    "Create a new workspace when you begin a new work, study, or document series."
  );

  const input = $("project-name");
  if (input) input.placeholder = hoPerm(
    "Nom du nouveau projet...",
    "Name of the new project..."
  );

  const btn = $("init-btn");
  if (btn) btn.innerText = hoPerm("Continuer avec ce projet", "Load");

  const sel = $("project-selector");
  if (sel) {
    const first = sel.querySelector('option[value=""]');
    if (first) first.innerText = hoPerm("Choisir un projet...", "Choose a project...");
  }
}

function applySessionScreenCopy() {
  const root = $("controls-section");
  if (!root) return;

  ensureProjectLangToggle();

  const kickers = root.querySelectorAll(".ritual-kicker");
  if (kickers[0]) kickers[0].innerText = hoPerm("Session", "Session");
  if (kickers[1]) kickers[1].innerText = hoPerm("Repère", "Reference");
  if (kickers[2]) kickers[2].innerText = hoPerm("Historique", "History");

  const titles = root.querySelectorAll(".section-title");
  if (titles[0]) titles[0].innerText = hoPerm(
    "Prêt à travailler",
    "Measure a real moment of human work"
  );
  if (titles[1]) titles[1].innerText = hoPerm(
    "Ce que HumanOrigin rend visible",
    "What HumanOrigin makes visible"
  );

  const leads = root.querySelectorAll(".section-lead");
  if (leads[0]) leads[0].innerText = hoPerm(
    "Associez votre document, lancez HumanOrigin, travaillez normalement, puis terminez pour préparer votre dossier vérifiable.",
    "Attach your document, start the HumanOrigin recording, work normally, then stop to generate proof linked to this file version."
  );

  const statLabels = root.querySelectorAll(".stat-lbl");
  if (statLabels[0]) statLabels[0].innerText = hoPerm("Frappes", "Keystrokes");
  if (statLabels[1]) statLabels[1].innerText = hoPerm("Clics", "Clicks");

  const startBtn = $("start-btn");
  if (startBtn) startBtn.innerText = hoPerm("Lancer HumanOrigin", "Start Recording");

  const stopBtn = $("stop-btn");
  if (stopBtn) stopBtn.innerText = hoPerm("Terminer ce moment de travail", "Stop Recording");

  const finalizeBtn = $("finalize-btn");
  if (finalizeBtn) {
    const t = (finalizeBtn.innerText || "").trim();
    if (
      t === "Certifier la Session" ||
      t === "Valider ce moment de travail" ||
      t === "Certify Session" ||
      t === "Certify session"
    ) {
      finalizeBtn.innerText = hoPerm("Valider ce moment de travail", "Certify session");
    }
  }

  const sideItems = root.querySelectorAll(".session-side-list li");
  if (sideItems[0]) sideItems[0].innerText = hoPerm(
    "HumanOrigin ne lit pas votre document : il associe votre travail à une version précise du fichier.",
    "HumanOrigin does not read your document like an AI detector: it measures a human work process."
  );
  if (sideItems[1]) sideItems[1].innerText = hoPerm(
    "Un fichier de vérification sera associé à cette version du document.",
    "Proof that will be linked to a specific version of the document during final certification."
  );
  if (sideItems[2]) sideItems[2].innerText = hoPerm(
    "Un dossier final sera préparé avec le PDF lisible et le fichier de vérification.",
    "A final package that is readable, signed, and ready to send with the published document and portable proof."
  );

  const draftText = root.querySelector(".draft-banner-premium span[style*='font-size: 13px']");
  if (draftText) draftText.innerText = hoPerm(
    "Un travail interrompu peut être repris",
    "Unsaved session found"
  );

  const recoverBtn = $("btn-recover-draft");
  if (recoverBtn) recoverBtn.innerText = hoPerm("Restaurer", "Restore");

  const histTitle = root.querySelector(".history-head-left h3");
  if (histTitle) histTitle.innerText = hoPerm("Travaux enregistrés", "Certified history");

  const histLead = root.querySelector(".history-head-left p");
  if (histLead) histLead.innerText = hoPerm(
    "Retrouvez ici les moments de travail enregistrés pour ce projet, puis préparez le dossier final à envoyer.",
    "Find here the sessions already certified for this project, as well as access to the final export when available."
  );

  const syncBtn = $("sync-btn");
  if (syncBtn) syncBtn.innerText = hoPerm("🔄", "🔄");

  const finalBtn = $("close-project-btn");
  if (finalBtn) finalBtn.innerText = hoPerm("📜 Créer le package final", "📜 Final Certificate");

  const ths = root.querySelectorAll(".history-table thead th");
  if (ths[0]) ths[0].innerText = hoPerm("Moment", "Date/Time");
  if (ths[1]) ths[1].innerText = hoPerm("État", "Status");
  if (ths[2]) ths[2].innerText = hoPerm("Détails techniques", "Proof (Hash)");
}

function ensureLoginLangToggle() {
  const root = $("login-screen");
  if (!root) return;

  let bar = document.getElementById("login-lang-toggle");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "login-lang-toggle";
    bar.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px;";
    bar.innerHTML = `
      <button id="login-lang-fr" class="btn btn-ghost btn-mini" type="button">FR</button>
      <button id="login-lang-en" class="btn btn-ghost btn-mini" type="button">EN</button>
    `;
    const card = root.querySelector(".glass-card");
    if (card) card.insertBefore(bar, card.firstChild);

    bar.querySelector("#login-lang-fr")?.addEventListener("click", () => {
      try { localStorage.setItem("ho_lang", "fr"); } catch {}
      applyLoginScreenCopy();
      if (typeof applyPermissionsScreenCopy === "function") applyPermissionsScreenCopy();
    });

    bar.querySelector("#login-lang-en")?.addEventListener("click", () => {
      try { localStorage.setItem("ho_lang", "en"); } catch {}
      applyLoginScreenCopy();
      if (typeof applyPermissionsScreenCopy === "function") applyPermissionsScreenCopy();
    });
  }

  const fr = document.getElementById("login-lang-fr");
  const en = document.getElementById("login-lang-en");
  const lang = hoUiLang();

  if (fr) {
    fr.style.opacity = lang == "fr" ? "1" : "0.65";
    fr.style.fontWeight = lang == "fr" ? "800" : "700";
  }
  if (en) {
    en.style.opacity = lang == "en" ? "1" : "0.65";
    en.style.fontWeight = lang == "en" ? "800" : "700";
  }
}

function applyLoginScreenCopy() {
  const root = $("login-screen");
  if (!root) return;

  ensureLoginLangToggle();

  const title = root.querySelector(".brand-title");
  if (title) title.innerText = hoPerm(
    "Accédez à votre espace HumanOrigin",
    "Access your HumanOrigin workspace"
  );

  const sub = root.querySelector(".brand-sub");
  if (sub) sub.innerText = hoPerm(
    "Un espace sécurisé pour reprendre vos projets, certifier vos sessions et préparer une preuve liée à un document précis.",
    "A secure space to resume your projects, certify your sessions, and prepare proof linked to a specific document."
  );

  const email = $("email");
  if (email) email.placeholder = hoPerm("votre@email.com", "your@email.com");

  const btn = $("login-btn");
  if (btn) btn.innerText = hoPerm("Recevoir mon lien", "Send my link");
}

function ensurePermissionsLangToggle() {
  const root = $("permissions-screen");
  if (!root) return;

  let bar = document.getElementById("perm-lang-toggle");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "perm-lang-toggle";
    bar.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-bottom:14px;";
    bar.innerHTML = `
      <button id="perm-lang-fr" class="btn btn-ghost btn-mini" type="button">FR</button>
      <button id="perm-lang-en" class="btn btn-ghost btn-mini" type="button">EN</button>
    `;
    const card = root.querySelector(".glass-card");
    if (card) card.insertBefore(bar, card.firstChild);

    bar.querySelector("#perm-lang-fr")?.addEventListener("click", () => {
      try { localStorage.setItem("ho_lang", "fr"); } catch {}
      applyPermissionsScreenCopy();
    });

    bar.querySelector("#perm-lang-en")?.addEventListener("click", () => {
      try { localStorage.setItem("ho_lang", "en"); } catch {}
      applyPermissionsScreenCopy();
    });
  }

  const fr = document.getElementById("perm-lang-fr");
  const en = document.getElementById("perm-lang-en");
  const lang = hoUiLang();

  if (fr) {
    fr.style.opacity = lang == "fr" ? "1" : "0.65";
    fr.style.fontWeight = lang == "fr" ? "800" : "700";
  }
  if (en) {
    en.style.opacity = lang == "en" ? "1" : "0.65";
    en.style.fontWeight = lang == "en" ? "800" : "700";
  }
}

function applyPermissionsScreenCopy() {
  const root = $("permissions-screen");
  if (!root) return;
  ensurePermissionsLangToggle();

  const kicker = root.querySelector(".ritual-kicker");
  if (kicker) kicker.innerText = "HumanOrigin";

  const title = root.querySelector(".brand-title");
  if (title) title.innerText = hoPerm(
    "Activer le protocole de preuve",
    "Enable the proof protocol"
  );

  const sub = root.querySelector(".brand-sub");
  if (sub) sub.innerText = hoPerm(
    "HumanOrigin a besoin de deux autorisations macOS — Accessibilité et Surveillance de l’entrée — pour mesurer correctement une session humaine.",
    "HumanOrigin needs two macOS permissions — Accessibility and Input Monitoring — to measure a human session correctly."
  );

  const note = root.querySelector(".ritual-note");
  if (note) note.innerText = hoPerm(
    "Cette étape ne sert pas à configurer une simple app. Elle ouvre l’accès au protocole de mesure. Les deux autorisations sont nécessaires pour que l’enregistrement fonctionne réellement.",
    "This step is not simple app setup. It unlocks the measurement protocol. Both permissions are required for recording to work properly."
  );

  const warn = $("perm-warn-input");
  if (warn) {
    warn.innerHTML = hoPerm(
      '⚠️ <strong>Attention :</strong> Aucune frappe détectée. Vérifiez aussi "Surveillance de l\'entrée".',
      '⚠️ <strong>Warning:</strong> No keystrokes detected. Also check "Input Monitoring".'
    );
  }

  const btn1 = $("perm-open-accessibility");
  if (btn1) btn1.innerText = hoPerm("1. Ouvrir Accessibilité", "1. Open Accessibility");

  const btn2 = $("perm-open-input");
  if (btn2) btn2.innerText = hoPerm("2. Ouvrir Surveillance Entrée", "2. Open Input Monitoring");

  const btn3 = $("perm-recheck");
  if (btn3) btn3.innerText = hoPerm("C'est fait, vérifier ✅", "Done, verify ✅");

  const foot = root.querySelector('p[style*="font-size: 11px"]');
  if (foot) foot.innerText = hoPerm(
    "Une fois coché, il faut parfois redémarrer l'application.",
    "Once enabled, you may need to restart the application."
  );
}

async function refreshPermissionsStateAndMaybeContinue(autoAdvance = false) {
  hoBootMark("permissions:refresh:start");
  const accessOk = await invoke("is_accessibility_trusted").catch(() => false);
  const input = await getInputPermissionEvidence();

  updatePermissionBadge(!!accessOk, !!input.granted);

  if (accessOk && input.granted) {
    setPermissionsHint(hoPerm("Les deux autorisations sont détectées. HumanOrigin peut maintenant mesurer correctement la session.", "Both permissions are detected. HumanOrigin can now measure the session correctly."));
    if (autoAdvance) {
      await continueAfterPermissions();
    }
    return true;
  }

  if (accessOk && !input.granted) {
    setPermissionsHint(hoPerm("Accessibilité est active, mais Surveillance de l’entrée manque encore. Activez-la, puis appuyez sur une touche et relancez la vérification.", "Accessibility is active, but Input Monitoring is still missing. Enable it, then press a key and run the check again."));
    return false;
  }

  if (!accessOk && input.granted) {
    setPermissionsHint(hoPerm("Surveillance de l’entrée semble active, mais Accessibilité manque encore. Activez aussi Accessibilité.", "Input Monitoring appears active, but Accessibility is still missing. Enable Accessibility as well."));
    return false;
  }

  setPermissionsHint(hoPerm("Activez les deux autorisations macOS : Accessibilité et Surveillance de l’entrée.", "Enable both macOS permissions: Accessibility and Input Monitoring."));
  return false;
}

async function startInputWatchdog() {
  try {
    if (inputWatchdogTimer) clearInterval(inputWatchdogTimer);
  } catch {}
  inputWatchdogTimer = null;

  lastInputTs = 0;
  inputTsStableCount = 0;

  inputWatchdogTimer = setInterval(async () => {
    try {
      const accessOk = !!(await invoke("is_accessibility_trusted").catch(() => false));
      const input = await getInputPermissionEvidence();

      if (input.ts <= 0 || input.ts === lastInputTs) {
        inputTsStableCount += 1;
      } else {
        inputTsStableCount = 0;
      }
      lastInputTs = input.ts || 0;

      updatePermissionBadge(accessOk, input.granted);

      hoBootMark("watchdog:tick");
      if (accessOk && input.granted) {
        await continueAfterPermissions();
        return;
      }

      const warn = $("perm-warn-input");
      if (warn && accessOk && !input.granted && inputTsStableCount >= 2) {
        warn.style.display = "block";
      }
    } catch {}
  }, 1200);
}

async function showPermissionsWall() {
  showScreen("PERMISSIONS");
  applyPermissionsScreenCopy();

  on("perm-open-accessibility", () => openMacSettings("accessibility"));
  on("perm-open-input", () => openMacSettings("input"));

  on("perm-recheck", async () => {
    toast(hoPerm("Vérification…", "Checking…"));

    const fullyReady = await refreshPermissionsStateAndMaybeContinue(false);
    const accessOk = await invoke("is_accessibility_trusted").catch(() => false);

    hoBootMark("permissions:recheck:fullyReady");
    if (fullyReady) {
      await continueAfterPermissions();
      return;
    }

    if (accessOk) {
      toast(hoPerm("Accès partiel détecté — il manque encore la surveillance de l’entrée.", "Partial access detected — Input Monitoring is still missing."));
      await startInputWatchdog();
      return;
    }

    toast(hoPerm("Accessibilité manquante — impossible d’ouvrir l’app.", "Accessibility missing — the app cannot be opened."));
  });

  await refreshPermissionsStateAndMaybeContinue(false);
  await startInputWatchdog();
}

async function ensurePermissionsBeforeApp() {
  hoBootMark("permcheck:start");
  const accessOk = await isMacPermissionsOk();
  hoBootMark("permcheck:afterIsMacPermissionsOk:" + String(accessOk));
  if (!accessOk) {
    hoBootMark("permcheck:beforeShowPermissionsWall");
    await showPermissionsWall();
    hoBootMark("permcheck:afterShowPermissionsWall");
    return false;
  }
  hoBootMark("permcheck:returnTrue");
  return true;
}

// =========================================================
// TUTORIEL / ONBOARDING (bypass)
// =========================================================
function setTutoStep(step) {
  const steps = [1, 2, 3];
  steps.forEach((i) => {
    const el = $("tuto-step-" + i);
    if (!el) return;
    el.classList.toggle("active", i === step);
  });
}

window.nextTuto = function (step) {
  setTutoStep(Number(step) || 1);
};

window.finishTuto = function () {
  try {
    localStorage.setItem("has_seen_tuto_v1", "true");
  } catch {}
  forcePostLogin().catch(() => showScreen("LOGIN"));
};

function checkAndShowTuto() {
  try {
    localStorage.setItem("has_seen_tuto_v1", "true");
  } catch {}
  return false;
}

// =========================================================
// AUTH
// =========================================================
async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) {
    showScreen("LOGIN");
  }
}

async function handleLogout() {
  if (isScanningUI) {
    if (!confirm("Un enregistrement HumanOrigin est en cours. Se déconnecter l’arrêtera. Continuer ?")) return;
    await stopScan().catch(() => {});
  }

  bumpEpoch();
  resetAllStateToLogin();

  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn("Logout server ignored", e);
  }
}

async function continueAfterPermissions() {
  if (__permissionsContinueInFlight) return;
  __permissionsContinueInFlight = true;
  try {
    stopPermissionTimers();
    hoBootMark("postlogin:getSession");
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      await forcePostLogin(true).catch(() => showScreen("LOGIN"));
    } else {
      showScreen("LOGIN");
    }
  } finally {
    setTimeout(() => {
      __permissionsContinueInFlight = false;
    }, 1200);
  }
}

// =========================================================
// POST-LOGIN ROUTING
// =========================================================
async function forcePostLogin(skipPermissionsCheck = false) {
  hoBootMark("postlogin:start");
  const myEpoch = uiEpoch;

  try {
    if (__pendingDeepLinkUrl && !__deepLinkHandling) {
      const u = __pendingDeepLinkUrl;
      __pendingDeepLinkUrl = null;
      await handleIncomingDeepLink(u);
      return;
    }

    if (!skipPermissionsCheck) {
    const permOk = await ensurePermissionsBeforeApp();
    if (!permOk) return;
  }

    hoBootMark("postlogin:beforeGetSession");
    let data;
    try {
      ({ data } = await hoGetSessionSafe());
      hoBootMark("postlogin:afterGetSession");
    } catch (e) {
      console.warn("getSession failed in forcePostLogin", e);
      hoBootMark("postlogin:getSessionFailed");
      showScreen("LOGIN");
      return;
    }
    if (epochIsStale(myEpoch)) return;

    hoBootMark("postlogin:afterSession");
    if (!data?.session) {
      showScreen("LOGIN");
      return;
    }

    currentUser = data.session.user;
    safeText("user-email-display", currentUser?.email || "");

    if (checkAndShowTuto()) return;

    hoBootMark("postlogin:beforeShow");
    if (currentProjectName) showScreen("DASHBOARD");
    else showScreen("PROJECT_SELECT");
    hoBootMark("postlogin:afterShow");

    hoBootMark("postlogin:beforeLoadProjects");
    await loadProjectList().catch(() => {});
    hoBootMark("postlogin:afterLoadProjects");
    if (epochIsStale(myEpoch)) return;

    hoBootMark("postlogin:beforeRefreshHistory");
    refreshHistory().catch(() => {});
    hoBootMark("postlogin:afterRefreshHistory");
    // checkForDrafts(true).catch(() => {}); // temp stability test
  } catch (e) {
    console.warn("forcePostLogin failed", e);
    hoBootMark("postlogin:error");
  }
}

// =========================================================
// DEEP LINK HANDLING (robuste)
// =========================================================
function parseUrlParamsFromFragmentOrQuery(urlStr) {
  try {
    const u = new URL(urlStr);
    const frag = (u.hash || "").replace(/^#/, "");
    if (frag) return new URLSearchParams(frag);

    const q = u.search || "";
    if (q) return new URLSearchParams(q.replace(/^\?/, ""));

    return new URLSearchParams();
  } catch {
    const parts = String(urlStr || "").split("#");
    if (parts[1]) return new URLSearchParams(parts[1]);

    const qparts = String(urlStr || "").split("?");
    if (qparts[1]) return new URLSearchParams(qparts[1]);

    return new URLSearchParams();
  }
}

async function handleIncomingDeepLink(urlStr) {
  if (!urlStr) return;
  if (__deepLinkHandling) return;

  __deepLinkHandling = true;

  try {
    console.log("DeepLink reçu:", urlStr);

    const p = parseUrlParamsFromFragmentOrQuery(urlStr);
    const access_token = p.get("access_token");
    const refresh_token = p.get("refresh_token");
    const code = p.get("code");
    const token_hash = p.get("token_hash");
    const type = p.get("type") || "email";

    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      toast("Connexion OK ✅");
      await forcePostLogin();
      return;
    }

    if (code && typeof supabase.auth.exchangeCodeForSession === "function") {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      toast("Connexion OK ✅");
      await forcePostLogin();
      return;
    }

    if (token_hash && typeof supabase.auth.verifyOtp === "function") {
      const { error } = await supabase.auth.verifyOtp({ token_hash, type });
      if (error) throw error;
      toast("Connexion OK ✅");
      await forcePostLogin();
      return;
    }

    console.warn("DeepLink sans token/code/token_hash:", urlStr);
  } catch (e) {
    console.warn("DeepLink auth fail:", e);
    alert("Erreur connexion : " + (e?.message || e));
  } finally {
    __deepLinkHandling = false;
  }
}

function __rememberDeepLink(url) {
  if (!url) return;
  __pendingDeepLinkUrl = String(url);
  console.log("[DEEPLINK] buffered =", __pendingDeepLinkUrl);
}

async function setupDeepLinkListeners() {
  if (__deepLinkListenersReady) return;
  __deepLinkListenersReady = true;

  const handler = async (ev) => {
    try {
      const payload = ev?.payload;

      if (Array.isArray(payload) && payload.length) {
        const u = String(payload[0]);
        __rememberDeepLink(u);
        await handleIncomingDeepLink(u);
        return;
      }

      if (typeof payload === "string") {
        __rememberDeepLink(payload);
        await handleIncomingDeepLink(payload);
        return;
      }

      if (payload && typeof payload === "object") {
        const u = payload.url || (Array.isArray(payload.urls) ? payload.urls[0] : null);
        if (u) {
          __rememberDeepLink(String(u));
          await handleIncomingDeepLink(String(u));
        }
      }
    } catch (e) {
      console.warn("DeepLink handler error", e);
    }
  };

  await listen("tauri://open-url", handler).catch(() => {});
  await listen("scheme-request", handler).catch(() => {});
  await listen("scheme-request-received", handler).catch(() => {});
  await listen("deep-link://open-url", handler).catch(() => {});

  try {
    const pending = await invoke("take_pending_deep_link");
    if (pending) {
      console.log("[DEEPLINK] pending from Rust =", pending);
      await handler({ payload: pending });
    }
  } catch (e) {
    console.warn("[DEEPLINK] take_pending_deep_link failed", e);
  }
}

// =========================================================
// PROJECTS
// =========================================================
async function loadProjectList() {
  hoBootMark("projects:load:start");
  try {
    const projects = await invoke("get_projects");
    const sel = $("project-selector");
    if (!sel) return;

    sel.innerHTML = '<option value="" disabled selected>Choisir un projet...</option>';

    hoBootMark("projects:load:gotList");
    (projects || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.innerText = p;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error("Load Projects Error", e);
  }
}

async function ensureProjectIdByName(name, timeoutMs = 3000) {
  if (!currentUser?.id || !name) return null;

  const fetchCloudId = async () => {
    try {
      const { data, error } = await supabase
        .from("ho_projects")
        .upsert(
          {
            user_id: currentUser.id,
            name,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,name" }
        )
        .select("id")
        .single();

      if (!error && data?.id) return data.id;

      const { data: retry } = await supabase
        .from("ho_projects")
        .select("id")
        .eq("name", name)
        .eq("user_id", currentUser.id)
        .single();

      return retry?.id || null;
    } catch (e) {
      console.warn("ensureProjectIdByName failed", e);
      return null;
    }
  };

  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([fetchCloudId(), timeoutPromise]);
}
function notifyDeferredLocalMode() {
  toast("Mode local actif — synchronisation cloud différée");
}

async function syncCurrentSessionToCloud(projectId, status = "RUNNING", snap = null) {
  if (!projectId || !currentSessionId || !currentUser?.id) return;

  const payload = {
    id: currentSessionId,
    user_id: currentUser.id,
    project_id: projectId,
    started_at: currentSessionStartedAt || new Date().toISOString(),
    status,
  };

  if (status !== "RUNNING") {
    payload.ended_at = new Date().toISOString();
    payload.active_ms = snap?.active_ms ?? 0;
    payload.events_count = snap?.events_count ?? 0;
    payload.scp_score = snap?.scp_score ?? 0;
    payload.evidence_score = snap?.evidence_score ?? 0;
    payload.diag = snap?.diag || {};
  }

  const { error } = await supabase.from("ho_sessions").upsert(payload);
  if (error) console.warn(`Cloud ${status} sync error`, error);
}

function retryProjectCloudBindingSilently(projectName, sessionIdRef = null, delayMs = 1800) {
  setTimeout(async () => {
    try {
      if (!currentUser?.id || !projectName) return;

      const id = await ensureProjectIdByName(projectName, 5000);
      if (!id) return;

      if (currentProjectName === projectName) {
        currentProjectId = id;
      }

      if (sessionIdRef && currentSessionId === sessionIdRef) {
        if (isScanningUI) {
          await syncCurrentSessionToCloud(id, "RUNNING");
        } else if (lastSnapshot) {
          await syncCurrentSessionToCloud(id, "STOPPED", lastSnapshot);
        }
      }

      refreshHistory().catch(() => {});
      console.log("Cloud sync restored for project:", projectName, id);
    } catch (e) {
      console.warn("Silent cloud retry failed", e);
    }
  }, delayMs);
}
async function initProject() {
  const nameInp = $("project-name");
  const sel = $("project-selector");
  const name = (nameInp?.value || "").trim() || (sel?.value || "");

  if (!name) {
    alert("Veuillez entrer ou choisir un nom de projet.");
    return;
  }

  const btn = $("init-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Chargement...";
  }

  try {
    await invoke("initialize_project", { projectName: name });
    currentProjectPath = await invoke("activate_project", { projectName: name });
    currentProjectName = name;
    currentProjectId = await ensureProjectIdByName(name);

    showScreen("DASHBOARD");
    updateDashboardUI("READY");
    toast("Projet prêt ✅");

    refreshHistory().catch(() => {});
    checkForDrafts(true).catch(() => {});
  } catch (e) {
    alert("Erreur chargement : " + e);
    showScreen("PROJECT_SELECT");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "Continuer avec ce projet";
    }
  }
}

async function quickActivateProjectByName(name) {
  try {
    await invoke("initialize_project", { projectName: name });
    currentProjectPath = await invoke("activate_project", { projectName: name });
    currentProjectName = name;

    showScreen("DASHBOARD");
    updateDashboardUI("READY");

    ensureProjectIdByName(name).then((id) => {
      currentProjectId = id;
      refreshHistory().catch(() => {});
      checkForDrafts(true).catch(() => {});
    });
  } catch (e) {
    alert("Erreur activation : " + e);
  }
}

async function changeProject() {
  if (isScanningUI) {
    if (!confirm("Un enregistrement HumanOrigin est en cours. L’arrêter pour changer de projet ?")) return;
    await stopScan().catch(() => {});
  }

  resetProjectStateOnly();
  updateDashboardUI("READY");
  showScreen("PROJECT_SELECT");
  refreshHistory().catch(() => {});
  checkForDrafts(true).catch(() => {});
}

// =========================================================
// SCAN
// =========================================================


async function stopScan() {
  isScanningUI = false;

  try {
    if (scanInterval) clearInterval(scanInterval);
  } catch {}
  scanInterval = null;

  try {
    const snap = await invoke("stop_scan", { paste: pasteStats });
    lastSnapshot = snap;

    updateDashboardUI("STOPPED");
    toast("Enregistrement arrêté. Brouillon enregistré.");

    const gatePassed = snap?.diag?.analysis?.gate_passed;
    const finBtn = $("finalize-btn");
    if (finBtn) {
      finBtn.disabled = false;
      finBtn.innerText = "Valider ce moment de travail";
      if (!gatePassed) toast("Volume insuffisant : certification TEMPORAIRE possible.");
    }

    if (!currentProjectId && currentProjectName) {
      currentProjectId = await ensureProjectIdByName(currentProjectName, 1200);
    }

    if (currentProjectId && currentUser?.id) {
      await syncCurrentSessionToCloud(currentProjectId, "STOPPED", snap);
    } else if (currentProjectName) {
      retryProjectCloudBindingSilently(currentProjectName, currentSessionId);
    }

    await checkForDrafts(true);
  } catch (e) {
    updateDashboardUI("READY");
    alert("Erreur arrêt enregistrement : " + e);
  } finally {
    resetPasteStats();
  }
}
function updateDashboardUI(state) {
  try { document.body.setAttribute("data-scan-state", state); } catch {}
  const startBtn = $("start-btn");
  const stopBtn = $("stop-btn");
  const finBtn = $("finalize-btn");
  const live = $("live-dashboard");

  if (startBtn) startBtn.classList.add("hidden");
  if (stopBtn) stopBtn.classList.add("hidden");
  if (finBtn) finBtn.classList.add("hidden");

  if (live) live.style.display = "none";

  if (finBtn && state !== "STOPPED") {
    finBtn.disabled = true;
    finBtn.innerText = "Valider ce moment de travail";
  }

  if (state === "READY") {
    if (startBtn) startBtn.classList.remove("hidden");
    safeText("timer", "00:00");
    safeText("keystrokes-display", "0");
    safeText("clicks-display", "0");
  } else if (state === "SCANNING") {
    if (stopBtn) stopBtn.classList.remove("hidden");
    if (live) live.style.display = "block";
  } else if (state === "STOPPED") {
    if (startBtn) startBtn.classList.remove("hidden");
    if (finBtn) {
      finBtn.classList.remove("hidden");
      finBtn.disabled = false;
      if (finBtn.innerText === "Travail enregistré ✅") finBtn.innerText = "Valider ce moment de travail";
    }
  }
}

// =========================================================
// CERTIFICATION (TRAVAIL) — BROUILLON always possible
// =========================================================
async function finalizeSession() {
  if (!currentSessionId) {
    alert("Aucune session.");
    return;
  }

  const gatePassed = lastSnapshot?.diag?.analysis?.gate_passed;
  const scpNow = lastSnapshot?.scp_score ?? lastSnapshot?.diag?.analysis?.score ?? 0;
  const isTemporary = gatePassed === false || scpNow <= 0;

  if (isTemporary) {
    const ok = confirm("Volume insuffisant.\nCertifier en TEMPORAIRE quand même ?");
    if (!ok) return;
  }

  const btn = $("finalize-btn");
  let success = false;

  if (btn) {
    btn.disabled = true;
    btn.innerText = "Signature…";
  }

  const withTimeout = (promise, ms = 3500) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);

  try {
    if (!currentProjectId && currentProjectName) {
      currentProjectId = await ensureProjectIdByName(currentProjectName, 1200);
    }

    const certData = {
      protocol: "ho3.cert.v1",
      meta: {
        user: currentUser?.id || null,
        project: currentProjectId || null,
        session: currentSessionId,
        date: new Date().toISOString(),
        status: isTemporary ? "TEMPORARY" : "FINAL",
        mode: "desktop-local-first",
      },
      scores: { scp: scpNow },
    };

    const payloadStr = JSON.stringify(certData);
    const payloadHash = await sha256Hex(payloadStr);
    const devSig = await invoke("sign_payload_hash", { payloadHash });

    let certId = crypto.randomUUID();
    let cloudOk = false;

    if (currentProjectId && currentUser?.id) {
      let remoteCertId = null;

      try {
        const edgeRes = await withTimeout(
          supabase.functions.invoke("sign-cert", {
            body: {
              cert_unsigned: certData,
              payload_hash: payloadHash,
              device_signature: JSON.stringify(devSig),
            },
          }),
          3500
        );

        const { data, error } = edgeRes || {};
        if (!error && data?.cert_id) {
          remoteCertId = data.cert_id;
        }
      } catch (edgeErr) {
        console.warn("sign-cert edge failed, local-first continues", edgeErr);
      }

      if (!remoteCertId) {
        try {
          await withTimeout(
            supabase.from("ho_certificates").insert({
              id: certId,
              user_id: currentUser.id,
              project_id: currentProjectId,
              session_id: currentSessionId,
              issued_at: new Date().toISOString(),
              payload_hash: payloadHash,
              authority_signature: "local-bypass",
              cert_json: certData,
            }),
            3000
          );

          remoteCertId = certId;
        } catch (fallbackErr) {
          console.warn("Cloud certificate insert failed, local-first continues", fallbackErr);
        }
      }

      if (remoteCertId) {
        certId = remoteCertId;

        try {
          await withTimeout(
            supabase
              .from("ho_sessions")
              .update({
                status: isTemporary ? "CERTIFIED_TEMP" : "CERTIFIED",
                cert_id: certId,
                certified_at: new Date().toISOString(),
              })
              .eq("id", currentSessionId),
            3000
          );

          cloudOk = true;
        } catch (sessionUpdateErr) {
          console.warn("Cloud session update failed, local-first continues", sessionUpdateErr);
        }
      }
    }

    const sidToDelete = restoredDraftSessionId || currentSessionId;
    try {
      await invoke("delete_local_draft", { sessionId: sidToDelete });
    } catch {}

    restoredDraftSessionId = null;
    success = true;

    if (btn) {
      btn.innerText = cloudOk ? "Travail enregistré ✅" : "Travail enregistré ✅";
      btn.disabled = true;
    }

    if (cloudOk) {
      toast(isTemporary ? "Session BROUILLON certifiée ✅" : "Session certifiée ✅");
      await refreshHistory().catch(() => {});
    } else {
      toast(isTemporary ? "Session BROUILLON certifiée en local ✅" : "Session certifiée en local ✅");
      setTimeout(() => {
        toast("Mode local actif — synchronisation cloud différée");
      }, 900);
    }

    await checkForDrafts(true);
  } catch (e) {
    console.error("finalizeSession failed", e);
    alert("Erreur certification : " + (e?.message || e));
  } finally {
    if (!success && btn) {
      btn.innerText = "Valider ce moment de travail";
      btn.disabled = false;
    }
  }
}
async function startScan() {
  const permOk = await ensurePermissionsBeforeApp();
  if (!permOk) return;

  if (!currentProjectName) {
    alert("Projet non chargé.");
    return;
  }

  if (isScanningUI) return;

  if (!currentProjectId) {
    currentProjectId = await ensureProjectIdByName(currentProjectName, 1200);
  }

  currentSessionId = crypto.randomUUID();
  currentSessionStartedAt = new Date().toISOString();
  restoredDraftSessionId = null;
  lastSnapshot = null;
  resetPasteStats();

  try {
    await invoke("start_scan", { sessionId: currentSessionId });

    isScanningUI = true;
    updateDashboardUI("SCANNING");

    scanInterval = setInterval(async () => {
      try {
        const s = await invoke("get_live_stats");
        if (s?.is_scanning) {
          safeText("timer", `${s.duration_sec ?? 0}s`);
          safeText("keystrokes-display", String(s.keystrokes ?? 0));
          safeText("clicks-display", String(s.clicks ?? 0));
        }
      } catch {}
    }, 1000);

    if (currentProjectId && currentUser?.id) {
      syncCurrentSessionToCloud(currentProjectId, "RUNNING").catch((error) => {
        console.warn("Cloud start error", error);
      });
    } else {
      notifyDeferredLocalMode();
      retryProjectCloudBindingSilently(currentProjectName, currentSessionId);
    }

    toast("Session active ✅");
  } catch (e) {
    isScanningUI = false;
    currentSessionId = null;
    currentSessionStartedAt = null;
    updateDashboardUI("READY");
    alert("Impossible de démarrer l’enregistrement HumanOrigin : " + e);
  }
}

// =========================================================
// HISTORIQUE — shows CERTIFIED + CERTIFIED_TEMP
// =========================================================
async function refreshHistory() {
  hoBootMark("history:refresh:start");
  const tbody = $("certs-tbody");
  if (!tbody) return;

  if (!currentProjectId) {
    if (!currentUser?.id) {
      tbody.innerHTML = `<tr><td colspan="3" style="color:#888;padding:15px">Connectez-vous</td></tr>`;
      return;
    }

    const { data: projects } = await supabase
      .from("ho_projects")
      .select("id,name,updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (!projects?.length) {
      tbody.innerHTML = `<tr><td colspan="3" style="color:#888;padding:15px">Aucun projet</td></tr>`;
      return;
    }

    const { data: stats } = await supabase
      .from("ho_sessions")
      .select("project_id")
      .eq("user_id", currentUser.id)
      .in("status", ["CERTIFIED", "CERTIFIED_TEMP"]);

    const counts = {};
    (stats || []).forEach((s) => {
      counts[s.project_id] = (counts[s.project_id] || 0) + 1;
    });

    tbody.innerHTML = projects
      .map((p) => {
        const n = counts[p.id] || 0;
        return `<tr data-proj="${esc(p.name)}" style="cursor:pointer">
          <td>${new Date(p.updated_at).toLocaleDateString()}</td>
          <td><span style="color:${n > 0 ? "#10b981" : "#888"};font-weight:bold">${n} certifs</span></td>
          <td>${esc(p.name)}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("tr[data-proj]").forEach((tr) => {
      tr.onclick = () => quickActivateProjectByName(tr.dataset.proj);
    });

    return;
  }

  const { data: sessions } = await supabase
    .from("ho_sessions")
    .select("certified_at, cert_id, scp_score, status")
    .eq("project_id", currentProjectId)
    .in("status", ["CERTIFIED", "CERTIFIED_TEMP"])
    .order("certified_at", { ascending: false })
    .limit(10);

  const closeBtn = $("close-project-btn");
  if (closeBtn) closeBtn.style.display = "block";

  if (!sessions?.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:#888;padding:15px">Aucune session certifiée</td></tr>`;
    return;
  }

  const certIds = sessions.map((s) => s.cert_id).filter(Boolean);
  const hashById = new Map();

  if (certIds.length) {
    const { data: certs } = await supabase
      .from("ho_certificates")
      .select("id,payload_hash")
      .in("id", certIds);

    (certs || []).forEach((c) => hashById.set(c.id, c.payload_hash || ""));
  }

  tbody.innerHTML = sessions
    .map((s) => {
      const time = s.certified_at ? new Date(s.certified_at).toLocaleTimeString() : "—";
      const scp = typeof s.scp_score === "number" ? Math.round(s.scp_score) : 0;
      const isTemp = s.status === "CERTIFIED_TEMP";
      const v = verdictFromScp(scp);
      const label = isTemp ? "BROUILLON" : v.label;
      const color = isTemp ? "#60a5fa" : v.color;
      const hash = s.cert_id ? hashById.get(s.cert_id) || "" : "";
      const proof = hash ? `${hash.substring(0, 8)}...` : "—";

      return `<tr>
        <td>${esc(time)}</td>
        <td><span style="color:${color};font-weight:900;">${esc(label)}</span></td>
        <td style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;">${esc(
          proof
        )}</td>
      </tr>`;
    })
    .join("");
}
function buildPublicationJob({
  sourcePdfPath,
  outputPdfPath,
  cartouchePngPath,
  certificateJsonPath,
  verifyTxtPath,
  certificateId,
  verifyUrl,
  verdict,
}) {
  return JSON.stringify(
    {
      job_version: "1.0",
      job_type: "pdf_publication",
      source_pdf_path: sourcePdfPath,
      output_pdf_path: outputPdfPath,
      cartouche_png_path: cartouchePngPath,
      certificate_json_path: certificateJsonPath,
      verify_txt_path: verifyTxtPath,
      certificate_id: certificateId,
      verify_url: verifyUrl,
      verdict,
      render: {
        mode: "premium_compact",
        pages: "all",
       first_page_scale: 1.28,
other_pages_scale: 1.12,
        anchor: "bottom_right",
        margin_pt: 24,
      },
    },
    null,
    2
  );
}

async function runPublisherSidecar({ jobPath, fallbackInput }) {
  const command = Command.sidecar("binaries/humanorigin-publisher", ["--job", jobPath]);
  const result = await command.execute();

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  console.log("[PUBLISHER] code =", result.code);
  console.log("[PUBLISHER] stdout =", stdout);
  console.log("[PUBLISHER] stderr =", stderr);

  if (result.code !== 0) {
    throw new Error(stderr || stdout || `Publisher exited with code ${result.code}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout || "{}");
  } catch (e) {
    throw new Error(`Publisher returned invalid JSON: ${stdout}`);
  }

  if (!parsed?.ok) {
    throw new Error(parsed?.message || "Publisher sidecar failed");
  }

  return parsed;
}

async function runConverterSidecar({ inputPath, outputDir }) {
  const command = Command.sidecar("binaries/humanorigin-converter", [
    "--input",
    inputPath,
    "--output-dir",
    outputDir,
  ]);

  const result = await command.execute();

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");

  console.log("[CONVERTER] code =", result.code);
  console.log("[CONVERTER] stdout =", stdout);
  console.log("[CONVERTER] stderr =", stderr);

  if (result.code !== 0) {
    throw new Error(stderr || stdout || `Converter exited with code ${result.code}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout || "{}");
  } catch (e) {
    throw new Error(`Converter returned invalid JSON: ${stdout}`);
  }

  if (!parsed?.ok) {
    throw new Error(parsed?.message || "Converter sidecar failed");
  }

  if (!parsed.intermediate_pdf_path) {
    throw new Error("Converter sidecar did not return intermediate_pdf_path");
  }

  return parsed;
}
// =========================================================
// FINAL PROJECT CERTIFICATE (HTML + HO-JSON + PUBLICATION KIT)
// =========================================================
async function exportFinalProjectCertificate() {
  if (!currentProjectPath) {
    alert("Projet non chargé.");
    return;
  }

  let __hoExportDebugPath = null;
  const __hoExportDebugLines = [];

  const __hoExportMark = async (stage, extra = "") => {
    const line = `[${new Date().toISOString()}] ${stage}${extra ? " — " + extra : ""}`;
    __hoExportDebugLines.push(line);
    console.log("[HO EXPORT DEBUG]", line);

    if (__hoExportDebugPath) {
      try {
        await writeTextFile(__hoExportDebugPath, __hoExportDebugLines.join("\n") + "\n");
      } catch (debugErr) {
        console.warn("[HO EXPORT DEBUG] write failed", debugErr);
      }
    }
  };

  await __hoExportMark("start", `projectPath=${currentProjectPath}`);

  const bind = await pickDocumentToBind();
  if (!bind) {
    alert("Sélection annulée. Aucun document certifié.");
    return;
  }

  toast("Génération du certificat final projet...");

  try {
    await __hoExportMark("before-finalize_project");
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });
    await __hoExportMark("after-finalize_project-raw", JSON.stringify(res || {}));
    console.log("[FINALIZE_PROJECT]", res);

    if (!res?.html_path) {
      alert("finalize_project n'a pas renvoyé de html_path");
      return;
    }

    const projectValid = Boolean(res?.project_valid);
    const scp = Number(res?.scp_score ?? 0);

    let verdict = "PREUVE LIMITÉE";
    let reasons = [];

    if (!projectValid) {
      verdict = "PREUVE LIMITÉE";
      reasons = [String(res?.validation_reason || "VOLUME INSUFFISANT")];
    } else {
      verdict = scp >= 80 ? "COHERENT" : scp >= 50 ? "ATYPIQUE" : "SUSPECT";
      reasons = [];
    }

    const appVersion = await app.getVersion().catch(() => "unknown");
    const certificateId = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const verifierUrl = "le vérificateur public HumanOrigin";

    const hoDoc = {
      ho: {
        version: "1.0",
        type: "certificate",
        certificate_id: certificateId,
        issued_at: issuedAt,
        app: {
          name: "HumanOrigin",
          version: appVersion,
          platform:
            navigator.userAgentData?.platform ||
            navigator.platform ||
            navigator.userAgent ||
            "unknown",
        },
      },
      subject: {
        title: res.project_name || currentProjectName || "Projet",
        author_hint: currentUser?.email || undefined,
      },
      document: {
        filename: bind.filename,
        mime: bind.mime,
        sha256: bind.sha256,
      },
      evidence: {
        project_summary: {
          total_active_seconds: res.total_active_seconds ?? 0,
          total_keystrokes: res.total_keystrokes ?? 0,
          session_count: res.session_count ?? 0,
          valid_sessions: res.valid_sessions ?? 0,
          validation_reason: res.validation_reason ?? "",
        },
        sessions: [
          {
            session_id: "project-finalization-summary",
            started_at: undefined,
            ended_at: undefined,
            metrics: {
              active_seconds: res.total_active_seconds ?? 0,
              keystrokes: res.total_keystrokes ?? 0,
              mouse_moves: 0,
              pastes: 0,
            },
          },
        ],
      },
      score: {
        schema: "scp-v1",
        value: scp,
        verdict,
        reasons,
      },
      signing: {
        alg: "ed25519",
        pubkey: "",
        signed_at: issuedAt,
        payload_to_sign: "",
        signature: "",
      },
    };

    const keyProbe = await invoke("sign_payload_hash", {
      payloadHash: "0".repeat(64),
    });

    hoDoc.signing.pubkey = keyProbe.public_key;

    const stripped = stripForSigning(hoDoc);
    const canonStr = JSON.stringify(canonicalize(stripped));
    const payloadHashHex = await sha256Hex(canonStr);

    const sigObj = await invoke("sign_payload_hash", {
      payloadHash: payloadHashHex,
    });

    hoDoc.signing.payload_to_sign = payloadHashHex;
    hoDoc.signing.signature = sigObj.signature;
    hoDoc.signing.pubkey = sigObj.public_key;

    const visualVerdict = getVisualVerdictMeta(verdict);

    const badgeSvg = buildBadgeSvg({
      certificateId,
      verdict,
      issuedAt,
    });

    const cartoucheSvg = await buildCartoucheSvg({
      verifierUrl,
      certificateId,
      verdict,
      issuedAt,
    });

    const cartoucheCompactSvg = await buildCartoucheCompactSvg({
      verifierUrl,
      certificateId,
      verdict,
      issuedAt,
    });

    const stampSvg = await buildStampSvg({
      verifierUrl,
      certificateId,
      verdictLabel: visualVerdict.label,
      docHash: hoDoc.document.sha256,
    });

    const verifyTxt = buildVerifyTxt({
      certificateId,
      projectTitle: hoDoc.subject.title,
      issuedAt,
      verdict,
      documentSha256: hoDoc.document.sha256,
      verifierUrl,
    });

  const readMeFirstTxt = buildReadMeFirstTxt({
  projectTitle: hoDoc.subject.title,
  documentFilename: hoDoc.document.filename,
  certificateId,
  issuedAt,
  verdict,
  documentSha256: hoDoc.document.sha256,
  verifierUrl,
});

    const shareCardHtml = buildShareCardHtml({
      projectTitle: hoDoc.subject.title,
      documentFilename: hoDoc.document.filename,
      certificateId,
      issuedAt,
      verdict,
      documentMime: hoDoc.document.mime,
      verifierUrl,
    });

    const dir = dirnameAnyPath(res.html_path);
    const sep = String(res.html_path).includes("\\") ? "\\" : "/";
      __hoExportDebugPath = `${dir}${sep}HumanOrigin_WINDOWS_EXPORT_DEBUG.txt`;
      await __hoExportMark("after-finalize_project", `html_path=${res.html_path}`);

    const bindExtLower = fileExtLower(bind.filename);
    const publishedDocumentFilename = `BOUND_DOCUMENT.${bindExtLower}`;
    const publishedDocumentPath = `${dir}${sep}${publishedDocumentFilename}`;

    const publishedHtmlPath = `${dir}${sep}HumanOrigin_PUBLISHED.html`;
    const openFirstPath = `${dir}${sep}HumanOrigin_OPEN_FIRST.html`;
    let preferredOpenPath = openFirstPath;
    const publishedPdfFilename = "HumanOrigin_PUBLISHED.pdf";
    const publishedPdfPath = `${dir}${sep}${publishedPdfFilename}`;
    const canGeneratePublishedPdf = bind.mime === "application/pdf" || bindExtLower === "docx";

    const publicationJobPath = `${dir}${sep}HumanOrigin_PUBLICATION_JOB.json`;

    const publishedHtml = buildPublishedHtml({
      projectTitle: hoDoc.subject.title,
      documentFilename: hoDoc.document.filename,
      publishedDocumentFilename,
      certificateId,
      issuedAt,
      verdict,
      verifierUrl,
      mime: hoDoc.document.mime,
    });

    const openFirstHtml = buildOpenFirstHtml({
      projectTitle: hoDoc.subject.title,
      documentFilename: hoDoc.document.filename,
      publishedDocumentFilename,
      publishedOutputFilename: canGeneratePublishedPdf ? publishedPdfFilename : null,
      referenceProofFilename: "CERTIFICAT_FINAL.v1.ho.json",
      compatibilityProofFilename: "CERTIFICAT_FINALfichier de vérification",
      certificateId,
      issuedAt,
      verdict,
      verifierUrl,
      isPdf: canGeneratePublishedPdf,
    });

    const manifestJson = buildPublicationManifest({
      projectTitle: hoDoc.subject.title,
      documentFilename: hoDoc.document.filename,
      publishedDocumentFilename,
      certificateId,
      issuedAt,
      verdict,
      verifierUrl,
      documentSha256: hoDoc.document.sha256,
      documentMime: hoDoc.document.mime,
      publishedOutputFilename: canGeneratePublishedPdf ? publishedPdfFilename : null,
    });

    const badgePath = `${dir}${sep}HumanOrigin_BADGE.svg`;
    const badgePngPath = `${dir}${sep}HumanOrigin_BADGE.png`;

    const cartouchePath = `${dir}${sep}HumanOrigin_CARTOUCHE.svg`;
    const cartouchePngPath = `${dir}${sep}HumanOrigin_CARTOUCHE.png`;

    const cartoucheCompactPath = `${dir}${sep}HumanOrigin_CARTOUCHE_COMPACT.svg`;
    const cartoucheCompactPngPath = `${dir}${sep}HumanOrigin_CARTOUCHE_COMPACT.png`;

    const stampPath = `${dir}${sep}HumanOrigin_STAMP.svg`;
    const stampPngPath = `${dir}${sep}HumanOrigin_STAMP.png`;

    const verifyTxtPath = `${dir}${sep}HumanOrigin_VERIFY.txt`;
    const readMeFirstPath = `${dir}${sep}HumanOrigin_READ_ME_FIRST.txt`;
    const shareCardPath = `${dir}${sep}HumanOrigin_SHARE_CARD.html`;
    const manifestPath = `${dir}${sep}HumanOrigin_MANIFEST.json`;

    const hoPath = String(res.html_path).replace(/\.html$/i, "fichier de vérification");
    const hoPathV1 = String(res.html_path).replace(/\.html$/i, ".v1fichier de vérification");

    const hoDocV1 = {
      format: "humanorigin-hojson",
      version: "1.0",
      payload: {
        certificate_type: "final_project_certificate",
        certificate_id: certificateId,
        issued_at: issuedAt,
        issuer: {
          product: "HumanOrigin",
          issuer_mode: "local",
        },
        project: {
          name: hoDoc.subject.title,
        },
        document: {
          binding_mode: "external_file",
          filename: hoDoc.document.filename ?? null,
          mime: hoDoc.document.mime ?? null,
          sha256: hoDoc.document.sha256 ?? null,
        },
        process_summary: {
          verdict,
          scp_score: Number.isFinite(scp) ? scp : 0,
          evidence_score: 0,
          active_ms: Math.max(0, Number(res.total_active_seconds || 0)) * 1000,
          valid_sessions_count: Math.max(0, Number(res.valid_sessions || 0)),
          certified_sessions_count: Math.max(0, Number(res.valid_sessions || 0)),
        },
        verification: {
          verify_url: verifierUrl || null,
          verification_method: "ed25519_payload_sha256",
        },
      },
      payload_sha256: "",
      signatures: [],
    };

    const signHoDocV1 = async () => {
      const hoDocV1CanonStr = JSON.stringify(canonicalize(hoDocV1.payload));
      const hoDocV1PayloadHashHex = await sha256Hex(hoDocV1CanonStr);

      const hoDocV1SigObj = await invoke("sign_payload_hash", {
        payloadHash: hoDocV1PayloadHashHex,
      });

      hoDocV1.payload_sha256 = hoDocV1PayloadHashHex;
      hoDocV1.signatures = [
        {
          role: "issuer",
          algorithm: "ed25519",
          signed_field: "payload_sha256",
          public_key: hoDocV1SigObj.public_key,
          signature: hoDocV1SigObj.signature,
        },
      ];
    };

    await signHoDocV1();

    await writeTextFile(badgePath, badgeSvg);
    await writeTextFile(cartouchePath, cartoucheSvg);
    await writeTextFile(cartoucheCompactPath, cartoucheCompactSvg);
    await writeTextFile(stampPath, stampSvg);
    await writeTextFile(verifyTxtPath, verifyTxt);
    await writeTextFile(readMeFirstPath, readMeFirstTxt);
    await writeTextFile(shareCardPath, shareCardHtml);
    await writeTextFile(manifestPath, manifestJson);
    await writeTextFile(hoPath, JSON.stringify(hoDoc, null, 2));
    await writeTextFile(hoPathV1, JSON.stringify(hoDocV1, null, 2));

    await invoke("copy_file", {
      srcPath: bind.path,
      destPath: publishedDocumentPath,
    });

    await writeTextFile(publishedHtmlPath, publishedHtml);
    await writeTextFile(openFirstPath, openFirstHtml);
    preferredOpenPath = openFirstPath;

    try {
      const rawShareProjectName = String(hoDoc?.subject?.title || "HumanOrigin Project")
        .replace(/[\\/:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "HumanOrigin Project";

      const sharePackageDir = `${dir}${sep}${rawShareProjectName} — HumanOrigin Package`;
      const sendDir = `${sharePackageDir}${sep}2_SEND_TO_RECIPIENT`;
      const technicalDir = `${sharePackageDir}${sep}3_TECHNICAL_PROOF_ARCHIVE`;
      const shareOpenFirstPath = `${sharePackageDir}${sep}1_OPEN_FIRST.html`;
      const shareStartHerePath = `${sharePackageDir}${sep}README_START_HERE.txt`;

      const sendPublishedPdfFilename = `${rawShareProjectName} — HumanOrigin_PUBLISHED.pdf`;
      const sendProofFilename = `${rawShareProjectName} — HumanOrigin_PROOF.v1.ho.json`;
      const sendPublishedPdfRelativePath = `2_SEND_TO_RECIPIENT/${sendPublishedPdfFilename}`;
      const sendProofRelativePath = `2_SEND_TO_RECIPIENT/${sendProofFilename}`;

      await removeDir(sharePackageDir, { recursive: true }).catch(() => {});
      await createDir(sharePackageDir, { recursive: true });
      await createDir(sendDir, { recursive: true });
      await createDir(technicalDir, { recursive: true });

      const shareOpenFirstHtml = buildOpenFirstHtml({
        projectTitle: hoDoc.subject.title,
        documentFilename: hoDoc.document.filename,
        publishedDocumentFilename,
        publishedOutputFilename: canGeneratePublishedPdf ? sendPublishedPdfRelativePath : null,
        referenceProofFilename: sendProofRelativePath,
        compatibilityProofFilename: "3_TECHNICAL_PROOF_ARCHIVE/CERTIFICAT_FINALfichier de vérification",
        certificateId,
        issuedAt,
        verdict,
        verifierUrl,
        isPdf: canGeneratePublishedPdf,
      });

      await writeTextFile(shareOpenFirstPath, shareOpenFirstHtml);

      const copyIfPresent = async (src, dst, label) => {
        try {
          await copyFile(src, dst);
          console.log(`[SHARE PACKAGE] copied ${label || dst}`);
        } catch (err) {
          console.warn(`[SHARE PACKAGE] missing optional file: ${label || src}`, err);
        }
      };

      await __hoExportMark("after-renderPublicationKitPngs");

      if (canGeneratePublishedPdf) {
        await copyIfPresent(
          publishedPdfPath,
          `${sendDir}${sep}${sendPublishedPdfFilename}`,
          sendPublishedPdfFilename,
        );
      } else {
        const sendBoundFilename = `${rawShareProjectName} — ${publishedDocumentFilename}`;
        await copyIfPresent(
          publishedDocumentPath,
          `${sendDir}${sep}${sendBoundFilename}`,
          sendBoundFilename,
        );
      }

      await copyIfPresent(
        hoPathV1,
        `${sendDir}${sep}${sendProofFilename}`,
        sendProofFilename,
      );

      const sendReadme = [
        "HUMANORIGIN — DOSSIER À ENVOYER",
        "",
        "Projet :",
        rawShareProjectName,
        "",
        "Ce dossier contient les fichiers principaux à transmettre à un destinataire.",
        "",
        `1. ${canGeneratePublishedPdf ? sendPublishedPdfFilename : `${rawShareProjectName} — ${publishedDocumentFilename}`}`,
        canGeneratePublishedPdf
          ? "   Document publié avec marquage visible HumanOrigin."
          : "   Document source lié à la preuve HumanOrigin.",
        "",
        `2. ${sendProofFilename}`,
        "   Preuve portable signée, vérifiable publiquement.",
        "",
        "Pour vérifier :",
        "- ouvrir le vérificateur public HumanOrigin ;",
        "- importer le fichier de vérification ;",
        "- importer le document publié si une comparaison du document est demandée.",
        "",
        "Important :",
        "HumanOrigin ne certifie pas que le contenu du document est vrai.",
        "HumanOrigin certifie qu’un processus humain mesuré a été lié à ce document.",
      ].join("\n");

      await writeTextFile(`${sendDir}${sep}README_SEND_FIRST.txt`, sendReadme);

      const technicalCopies = [
        [hoPath, `${technicalDir}${sep}CERTIFICAT_FINALfichier de vérification`, "CERTIFICAT_FINALfichier de vérification"],
        [hoPathV1, `${technicalDir}${sep}CERTIFICAT_FINAL.v1.ho.json`, "CERTIFICAT_FINAL.v1.ho.json"],
        [`${dir}${sep}CERTIFICAT_FINAL.html`, `${technicalDir}${sep}CERTIFICAT_FINAL.html`, "CERTIFICAT_FINAL.html"],
        [manifestPath, `${technicalDir}${sep}HumanOrigin_MANIFEST.json`, "HumanOrigin_MANIFEST.json"],
        [verifyTxtPath, `${technicalDir}${sep}HumanOrigin_VERIFY.txt`, "HumanOrigin_VERIFY.txt"],
        [readMeFirstPath, `${technicalDir}${sep}HumanOrigin_READ_ME_FIRST.txt`, "HumanOrigin_READ_ME_FIRST.txt"],
        [publicationJobPath, `${technicalDir}${sep}HumanOrigin_PUBLICATION_JOB.json`, "HumanOrigin_PUBLICATION_JOB.json"],
        [publishedHtmlPath, `${technicalDir}${sep}HumanOrigin_PUBLISHED.html`, "HumanOrigin_PUBLISHED.html"],
        [shareCardPath, `${technicalDir}${sep}HumanOrigin_SHARE_CARD.html`, "HumanOrigin_SHARE_CARD.html"],
        [publishedDocumentPath, `${technicalDir}${sep}${publishedDocumentFilename}`, publishedDocumentFilename],
      ];

      if (canGeneratePublishedPdf) {
        technicalCopies.push([
          publishedPdfPath,
          `${technicalDir}${sep}HumanOrigin_PUBLISHED.pdf`,
          "HumanOrigin_PUBLISHED.pdf",
        ]);
      }

      for (const [src, dst, label] of technicalCopies) {
        await copyIfPresent(src, dst, label);
      }

      const technicalReadme = [
        "HUMANORIGIN — ARCHIVE TECHNIQUE",
        "",
        "Projet :",
        rawShareProjectName,
        "",
        "Ce dossier contient les fichiers techniques, de compatibilité, de diagnostic et d’archivage.",
        "",
        "Pour un destinataire non technique, privilégier :",
        "2_SEND_TO_RECIPIENT/",
        "",
        "Fichier de preuve recommandé :",
        "CERTIFICAT_FINAL.v1.ho.json",
        "",
        "Fichier de compatibilité legacy :",
        "CERTIFICAT_FINALfichier de vérification",
      ].join("\n");

      await writeTextFile(`${technicalDir}${sep}README_TECHNICAL_PROOF.txt`, technicalReadme);

      const startHereTxt = [
        "HUMANORIGIN — PACKAGE DU PROJET",
        "",
        "Projet :",
        rawShareProjectName,
        "",
        "À ouvrir en premier :",
        "1_OPEN_FIRST.html",
        "",
        "À envoyer à un destinataire :",
        "2_SEND_TO_RECIPIENT/",
        "",
        "Détails avancés :",
        "3_TECHNICAL_PROOF_ARCHIVE/",
        "",
        "Important :",
        "HumanOrigin ne certifie pas que le contenu du document est vrai.",
        "HumanOrigin certifie qu’un processus humain mesuré a été lié à ce document.",
      ].join("\n");

      await writeTextFile(shareStartHerePath, startHereTxt);

      // Le package premium devient l'entrée préférée après export.
      preferredOpenPath = shareOpenFirstPath;
    } catch (e) {
      console.warn("[SHARE PACKAGE] premium build failed", e);
    }

    await renderPublicationKitPngs({
      badgeSvg,
      badgePngPath,
      cartoucheSvg,
      cartouchePngPath,
      cartoucheCompactSvg,
      cartoucheCompactPngPath,
      stampSvg,
      stampPngPath,
    });

    if (canGeneratePublishedPdf) {
      let sourcePdfForPublishing = publishedDocumentPath;

      if (bindExtLower === "docx") {
        const converterOutputDir = `${dir}${sep}HumanOrigin_CONVERTED`;

        await createDir(converterOutputDir, { recursive: true });

        const converterResult = await runConverterSidecar({
          inputPath: publishedDocumentPath,
          outputDir: converterOutputDir,
        });

        console.log("[CONVERTER RESULT]", converterResult);
        sourcePdfForPublishing = converterResult.intermediate_pdf_path;
      }

      const publicationJobJson = buildPublicationJob({
        sourcePdfPath: sourcePdfForPublishing,
        outputPdfPath: publishedPdfPath,
        cartouchePngPath: cartoucheCompactPngPath,
        certificateJsonPath: hoPath,
        verifyTxtPath,
        certificateId,
        verifyUrl: verifierUrl,
        verdict,
      });

      await writeTextFile(publicationJobPath, publicationJobJson);

      const publishResult = await runPublisherSidecar({
        jobPath: publicationJobPath,
        fallbackInput: {
          sourcePdfPath: sourcePdfForPublishing,
          outputPdfPath: publishedPdfPath,
          cartoucheCompactPngPath: cartoucheCompactPngPath,
          verifyUrl: verifierUrl,
          certificateId,
          verdict,
        },
      });

      console.log("[PUBLISHER RESULT]", publishResult);

      const finalPdfPath = publishResult.output_pdf_path || publishedPdfPath;
      console.log("[PUBLISHED PDF PATH]", finalPdfPath);

      const publishedOutputSha256 = await invoke("sha256_file", { path: finalPdfPath });

      hoDocV1.payload.publication = {
        status: "visible_published_copy_included",
        relationship: bindExtLower === "docx"
          ? "published_pdf_generated_from_bound_docx_then_marked_by_humanorigin"
          : "published_pdf_generated_from_bound_pdf_then_marked_by_humanorigin",
        source: {
          role: "bound_source_document",
          filename: hoDoc.document.filename ?? null,
          mime: hoDoc.document.mime ?? null,
          sha256: hoDoc.document.sha256 ?? null,
        },
        output: {
          role: "published_circulation_copy",
          filename: publishedPdfFilename,
          mime: "application/pdf",
          sha256: publishedOutputSha256,
          generated_from_source_sha256: hoDoc.document.sha256 ?? null,
          publisher_engine: publishResult.engine || "humanorigin-publisher",
        },
      };

      await signHoDocV1();
      await writeTextFile(hoPathV1, JSON.stringify(hoDocV1, null, 2));

      const manifestJsonWithPublicationHash = buildPublicationManifest({
        projectTitle: hoDoc.subject.title,
        documentFilename: hoDoc.document.filename,
        publishedDocumentFilename,
        certificateId,
        issuedAt,
        verdict,
        verifierUrl,
        documentSha256: hoDoc.document.sha256,
        documentMime: hoDoc.document.mime,
        publishedOutputFilename: publishedPdfFilename,
        publishedOutputSha256,
      });

      await writeTextFile(manifestPath, manifestJsonWithPublicationHash);

      try {
        const rawShareProjectName = String(hoDoc?.subject?.title || "HumanOrigin Project")
          .replace(/[\\/:*?"<>|]/g, " ")
          .replace(/\s+/g, " ")
          .trim() || "HumanOrigin Project";

        const sharePackageDir = `${dir}${sep}${rawShareProjectName} — HumanOrigin Package`;
        const sendDir = `${sharePackageDir}${sep}2_SEND_TO_RECIPIENT`;
        const technicalDir = `${sharePackageDir}${sep}3_TECHNICAL_PROOF_ARCHIVE`;

        const sendPublishedPdfFilename = `${rawShareProjectName} — HumanOrigin_PUBLISHED.pdf`;
        const sendProofFilename = `${rawShareProjectName} — HumanOrigin_PROOF.v1.ho.json`;

        await createDir(sendDir, { recursive: true });
        await createDir(technicalDir, { recursive: true });

        await copyFile(finalPdfPath, `${sendDir}${sep}${sendPublishedPdfFilename}`);
        await copyFile(hoPathV1, `${sendDir}${sep}${sendProofFilename}`);

        await copyFile(finalPdfPath, `${technicalDir}${sep}HumanOrigin_PUBLISHED.pdf`);
        await copyFile(hoPathV1, `${technicalDir}${sep}CERTIFICAT_FINAL.v1.ho.json`);
        await copyFile(manifestPath, `${technicalDir}${sep}HumanOrigin_MANIFEST.json`);
      } catch (syncErr) {
        console.warn("[SHARE PACKAGE] post-publication sync failed", syncErr);
      }

      toast(bindExtLower === "docx"
        ? "DOCX converti et PDF publié HumanOrigin généré ✅"
        : "PDF publié HumanOrigin généré ✅"
      );

      await invoke("open_file", { path: preferredOpenPath });
      return;
    }

    toast("Kit de diffusion HumanOrigin généré ✅");
    await invoke("open_file", { path: preferredOpenPath });
  } catch (e) {
    console.error("exportFinalProjectCertificate failed", e);
    alert("Erreur package final projet : " + (e?.message || e));
  }
}

// =========================================================
// VIEWER (DOWNLOAD + RELOAD + OPEN EXTERNAL)
// =========================================================
async function openCertViewer(filePath) {
  const overlay = $("viewer-overlay");
  const iframe = $("viewer-iframe");
  const errDiv = $("viewer-error");
  if (!overlay || !iframe) return;

  currentCertHtmlPath = filePath;
  currentCertAssetUrl = convertFileSrc(filePath);

  iframe.src = "about:blank";
  if (errDiv) {
    errDiv.style.display = "none";
    errDiv.innerText = "";
  }

  overlay.style.display = "flex";

  const closeViewer = () => {
    overlay.style.display = "none";
    iframe.src = "about:blank";
    window.removeEventListener("keydown", onKey);
  };

  const onKey = (e) => {
    if (e.key === "Escape") closeViewer();
  };

  window.addEventListener("keydown", onKey);

  on("viewer-close", closeViewer);

  on("viewer-open-external", () => invoke("open_file", { path: filePath }));

  on("viewer-reload", () => {
    iframe.src = "about:blank";
    setTimeout(() => {
      iframe.src = currentCertAssetUrl;
    }, 50);
  });

  on("viewer-download", async () => {
    try {
      const ext = fileExtLower(currentCertHtmlPath || "");
      const defaultName = basenameAnyPath(currentCertHtmlPath || "HumanOrigin_artifact");

      const savePath = await save({
        defaultPath: defaultName,
      });

      if (!savePath) return;

      if (["html", "txt", "json", "svg", "md"].includes(ext)) {
        const txt = await invoke("read_text_file", { path: currentCertHtmlPath });
        await writeTextFile(savePath, String(txt || ""));
      } else {
        await invoke("copy_file", {
          srcPath: currentCertHtmlPath,
          destPath: savePath,
        });
      }

      toast("Téléchargé ✅");
    } catch (e) {
      alert("Téléchargement impossible : " + (e?.message || e));
    }
  });

  setTimeout(() => {
    iframe.src = currentCertAssetUrl;
  }, 50);

  setTimeout(() => {
    try {
      const doc = iframe.contentDocument;
      if (doc && !doc.body?.innerText && !doc.body?.innerHTML && errDiv) {
        errDiv.innerText = "Affichage bloqué. Cliquez sur 'Ouvrir Nav'.";
        errDiv.style.display = "block";
      }
    } catch {}
  }, 1000);
}

// =========================================================
// DRAFTS (banner + modal)
// =========================================================
function ensureDraftModal() {
  let modal = $("draft-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "draft-modal";
  modal.innerHTML = `
    <div id="draft-modal-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <h2 style="margin:0;font-weight:950;letter-spacing:-0.02em;color:#0b1b33;font-size:22px;">Sessions en attente de certification</h2>
          <div style="margin-top:6px;font-size:13px;color:rgba(11,18,32,0.6);">Reprendre ou supprimer un brouillon local avant certification.</div>
        </div>
        <button id="draft-modal-x" style="width:40px;height:40px;border-radius:12px;border:1px solid rgba(14,29,58,0.12);background:rgba(255,255,255,0.7);font-weight:900;cursor:pointer;">✕</button>
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin:12px 0 14px;">
        <input id="draft-modal-filter" placeholder="Rechercher un projet..." style="flex:1;padding:10px 12px;border-radius:14px;border:1px solid rgba(15,23,42,0.12);background:rgba(255,255,255,0.8);outline:none;" />
        <button id="draft-modal-refresh" style="padding:8px 12px;border-radius:12px;border:1px solid rgba(14,29,58,0.12);background:rgba(255,255,255,0.7);font-weight:850;cursor:pointer;">Actualiser</button>
      </div>

      <div id="draft-modal-list" style="overflow:auto;border-radius:18px;border:1px solid rgba(15,23,42,0.08);background:rgba(255,255,255,0.72);max-height:min(52vh,460px);"></div>
    </div>
  `;

  modal.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:10001;padding:18px;background:rgba(10,18,35,0.45);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);";

  const card = modal.querySelector("#draft-modal-card");
  card.style.cssText =
    "width:min(860px,calc(100vw - 32px));max-height:min(78vh,760px);border-radius:26px;padding:18px;background:rgba(255,255,255,0.62);border:1px solid rgba(14,29,58,0.12);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 28px 70px rgba(12,24,46,0.18),0 0 0 1px rgba(255,255,255,0.35) inset;overflow:hidden;";

  document.body.appendChild(modal);

  const close = () => {
    modal.style.display = "none";
  };

  modal.querySelector("#draft-modal-x").onclick = close;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };

  modal.querySelector("#draft-modal-refresh").onclick = () =>
    checkForDrafts(true).then(renderDraftModalList);

  modal.querySelector("#draft-modal-filter").oninput = renderDraftModalList;

  return modal;
}

function renderDraftModalList() {
  const list = $("draft-modal-list");
  const filter = ($("draft-modal-filter")?.value || "").toLowerCase();
  if (!list) return;

  let items = draftsCache || [];
  if (filter) {
    items = items.filter((d) => (d.project_name || "").toLowerCase().includes(filter));
  }

  items.sort((a, b) => (b.created_at_utc || "").localeCompare(a.created_at_utc || ""));

  if (!items.length) {
    list.innerHTML = "<div style='padding:15px;color:#888'>Aucun brouillon.</div>";
    return;
  }

  list.innerHTML = items
    .map((d) => {
      const dateStr = d.created_at_utc ? new Date(d.created_at_utc).toLocaleString() : "—";
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 14px;border-bottom:1px solid rgba(15,23,42,0.06);">
        <div style="min-width:0;display:flex;flex-direction:column;gap:4px;">
          <div style="font-weight:950;font-size:14px;color:#0b1b33;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(
            d.project_name
          )}</div>
          <div style="font-size:12px;color:rgba(11,18,32,0.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(
            dateStr
          )}</div>
          <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:rgba(11,18,32,0.45);">session: ${esc(
            d.session_id
          )}</div>
        </div>
        <div style="display:flex;gap:10px;flex-shrink:0;">
          <button data-act="restore" data-sid="${d.session_id}"
            style="padding:8px 12px;border-radius:12px;border:1px solid rgba(56,132,255,0.22);background:linear-gradient(180deg,#102a52 0%,#071429 100%);color:#fff;font-weight:900;cursor:pointer;">
            Restaurer
          </button>
          <button data-act="delete" data-sid="${d.session_id}"
            style="padding:8px 12px;border-radius:12px;border:1px solid rgba(255,59,48,0.22);background:rgba(255,255,255,0.72);color:#b91c1c;font-weight:900;cursor:pointer;">
            Suppr.
          </button>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.sid;

      if (btn.dataset.act === "restore") {
        await recoverDraft(sid);
        const modal = $("draft-modal");
        if (modal) modal.style.display = "none";
      } else {
        if (!confirm("Supprimer ?")) return;

        try {
          await invoke("delete_local_draft", { sessionId: sid });
        } catch {}

        await checkForDrafts(true);
        renderDraftModalList();
      }
    };
  });
}

async function checkForDrafts(forceRefresh = false) {
  try {
    if (!draftsCache.length || forceRefresh) {
      draftsCache = await invoke("list_local_drafts");
      if (!Array.isArray(draftsCache)) draftsCache = [];
    }

    const banner = $("draft-banner");
    const btnRecover = $("btn-recover-draft");
    if (!banner || !btnRecover) return;

    if (!draftsCache.length) {
      banner.style.display = "none";
      return;
    }

    let candidates = draftsCache;
    if (currentProjectName) {
      const match = draftsCache.filter((d) => d.project_name === currentProjectName);
      if (match.length > 0) candidates = match;
    }

    const d0 = candidates[0];
    if (!d0) {
      banner.style.display = "none";
      return;
    }

    banner.style.display = "flex";
    btnRecover.innerText = "Reprendre ce travail · " + (d0.project_name || "");
    btnRecover.onclick = async () => {
      if (!currentProjectName && d0.project_name) {
        await quickActivateProjectByName(d0.project_name);
      }
      await recoverDraft(d0.session_id);
    };

    if (!$("btn-drafts-all")) {
      const btnAll = document.createElement("button");
      btnAll.id = "btn-drafts-all";
      btnAll.innerText = "Voir les travaux enregistrés";
      btnAll.className = "btn btn-ghost btn-mini";
      banner.appendChild(btnAll);

      btnAll.onclick = () => {
        const m = ensureDraftModal();
        m.style.display = "flex";
        renderDraftModalList();
      };
    }
  } catch (e) {
    console.warn("checkForDrafts failed", e);
  }
}

async function recoverDraft(sid) {
  try {
    const json = await invoke("load_local_draft", { sessionId: sid });
    const p = JSON.parse(json);

    const projName = p.project_name || null;
    if (projName && projName !== currentProjectName) {
      await quickActivateProjectByName(projName);
    }

    restoredDraftSessionId = sid;
    currentSessionId = p.session_id || sid;

    lastSnapshot = {
      scp_score: p.analysis?.score || 0,
      active_ms: (p.analysis?.active_est_sec || 0) * 1000,
      diag: {
        analysis: p.analysis || {},
        paste: p.paste_stats || {},
      },
    };

    const finBtn = $("finalize-btn");
    if (finBtn) {
      finBtn.disabled = false;
      finBtn.innerText = "Valider ce moment de travail";
    }

    const banner = $("draft-banner");
    if (banner) banner.style.display = "none";

    showScreen("DASHBOARD");
    updateDashboardUI("STOPPED");
    toast("Session restaurée.");
  } catch (e) {
    alert("Erreur restauration : " + e);
  }
}

// =========================================================
// CRYPTO
// =========================================================
function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const keys = Object.keys(value).sort();
  const out = {};
  for (const k of keys) out[k] = canonicalize(value[k]);
  return out;
}

function stripForSigning(doc) {
  const copy = JSON.parse(JSON.stringify(doc));
  if (copy.signing) {
    delete copy.signing.signature;
    delete copy.signing.payload_to_sign;
  }
  return copy;
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =========================================================
// STAMP / BADGE / CARTOUCHE (SVG + QR)
// =========================================================
function shortId(uuid) {
  const s = String(uuid || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return s ? s.slice(0, 10) : "HO";
}

function shortHash(h) {
  const s = String(h || "");
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s || "—";
}

function formatDisplayDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function getVisualVerdictMeta(verdict) {
  const v = String(verdict || "").toUpperCase();

  if (v === "COHERENT") {
    return {
      label: "COHERENT",
      color: "#0f766e",
      bg: "#ecfeff",
      border: "#99f6e4",
    };
  }

  if (v === "ATYPIQUE" || v === "ATYPICAL") {
    return {
      label: "ATYPICAL",
      color: "#b45309",
      bg: "#fffbeb",
      border: "#fde68a",
    };
  }

  if (v === "SUSPECT") {
    return {
      label: "SUSPECT",
      color: "#b91c1c",
      bg: "#fef2f2",
      border: "#fecaca",
    };
  }

  return {
    label: "PREUVE LIMITÉE",
    color: "#475569",
    bg: "#f8fafc",
    border: "#cbd5e1",
  };
}

function buildBadgeSvg({ certificateId, verdict, issuedAt }) {
  const idShort = shortId(certificateId);
  const visual = getVisualVerdictMeta(verdict);
  const dateLabel = formatDisplayDate(issuedAt);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="88" viewBox="0 0 680 88">
  <defs>
    <style>
      .bg{fill:#ffffff}
      .border{fill:none;stroke:#dbe3ee;stroke-width:1.5}
      .brand{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;font-size:24px;fill:#0b1220}
      .meta{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:600;font-size:13px;fill:#334155}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;fill:#475569}
      .pillText{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;font-size:12px;fill:${visual.color}}
    </style>
  </defs>

  <rect x="1" y="1" width="678" height="86" rx="18" class="bg"/>
  <rect x="1" y="1" width="678" height="86" rx="18" class="border"/>

  <text x="24" y="34" class="brand">HumanOrigin</text>
  <text x="24" y="58" class="meta">Verified Process Certificate</text>

  <rect x="300" y="22" width="122" height="30" rx="15" fill="${visual.bg}" stroke="${visual.border}" />
  <text x="361" y="41" text-anchor="middle" class="pillText">${visual.label}</text>

  <text x="445" y="40" class="mono">ID ${idShort} · ${dateLabel}</text>
</svg>`;
}

async function buildCartoucheSvg({ verifierUrl, certificateId, verdict, issuedAt }) {
  const idShort = shortId(certificateId);
  const visual = getVisualVerdictMeta(verdict);
  const dateLabel = formatDisplayDate(issuedAt);

  const url = verifierUrl.includes("?")
    ? `${verifierUrl}&id=${encodeURIComponent(idShort)}`
    : `${verifierUrl}?id=${encodeURIComponent(idShort)}`;

 const qrSvg = await QRCode.toString(url, { type: "svg", margin: 0, width: 112 });
const qrInner = qrSvg.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/s, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="300" viewBox="0 0 960 300">
  <defs>
    <style>
      .paper{fill:#fffdf8}
      .border{fill:none;stroke:#d7dde7;stroke-width:2}
      .brand{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;font-size:42px;fill:#0b1220}
      .sub{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:700;font-size:16px;fill:#475569;letter-spacing:0.02em}
      .verdict{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:950;font-size:30px;fill:${visual.color}}
      .body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:600;font-size:16px;fill:#334155}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;fill:#475569}
      .micro{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:700;font-size:13px;fill:#64748b}
      .verify{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;font-size:14px;fill:#0b1220}
    </style>
  </defs>

  <rect x="1" y="1" width="958" height="298" rx="26" class="paper"/>
  <rect x="1" y="1" width="958" height="298" rx="26" class="border"/>

  <line x1="682" y1="28" x2="682" y2="272" stroke="#e2e8f0" stroke-width="2"/>

  <text x="34" y="62" class="brand">HumanOrigin</text>
  <text x="36" y="92" class="sub">Human Process Proof</text>

  <rect x="36" y="118" width="164" height="38" rx="19" fill="${visual.bg}" stroke="${visual.border}" />
  <text x="118" y="143" text-anchor="middle" class="verdict" font-size="18">${visual.label}</text>

  <text x="36" y="188" class="body">Registered in a public verification chain</text>
  <text x="36" y="218" class="mono">Proof ID: ${idShort} · ${dateLabel}</text>
  <text x="36" y="248" class="micro">Scan to inspect record</text>

  <g transform="translate(748,54)">
    <rect x="-10" y="-10" width="164" height="164" rx="18" fill="#ffffff" stroke="#d7dde7" stroke-width="2"/>
    <svg x="0" y="0" width="144" height="144" viewBox="0 0 144 144">
      ${qrInner}
    </svg>
  </g>

  <text x="820" y="240" text-anchor="middle" class="verify">Inspect</text>
</svg>`;
}

async function buildCartoucheCompactSvg({ verifierUrl, certificateId, verdict, issuedAt }) {
  const idShort = shortId(certificateId);
  const visual = getVisualVerdictMeta(verdict);
  const dateLabel = formatDisplayDate(issuedAt);

  const xml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  const url = verifierUrl.includes("?")
    ? `${verifierUrl}&id=${encodeURIComponent(idShort)}`
    : `${verifierUrl}?id=${encodeURIComponent(idShort)}`;

  const NAVY = "#08234d";
  const NAVY_SOFT = "#12376d";
  const PAPER = "#fffdf8";
  const HAIRLINE = "#d9e0ec";

  const QR_SIZE = 318;

  const qrSvgRaw = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: QR_SIZE,
    color: {
      dark: NAVY,
      light: "#ffffff",
    },
  });

  const qrViewBox =
    qrSvgRaw.match(/viewBox="([^"]+)"/)?.[1] || "0 0 29 29";

  const qrInner = qrSvgRaw
    .replace(/<\?xml[\s\S]*?\?>\s*/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>\s*/g, "")
    .replace(/^.*?<svg[^>]*>/s, "")
    .replace(/<\/svg>\s*$/s, "")
    .replace(/#000000/gi, NAVY)
    .replace(/black/gi, NAVY);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="760" viewBox="0 0 520 760">
  <defs>
    <style>
      .bg{fill:${PAPER}}
      .frame{fill:none;stroke:${NAVY};stroke-width:18;stroke-linecap:butt;stroke-linejoin:round}
      .brand{font-family:Georgia,'Times New Roman',serif;font-size:54px;font-weight:400;fill:${NAVY};letter-spacing:0.045em}
      .smallcaps{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;font-weight:800;fill:${NAVY};letter-spacing:0.34em}
      .micro{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:10px;font-weight:800;fill:${NAVY_SOFT};letter-spacing:0.28em}
      .value{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;font-weight:700;fill:${NAVY};letter-spacing:0.12em}
      .status{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;font-weight:900;fill:${visual.color};letter-spacing:0.08em}
      .scan{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;font-weight:900;fill:${NAVY};letter-spacing:0.28em}
    </style>
  </defs>

  <rect x="0" y="0" width="520" height="760" rx="0" class="bg"/>

  <!-- Cadre premium avec fentes haute et basse -->
  <path class="frame" d="M220 34 L96 34 Q56 34 56 74 L56 686 Q56 726 96 726 L220 726"/>
  <path class="frame" d="M300 34 L424 34 Q464 34 464 74 L464 686 Q464 726 424 726 L300 726"/>

  <g transform="translate(101,86)">
    <rect x="-14" y="-14" width="346" height="346" rx="18" fill="#ffffff" opacity="0.86"/>
    <svg x="0" y="0" width="${QR_SIZE}" height="${QR_SIZE}" viewBox="${qrViewBox}" shape-rendering="crispEdges">
      ${qrInner}
    </svg>
  </g>

  <line x1="88" y1="436" x2="232" y2="436" stroke="${NAVY_SOFT}" stroke-width="1.5" stroke-dasharray="2 7" opacity="0.72"/>
  <line x1="288" y1="436" x2="432" y2="436" stroke="${NAVY_SOFT}" stroke-width="1.5" stroke-dasharray="2 7" opacity="0.72"/>
  <path d="M260 424 L267 436 L260 448 L253 436 Z" fill="${NAVY}"/>

  <text x="260" y="505" text-anchor="middle" class="brand">HumanOrigin</text>

  <line x1="94" y1="535" x2="139" y2="535" stroke="${NAVY}" stroke-width="2"/>
  <line x1="381" y1="535" x2="426" y2="535" stroke="${NAVY}" stroke-width="2"/>
  <text x="260" y="541" text-anchor="middle" class="smallcaps">HUMAN PROCESS PROOF</text>

  <circle cx="204" cy="586" r="18" fill="${NAVY}"/>
  <path d="M194 586 L201 594 L216 576" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="238" y="592" class="scan">SCAN TO VERIFY</text>

  <rect x="74" y="628" width="372" height="62" rx="8" fill="#ffffff" stroke="${HAIRLINE}" stroke-width="1.5"/>
  <line x1="198" y1="638" x2="198" y2="680" stroke="${HAIRLINE}" stroke-width="1.3" stroke-dasharray="2 5"/>
  <line x1="322" y1="638" x2="322" y2="680" stroke="${HAIRLINE}" stroke-width="1.3" stroke-dasharray="2 5"/>

  <text x="136" y="653" text-anchor="middle" class="micro">PROOF ID</text>
  <text x="136" y="675" text-anchor="middle" class="value">${xml(idShort)}</text>

  <text x="260" y="653" text-anchor="middle" class="micro">STATUS</text>
  <text x="260" y="675" text-anchor="middle" class="status">${xml(visual.label)}</text>

  <text x="384" y="653" text-anchor="middle" class="micro">ISSUED</text>
  <text x="384" y="675" text-anchor="middle" class="value">${xml(dateLabel)}</text>
</svg>`;
}


async function buildStampSvg({ verifierUrl, certificateId, verdictLabel, docHash }) {
  const idShort = shortId(certificateId);
  const hashShort = shortHash(docHash);

  const url = verifierUrl.includes("?")
    ? `${verifierUrl}&id=${encodeURIComponent(idShort)}`
    : `${verifierUrl}?id=${encodeURIComponent(idShort)}`;

const qrSvgRaw = await QRCode.toString(url, { type: "svg", margin: 0, width: 120 });
const qrSvg = qrSvgRaw
  .replace(/<\?xml[\s\S]*?\?>\s*/g, "")
  .replace(/<!DOCTYPE[\s\S]*?>\s*/g, "")
  .replace(/^<svg[^>]*>/, '<svg x="0" y="0" width="120" height="120" shape-rendering="crispEdges">');
  const qrInner = qrSvg.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/s, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="180" viewBox="0 0 520 180">
  <defs>
    <style>
      .bg{fill:#ffffff;fill-opacity:0.98}
      .border{fill:none;stroke:#0b1220;stroke-width:3}
      .h{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;fill:#0b1220}
      .m{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:700;fill:#0b1220}
      .t{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;fill:#0b1220}
      .mut{fill:#334155}
    </style>
  </defs>

  <rect x="8" y="8" width="504" height="164" rx="18" class="bg"/>
  <rect x="8" y="8" width="504" height="164" rx="18" class="border"/>

  <text x="26" y="48" class="h" font-size="26">HumanOrigin</text>
  <text x="26" y="76" class="m" font-size="14">Human Process Proof</text>

  <text x="26" y="110" class="m" font-size="16">Verdict: <tspan class="h" font-size="16">${verdictLabel}</tspan></text>
  <text x="26" y="132" class="t">Proof ID: ${idShort}</text>
  <text x="26" y="152" class="t">Doc hash: ${hashShort}</text>

  <text x="300" y="152" class="t mut">Verifier: ${verifierUrl.replace(/^https?:\/\//, "")}</text>

  <g transform="translate(380,28)">
    <rect x="-6" y="-6" width="132" height="132" rx="12" fill="#fff" stroke="#0b1220" stroke-width="2"/>
    <svg x="0" y="0" width="120" height="120" viewBox="0 0 120 120">
      ${qrInner}
    </svg>
  </g>
</svg>`;
}

function buildVerifyTxt({
  certificateId,
  projectTitle,
  issuedAt,
  verdict,
  documentSha256,
  verifierUrl,
}) {
  const idShort = shortId(certificateId);
  const dateLabel = formatDisplayDate(issuedAt);
  const verdictLabel = String(verdict || "UNKNOWN").toUpperCase();
  const fullHash = documentSha256 || "n/a";

  return `HUMANORIGIN — VERIFICATION GUIDE

Project
${projectTitle || "Untitled project"}

Certificate ID
${idShort}

Issued
${dateLabel}

Verdict
${verdictLabel}

Bound document SHA-256
${fullHash}

WHAT THIS PACKAGE CONTAINS

This export may include:
- CERTIFICAT_FINALfichier de vérification  -> signed proof file
- CERTIFICAT_FINAL.html     -> human-readable certificate
- HumanOrigin_PUBLISHED.pdf -> published marked document (when PDF publication is used)
- HumanOrigin_CARTOUCHE*.svg/.png -> visible public mark assets

SOURCE OF TRUTH

The signed file CERTIFICAT_FINALfichier de vérification is the source of truth.
The visible cartouche, badge, stamp, or PDF marking are public-facing markers,
but the signed fichier de vérification file is the authoritative proof object.

HOW TO VERIFY

1. Open the verifier:
${verifierUrl}

2. Drag and drop:
CERTIFICAT_FINALfichier de vérification

3. Confirm that the verifier reports:
- VALID signature
- matching certificate ID
- matching document hash for the published file you received

IMPORTANT

If the bound document is modified, its SHA-256 hash changes.
In that case, the certificate no longer matches that document.

HUMANORIGIN SUMMARY

HumanOrigin certifies a human creation process through a signed portable proof object.
The visible mark helps circulation.
The signed fichier de vérification file remains the authoritative verification artifact.
`;
}
function buildReadMeFirstTxt({
  certificateId,
  projectTitle,
  issuedAt,
  verdict,
  documentSha256,
  documentMime,
  documentFilename,
  verifierUrl,
}) {
  const idShort = shortId(certificateId);
  const dateLabel = formatDisplayDate(issuedAt);
  const verdictLabel = String(verdict || "UNKNOWN").toUpperCase();
  const isPdf = documentMime === "application/pdf";

  const publicationStatus = isPdf
    ? `PUBLICATION STATUS

This bound file is a PDF.
A visible published version may be included as:
HumanOrigin_PUBLISHED.pdf

This is the recommended public circulation format when available.`
    : `PUBLICATION STATUS

This bound file type does not yet receive a native visibly marked published copy.

Current bound source file
${documentFilename || "BOUND_DOCUMENT"}

Current recommended workflow
- keep the original bound working file
- use CERTIFICAT_FINALfichier de vérification as the source of truth
- use the exported visible assets for circulation
- publish a PDF version later when a visible marked public document is needed`;

  return `HUMANORIGIN — READ ME FIRST

This package contains a HumanOrigin proof bundle linked to a bound document.

PROJECT
${projectTitle || "Untitled project"}

CERTIFICATE ID
${idShort}

ISSUED
${dateLabel}

VERDICT
${verdictLabel}

OPEN IN THIS ORDER

1. HumanOrigin_READ_ME_FIRST.txt
   Quick orientation for this package

2. CERTIFICAT_FINAL.html
   Human-readable certificate view

3. HumanOrigin_VERIFY.txt
   Verification instructions

4. CERTIFICAT_FINALfichier de vérification
   Signed proof object (source of truth)

SOURCE OF TRUTH

The authoritative proof file is:
CERTIFICAT_FINALfichier de vérification

The cartouche, badge, stamp, HTML certificate, and published PDF are visibility and presentation assets.
Formal verification is based on the signed fichier de vérification file and the bound document hash.

${publicationStatus}

HOW TO VERIFY

1. Open the verifier:
${verifierUrl}

2. Load:
CERTIFICAT_FINALfichier de vérification

3. Confirm:
- VALID signature
- matching certificate ID
- matching bound document hash

BOUND DOCUMENT SHA-256
${documentSha256 || "n/a"}

IMPORTANT

If the bound document changes, its hash changes.
In that case, the certificate no longer matches that document.
`;
}

function buildShareCardHtml({
  projectTitle,
  documentFilename,
  certificateId,
  issuedAt,
  verdict,
  verifierUrl,
}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>HumanOrigin Share Card</title>
  <style>
    body{
      margin:0;
      background:#f4f7fb;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      color:#0b1220;
    }
    .wrap{
      max-width:900px;
      margin:32px auto;
      padding:24px;
    }
    .card{
      background:#ffffff;
      border:1px solid #dbe3ee;
      border-radius:24px;
      padding:28px;
      box-shadow:0 18px 48px rgba(15,23,42,0.08);
    }
    .kicker{
      font-size:12px;
      font-weight:800;
      letter-spacing:.12em;
      text-transform:uppercase;
      color:#64748b;
      margin-bottom:10px;
    }
    h1{
      margin:0 0 8px 0;
      font-size:34px;
      line-height:1.05;
      letter-spacing:-0.03em;
    }
    .sub{
      color:#475569;
      font-size:16px;
      margin-bottom:24px;
    }
    .hero{
      display:grid;
      grid-template-columns:1.2fr .8fr;
      gap:24px;
      align-items:start;
    }
    .panel{
      border:1px solid #e2e8f0;
      border-radius:18px;
      padding:18px;
      background:#fcfdff;
    }
    .label{
      font-size:12px;
      font-weight:800;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:#64748b;
      margin-bottom:8px;
    }
    .value{
      font-size:16px;
      font-weight:700;
      color:#0b1220;
      word-break:break-word;
    }
    .mono{
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      font-size:13px;
      color:#334155;
      word-break:break-word;
    }
    .imgbox{
      border:1px solid #e2e8f0;
      border-radius:18px;
      padding:16px;
      background:white;
      text-align:center;
    }
    img{
      max-width:100%;
      height:auto;
      display:block;
      margin:0 auto;
    }
    ul{
      margin:10px 0 0 18px;
      padding:0;
      color:#334155;
    }
    li{ margin:8px 0; }
    .footer{
      margin-top:22px;
      font-size:13px;
      color:#64748b;
    }
    @media (max-width: 760px){
      .hero{ grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="kicker">HumanOrigin</div>
      <h1>Verified Process Package</h1>
      <div class="sub">
        This bundle links a bound document to a HumanOrigin proof package and a public verification flow.
      </div>

      <div class="panel" style="margin-bottom:16px;background:#fffdf8;">
        <div class="label">Source of truth</div>
        <div class="value" style="margin-bottom:8px;">CERTIFICAT_FINALfichier de vérification</div>
        <div style="font-size:14px;line-height:1.55;color:#475569;">
          The HTML views and visible marks help circulation and reading.
          Formal verification is based on the signed <strong>fichier de vérification</strong> proof file and the bound document hash.
        </div>
      </div>

      <div style="margin:0 0 24px 0;padding:16px 18px;border:1px solid #dbe3ee;border-radius:18px;background:#fcfdff;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:10px;">
          Verification note
        </div>

        <div style="font-size:15px;line-height:1.55;color:#0b1220;margin-bottom:10px;">
          This HTML certificate is a readable presentation of the HumanOrigin package.
          The signed file <strong>CERTIFICAT_FINALfichier de vérification</strong> is the authoritative proof object.
        </div>

        <div style="font-size:14px;line-height:1.55;color:#475569;margin-bottom:12px;">
          Visible assets such as the cartouche, badge, stamp, or published PDF help circulation and recognition,
          but formal verification is based on the signed <strong>fichier de vérification</strong> artifact and the bound document hash.
        </div>

        <div style="font-size:14px;line-height:1.6;color:#0b1220;">
          <strong>How to verify:</strong><br/>
          1. Open the verifier: <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(verifierUrl)}</span><br/>
          2. Load <strong>CERTIFICAT_FINALfichier de vérification</strong><br/>
          3. Confirm a valid signature and a matching bound document hash
        </div>
      </div>

      <div class="hero">
        <div>
          <div class="panel" style="margin-bottom:16px;">
            <div class="label">Project</div>
            <div class="value">${esc(projectTitle)}</div>
          </div>

          <div class="panel" style="margin-bottom:16px;">
            <div class="label">Bound document</div>
            <div class="value">${esc(documentFilename)}</div>
          </div>

          <div class="panel" style="margin-bottom:16px;">
            <div class="label">Certificate ID</div>
            <div class="mono">${esc(certificateId)}</div>
          </div>

          <div class="panel" style="margin-bottom:16px;">
            <div class="label">Issued at</div>
            <div class="value">${esc(issuedAt)}</div>
          </div>

          <div class="panel">
            <div class="label">Verdict</div>
            <div class="value">${esc(verdict)}</div>
          </div>
        </div>

        <div>
          <div class="imgbox" style="margin-bottom:16px;">
            <img src="HumanOrigin_CARTOUCHE.png" alt="HumanOrigin cartouche" />
          </div>

          <div class="panel">
            <div class="label">How to verify</div>
            <ul>
              <li>Open the verifier page</li>
              <li>Load <strong>CERTIFICAT_FINALfichier de vérification</strong></li>
              <li>Use <strong>HumanOrigin_VERIFY.txt</strong> for quick reference</li>
            </ul>
            <div class="footer">Verifier: ${esc(verifierUrl)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
function buildPublicationManifest({
  projectTitle,
  documentFilename,
  publishedDocumentFilename,
  certificateId,
  issuedAt,
  verdict,
  verifierUrl,
  documentSha256,
  documentMime,
  publishedOutputFilename = null,
  publishedOutputSha256 = null,
}) {
  const files = [
    "CERTIFICAT_FINAL.html",
    "CERTIFICAT_FINALfichier de vérification",
    "HumanOrigin_BADGE.svg",
    "HumanOrigin_BADGE.png",
    "HumanOrigin_CARTOUCHE.svg",
    "HumanOrigin_CARTOUCHE.png",
    "HumanOrigin_CARTOUCHE_COMPACT.svg",
    "HumanOrigin_CARTOUCHE_COMPACT.png",
    "HumanOrigin_STAMP.svg",
    "HumanOrigin_STAMP.png",
    "HumanOrigin_VERIFY.txt",
    "HumanOrigin_READ_ME_FIRST.txt",
    "HumanOrigin_SHARE_CARD.html",
    "HumanOrigin_PUBLISHED.html",
    "HumanOrigin_PUBLICATION_JOB.json",
    "HumanOrigin_MANIFEST.json",
    publishedDocumentFilename,
  ];

  if (publishedOutputFilename) {
    files.push(publishedOutputFilename);
  }

  return JSON.stringify(
    {
      humanorigin_package_version: "1.1",
      package_type: "publication_bundle",
      project_title: projectTitle,
      bound_document_filename: documentFilename,
      bound_document_sha256: documentSha256,
      bound_document_mime: documentMime,
      published_document_filename: publishedDocumentFilename,
      published_output_filename: publishedOutputFilename,
      published_output_sha256: publishedOutputSha256,

      publication_status: publishedOutputFilename
        ? "visible_published_copy_included"
        : "no_native_visible_published_copy_for_this_file_type",

      recommended_public_workflow: publishedOutputFilename
        ? "Use the included published output for public circulation."
        : "Send the full package folder or ZIP, open HumanOrigin_PUBLISHED.html first, keep the bound source file as the linked source document, use CERTIFICAT_FINALfichier de vérification as the authoritative proof file, and publish a PDF later if a visibly marked public version is needed.",
      certificate_id: certificateId,
      issued_at: issuedAt,
      verdict,
      verifier_url: verifierUrl,

      source_of_truth: {
        primary_file: "CERTIFICAT_FINALfichier de vérification",
        description: "Signed HumanOrigin proof object",
      },

      recommended_opening_order: [
        "HumanOrigin_PUBLISHED.html",
        "HumanOrigin_VERIFY.txt",
        "CERTIFICAT_FINALfichier de vérification",
        documentFilename,
      ],

      verification_summary: {
        verifier_url: verifierUrl,
        steps: [
          "Open the verifier",
          "Load CERTIFICAT_FINALfichier de vérification",
          "Confirm VALID signature",
          "Confirm matching bound document hash",
        ],
      },

      visible_assets_role: {
        description:
          "Cartouche, badge, stamp, and published PDF are public-facing visibility assets, not the authoritative proof object.",
      },

      files,
    },
    null,
    2
  );
}

function buildOpenFirstHtml({
  projectTitle,
  documentFilename,
  publishedDocumentFilename,
  publishedOutputFilename,
  referenceProofFilename,
  compatibilityProofFilename,
  certificateId,
  issuedAt,
  verdict,
  verifierUrl,
  isPdf,
}) {
  const mainDocumentFilename = publishedOutputFilename || publishedDocumentFilename;
  const proofFilename = referenceProofFilename || "CERTIFICAT_FINAL.v1.ho.json";

  const packageFolderName = "2_SEND_TO_RECIPIENT";
  const archiveFolderName = "3_TECHNICAL_PROOF_ARCHIVE";

  const mainDisplayFilename = String(mainDocumentFilename || "").split(/[\\/]/).pop();
  const proofDisplayFilename = String(proofFilename || "").split(/[\\/]/).pop();

  const sendFolderHref = `${packageFolderName}/`;
  const sendDocumentHref = `${packageFolderName}/${mainDisplayFilename}`;
  const archiveFolderHref = `${archiveFolderName}/`;

  function withVerifierContext(url) {
    const base = String(url || "le vérificateur public HumanOrigin");
    const join = base.includes("?") ? "&" : "?";
    return base + join
      + "project=" + encodeURIComponent(projectTitle || "")
      + "&expected_document=" + encodeURIComponent(`${packageFolderName}/${mainDisplayFilename}`)
      + "&expected_proof=" + encodeURIComponent(`${packageFolderName}/${proofDisplayFilename}`);
  }

  const contextualVerifierUrl = withVerifierContext(verifierUrl);

  const sendMessage = [
    "Bonjour,",
    "",
    "Je vous transmets le dossier HumanOrigin lié au document.",
    "",
    "Il contient :",
    "• le PDF publié, que vous pouvez ouvrir directement ;",
    "• la preuve portable signée HumanOrigin, conservée pour vérification publique.",
    "",
    "Le fichier de vérification n’est pas destiné à être lu directement : il sert au vérificateur HumanOrigin.",
    "",
    "Vérificateur public :",
    contextualVerifierUrl,
    "",
    "Bien à vous,"
  ].join(String.fromCharCode(10));

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>HumanOrigin — Package prêt</title>
  <style>
    :root{
      --navy:#08234d;
      --ink:#0f172a;
      --muted:#64748b;
      --bg:#eef3f9;
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      min-height:100vh;
      background:
        radial-gradient(circle at top left,rgba(8,35,77,.12),transparent 36%),
        linear-gradient(135deg,#f8fafc,#eef3f9);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      color:var(--ink);
    }
    .wrap{
      max-width:960px;
      margin:0 auto;
      padding:46px 24px 60px;
    }
    .card{
      background:rgba(255,255,255,.94);
      border:1px solid rgba(15,23,42,.08);
      border-radius:36px;
      box-shadow:0 28px 76px rgba(15,23,42,.11);
      padding:38px;
      backdrop-filter:blur(12px);
    }
    .kicker{
      margin-bottom:14px;
      color:var(--muted);
      font-size:11px;
      letter-spacing:.22em;
      text-transform:uppercase;
      font-weight:950;
    }
    h1{
      margin:0;
      font-size:56px;
      line-height:.94;
      letter-spacing:-.06em;
    }
    .lead{
      margin:18px 0 0;
      max-width:680px;
      color:#475569;
      font-size:18px;
      line-height:1.5;
      font-weight:720;
    }
    .hero{
      margin-top:32px;
      padding:32px;
      border-radius:30px;
      color:white;
      background:linear-gradient(145deg,#08234d,#0d2f68);
      box-shadow:0 26px 70px rgba(8,35,77,.25);
    }
    .hero h2{
      margin:0;
      font-size:38px;
      line-height:1;
      letter-spacing:-.045em;
    }
    .hero p{
      margin:14px 0 0;
      max-width:680px;
      color:rgba(255,255,255,.84);
      font-size:16px;
      line-height:1.5;
      font-weight:720;
    }
    .folder{
      margin-top:22px;
      padding:22px;
      border-radius:22px;
      background:rgba(255,255,255,.12);
      border:1px solid rgba(255,255,255,.18);
    }
    .folder span{
      display:block;
      margin-bottom:8px;
      color:rgba(255,255,255,.68);
      font-size:11px;
      letter-spacing:.18em;
      text-transform:uppercase;
      font-weight:950;
    }
    .folder strong{
      display:block;
      color:white;
      font-size:30px;
      line-height:1.1;
    }
    .folder small{
      display:block;
      margin-top:7px;
      color:rgba(255,255,255,.70);
      font-size:13px;
      font-weight:800;
      overflow-wrap:anywhere;
    }
    .actions{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      margin-top:22px;
    }
    .btn,button.btn{
      appearance:none;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:46px;
      padding:12px 18px;
      border-radius:999px;
      border:1px solid rgba(8,35,77,.16);
      background:white;
      color:var(--navy);
      text-decoration:none;
      font:inherit;
      font-size:14px;
      font-weight:950;
      cursor:pointer;
    }
    .btn.dark{
      background:var(--navy);
      color:white;
      border-color:var(--navy);
    }
    .files{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:12px;
      margin-top:24px;
    }
    .file{
      padding:18px;
      border-radius:20px;
      background:#f8fafc;
      border:1px solid rgba(15,23,42,.08);
    }
    .file span{
      display:block;
      margin-bottom:8px;
      color:var(--muted);
      font-size:10px;
      letter-spacing:.14em;
      text-transform:uppercase;
      font-weight:950;
    }
    .file strong{
      display:block;
      font-size:14px;
      line-height:1.35;
      overflow-wrap:anywhere;
    }
    .file em{
      display:block;
      margin-top:8px;
      color:#64748b;
      font-style:normal;
      font-size:12px;
      line-height:1.4;
      font-weight:720;
    }
    .below{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:16px;
      margin-top:18px;
    }
    .panel{
      padding:22px;
      border-radius:24px;
      background:white;
      border:1px solid rgba(15,23,42,.08);
      box-shadow:0 16px 42px rgba(15,23,42,.06);
    }
    .panel h3{
      margin:0;
      font-size:21px;
      line-height:1.1;
      letter-spacing:-.03em;
    }
    .panel p{
      margin:10px 0 0;
      color:#64748b;
      font-size:14px;
      line-height:1.5;
      font-weight:720;
    }
    details{margin-top:14px}
    summary{
      cursor:pointer;
      color:var(--navy);
      font-size:13px;
      font-weight:900;
    }
    .message{
      margin-top:12px;
      padding:15px 16px;
      border-radius:16px;
      background:#f8fafc;
      border:1px solid rgba(15,23,42,.08);
      color:#0f172a;
      font-size:13px;
      line-height:1.55;
      font-weight:650;
      white-space:pre-wrap;
      max-height:230px;
      overflow:auto;
    }
    .fineprint{
      margin-top:20px;
      padding:17px 19px;
      border-radius:22px;
      border:1px dashed rgba(8,35,77,.22);
      background:rgba(255,253,248,.78);
      color:#334155;
      font-size:14px;
      line-height:1.55;
      font-weight:720;
    }
    @media(max-width:820px){
      h1{font-size:42px}
      .files,.below{grid-template-columns:1fr}
      .card,.hero{padding:24px}
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <div class="kicker">HumanOrigin Package</div>
      <h1>Votre package est prêt.</h1>
      <p class="lead">
        Un seul geste : envoyez le dossier préparé au destinataire. Il contient le document lisible et la preuve vérifiable.
      </p>

      <div class="hero">
        <div class="kicker">Action principale</div>
        <h2>Envoyez ce dossier.</h2>
        <p>
          Le destinataire ouvre le PDF. La preuve signée reste dans le dossier pour vérification publique si nécessaire.
        </p>

        <div class="folder">
          <span>Dossier à transmettre</span>
          <strong>Dossier à envoyer</strong>
          <small>${esc(packageFolderName)}</small>
        </div>

        <div class="actions">
          <a class="btn" href="${esc(sendFolderHref)}" target="_blank" rel="noopener">Ouvrir le dossier à envoyer</a>
          <button class="btn" type="button" id="copySendMessage">Copier le message d’accompagnement</button>
          <a class="btn" href="${esc(sendDocumentHref)}" target="_blank" rel="noopener">Voir le PDF</a>
        </div>
      </div>

      <div class="files">
        <div class="file">
          <span>PDF publié</span>
          <strong>${esc(mainDisplayFilename)}</strong>
          <em>Document à lire normalement.</em>
        </div>
        <div class="file">
          <span>Fichier de vérification inclus</span>
          <strong>${esc(proofDisplayFilename)}</strong>
          <em>À garder dans le dossier. Ne pas ouvrir directement.</em>
        </div>
      </div>

      <div class="below">
        <div class="panel">
          <h3>Email d’accompagnement</h3>
          <p>Copiez ce message, puis joignez le dossier ${esc(packageFolderName)}.</p>
          <div class="actions">
            <button class="btn dark" type="button" id="copySendMessage2">Copier le message d’accompagnement</button>
          </div>
          <details>
            <summary>Voir le message</summary>
            <div class="message">${esc(sendMessage)}</div>
          </details>
        </div>

        <div class="panel">
          <h3>Vérification facultative</h3>
          <p>Le fichier de vérification n’est pas une page à lire. Il sert au vérificateur HumanOrigin.</p>
          <div class="actions">
            <a class="btn dark" href="${esc(contextualVerifierUrl)}" target="_blank" rel="noopener">Ouvrir le vérificateur</a>
            <a class="btn" href="${esc(archiveFolderHref)}" target="_blank" rel="noopener">Détails avancés</a>
          </div>
        </div>
      </div>

      <div class="fineprint">
        HumanOrigin ne certifie pas que le contenu du document est vrai. Il certifie qu’un processus humain mesuré a été lié à ce document et qu’une preuve portable peut être vérifiée publiquement.
      </div>
    </section>
  </main>

  <script>
    const sendMessage = ${JSON.stringify(sendMessage)};
    const buttons = [
      document.getElementById("copySendMessage"),
      document.getElementById("copySendMessage2")
    ].filter(Boolean);

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          return ok;
        } catch (_) {
          return false;
        }
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ok = await copyText(sendMessage);
        const old = btn.textContent;
        btn.textContent = ok ? "Message copié" : "Copie impossible";
        setTimeout(() => { btn.textContent = old; }, 1600);
        if (!ok) alert(sendMessage);
      });
    });
  </script>
</body>
</html>`;
}


  function buildPublishedHtml({
  projectTitle,
  documentFilename,
  publishedDocumentFilename,
  certificateId,
  issuedAt,
  verdict,
  verifierUrl,
  mime,
}) {
  const isPdf = mime === "application/pdf";
  const isImage = String(mime || "").startsWith("image/");
  const packageTitle = isPdf ? "Published Document Package" : "Package de preuve du document associé";
  const packageSubtitle = isPdf
    ? "This package contains the bound document together with the HumanOrigin proof materials and publication assets."
    : "Ce package contient le document source lié, la preuve HumanOrigin et les indications de circulation essentielles.";

  const publicationNote = isPdf
    ? `
      <div class="meta-card" style="margin-bottom:18px;">
        <div class="meta-label">Publication status</div>
        <div class="meta-value">Visible published PDF included</div>
        <div class="footer-note" style="margin-top:10px;">
          This package includes a public-facing PDF circulation format with HumanOrigin visible publication marking.
        </div>
      </div>
    `
    : `
      <div class="meta-card" style="margin-bottom:18px;">
        <style>
          .docx-guide-toolbar{
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            flex-wrap:wrap;
          }
          .docx-lang-switch{
            display:inline-flex;
            gap:6px;
            padding:4px;
            border:1px solid #d7dce4;
            border-radius:999px;
            background:#fff;
          }
          .docx-lang-switch button{
            border:0;
            background:transparent;
            padding:6px 10px;
            border-radius:999px;
            font:inherit;
            font-weight:700;
            color:#5b6980;
            cursor:pointer;
          }
          .docx-lang-switch button.is-active{
            background:#0f2b57;
            color:#fff;
          }
          .docx-guide-actions{
            display:flex;
            flex-wrap:wrap;
            gap:8px;
            margin-top:14px;
          }
          .docx-guide-actions button{
            border:1px solid #d7dce4;
            background:#fff;
            padding:10px 14px;
            border-radius:999px;
            font:inherit;
            font-weight:700;
            color:#12233d;
            cursor:pointer;
          }
          .docx-guide-actions button.is-active{
            background:#0f2b57;
            border-color:#0f2b57;
            color:#fff;
          }
          .docx-guide-answer{
            margin-top:12px;
            padding:14px 16px;
            border:1px dashed #d7dce4;
            border-radius:14px;
            background:rgba(255,255,255,0.7);
            color:#12233d;
            font-weight:700;
            line-height:1.45;
          }
        </style>

        <div class="docx-guide-toolbar">
          <div>
            <div class="meta-label" id="docxStatusLabel">STATUT DE PUBLICATION</div>
            <div class="meta-value" id="docxStatusValue">Aucune copie publique visiblement marquée n'est incluse pour ce type de fichier</div>
          </div>

          <div class="docx-lang-switch" aria-label="Language switch">
            <button type="button" class="is-active" id="docxLangFrBtn" data-docx-lang="fr">FR</button>
            <button type="button" id="docxLangEnBtn" data-docx-lang="en">EN</button>
          </div>
        </div>

        <div class="docx-guide-actions">
          <button type="button" class="is-active" id="docxActionSend" data-docx-action="send">Que faut-il envoyer ?</button>
          <button type="button" id="docxActionOpen" data-docx-action="open">Quel fichier ouvrir en premier ?</button>
          <button type="button" id="docxActionProof" data-docx-action="proof">Quel fichier fait foi ?</button>
        </div>

        <div class="docx-guide-answer" id="docxGuideAnswer">
          Envoyez le ZIP complet du package HumanOrigin. À défaut, envoyez le dossier complet contenant HumanOrigin_PUBLISHED.html, CERTIFICAT_FINALfichier de vérification et le document source lié. N'envoyez pas un fichier seul.
        </div>

        <script>
          (function () {
            const copy = {
              fr: {
                title: "Package de preuve du document associé",
                subtitle: "Ce package contient le document source lié, la preuve HumanOrigin et les indications de circulation essentielles.",
                statusLabel: "STATUT DE PUBLICATION",
                statusValue: "Aucune copie publique visiblement marquée n'est incluse pour ce type de fichier",
                actionSend: "Que faut-il envoyer ?",
                actionOpen: "Quel fichier ouvrir en premier ?",
                actionProof: "Quel fichier fait foi ?",
                answers: {
                  send: "Envoyez le ZIP complet du package HumanOrigin. À défaut, envoyez le dossier complet contenant HumanOrigin_PUBLISHED.html, CERTIFICAT_FINALfichier de vérification et le document source lié. N'envoyez pas un fichier seul.",
                  open: "Ouvrez d'abord HumanOrigin_PUBLISHED.html.",
                  proof: "Le fichier de référence est CERTIFICAT_FINALfichier de vérification."
                },
                metaLabels: [
                  "PROJET",
                  "DOCUMENT SOURCE LIÉ",
                  "ID CERTIFICAT",
                  "ÉMIS LE",
                  "VERDICT",
                  "FICHIER DE RÉFÉRENCE",
                  "À OUVRIR D'ABORD",
                  "À ENVOYER"
                ],
                sendValue: "Le ZIP complet ou le dossier complet",
                docTitle: "Document source lié",
                openDoc: "Ouvrir le document source lié",
                openTech: "Ouvrir le certificat technique",
                openVerifier: "Ouvrir le vérificateur",
                fallbackNote: "Ce document source lié est inclus dans ce package.",
                bottomNote: "Cette page est l'entrée lisible principale du package. Envoyez le dossier complet ou le ZIP, pas CERTIFICAT_FINAL.html seul. Le fichier signé CERTIFICAT_FINALfichier de vérification reste la preuve de référence.",
                verifierNote: "La vérification formelle repose sur le fichier signé fichier de vérification et sur l'empreinte du document associé. Vérificateur :"
              },
              en: {
                title: "Bound Document Proof Package",
                subtitle: "This package contains the linked source document, the HumanOrigin proof files, and the essential circulation guidance.",
                statusLabel: "PUBLICATION STATUS",
                statusValue: "No visibly marked public copy is included for this file type",
                actionSend: "What should be sent?",
                actionOpen: "Which file should be opened first?",
                actionProof: "Which file is authoritative?",
                answers: {
                  send: "Send the full HumanOrigin package ZIP. Otherwise send the full folder containing HumanOrigin_PUBLISHED.html, CERTIFICAT_FINALfichier de vérification, and the linked source document. Do not send a single file on its own.",
                  open: "Open HumanOrigin_PUBLISHED.html first.",
                  proof: "The reference proof file is CERTIFICAT_FINALfichier de vérification."
                },
                metaLabels: [
                  "PROJECT",
                  "LINKED SOURCE DOCUMENT",
                  "CERTIFICATE ID",
                  "ISSUED AT",
                  "VERDICT",
                  "REFERENCE PROOF FILE",
                  "OPEN FIRST",
                  "WHAT TO SEND"
                ],
                sendValue: "The full package ZIP or full folder",
                docTitle: "Linked source document",
                openDoc: "Open linked source document",
                openTech: "Open technical certificate",
                openVerifier: "Open verifier",
                fallbackNote: "This linked source document is included in this package.",
                bottomNote: "This page is the main readable entry for the package. Send the full package folder or ZIP, not CERTIFICAT_FINAL.html alone. The signed file CERTIFICAT_FINALfichier de vérification remains the reference proof file.",
                verifierNote: "Formal verification is based on the signed fichier de vérification file and the linked document hash. Verifier:"
              }
            };

            let currentLang = "fr";
            let currentAction = "send";

            function safeLocalStorageSet(key, value) {
              try { localStorage.setItem(key, value); } catch (_) {}
            }

            function safeLocalStorageGet(key) {
              try { return localStorage.getItem(key); } catch (_) { return null; }
            }

            function setActiveLangButtons(lang) {
              const frBtn = document.getElementById("docxLangFrBtn");
              const enBtn = document.getElementById("docxLangEnBtn");
              if (frBtn) frBtn.classList.toggle("is-active", lang === "fr");
              if (enBtn) enBtn.classList.toggle("is-active", lang === "en");
            }

            function setActiveActionButtons(action) {
              const sendBtn = document.getElementById("docxActionSend");
              const openBtn = document.getElementById("docxActionOpen");
              const proofBtn = document.getElementById("docxActionProof");
              if (sendBtn) sendBtn.classList.toggle("is-active", action === "send");
              if (openBtn) openBtn.classList.toggle("is-active", action === "open");
              if (proofBtn) proofBtn.classList.toggle("is-active", action === "proof");
            }

            function applyLang(lang) {
              currentLang = lang;
              safeLocalStorageSet("ho_docx_lang", lang);
              const c = copy[lang];

              const heroTitle = document.querySelector("h1");
              if (heroTitle) heroTitle.textContent = c.title;

              const heroSubtitle = heroTitle && heroTitle.nextElementSibling;
              if (heroSubtitle) heroSubtitle.textContent = c.subtitle;

              const statusLabel = document.getElementById("docxStatusLabel");
              const statusValue = document.getElementById("docxStatusValue");
              if (statusLabel) statusLabel.textContent = c.statusLabel;
              if (statusValue) statusValue.textContent = c.statusValue;

              const sendBtn = document.getElementById("docxActionSend");
              const openBtn = document.getElementById("docxActionOpen");
              const proofBtn = document.getElementById("docxActionProof");
              if (sendBtn) sendBtn.textContent = c.actionSend;
              if (openBtn) openBtn.textContent = c.actionOpen;
              if (proofBtn) proofBtn.textContent = c.actionProof;

              const metaLabels = document.querySelectorAll(".meta-grid .meta-card .meta-label");
              const metaValues = document.querySelectorAll(".meta-grid .meta-card .meta-value");

              if (metaLabels[0]) metaLabels[0].textContent = c.metaLabels[0];
              if (metaLabels[1]) metaLabels[1].textContent = c.metaLabels[1];
              if (metaLabels[2]) metaLabels[2].textContent = c.metaLabels[2];
              if (metaLabels[3]) metaLabels[3].textContent = c.metaLabels[3];
              if (metaLabels[4]) metaLabels[4].textContent = c.metaLabels[4];
              if (metaLabels[5]) metaLabels[5].textContent = c.metaLabels[5];
              if (metaLabels[6]) metaLabels[6].textContent = c.metaLabels[6];
              if (metaLabels[7]) metaLabels[7].textContent = c.metaLabels[7];

              if (metaValues[6]) metaValues[6].textContent = "HumanOrigin_PUBLISHED.html";
              if (metaValues[7]) metaValues[7].textContent = c.sendValue;

              const docTitle = document.querySelector(".doc .doc-title");
              if (docTitle) docTitle.textContent = c.docTitle;

              const topButtons = document.querySelectorAll(".doc .actions .btn");
              if (topButtons[0]) topButtons[0].textContent = c.openDoc;
              if (topButtons[1]) topButtons[1].textContent = c.openTech;
              if (topButtons[2]) topButtons[2].textContent = c.openVerifier;

              const fallbackNote = document.querySelector(".fallback-card p");
              if (fallbackNote) fallbackNote.textContent = c.fallbackNote;

              const openButtons = document.querySelectorAll("a.open-btn");
              openButtons.forEach((btn) => {
                btn.textContent = c.openDoc;
              });

              const footerNotes = Array.from(document.querySelectorAll(".footer-note"));
              const verifierNoteEl = footerNotes.find((el) => el.textContent.includes("Formal verification") || el.textContent.includes("La vérification formelle"));
              if (verifierNoteEl) {
                const rawVerifierText = verifierNoteEl.textContent || "";
                const httpIndex = rawVerifierText.indexOf("http");
                const url = httpIndex >= 0 ? rawVerifierText.slice(httpIndex).trim() : "";
                verifierNoteEl.textContent = c.verifierNote + (url ? " " + url : "");
              }

              const bottomNoteEl = Array.from(document.querySelectorAll(".doc .footer-note")).pop();
              if (bottomNoteEl) bottomNoteEl.textContent = c.bottomNote;

              setActiveLangButtons(lang);
              window.__hoDocxShow(currentAction);
            }

            window.__hoDocxSetLang = function (lang) {
              applyLang(lang === "en" ? "en" : "fr");
            };

            window.__hoDocxShow = function (action) {
              currentAction = action;
              const c = copy[currentLang];
              const answer = document.getElementById("docxGuideAnswer");
              if (answer) answer.textContent = c.answers[action] || c.answers.send;
              setActiveActionButtons(action);
            };

            function initDocxGuide() {
              document.querySelectorAll("[data-docx-lang]").forEach((btn) => {
                btn.addEventListener("click", () => {
                  window.__hoDocxSetLang(btn.getAttribute("data-docx-lang"));
                });
              });

              document.querySelectorAll("[data-docx-action]").forEach((btn) => {
                btn.addEventListener("click", () => {
                  window.__hoDocxShow(btn.getAttribute("data-docx-action"));
                });
              });

              const lang = safeLocalStorageGet("ho_docx_lang") || "fr";
              applyLang(lang === "en" ? "en" : "fr");
              window.__hoDocxShow("send");
            }

            if (document.readyState === "loading") {
              document.addEventListener("DOMContentLoaded", initDocxGuide);
            } else {
              initDocxGuide();
            }
          })();
        </script>
      </div>
    `;

  let previewHtml = `
    <div class="fallback-card">
      <p>Ce document source lié est inclus dans ce package.</p>
      <a class="open-btn" href="${esc(publishedDocumentFilename)}" target="_blank" rel="noopener">
        Open linked source document
      </a>
    </div>
  `;

  if (isPdf) {
    previewHtml = `
      <div class="viewer-frame">
        <iframe src="${esc(publishedDocumentFilename)}#view=FitH" title="Bound document preview"></iframe>
      </div>
    `;
  } else if (isImage) {
    previewHtml = `
      <div class="viewer-image">
        <img src="${esc(publishedDocumentFilename)}" alt="Bound document preview" />
      </div>
    `;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>HumanOrigin Published Document</title>
  <style>
    body{
      margin:0;
      background:#f3f6fb;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      color:#0b1220;
    }
    .wrap{
      max-width:1180px;
      margin:0 auto;
      padding:28px;
    }
    .top{
      display:grid;
      grid-template-columns:1fr auto;
      gap:18px;
      align-items:start;
      margin-bottom:24px;
    }
    .hero{
      background:#ffffff;
      border:1px solid #dbe3ee;
      border-radius:24px;
      padding:24px;
      box-shadow:0 18px 48px rgba(15,23,42,0.08);
    }
    .kicker{
      font-size:12px;
      font-weight:800;
      letter-spacing:.12em;
      text-transform:uppercase;
      color:#64748b;
      margin-bottom:10px;
    }
    h1{
      margin:0 0 8px 0;
      font-size:34px;
      line-height:1.03;
      letter-spacing:-0.03em;
    }
    .sub{
      color:#475569;
      font-size:16px;
      line-height:1.5;
      margin-bottom:18px;
    }
    .meta{
      display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr));
      gap:14px;
      margin-top:18px;
    }
    .meta-card{
      background:#f8fbff;
      border:1px solid #e2e8f0;
      border-radius:18px;
      padding:16px;
    }
    .meta-label{
      font-size:11px;
      font-weight:800;
      letter-spacing:.08em;
      text-transform:uppercase;
      color:#64748b;
      margin-bottom:8px;
    }
    .meta-value{
      font-size:15px;
      font-weight:700;
      color:#0b1220;
      word-break:break-word;
    }
    .mono{
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      font-size:13px;
      color:#334155;
      word-break:break-word;
    }
    .cartouche{
      background:#ffffff;
      border:1px solid #dbe3ee;
      border-radius:24px;
      padding:16px;
      box-shadow:0 18px 48px rgba(15,23,42,0.08);
      max-width:420px;
    }
    .cartouche img{
      display:block;
      width:100%;
      height:auto;
    }
    .doc{
      background:#ffffff;
      border:1px solid #dbe3ee;
      border-radius:24px;
      padding:20px;
      box-shadow:0 18px 48px rgba(15,23,42,0.08);
    }
    .doc-top{
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:16px;
      margin-bottom:16px;
      flex-wrap:wrap;
    }
    .doc-title{
      font-size:20px;
      font-weight:900;
      letter-spacing:-0.02em;
    }
    .actions{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
    }
    .btn, .open-btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:11px 14px;
      border-radius:14px;
      border:1px solid rgba(14,29,58,0.12);
      background:#0f274a;
      color:#ffffff;
      text-decoration:none;
      font-weight:850;
    }
    .btn.secondary{
      background:#ffffff;
      color:#0b1220;
    }
    .viewer-frame{
      border:1px solid #e2e8f0;
      border-radius:18px;
      overflow:hidden;
      background:#fff;
      height:78vh;
      min-height:640px;
    }
    .viewer-frame iframe{
      width:100%;
      height:100%;
      border:0;
      display:block;
      background:#fff;
    }
    .viewer-image{
      border:1px solid #e2e8f0;
      border-radius:18px;
      background:#fff;
      padding:18px;
      text-align:center;
    }
    .viewer-image img{
      max-width:100%;
      height:auto;
      display:block;
      margin:0 auto;
    }
    .fallback-card{
      border:1px dashed #cbd5e1;
      border-radius:18px;
      padding:26px;
      background:#f8fbff;
    }
    .footer-note{
      margin-top:18px;
      color:#64748b;
      font-size:13px;
      line-height:1.5;
    }
    @media (max-width: 980px){
      .top{ grid-template-columns:1fr; }
      .meta{ grid-template-columns:1fr; }
      .cartouche{ max-width:none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="hero">
        <div class="kicker">HumanOrigin</div>
        <h1>${packageTitle}</h1>
        <div class="sub">
          ${packageSubtitle}
        </div>

        ${publicationNote}

        <div class="meta">
          <div class="meta-card">
            <div class="meta-label">Project</div>
            <div class="meta-value">${esc(projectTitle)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">${isPdf ? "Bound document" : "Document source lié"}</div>
            <div class="meta-value">${esc(documentFilename)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Certificate ID</div>
            <div class="mono">${esc(certificateId)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Issued at</div>
            <div class="meta-value">${esc(issuedAt)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Verdict</div>
            <div class="meta-value">${esc(verdict)}</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">Source of truth</div>
            <div class="meta-value">CERTIFICAT_FINALfichier de vérification</div>
          </div>
          ${!isPdf ? `
          <div class="meta-card">
            <div class="meta-label">À OUVRIR D'ABORD</div>
            <div class="meta-value">HumanOrigin_PUBLISHED.html</div>
          </div>
          <div class="meta-card">
            <div class="meta-label">À ENVOYER</div>
            <div class="meta-value">The full package folder or ZIP</div>
          </div>` : ""}
        </div>

        <div class="footer-note">
          Formal verification is based on the signed <strong>fichier de vérification</strong> proof file and the bound document hash.
          Verifier: ${esc(verifierUrl)}
        </div>
      </div>

      <div class="cartouche">
        <img src="HumanOrigin_CARTOUCHE.png" alt="HumanOrigin cartouche" />
      </div>
    </div>

    <div class="doc">
      <div class="doc-top">
        <div class="doc-title">${isPdf ? "Bound document" : "Document source lié"}</div>
        <div class="actions">
          <a class="btn" href="${esc(publishedDocumentFilename)}" target="_blank" rel="noopener">${isPdf ? "Open bound document" : "Ouvrir le document source lié"}</a>
          <a class="btn secondary" href="CERTIFICAT_FINAL.html" target="_blank" rel="noopener">${isPdf ? "Open certificate" : "Ouvrir le certificat technique"}</a>
          <a class="btn secondary" href="${esc(verifierUrl)}" target="_blank" rel="noopener">Ouvrir le vérificateur</a>
        </div>
      </div>

      ${previewHtml}

      <div class="footer-note">
        ${isPdf
          ? `This page is a readable package view. The signed file <strong>CERTIFICAT_FINALfichier de vérification</strong> remains the authoritative proof object.`
          : `Cette page est l'entrée lisible principale du package. Envoyez le ZIP complet du package HumanOrigin ou le dossier complet, pas <strong>CERTIFICAT_FINAL.html</strong> seul. Le fichier signé <strong>CERTIFICAT_FINALfichier de vérification</strong> reste la preuve de référence.`}
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function renderPublicationKitPngs({
  badgeSvg,
  badgePngPath,
  cartoucheSvg,
  cartouchePngPath,
  cartoucheCompactSvg,
  cartoucheCompactPngPath,
  stampSvg,
  stampPngPath,
}) {
  await invoke("render_svg_to_png", {
    svg: badgeSvg,
    outputPath: badgePngPath,
    width: 2200,
  });

  await invoke("render_svg_to_png", {
    svg: cartoucheSvg,
    outputPath: cartouchePngPath,
    width: 2400,
  });

  await invoke("render_svg_to_png", {
    svg: cartoucheCompactSvg,
    outputPath: cartoucheCompactPngPath,
    width: 2200,
  });

  await invoke("render_svg_to_png", {
    svg: stampSvg,
    outputPath: stampPngPath,
    width: 2000,
  });
}

// =========================================================
// UPDATE TAURI
// =========================================================
async function tauriCheckAndInstallUpdate() {
  try {
    console.log("[UPDATER] checkUpdate…");
    toast("Check update…");

    const { shouldUpdate, manifest } = await checkUpdate();
    console.log("[UPDATER] shouldUpdate=", shouldUpdate, "manifest=", manifest);

    if (!shouldUpdate) {
      toast("Aucune mise à jour.");
      return;
    }

    const ok = confirm(`Mise à jour dispo (${manifest?.version}). Installer maintenant ?`);
    if (!ok) return;

    console.log("[UPDATER] installUpdate…");
    toast("Téléchargement…");

    await installUpdate();

    console.log("[UPDATER] install done → relaunch()");
    toast("Install OK, redémarrage…");
    await relaunch();
  } catch (e) {
    console.error("[UPDATER] ERROR:", e);
    alert("Erreur update: " + (e?.message || JSON.stringify(e)));
  }
}

// =========================================================
// GLOBAL EXPOSURE (safe)
// =========================================================
window.initProject = initProject;
window.startScan = startScan;
window.stopScan = stopScan;
window.finalizeSession = finalizeSession;
window.changeProject = changeProject;
window.handleLogout = handleLogout;
window.exportFinalProjectCertificate = exportFinalProjectCertificate;
window.tauriCheckAndInstallUpdate = tauriCheckAndInstallUpdate;

// =========================================================
// BOOT
// =========================================================
setupDeepLinkListeners().catch(() => {});

window.addEventListener("focus", () => {
  if (isPermissionsScreenVisible()) {
    refreshPermissionsStateAndMaybeContinue().catch(() => {});
  }
});

// visibilitychange disabled on macOS to avoid duplicate permission resume

window.addEventListener("DOMContentLoaded", async () => {
  hoBootMark("dom:loaded");
  setupDeepLinkListeners().catch(() => {});

  const __hoLoginTitle = document.querySelector("#login-screen .brand-title");
  if (__hoLoginTitle) __hoLoginTitle.innerText = "Accédez à votre espace HumanOrigin";

  try {
    const v = await app.getVersion();
    const el = $("app-version");
    if (el) el.innerText = `Version ${v} · Sécurisé par Ed25519`;
  } catch {}

  on("login-btn", async () => {
    const email = $("email")?.value?.trim();
    if (!email) {
      alert("Email requis");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: "humanorigin://login" },
    });

    if (error) alert(error.message);
    else toast("Lien envoyé ✅");
  });

  on("logout-btn", handleLogout);
  on("change-project-btn", changeProject);
  on("init-btn", initProject);
  on("start-btn", startScan);
  on("stop-btn", stopScan);
  on("finalize-btn", finalizeSession);
  on("sync-btn", () => refreshHistory().catch(() => {}));
  on("close-project-btn", exportFinalProjectCertificate);
  on("check-update-btn", tauriCheckAndInstallUpdate);

  window.addEventListener("paste", (e) => {
    if (!isScanningUI) return;

    try {
      const txt = (e.clipboardData || window.clipboardData).getData("text") || "";
      pasteStats.paste_events += 1;
      pasteStats.pasted_chars += txt.length;
      pasteStats.max_paste_chars = Math.max(pasteStats.max_paste_chars, txt.length);
    } catch {}
  });

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      bumpEpoch();
      resetAllStateToLogin();
      return;
    }

    currentUser = session.user;
    safeText("user-email-display", currentUser?.email || "");

    if (event === "SIGNED_IN") {
      await forcePostLogin().catch(() => {});
    }
  });

  await forcePostLogin().catch(() => showScreen("LOGIN"));
});
