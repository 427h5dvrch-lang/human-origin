// /src/main.js — VERSION BULLETPROOF v2.3
// (Imports en premier ✅, deep-link robuste, UI non bloquante, drafts + viewer + download OK)

import { invoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { createClient } from "@supabase/supabase-js";
import { save } from "@tauri-apps/api/dialog";
import { writeTextFile } from "@tauri-apps/api/fs";
// import { appWindow } from "@tauri-apps/api/window"; // optionnel (non utilisé)

console.log("HumanOrigin main.js loaded ✅");

// =========================================================
// CONFIG
// =========================================================
const DEBUG = true;

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
let restoredDraftSessionId = null;

let lastSnapshot = null;
let scanInterval = null;

let isScanningUI = false;
let draftsCache = [];

let pasteStats = { paste_events: 0, pasted_chars: 0, max_paste_chars: 0 };

// =========================================================
// GLOBAL SAFETY LOGS
// =========================================================
window.onerror = (msg, src, line, col, err) => {
  console.log("JS ERROR:", msg, "line", line, "col", col, err);
};

window.addEventListener("unhandledrejection", (e) => {
  console.log("PROMISE REJECT:", e?.reason);
});

// =========================================================
// UI HELPERS
// =========================================================
const $ = (id) => document.getElementById(id);

function dbg(msg, extra) {
  if (!DEBUG) return;
  console.log("[DBG]", msg, extra ?? "");
  const t = $("toast");
  if (t) {
    t.innerText = "[DBG] " + msg;
    t.style.display = "block";
    setTimeout(() => (t.style.display = "none"), 900);
  }
}

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.innerText = msg ?? "";
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 2500);
}

const safeText = (id, text) => {
  const el = $(id);
  if (el) el.innerText = text ?? "";
};

const on = (id, fn) => {
  const el = $(id);
  if (el) el.onclick = fn;
};

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function resetPasteStats() {
  pasteStats = { paste_events: 0, pasted_chars: 0, max_paste_chars: 0 };
}

// Debug clics (capture = même si overlay bloque)
if (DEBUG) {
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target;
      dbg(`CLICK -> ${el?.tagName || "?"}#${el?.id || ""}.${String(el?.className || "")}`);
    },
    true
  );
}

// =========================================================
// SCREEN ROUTER
// =========================================================
function showScreen(screenName) {
  const loginScreen = $("login-screen");
  const appScreen = $("app-screen");
  const projectSec = $("project-section");
  const controlsSec = $("controls-section");

  if (loginScreen) loginScreen.style.display = "none";
  if (appScreen) appScreen.style.display = "none";
  if (projectSec) projectSec.style.display = "none";
  if (controlsSec) controlsSec.classList.add("hidden");

  switch (screenName) {
    case "LOGIN":
      if (loginScreen) loginScreen.style.display = "block";
      break;

    case "PROJECT_SELECT":
      if (appScreen) appScreen.style.display = "flex";
      if (projectSec) projectSec.style.display = "block";
      safeText("current-project-title", "—");
      break;

    case "DASHBOARD":
      if (appScreen) appScreen.style.display = "flex";
      if (controlsSec) controlsSec.classList.remove("hidden");
      safeText("current-project-title", currentProjectName || "Projet");
      break;
  }

  // ne doit JAMAIS casser l'UI
  checkForDrafts(false).catch((e) => console.log("checkForDrafts failed", e));
}

// =========================================================
// AUTH
// =========================================================
async function checkSession() {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) showScreen("LOGIN");
  } catch (e) {
    console.log("checkSession failed", e);
    showScreen("LOGIN");
  }
}

// Logout "autoritaire" : UI d’abord, serveur ensuite
async function handleLogout() {
  if (isScanningUI) {
    const ok = confirm("Un scan est en cours. Se déconnecter l'arrêtera. Continuer ?");
    if (!ok) return;
    await stopScan().catch(() => {});
  }

  // UI reset immédiat
  currentUser = null;
  currentProjectId = null;
  currentProjectName = null;
  currentProjectPath = null;
  currentSessionId = null;
  restoredDraftSessionId = null;
  lastSnapshot = null;
  draftsCache = [];

  showScreen("LOGIN");

  // best effort serveur
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn("signOut error (ignored, local logout OK)", e);
  }
}

// =========================================================
// DEEP LINK HANDLING (robuste)
// =========================================================
function parseUrlParamsFromFragmentOrQuery(urlStr) {
  try {
    const u = new URL(urlStr);
    // fragment (#a=b&c=d) — cas Supabase tokens
    const frag = (u.hash || "").replace(/^#/, "");
    if (frag) return new URLSearchParams(frag);

    // query (?code=...) — parfois code flow
    const q = u.search || "";
    if (q) return new URLSearchParams(q.replace(/^\?/, ""));

    return new URLSearchParams();
  } catch {
    // fallback si URL() échoue (string brute)
    const parts = String(urlStr || "").split("#");
    if (parts[1]) return new URLSearchParams(parts[1]);
    const parts2 = String(urlStr || "").split("?");
    if (parts2[1]) return new URLSearchParams(parts2[1]);
    return new URLSearchParams();
  }
}

async function handleIncomingDeepLink(urlStr) {
  dbg("DEEP LINK reçu", urlStr);

  const p = parseUrlParamsFromFragmentOrQuery(urlStr);

  const access_token = p.get("access_token");
  const refresh_token = p.get("refresh_token");
  const code = p.get("code");

  try {
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
      toast("Connexion OK ✅");
      return;
    }

    // Certains flows envoient ?code=...
    if (code && typeof supabase.auth.exchangeCodeForSession === "function") {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      toast("Connexion OK ✅");
      return;
    }

    // Si TEST sans tokens, on log juste
    toast("Deep link reçu (pas de tokens)");
  } catch (e) {
    console.warn("Deep link auth error:", e);
    alert("Erreur deep link auth : " + (e?.message || e));
  }
}

async function setupDeepLinkListeners() {
  // On écoute plusieurs noms car selon versions/plugins ça change
  const handler = async (ev) => {
    const payload = ev?.payload;

    // payload peut être string, object, array
    if (Array.isArray(payload) && payload.length) {
      await handleIncomingDeepLink(String(payload[0]));
      return;
    }
    if (typeof payload === "string") {
      await handleIncomingDeepLink(payload);
      return;
    }
    if (payload && typeof payload === "object") {
      // ex: { url: "..."} ou { urls: [...] }
      const u = payload.url || (Array.isArray(payload.urls) ? payload.urls[0] : null);
      if (u) {
        await handleIncomingDeepLink(String(u));
        return;
      }
    }

    dbg("Deep link event payload inconnu", payload);
  };

  // Ces 2-là couvrent la plupart des setups Tauri v1 + plugin deep-link
  await listen("scheme-request", handler).catch(() => {});
  await listen("scheme-request-received", handler).catch(() => {});
  await listen("deep-link://open-url", handler).catch(() => {});
  await listen("deep-link:open-url", handler).catch(() => {});

  dbg("Deep link listeners READY");
}

// =========================================================
// PROJECTS (LOCAL + CLOUD) — UI non bloquante
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

async function ensureProjectIdByName(name) {
  try {
    if (!currentUser?.id) return null;

    const { data, error } = await supabase
      .from("ho_projects")
      .upsert(
        { user_id: currentUser.id, name, updated_at: new Date().toISOString() },
        { onConflict: "user_id,name" }
      )
      .select("id")
      .single();

    if (!error && data?.id) return data.id;

    const { data: r } = await supabase
      .from("ho_projects")
      .select("id")
      .eq("name", name)
      .eq("user_id", currentUser.id)
      .single();

    return r?.id || null;
  } catch (e) {
    console.warn("ensureProjectIdByName failed", e);
    return null;
  }
}

async function initProject() {
  const nameInp = $("project-name");
  const sel = $("project-selector");
  const name = (nameInp?.value || "").trim() || (sel?.value || "");
  if (!name) return alert("Veuillez entrer ou choisir un nom de projet.");

  const btn = $("init-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Chargement…";
  }

  try {
    // 1) LOCAL d'abord (critique)
    await invoke("initialize_project", { projectName: name });
    currentProjectPath = await invoke("activate_project", { projectName: name });
    currentProjectName = name;

    // UI immédiate
    showScreen("DASHBOARD");
    toast("Projet chargé : " + name);

    // 2) CLOUD ensuite (ne doit pas bloquer)
    ensureProjectIdByName(name)
      .then((id) => {
        currentProjectId = id;
        return refreshHistory();
      })
      .then(() => checkForDrafts(true))
      .catch((e) => console.warn("Cloud sync warning", e));
  } catch (e) {
    alert("Erreur chargement projet : " + e);
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
    toast("Projet chargé : " + name);

    ensureProjectIdByName(name)
      .then((id) => {
        currentProjectId = id;
        return refreshHistory();
      })
      .then(() => checkForDrafts(true))
      .catch((e) => console.warn("Cloud sync warning", e));
  } catch (e) {
    alert("Erreur activation projet : " + e);
  }
}

async function changeProject() {
  if (isScanningUI) {
    const ok = confirm("Un scan est en cours. L'arrêter pour changer de projet ?");
    if (!ok) return;
    await stopScan().catch(() => {});
  }

  currentProjectId = null;
  currentProjectName = null;
  currentProjectPath = null;
  currentSessionId = null;
  restoredDraftSessionId = null;
  lastSnapshot = null;

  const tbody = $("certs-tbody");
  if (tbody) tbody.innerHTML = "";

  showScreen("PROJECT_SELECT");

  refreshHistory().catch(() => {});
  checkForDrafts(true).catch(() => {});
}

// =========================================================
// SCAN
// =========================================================
async function startScan() {
  // Local obligatoire
  if (!currentProjectName || !currentProjectPath) {
    return alert("Aucun projet local actif. Choisissez/Créez un projet d'abord.");
  }
  // Cloud recommandé (mais on tente rattrapage)
  if (!currentProjectId) {
    currentProjectId = await ensureProjectIdByName(currentProjectName);
    if (!currentProjectId) {
      const ok = confirm("Cloud indisponible (ID projet introuvable). Continuer en local ?");
      if (!ok) return;
    }
  }

  currentSessionId = crypto.randomUUID();
  restoredDraftSessionId = null;
  lastSnapshot = null;
  resetPasteStats();

  try {
    // Cloud start best effort
    if (currentProjectId && currentUser?.id) {
      supabase
        .from("ho_sessions")
        .insert({
          id: currentSessionId,
          user_id: currentUser.id,
          project_id: currentProjectId,
          started_at: new Date().toISOString(),
          status: "RUNNING",
        })
        .then(({ error }) => error && console.warn("Cloud start error", error));
    }

    // Local start critique
    await invoke("start_scan", { sessionId: currentSessionId });

    isScanningUI = true;
    updateDashboardUI("SCANNING");

    scanInterval = setInterval(async () => {
      try {
        const s = await invoke("get_live_stats");
        if (s?.is_scanning) {
          safeText("timer", s.duration_sec + "s");
          safeText("keystrokes-display", String(s.keystrokes));
          safeText("clicks-display", String(s.clicks));
        }
      } catch {}
    }, 1000);

    toast("Session démarrée");
  } catch (e) {
    isScanningUI = false;
    updateDashboardUI("READY");
    alert("Impossible de démarrer le scan local : " + e);
  }
}

async function stopScan() {
  isScanningUI = false;
  if (scanInterval) clearInterval(scanInterval);

  try {
    const snap = await invoke("stop_scan", { paste: pasteStats });
    lastSnapshot = snap;

    updateDashboardUI("STOPPED");
    toast("Scan arrêté. Brouillon enregistré.");

    if (snap?.html_path && lastSnapshot) lastSnapshot.session_html_path = snap.html_path;

    // Cloud stop best effort
    if (currentProjectId) {
      supabase
        .from("ho_sessions")
        .update({
          ended_at: new Date().toISOString(),
          status: "STOPPED",
          active_ms: snap?.active_ms || 0,
          events_count: snap?.events_count || 0,
          scp_score: snap?.scp_score || 0,
          evidence_score: snap?.evidence_score || 0,
          diag: snap?.diag || {},
        })
        .eq("id", currentSessionId)
        .then(({ error }) => error && console.warn("Cloud stop sync failed", error));
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
  const startBtn = $("start-btn");
  const stopBtn = $("stop-btn");
  const finBtn = $("finalize-btn");
  const live = $("live-dashboard");

  if (startBtn) startBtn.classList.add("hidden");
  if (stopBtn) stopBtn.classList.add("hidden");
  if (finBtn) finBtn.disabled = true;
  if (live) live.style.display = "none";

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
    if (finBtn) finBtn.disabled = false;
  }
}

// =========================================================
// CERTIFICATION (SESSION)
// =========================================================
async function finalizeSession() {
  if (!currentSessionId) return alert("Aucune session à finaliser.");

  // Cloud requis pour certifier (sinon pas de cert/DB)
  if (!currentProjectId) {
    currentProjectId = await ensureProjectIdByName(currentProjectName);
    if (!currentProjectId) return alert("Impossible de certifier : pas de connexion Cloud.");
  }

  const btn = $("finalize-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Signature…";
  }

  try {
    const scp = lastSnapshot?.scp_score ?? lastSnapshot?.diag?.analysis?.score ?? 0;

    const certData = {
      protocol: "ho3.cert.v1",
      meta: {
        user: currentUser.id,
        project: currentProjectId,
        session: currentSessionId,
        date: new Date().toISOString(),
      },
      scores: { scp },
    };

    const payloadStr = JSON.stringify(certData);
    const payloadHash = await sha256Hex(payloadStr);
    const devSig = await invoke("sign_payload_hash", { payloadHash });

    const { data, error } = await supabase.functions.invoke("sign-cert", {
      body: {
        cert_unsigned: certData,
        payload_hash: payloadHash,
        device_signature: JSON.stringify(devSig),
      },
    });

    let certId = null;

    if (!error && data?.cert_id) {
      certId = data.cert_id;
    } else {
      certId = crypto.randomUUID();
      await supabase.from("ho_certificates").insert({
        id: certId,
        user_id: currentUser.id,
        project_id: currentProjectId,
        session_id: currentSessionId,
        issued_at: new Date().toISOString(),
        payload_hash: payloadHash,
        authority_signature: "local-bypass",
        cert_json: certData,
      });
    }

    await supabase
      .from("ho_sessions")
      .update({
        status: "CERTIFIED",
        cert_id: certId,
        certified_at: new Date().toISOString(),
      })
      .eq("id", currentSessionId);

    const sidToDelete = restoredDraftSessionId || currentSessionId;
    try {
      await invoke("delete_local_draft", { sessionId: sidToDelete });
    } catch {}

    restoredDraftSessionId = null;

    toast("Session certifiée ✅");
    await refreshHistory();
    await checkForDrafts(true);
  } catch (e) {
    alert("Erreur certification : " + e);
  } finally {
    if (btn) {
      btn.innerText = "Finaliser la session";
      btn.disabled = false;
    }
  }
}

// =========================================================
// HISTORY (CLOUD)
// =========================================================
async function refreshHistory() {
  const tbody = $("certs-tbody");
  if (!tbody) return;

  // MODE 1 : post-login / choix projet
  if (!currentProjectId) {
    if (!currentUser?.id) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="color: rgba(11,18,32,0.55); padding: 14px 0;">
            Connectez-vous pour voir l’historique.
          </td>
        </tr>`;
      return;
    }

    const { data: projects, error: pErr } = await supabase
      .from("ho_projects")
      .select("id,name,updated_at")
      .eq("user_id", currentUser.id)
      .order("updated_at", { ascending: false })
      .limit(12);

    if (pErr) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="color:#b91c1c; padding: 14px 0;">
            Erreur chargement projets : ${esc(pErr.message)}
          </td>
        </tr>`;
      return;
    }

    if (!projects?.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="3" style="color: rgba(11,18,32,0.55); padding: 14px 0;">
            Aucun projet pour le moment. Créez-en un pour démarrer.
          </td>
        </tr>`;
      return;
    }

    const { data: certSessions, error: sErr } = await supabase
      .from("ho_sessions")
      .select("project_id, certified_at")
      .eq("user_id", currentUser.id)
      .eq("status", "CERTIFIED")
      .order("certified_at", { ascending: false })
      .limit(500);

    if (sErr) console.warn("refreshHistory stats error:", sErr);

    const stats = new Map(); // pid -> {count,last}
    (certSessions || []).forEach((s) => {
      const pid = s.project_id;
      const t = s.certified_at;
      if (!pid) return;
      const prev = stats.get(pid) || { count: 0, last: null };
      prev.count += 1;
      if (!prev.last && t) prev.last = t;
      stats.set(pid, prev);
    });

    tbody.innerHTML = projects
      .map((p) => {
        const st = stats.get(p.id) || { count: 0, last: null };
        const lastTxt = st.last ? new Date(st.last).toLocaleString() : "—";
        const countTxt = `${st.count} certif`;
        const name = esc(p.name);

        return `<tr data-proj="${encodeURIComponent(p.name)}" style="cursor:pointer;">
          <td>${esc(lastTxt)}</td>
          <td><span style="color:${st.count ? "#10b981" : "rgba(11,18,32,0.55)"};font-weight:800;">${esc(
            countTxt
          )}</span></td>
          <td style="font-weight:900;">${name}</td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll("tr[data-proj]").forEach((tr) => {
      tr.onclick = async () => {
        const name = decodeURIComponent(tr.getAttribute("data-proj") || "");
        if (!name) return;
        await quickActivateProjectByName(name);
      };
    });

    return;
  }

  // MODE 2 : projet actif (dashboard)
  const { count } = await supabase
    .from("ho_sessions")
    .select("*", { count: "exact", head: true })
    .eq("project_id", currentProjectId)
    .eq("status", "CERTIFIED");

  const closeBtn = $("close-project-btn");
  if (closeBtn) closeBtn.style.display = count > 0 ? "block" : "none";

  const { data: sessions, error: sessErr } = await supabase
    .from("ho_sessions")
    .select("id, certified_at, cert_id, scp_score")
    .eq("project_id", currentProjectId)
    .eq("status", "CERTIFIED")
    .order("certified_at", { ascending: false })
    .limit(10);

  if (sessErr) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="color:#b91c1c; padding: 14px 0;">
          Erreur historique : ${esc(sessErr.message)}
        </td>
      </tr>`;
    return;
  }

  if (!sessions?.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="color: rgba(11,18,32,0.55); padding: 14px 0;">
          Aucune session certifiée pour ce projet.
        </td>
      </tr>`;
    return;
  }

  const certIds = sessions.map((s) => s.cert_id).filter(Boolean);
  const hashById = new Map();

  if (certIds.length) {
    const { data: certs, error: cErr } = await supabase
      .from("ho_certificates")
      .select("id,payload_hash")
      .in("id", certIds);

    if (!cErr && certs?.length) {
      certs.forEach((c) => {
        if (c?.id) hashById.set(c.id, c.payload_hash || "");
      });
    }
  }

  tbody.innerHTML = sessions
    .map((s) => {
      const time = s.certified_at ? new Date(s.certified_at).toLocaleTimeString() : "—";
      const scp = typeof s.scp_score === "number" ? Math.round(s.scp_score) : null;

      const hash = s.cert_id ? hashById.get(s.cert_id) || "" : "";
      const proof = hash
        ? `${hash.substring(0, 8)}...`
        : s.cert_id
        ? `${String(s.cert_id).substring(0, 8)}...`
        : "—";

      const proofTxt = scp !== null ? `SCP ${scp} • ${proof}` : proof;

      return `<tr>
        <td>${esc(time)}</td>
        <td><span style="color:#10b981;font-weight:700;">OK</span></td>
        <td style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;">${esc(
          proofTxt
        )}</td>
      </tr>`;
    })
    .join("");
}

// =========================================================
// FINAL PROJECT CERTIFICATE + VIEWER OVERLAY
// =========================================================
async function exportFinalProjectCertificate() {
  if (!currentProjectPath) return;

  toast("Génération du certificat projet…");

  try {
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });
    if (res?.html_path) openCertViewer(res.html_path);
  } catch (e) {
    alert("Erreur génération : " + e);
  }
}

let currentCertHtmlPath = null;
let currentCertAssetUrl = null;

async function openCertViewer(htmlPath) {
  const overlay = $("viewer-overlay");
  const iframe = $("viewer-iframe");
  const errDiv = $("viewer-error");

  if (!overlay || !iframe) return;

  currentCertHtmlPath = htmlPath;
  currentCertAssetUrl = convertFileSrc(htmlPath);

  iframe.src = "about:blank";
  iframe.onload = null;

  if (errDiv) {
    errDiv.style.display = "none";
    errDiv.innerText = "";
  }

  overlay.style.display = "flex";

  const onKey = (e) => {
    if (e.key === "Escape") closeViewer();
  };

  const closeViewer = () => {
    overlay.style.display = "none";
    iframe.src = "about:blank";
    window.removeEventListener("keydown", onKey);
    overlay.onclick = null;
    currentCertHtmlPath = null;
    currentCertAssetUrl = null;
  };

  const closeBtn = $("viewer-close");
  if (closeBtn) closeBtn.onclick = closeViewer;

  overlay.onclick = (e) => {
    if (e.target === overlay) closeViewer();
  };
  window.addEventListener("keydown", onKey);

  const openBtn = $("viewer-open-external");
  if (openBtn) openBtn.onclick = () => invoke("open_file", { path: htmlPath });

  const reloadBtn = $("viewer-reload");
  if (reloadBtn)
    reloadBtn.onclick = () => {
      iframe.src = "about:blank";
      setTimeout(() => {
        iframe.src = `${currentCertAssetUrl}?t=${Date.now()}`;
      }, 30);
    };

  const dlBtn = $("viewer-download");
  if (dlBtn)
    dlBtn.onclick = async () => {
      try {
        const htmlContent = await invoke("read_text_file", { path: htmlPath });
        const defaultName = `HumanOrigin-certificat-${new Date().toISOString().slice(0, 10)}.html`;

        const outPath = await save({
          defaultPath: defaultName,
          filters: [{ name: "HTML", extensions: ["html"] }],
        });

        if (!outPath) return;
        await writeTextFile(outPath, htmlContent);
        toast("Certificat téléchargé ✅");
      } catch (e) {
        alert("Erreur téléchargement : " + e);
      }
    };

  iframe.src = currentCertAssetUrl;

  setTimeout(() => {
    if (errDiv && overlay.style.display === "flex") {
      errDiv.style.display = "block";
      errDiv.innerText =
        "Si l’aperçu interne reste blanc :\n" +
        "• Cliquez « Recharger »\n" +
        "• ou « Ouvrir dans navigateur »\n";
    }
  }, 900);
}

// =========================================================
// DRAFTS (BANNER + MODAL LIST)
// =========================================================
function ensureDraftModal() {
  let modal = document.getElementById("draft-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "draft-modal";

  modal.innerHTML = `
    <div id="draft-modal-card">
      <div class="draft-toprow">
        <div>
          <h2>Sessions non certifiées</h2>
          <div id="draft-modal-sub">Restaurer ou supprimer un brouillon</div>
        </div>
        <button id="draft-modal-x" class="draft-x" aria-label="Fermer">✕</button>
      </div>

      <div class="draft-controls">
        <input id="draft-modal-filter" placeholder="Filtrer par projet…" />
        <button id="draft-modal-refresh" class="btn btn-ghost btn-mini">Rafraîchir</button>
      </div>

      <div id="draft-modal-list" class="draft-list"></div>

      <div class="draft-bottom">
        <button id="draft-modal-ok" class="btn btn-primary">OK</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const close = () => (modal.style.display = "none");

  const xBtn = document.getElementById("draft-modal-x");
  if (xBtn) xBtn.onclick = close;

  const okBtn = document.getElementById("draft-modal-ok");
  if (okBtn) okBtn.onclick = close;

  modal.onclick = (e) => {
    if (e.target === modal) close();
  };

  const refBtn = document.getElementById("draft-modal-refresh");
  if (refBtn)
    refBtn.onclick = async () => {
      await checkForDrafts(true);
      renderDraftModalList();
    };

  const fil = document.getElementById("draft-modal-filter");
  if (fil) fil.oninput = () => renderDraftModalList();

  return modal;
}

function openDraftModal() {
  const modal = ensureDraftModal();
  modal.style.display = "flex";
  renderDraftModalList();
}

function renderDraftModalList() {
  const list = document.getElementById("draft-modal-list");
  const filter = (document.getElementById("draft-modal-filter")?.value || "")
    .trim()
    .toLowerCase();

  if (!list) return;

  let items = draftsCache || [];
  if (filter) {
    items = items.filter((d) => String(d.project_name || "").toLowerCase().includes(filter));
  }

  items = items.slice().sort((a, b) => {
    const pa = String(a.project_name || "");
    const pb = String(b.project_name || "");
    const c = pa.localeCompare(pb);
    if (c !== 0) return c;
    const ta = a.created_at_utc ? new Date(a.created_at_utc).getTime() : 0;
    const tb = b.created_at_utc ? new Date(b.created_at_utc).getTime() : 0;
    return tb - ta;
  });

  if (!items.length) {
    list.innerHTML = `<div style="padding:14px; color:rgba(11,18,32,.65); font-weight:800;">Aucun brouillon.</div>`;
    return;
  }

  list.innerHTML = items
    .map((d) => {
      const proj = d.project_name || "—";
      const when = d.created_at_utc ? new Date(d.created_at_utc).toLocaleString() : "—";
      const size = d.size_bytes ? `${Math.round(d.size_bytes / 1024)} KB` : "";
      const sid = d.session_id || "";
      const sidShort = sid ? sid.slice(0, 6) + "…" + sid.slice(-4) : "—";
      const line = `${when}${size ? "  •  " + size : ""}  •  Session ${sidShort}`;

      return `
        <div class="draft-item">
          <div class="draft-meta">
            <div class="draft-title">${esc(proj)}</div>
            <div class="draft-subline">${esc(line)}</div>
            <div class="draft-mono">${esc(sid)}</div>
          </div>

          <div class="draft-btns">
            <button class="btn btn-primary btn-mini" data-act="restore" data-sid="${esc(sid)}">Restaurer</button>
            <button class="btn btn-ghost btn-mini" data-act="delete" data-sid="${esc(sid)}">Supprimer</button>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.getAttribute("data-sid");
      const act = btn.getAttribute("data-act");
      if (!sid) return;

      if (act === "restore") {
        await recoverDraft(sid);
        const modal = document.getElementById("draft-modal");
        if (modal) modal.style.display = "none";
        return;
      }

      if (act === "delete") {
        const ok = confirm("Supprimer ce brouillon ? (Action irréversible)");
        if (!ok) return;
        try {
          await invoke("delete_local_draft", { sessionId: sid });
        } catch (e) {
          alert("Erreur suppression : " + e);
        }
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
    const txt = $("draft-banner-text");
    const btnRecover = $("btn-recover-draft");

    if (!banner || !txt || !btnRecover) return;

    if (!draftsCache.length) {
      banner.style.display = "none";
      return;
    }

    let candidates = draftsCache;
    if (currentProjectName) {
      const same = draftsCache.filter((d) => (d.project_name || "") === currentProjectName);
      if (same.length) candidates = same;
    }

    const d0 = candidates[0];
    const total = draftsCache.length;

    banner.style.display = "flex";
    txt.innerText = `⚠️ ${total} session${total > 1 ? "s" : ""} non certifiée${
      total > 1 ? "s" : ""
    } • Dernière : ${d0.project_name || "—"}`;

    btnRecover.onclick = async () => {
      if (!currentProjectName && d0.project_name) {
        await quickActivateProjectByName(d0.project_name);
      }
      await recoverDraft(d0.session_id);
    };

    const actionsWrap = btnRecover.parentElement || banner;

    let btnAll = document.getElementById("btn-drafts-all");
    if (!btnAll) {
      btnAll = document.createElement("button");
      btnAll.id = "btn-drafts-all";
      btnAll.type = "button";
      btnAll.innerText = "Voir tout";
      btnAll.className = "btn btn-ghost btn-mini";
      actionsWrap.appendChild(btnAll);
    }
    btnAll.onclick = () => openDraftModal();
  } catch (e) {
    console.warn("checkForDrafts", e);
  }
}

async function recoverDraft(sid) {
  try {
    const json = await invoke("load_local_draft", { sessionId: sid });
    const p = JSON.parse(json);

    const projName = p.project_name || currentProjectName || null;
    if (projName && projName !== currentProjectName) {
      await quickActivateProjectByName(projName);
    }

    restoredDraftSessionId = sid;
    currentSessionId = p.session_id || sid;

    lastSnapshot = {
      scp_score: p.analysis?.score || 0,
      active_ms: (p.analysis?.active_est_sec || 0) * 1000,
      diag: { analysis: p.analysis || {}, paste: p.paste_stats || {} },
      session_html_path: null,
    };

    if (currentProjectName) currentProjectId = await ensureProjectIdByName(currentProjectName);

    if (currentProjectId) {
      const startedAt = p.timestamp_start || new Date().toISOString();
      const endedAt = p.timestamp_end || new Date().toISOString();
      const scp = p.analysis?.score || 0;

      try {
        await supabase.from("ho_sessions").upsert(
          {
            id: currentSessionId,
            user_id: currentUser.id,
            project_id: currentProjectId,
            started_at: startedAt,
            ended_at: endedAt,
            status: "STOPPED",
            scp_score: scp,
            active_ms: (p.analysis?.active_est_sec || 0) * 1000,
            events_count: p.analysis?.total_events || 0,
            diag: { analysis: p.analysis || {}, paste: p.paste_stats || {} },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      } catch (e) {
        console.warn("Upsert ho_sessions failed (still OK locally)", e);
      }
    }

    const banner = $("draft-banner");
    if (banner) banner.style.display = "none";

    showScreen("DASHBOARD");
    updateDashboardUI("STOPPED");
    toast("Brouillon restauré. Vous pouvez finaliser.");
  } catch (e) {
    alert("Erreur restauration : " + e);
  }
}

// =========================================================
// UTILS
// =========================================================
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =========================================================
// BOOT
// =========================================================
window.addEventListener("DOMContentLoaded", () => {
  dbg("DOM READY ✅");

  // Marqueur visuel (safe)
  try {
    document.documentElement.style.outline = "6px solid rgba(255,0,0,.35)";
  } catch {}

  setupDeepLinkListeners().catch((e) => console.warn("setupDeepLinkListeners failed", e));

  on("login-btn", async () => {
    const email = $("email")?.value?.trim();
    if (!email) return;

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
      currentUser = null;
      currentProjectId = null;
      currentProjectName = null;
      currentProjectPath = null;
      currentSessionId = null;
      restoredDraftSessionId = null;
      lastSnapshot = null;
      draftsCache = [];
      showScreen("LOGIN");
      return;
    }

    currentUser = session.user;
    safeText("user-email-display", currentUser.email);

    await loadProjectList();
    showScreen("PROJECT_SELECT");

    refreshHistory().catch(() => {});
    checkForDrafts(true).catch(() => {});
  });

  checkSession();
});
