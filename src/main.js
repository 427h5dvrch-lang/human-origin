// /src/main.js — VERSION V2.9 (DIAMOND)
// Fix: Post-login routing (après deep link) -> bascule PROJECT_SELECT immédiate
// Fix: Deep link robuste + anti-fantômes logout + Credibility Lock + Drafts UX + History verdicts
// Fix: onAuthStateChange ne dépend plus de style.display

import { invoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { createClient } from "@supabase/supabase-js";

console.log("HumanOrigin main.js V2.9 loaded (DIAMOND) 💠");

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
let restoredDraftSessionId = null;
let lastSnapshot = null;
let scanInterval = null;
let isScanningUI = false;
let draftsCache = [];
let pasteStats = { paste_events: 0, pasted_chars: 0, max_paste_chars: 0 };

// Anti-fantômes : permet d’ignorer des retours async d’une "vie" précédente
let uiEpoch = 0;
const bumpEpoch = () => (uiEpoch += 1);
const epochIsStale = (e) => e !== uiEpoch;

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
  setTimeout(() => (el.style.display = "none"), 3000);
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function resetPasteStats() {
  pasteStats = { paste_events: 0, pasted_chars: 0, max_paste_chars: 0 };
}

// --- Verdict visuel ---
function verdictFromScp(scp) {
  if (scp === null || scp === undefined) return { label: "—", color: "rgba(11,18,32,0.55)" };
  if (scp <= 0) return { label: "INSUFFISANT", color: "#9ca3af" };
  if (scp >= 80) return { label: "COHÉRENT", color: "#10b981" };
  if (scp >= 50) return { label: "ATYPIQUE", color: "#f59e0b" };
  return { label: "SUSPECT", color: "#ef4444" };
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
}

// =========================================================
// RESET HELPERS
// =========================================================
function resetProjectStateOnly() {
  currentProjectId = null;
  currentProjectName = null;
  currentProjectPath = null;
  currentSessionId = null;
  restoredDraftSessionId = null;
  lastSnapshot = null;

  const tbody = $("certs-tbody");
  if (tbody) tbody.innerHTML = "";
}

function resetAllStateToLogin() {
  // stop interval
  try {
    if (scanInterval) clearInterval(scanInterval);
  } catch {}
  scanInterval = null;

  isScanningUI = false;
  resetProjectStateOnly();

  currentUser = null;
  draftsCache = [];
  resetPasteStats();

  showScreen("LOGIN");
}

// =========================================================
// AUTH
// =========================================================
async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) showScreen("LOGIN");
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

// =========================================================
// POST-LOGIN ROUTING (FIX MAJEUR)
// =========================================================
async function forcePostLogin() {
  const myEpoch = uiEpoch;

  try {
    const { data } = await supabase.auth.getSession();
    if (epochIsStale(myEpoch)) return;
    if (!data?.session) return;

    currentUser = data.session.user;
    safeText("user-email-display", currentUser.email);

    await loadProjectList();
    if (epochIsStale(myEpoch)) return;

    // Si aucun projet actif -> écran sélection projet
    if (!currentProjectName) showScreen("PROJECT_SELECT");
    refreshHistory().catch(() => {});
    checkForDrafts(true).catch(() => {});
  } catch (e) {
    console.warn("forcePostLogin failed", e);
  }
}

// =========================================================
// DEEP LINK HANDLING (ROBUSTE)
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
    return new URLSearchParams();
  }
}

async function handleIncomingDeepLink(urlStr) {
  console.log("DeepLink reçu:", urlStr);

  const p = parseUrlParamsFromFragmentOrQuery(urlStr);
  const access_token = p.get("access_token");
  const refresh_token = p.get("refresh_token");
  const code = p.get("code");

  try {
    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
      toast("Connexion OK ✅");
      await forcePostLogin(); // ✅ FIX
      return;
    }

    if (code && typeof supabase.auth.exchangeCodeForSession === "function") {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      toast("Connexion OK ✅");
      await forcePostLogin(); // ✅ FIX
      return;
    }
  } catch (e) {
    console.warn("DeepLink auth fail:", e);
    alert("Erreur connexion : " + (e?.message || e));
  }
}

async function setupDeepLinkListeners() {
  const handler = async (ev) => {
    const payload = ev?.payload;

    if (Array.isArray(payload) && payload.length) {
      await handleIncomingDeepLink(String(payload[0]));
      return;
    }

    if (typeof payload === "string") {
      await handleIncomingDeepLink(payload);
      return;
    }

    if (payload && typeof payload === "object") {
      const u = payload.url || (Array.isArray(payload.urls) ? payload.urls[0] : null);
      if (u) await handleIncomingDeepLink(String(u));
    }
  };

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

async function ensureProjectIdByName(name) {
  if (!currentUser?.id) return null;

  const fetchCloudId = async () => {
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
  };

  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
  return Promise.race([fetchCloudId(), timeoutPromise]);
}

async function initProject() {
  const nameInp = $("project-name");
  const sel = $("project-selector");
  const name = (nameInp?.value || "").trim() || (sel?.value || "");
  if (!name) return alert("Veuillez entrer ou choisir un nom de projet.");

  const btn = $("init-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Chargement...";
  }

  try {
    await invoke("initialize_project", { projectName: name });
    currentProjectPath = await invoke("activate_project", { projectName: name });
    currentProjectName = name;

    showScreen("DASHBOARD");
    toast("Projet activé");

    currentProjectId = await ensureProjectIdByName(name);
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

    ensureProjectIdByName(name).then((id) => {
      currentProjectId = id;
      refreshHistory();
      checkForDrafts(true);
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
  showScreen("PROJECT_SELECT");
  refreshHistory().catch(() => {});
  checkForDrafts(true).catch(() => {});
}

// =========================================================
// SCAN
// =========================================================
async function startScan() {
  if (!currentProjectName) return alert("Projet non chargé.");

  if (!currentProjectId) {
    currentProjectId = await ensureProjectIdByName(currentProjectName);
    if (!currentProjectId) {
      if (!confirm("Cloud indisponible. Continuer en local ?")) return;
    }
  }

  currentSessionId = crypto.randomUUID();
  restoredDraftSessionId = null;
  lastSnapshot = null;
  resetPasteStats();

  try {
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
    alert("Impossible de démarrer le scan : " + e);
  }
}

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

    if (snap?.html_path && lastSnapshot) lastSnapshot.session_html_path = snap.html_path;

    // CREDIBILITY LOCK
    const gatePassed = snap?.diag?.analysis?.gate_passed;
    const finBtn = $("finalize-btn");
    if (finBtn) {
      finBtn.disabled = !gatePassed;
      if (!gatePassed) toast("Volume insuffisant. Continuez à travailler.");
    }

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
        .catch(console.warn);
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
  if (state !== "STOPPED" && finBtn) finBtn.disabled = true;
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
    if (finBtn) finBtn.classList.remove("hidden");
  }
}

// =========================================================
// CERTIFICATION (SESSION)
// =========================================================
async function finalizeSession() {
  if (!currentSessionId) return alert("Aucune session.");

  const gatePassed = lastSnapshot?.diag?.analysis?.gate_passed;
  const scpNow = lastSnapshot?.scp_score ?? lastSnapshot?.diag?.analysis?.score ?? 0;

  if (gatePassed === false || scpNow <= 0) {
    alert(
      "Session INSUFFISANTE : volume d'effort trop faible.\nVous devez travailler davantage pour certifier cette session."
    );
    return;
  }

  if (!currentProjectId) {
    currentProjectId = await ensureProjectIdByName(currentProjectName);
    if (!currentProjectId) return alert("Impossible de certifier : Pas de connexion Cloud.");
  }

  const btn = $("finalize-btn");
  let success = false;
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Signature…";
  }

  try {
    const certData = {
      protocol: "ho3.cert.v1",
      meta: {
        user: currentUser.id,
        project: currentProjectId,
        session: currentSessionId,
        date: new Date().toISOString(),
      },
      scores: { scp: scpNow },
    };

    const payloadStr = JSON.stringify(certData);
    const payloadHash = await sha256Hex(payloadStr);
    const devSig = await invoke("sign_payload_hash", { payloadHash });

    const { data, error } = await supabase.functions.invoke("sign-cert", {
      body: { cert_unsigned: certData, payload_hash: payloadHash, device_signature: JSON.stringify(devSig) },
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
    success = true;

    await refreshHistory();
    await checkForDrafts(true);

    if (btn) {
      btn.innerText = "Certifiée ✅";
      btn.disabled = true;
    }
  } catch (e) {
    alert("Erreur certification : " + e);
  } finally {
    if (!success && btn) {
      btn.innerText = "Finaliser la session";
      btn.disabled = false;
    }
  }
}

// =========================================================
// HISTORIQUE
// =========================================================
async function refreshHistory() {
  const tbody = $("certs-tbody");
  if (!tbody) return;

  // MODE GLOBAL
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
      .eq("status", "CERTIFIED");

    const counts = {};
    (stats || []).forEach((s) => (counts[s.project_id] = (counts[s.project_id] || 0) + 1));

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

  // MODE PROJET
  const { data: sessions } = await supabase
    .from("ho_sessions")
    .select("certified_at, cert_id, scp_score")
    .eq("project_id", currentProjectId)
    .eq("status", "CERTIFIED")
    .order("certified_at", { ascending: false })
    .limit(10);

  const closeBtn = $("close-project-btn");
  if (closeBtn) closeBtn.style.display = sessions?.length ? "block" : "none";

  if (!sessions?.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:#888;padding:15px">Aucune session certifiée</td></tr>`;
    return;
  }

  const certIds = sessions.map((s) => s.cert_id).filter(Boolean);
  const hashById = new Map();

  if (certIds.length) {
    const { data: certs } = await supabase.from("ho_certificates").select("id,payload_hash").in("id", certIds);
    (certs || []).forEach((c) => hashById.set(c.id, c.payload_hash || ""));
  }

  tbody.innerHTML = sessions
    .map((s) => {
      const time = new Date(s.certified_at).toLocaleTimeString();
      const scp = typeof s.scp_score === "number" ? Math.round(s.scp_score) : 0;

      let v = verdictFromScp(scp);
      if (v.label === "INSUFFISANT") v = { label: "CERTIFIÉ", color: "#10b981" };

      const hash = s.cert_id ? hashById.get(s.cert_id) || "" : "";
      const proof = hash ? `${hash.substring(0, 8)}...` : "—";

      return `<tr>
        <td>${esc(time)}</td>
        <td><span style="color:${v.color};font-weight:900;">${esc(v.label)}</span></td>
        <td style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;">${esc(proof)}</td>
      </tr>`;
    })
    .join("");
}

async function exportFinalProjectCertificate() {
  if (!currentProjectPath) return;
  toast("Génération du certificat...");
  try {
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });
    if (res?.html_path) openCertViewer(res.html_path);
  } catch (e) {
    alert("Erreur génération : " + e);
  }
}

// =========================================================
// VIEWER
// =========================================================
let currentCertAssetUrl = null;

async function openCertViewer(htmlPath) {
  const overlay = $("viewer-overlay");
  const iframe = $("viewer-iframe");
  const errDiv = $("viewer-error");
  if (!overlay || !iframe) return;

  currentCertAssetUrl = convertFileSrc(htmlPath);

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

  $("viewer-close").onclick = closeViewer;
  $("viewer-open-external").onclick = () => invoke("open_file", { path: htmlPath });
  $("viewer-reload").onclick = () => {
    iframe.src = "about:blank";
    setTimeout(() => (iframe.src = currentCertAssetUrl), 50);
  };

  setTimeout(() => (iframe.src = currentCertAssetUrl), 50);

  setTimeout(() => {
    try {
      const doc = iframe.contentDocument;
      if (doc && !doc.body.innerText && !doc.body.innerHTML && errDiv) {
        errDiv.innerText = "Affichage bloqué. Cliquez sur 'Ouvrir externe'.";
        errDiv.style.display = "block";
      }
    } catch {}
  }, 1000);
}

// =========================================================
// DRAFTS
// =========================================================
function ensureDraftModal() {
  let modal = $("draft-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "draft-modal";
  modal.innerHTML = `<div id="draft-modal-card">
    <div class="draft-toprow">
      <h2>Sessions non certifiées</h2>
      <button id="draft-modal-x">✕</button>
    </div>
    <div class="draft-controls">
      <input id="draft-modal-filter" placeholder="Filtrer..." />
      <button id="draft-modal-refresh" class="btn-grey btn-mini">Rafraîchir</button>
    </div>
    <div id="draft-modal-list"></div>
  </div>`;

  modal.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:10001;";

  const card = modal.querySelector("#draft-modal-card");
  card.style.cssText =
    "background:white;padding:20px;border-radius:12px;width:90%;max-width:600px;max-height:80vh;display:flex;flex-direction:column;gap:15px;";

  const list = modal.querySelector("#draft-modal-list");
  list.style.cssText = "overflow-y:auto;border:1px solid #eee;border-radius:8px;max-height:300px;";

  document.body.appendChild(modal);

  const close = () => (modal.style.display = "none");
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

  let items = draftsCache || [];
  if (filter) items = items.filter((d) => (d.project_name || "").toLowerCase().includes(filter));

  items.sort((a, b) => (b.created_at_utc || "").localeCompare(a.created_at_utc || ""));

  if (!items.length) {
    list.innerHTML = "<div style='padding:15px;color:#888'>Aucun brouillon.</div>";
    return;
  }

  list.innerHTML = items
    .map((d) => {
      const dateStr = d.created_at_utc ? new Date(d.created_at_utc).toLocaleString() : "—";
      return `<div style="padding:10px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:bold">${esc(d.project_name)}</div>
          <div style="font-size:11px;color:#666">${esc(dateStr)}</div>
        </div>
        <div style="display:flex;gap:5px;">
          <button data-act="restore" data-sid="${d.session_id}" class="btn-black btn-mini">Restaurer</button>
          <button data-act="delete" data-sid="${d.session_id}" class="btn-red btn-mini">Suppr.</button>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.onclick = async () => {
      const sid = btn.dataset.sid;
      if (btn.dataset.act === "restore") {
        await recoverDraft(sid);
        $("draft-modal").style.display = "none";
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

    banner.style.display = "flex";
    btnRecover.innerText = "Restaurer " + (d0.project_name || "");
    btnRecover.onclick = async () => {
      if (!currentProjectName && d0.project_name) await quickActivateProjectByName(d0.project_name);
      await recoverDraft(d0.session_id);
    };

    if (!$("btn-drafts-all")) {
      const btnAll = document.createElement("button");
      btnAll.id = "btn-drafts-all";
      btnAll.innerText = "Voir tout";
      btnAll.className = "btn-grey btn-mini";
      banner.appendChild(btnAll);

      btnAll.onclick = () => {
        const m = ensureDraftModal();
        m.style.display = "flex";
        renderDraftModalList();
      };
    }
  } catch (e) {
    console.warn(e);
  }
}

async function recoverDraft(sid) {
  try {
    const json = await invoke("load_local_draft", { sessionId: sid });
    const p = JSON.parse(json);

    const projName = p.project_name || null;
    if (projName && projName !== currentProjectName) await quickActivateProjectByName(projName);

    restoredDraftSessionId = sid;
    currentSessionId = p.session_id || sid;

    lastSnapshot = {
      scp_score: p.analysis?.score || 0,
      active_ms: (p.analysis?.active_est_sec || 0) * 1000,
      diag: { analysis: p.analysis || {}, paste: p.paste_stats || {} },
    };

    const gatePassed = p.analysis?.gate_passed;
    const finBtn = $("finalize-btn");
    if (finBtn) finBtn.disabled = !gatePassed;

    $("draft-banner").style.display = "none";
    showScreen("DASHBOARD");
    updateDashboardUI("STOPPED");
    toast("Brouillon restauré.");
  } catch (e) {
    alert("Erreur restauration : " + e);
  }
}

// =========================================================
// CRYPTO
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
  setupDeepLinkListeners().catch(() => {});

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

  // ✅ Ne dépend plus de style.display
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session) {
      bumpEpoch();
      resetAllStateToLogin();
      return;
    }

    currentUser = session.user;
    safeText("user-email-display", currentUser.email);

    await loadProjectList();

    // si pas de projet actif -> select projet
    if (!currentProjectName) {
      showScreen("PROJECT_SELECT");
      refreshHistory().catch(() => {});
      checkForDrafts(true).catch(() => {});
    }
  });

  checkSession();
  // au cas où on arrive avec session déjà là
  forcePostLogin().catch(() => {});
});
