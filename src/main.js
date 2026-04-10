// /src/main.js — V3.2.1 FULL + PUBLICATION KIT V1
// Flow: Boot -> Permissions Mac -> (Tuto bypass) -> Login -> Dashboard
// Key rules restored:
// - 1 certificat TEMP par session (même volume faible, confirmation)
// - 1 certificat FINAL par session si gate OK
// - 1 certificat FINAL projet via finalize_project (toujours accessible)
// - Historique affiche CERTIFIED + CERTIFIED_TEMP
// - DeepLink macOS fiable via `tauri://open-url` + buffer pending
// Publication Kit V1:
// - CERTIFICAT_FINAL.html
// - CERTIFICAT_FINAL.ho.json
// - HumanOrigin_STAMP.svg / .png
// - HumanOrigin_BADGE.svg / .png
// - HumanOrigin_CARTOUCHE.svg / .png
// - HumanOrigin_CARTOUCHE_COMPACT.svg / .png
// - HumanOrigin_VERIFY.txt

import { invoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/api/dialog";
import { writeTextFile } from "@tauri-apps/api/fs";
import { createClient } from "@supabase/supabase-js";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import * as app from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/api/process";
import QRCode from "qrcode";
import { Command } from "@tauri-apps/api/shell";

console.log("HumanOrigin main.js V3.2.1 FULL + Publication Kit V1 loaded ✅");

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
  currentScreenName = screenName;
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
      safeText("current-project-title", "Sélection du projet");
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
  const accessOk = await isMacPermissionsOk();
  if (!accessOk) {
    await showPermissionsWall();
    return false;
  }
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
    if (!confirm("Un scan est en cours. Se déconnecter l'arrêtera. Continuer ?")) return;
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

    const { data } = await supabase.auth.getSession();
    if (epochIsStale(myEpoch)) return;

    if (!data?.session) {
      showScreen("LOGIN");
      return;
    }

    currentUser = data.session.user;
    safeText("user-email-display", currentUser?.email || "");

    if (checkAndShowTuto()) return;

    if (currentProjectName) showScreen("DASHBOARD");
    else showScreen("PROJECT_SELECT");

    await loadProjectList().catch(() => {});
    if (epochIsStale(myEpoch)) return;

    refreshHistory().catch(() => {});
    checkForDrafts(true).catch(() => {});
  } catch (e) {
    console.warn("forcePostLogin failed", e);
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
}

// =========================================================
// PROJECTS
// =========================================================
async function loadProjectList() {
  try {
    const projects = await invoke("get_projects");
    const sel = $("project-selector");
    if (!sel) return;

    sel.innerHTML = '<option value="" disabled selected>Choisir un projet...</option>';

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
      btn.innerText = "Charger";
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
    if (!confirm("Un scan est en cours. L'arrêter pour changer de projet ?")) return;
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
    toast("Scan arrêté. Brouillon enregistré.");

    const gatePassed = snap?.diag?.analysis?.gate_passed;
    const finBtn = $("finalize-btn");
    if (finBtn) {
      finBtn.disabled = false;
      finBtn.innerText = "Certifier la Session";
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
    alert("Erreur arrêt scan: " + e);
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
    finBtn.innerText = "Certifier la Session";
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
      if (finBtn.innerText === "Certifiée ✅") finBtn.innerText = "Certifier la Session";
    }
  }
}

// =========================================================
// CERTIFICATION (SESSION) — TEMP always possible
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
      btn.innerText = cloudOk ? "Certifiée ✅" : "Certifiée locale ✅";
      btn.disabled = true;
    }

    if (cloudOk) {
      toast(isTemporary ? "Session TEMP certifiée ✅" : "Session certifiée ✅");
      await refreshHistory().catch(() => {});
    } else {
      toast(isTemporary ? "Session TEMP certifiée en local ✅" : "Session certifiée en local ✅");
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
      btn.innerText = "Certifier la Session";
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
    alert("Impossible de démarrer le scan : " + e);
  }
}

// =========================================================
// HISTORIQUE — shows CERTIFIED + CERTIFIED_TEMP
// =========================================================
async function refreshHistory() {
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
      const label = isTemp ? "TEMP" : v.label;
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
// =========================================================
// FINAL PROJECT CERTIFICATE (HTML + HO-JSON + PUBLICATION KIT)
// =========================================================
async function exportFinalProjectCertificate() {
  if (!currentProjectPath) {
    alert("Projet non chargé.");
    return;
  }

  const bind = await pickDocumentToBind();
  if (!bind) {
    alert("Sélection annulée. Aucun document certifié.");
    return;
  }

  toast("Génération du certificat final projet...");

  try {
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });
    console.log("[FINALIZE_PROJECT]", res);

    if (!res?.html_path) {
      alert("finalize_project n'a pas renvoyé de html_path");
      return;
    }

    const projectValid = Boolean(res?.project_valid);
    const scp = Number(res?.scp_score ?? 0);

    let verdict = "INCOMPLETE";
    let reasons = [];

    if (!projectValid) {
      verdict = "INCOMPLETE";
      reasons = [String(res?.validation_reason || "VOLUME INSUFFISANT")];
    } else {
      verdict = scp >= 80 ? "COHERENT" : scp >= 50 ? "ATYPIQUE" : "SUSPECT";
      reasons = [];
    }

    const appVersion = await app.getVersion().catch(() => "unknown");
    const certificateId = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const verifierUrl = "https://427h5dvrch-lang.github.io/humanorigin-verifier/";

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

    const publishedDocumentFilename = `BOUND_DOCUMENT.${fileExtLower(bind.filename)}`;
    const publishedDocumentPath = `${dir}${sep}${publishedDocumentFilename}`;

    const publishedHtmlPath = `${dir}${sep}HumanOrigin_PUBLISHED.html`;
    const publishedPdfFilename = "HumanOrigin_PUBLISHED.pdf";
    const publishedPdfPath = `${dir}${sep}${publishedPdfFilename}`;

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
      publishedOutputFilename: bind.mime === "application/pdf" ? publishedPdfFilename : null,
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

    const hoPath = String(res.html_path).replace(/\.html$/i, ".ho.json");
    const hoPathV1 = String(res.html_path).replace(/\.html$/i, ".v1.ho.json");

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

    if (bind.mime === "application/pdf") {
      const publicationJobJson = buildPublicationJob({
        sourcePdfPath: publishedDocumentPath,
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
          sourcePdfPath: publishedDocumentPath,
          outputPdfPath: publishedPdfPath,
          cartoucheCompactPngPath: cartoucheCompactPngPath,
          verifyUrl: verifierUrl,
          certificateId,
          verdict,
        },
      });

      console.log("[PUBLISHER RESULT]", publishResult);

      toast("PDF publié HumanOrigin généré ✅");
      const finalPdfPath = publishResult.output_pdf_path || publishedPdfPath;
      toast("PDF publié HumanOrigin généré ✅");
      await invoke("open_file", { path: finalPdfPath });
      return;
    }

    toast("Kit de diffusion HumanOrigin généré ✅");
    await invoke("open_file", { path: publishedHtmlPath });
  } catch (e) {
    console.error("exportFinalProjectCertificate failed", e);
    alert("Erreur export final projet : " + (e?.message || e));
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
    btnRecover.innerText = "Reprendre · " + (d0.project_name || "");
    btnRecover.onclick = async () => {
      if (!currentProjectName && d0.project_name) {
        await quickActivateProjectByName(d0.project_name);
      }
      await recoverDraft(d0.session_id);
    };

    if (!$("btn-drafts-all")) {
      const btnAll = document.createElement("button");
      btnAll.id = "btn-drafts-all";
      btnAll.innerText = "Bibliothèque";
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
      finBtn.innerText = "Certifier la Session";
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
    label: "INCOMPLETE",
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
  <text x="36" y="92" class="sub">Biological Origin Record</text>

  <rect x="36" y="118" width="164" height="38" rx="19" fill="${visual.bg}" stroke="${visual.border}" />
  <text x="118" y="143" text-anchor="middle" class="verdict" font-size="18">${visual.label}</text>

  <text x="36" y="188" class="body">Registered in a public verification chain</text>
  <text x="36" y="218" class="mono">Registry ID: ${idShort} · ${dateLabel}</text>
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

  const url = verifierUrl.includes("?")
    ? `${verifierUrl}&id=${encodeURIComponent(idShort)}`
    : `${verifierUrl}?id=${encodeURIComponent(idShort)}`;

  const QR_BOX_SIZE = 136;
  const QR_PADDING = 8;
  const QR_SIZE = QR_BOX_SIZE - (QR_PADDING * 2); // 120

  const qrSvgRaw = await QRCode.toString(url, {
    type: "svg",
    margin: 0,
    width: QR_SIZE,
  });

 const qrViewBox =
  qrSvgRaw.match(/viewBox="([^"]+)"/)?.[1] || "0 0 29 29";

const qrInner = qrSvgRaw
  .replace(/<\?xml[\s\S]*?\?>\s*/g, "")
  .replace(/<!DOCTYPE[\s\S]*?>\s*/g, "")
  .replace(/^.*?<svg[^>]*>/s, "")
  .replace(/<\/svg>\s*$/s, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="160" viewBox="0 0 720 160">
  <defs>
    <style>
      .paper{fill:#fffdf8}
      .border{fill:none;stroke:#d7dde7;stroke-width:2}
      .brand{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;font-size:30px;fill:#0b1220}
      .sub{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:700;font-size:13px;fill:#475569}
      .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;fill:#475569}
      .pill{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;font-weight:900;font-size:13px;fill:${visual.color}}
    </style>
  </defs>

  <rect x="1" y="1" width="718" height="158" rx="22" class="paper"/>
  <rect x="1" y="1" width="718" height="158" rx="22" class="border"/>

  <text x="28" y="52" class="brand">HumanOrigin</text>
  <text x="28" y="77" class="sub">Biological Origin Record</text>

  <rect x="28" y="96" width="150" height="32" rx="16" fill="${visual.bg}" stroke="${visual.border}" />
  <text x="103" y="117" text-anchor="middle" class="pill">${visual.label}</text>

  <text x="196" y="116" class="mono">Registry ID: ${idShort} · ${dateLabel}</text>

  <g transform="translate(566,12)">
    <rect x="0" y="0" width="${QR_BOX_SIZE}" height="${QR_BOX_SIZE}" rx="18" fill="#ffffff" stroke="#d7dde7" stroke-width="2"/>
    <svg
  x="${QR_PADDING}"
  y="${QR_PADDING}"
  width="${QR_SIZE}"
  height="${QR_SIZE}"
  viewBox="${qrViewBox}"
  shape-rendering="crispEdges"
>
  ${qrInner}
</svg>
  </g>
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
  <text x="26" y="76" class="m" font-size="14">Biological Origin Record</text>

  <text x="26" y="110" class="m" font-size="16">Verdict: <tspan class="h" font-size="16">${verdictLabel}</tspan></text>
  <text x="26" y="132" class="t">Registry ID: ${idShort}</text>
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
- CERTIFICAT_FINAL.ho.json  -> signed proof file
- CERTIFICAT_FINAL.html     -> human-readable certificate
- HumanOrigin_PUBLISHED.pdf -> published marked document (when PDF publication is used)
- HumanOrigin_CARTOUCHE*.svg/.png -> visible public mark assets

SOURCE OF TRUTH

The signed file CERTIFICAT_FINAL.ho.json is the source of truth.
The visible cartouche, badge, stamp, or PDF marking are public-facing markers,
but the signed .ho.json file is the authoritative proof object.

HOW TO VERIFY

1. Open the verifier:
${verifierUrl}

2. Drag and drop:
CERTIFICAT_FINAL.ho.json

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
The signed .ho.json file remains the authoritative verification artifact.
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
- use CERTIFICAT_FINAL.ho.json as the source of truth
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

4. CERTIFICAT_FINAL.ho.json
   Signed proof object (source of truth)

SOURCE OF TRUTH

The authoritative proof file is:
CERTIFICAT_FINAL.ho.json

The cartouche, badge, stamp, HTML certificate, and published PDF are visibility and presentation assets.
Formal verification is based on the signed .ho.json file and the bound document hash.

${publicationStatus}

HOW TO VERIFY

1. Open the verifier:
${verifierUrl}

2. Load:
CERTIFICAT_FINAL.ho.json

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
        <div class="value" style="margin-bottom:8px;">CERTIFICAT_FINAL.ho.json</div>
        <div style="font-size:14px;line-height:1.55;color:#475569;">
          The HTML views and visible marks help circulation and reading.
          Formal verification is based on the signed <strong>.ho.json</strong> proof file and the bound document hash.
        </div>
      </div>

      <div style="margin:0 0 24px 0;padding:16px 18px;border:1px solid #dbe3ee;border-radius:18px;background:#fcfdff;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:10px;">
          Verification note
        </div>

        <div style="font-size:15px;line-height:1.55;color:#0b1220;margin-bottom:10px;">
          This HTML certificate is a readable presentation of the HumanOrigin package.
          The signed file <strong>CERTIFICAT_FINAL.ho.json</strong> is the authoritative proof object.
        </div>

        <div style="font-size:14px;line-height:1.55;color:#475569;margin-bottom:12px;">
          Visible assets such as the cartouche, badge, stamp, or published PDF help circulation and recognition,
          but formal verification is based on the signed <strong>.ho.json</strong> artifact and the bound document hash.
        </div>

        <div style="font-size:14px;line-height:1.6;color:#0b1220;">
          <strong>How to verify:</strong><br/>
          1. Open the verifier: <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${esc(verifierUrl)}</span><br/>
          2. Load <strong>CERTIFICAT_FINAL.ho.json</strong><br/>
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
              <li>Load <strong>CERTIFICAT_FINAL.ho.json</strong></li>
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
}) {
  const files = [
    "CERTIFICAT_FINAL.html",
    "CERTIFICAT_FINAL.ho.json",
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

      publication_status: publishedOutputFilename
        ? "visible_published_copy_included"
        : "no_native_visible_published_copy_for_this_file_type",

      recommended_public_workflow: publishedOutputFilename
        ? "Use the included published output for public circulation."
        : "Keep the bound source file as working source, use CERTIFICAT_FINAL.ho.json as source of truth, and publish a PDF later when a visibly marked public document is needed.",
      certificate_id: certificateId,
      issued_at: issuedAt,
      verdict,
      verifier_url: verifierUrl,

      source_of_truth: {
        primary_file: "CERTIFICAT_FINAL.ho.json",
        description: "Signed HumanOrigin proof object",
      },

      recommended_opening_order: [
        "HumanOrigin_READ_ME_FIRST.txt",
        "CERTIFICAT_FINAL.html",
        "HumanOrigin_VERIFY.txt",
        "CERTIFICAT_FINAL.ho.json",
      ],

      verification_summary: {
        verifier_url: verifierUrl,
        steps: [
          "Open the verifier",
          "Load CERTIFICAT_FINAL.ho.json",
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
  const packageTitle = isPdf ? "Published Document Package" : "Bound Document Package";
  const packageSubtitle = isPdf
    ? "This package contains the bound document together with the HumanOrigin proof materials and publication assets."
    : "This package contains the bound source document together with the HumanOrigin proof materials and circulation assets.";

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
        <div class="meta-label">Publication status</div>
        <div class="meta-value">No native visibly marked published copy for this file type</div>
        <div class="footer-note" style="margin-top:10px;">
          This bound source file is included and linked to the HumanOrigin proof package.
          Formal verification remains valid through <strong>CERTIFICAT_FINAL.ho.json</strong> and the bound document hash.
          When a public visibly marked circulation version is needed, the recommended path is to publish a PDF later.
        </div>
      </div>
    `;

  let previewHtml = `
    <div class="fallback-card">
      <p>This bound document is included in this package.</p>
      <a class="open-btn" href="${esc(publishedDocumentFilename)}" target="_blank" rel="noopener">
        Open bound document
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
            <div class="meta-label">Bound document</div>
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
            <div class="meta-value">CERTIFICAT_FINAL.ho.json</div>
          </div>
        </div>

        <div class="footer-note">
          Formal verification is based on the signed <strong>.ho.json</strong> proof file and the bound document hash.
          Verifier: ${esc(verifierUrl)}
        </div>
      </div>

      <div class="cartouche">
        <img src="HumanOrigin_CARTOUCHE.png" alt="HumanOrigin cartouche" />
      </div>
    </div>

    <div class="doc">
      <div class="doc-top">
        <div class="doc-title">Bound document</div>
        <div class="actions">
          <a class="btn" href="${esc(publishedDocumentFilename)}" target="_blank" rel="noopener">Open bound document</a>
          <a class="btn secondary" href="CERTIFICAT_FINAL.html" target="_blank" rel="noopener">Open certificate</a>
          <a class="btn secondary" href="${esc(verifierUrl)}" target="_blank" rel="noopener">Open verifier</a>
        </div>
      </div>

      ${previewHtml}

      <div class="footer-note">
        This page is a readable package view. The signed file <strong>CERTIFICAT_FINAL.ho.json</strong> remains the authoritative proof object.
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

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      bumpEpoch();
      resetAllStateToLogin();
      return;
    }

    currentUser = session.user;
    safeText("user-email-display", currentUser?.email || "");
    await forcePostLogin().catch(() => {});
  });

  await forcePostLogin().catch(() => showScreen("LOGIN"));
});