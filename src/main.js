import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { createClient } from "@supabase/supabase-js";

// --- SUPABASE ---
const supabaseUrl = "https://bhlisgvozsgqxugrfsiu.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJobGlzZ3ZvenNncXh1Z3Jmc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTI5NDEsImV4cCI6MjA4MzcyODk0MX0.L43rUuDFtg-QH7lVCFTFkJzMTjNUX7BWVXqmVMvIwZ0";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- STATE ---
let currentUser = null;

let currentProjectName = null;
let currentProjectPath = "";
let currentProjectId = null;

let currentSessionId = null; // cloud session row id
let lastSnapshot = null;     // rust snapshot for finalize

let scanInterval = null;
let scanStartTime = null;

// =========================================================
//  UI HELPERS
// =========================================================
function $(id) { return document.getElementById(id); }

function toast(msg) {
  const el = $("toast");
  if (!el) return alert(msg);
  el.innerText = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = "none"; }, 2400);
}

function setOnlineBadge(isOnline) {
  const b = $("cloud-badge");
  if (!b) return;
  b.innerText = isOnline ? "CLOUD: OK" : "CLOUD: OFFLINE / QUEUE";
  b.className = isOnline ? "badge ok" : "badge warn";
}

function setProjectTitle(name) {
  $("current-project-title").innerText = name || "—";
}

function resetLiveUI() {
  $("timer").innerText = "00:00";
  $("keystrokes-display").innerText = "0";
  $("clicks-display").innerText = "0";
}

// =========================================================
//  CRYPTO (SHA-256 réel, payload_hash)
// =========================================================
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// =========================================================
//  OFFLINE QUEUE (Hardening)
// =========================================================
const QUEUE_KEY = "ho_pending_ops_v1";

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}
function saveQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  $("queue-count").innerText = String(q.length);
  setOnlineBadge(q.length === 0);
}

function enqueue(op) {
  const q = loadQueue();
  q.push({ ...op, ts: Date.now() });
  saveQueue(q);
}

async function flushQueue() {
  if (!currentUser) return;
  let q = loadQueue();
  if (q.length === 0) { setOnlineBadge(true); return; }

  toast(`Sync queue… (${q.length})`);

  const kept = [];
  for (const op of q) {
    try {
      if (op.type === "session_insert") {
        const { error } = await supabase.from("ho_sessions").insert(op.payload);
        if (error) throw error;
      } else if (op.type === "session_update") {
        const { error } = await supabase
          .from("ho_sessions")
          .update(op.payload.update)
          .eq("id", op.payload.id);
        if (error) throw error;
      } else if (op.type === "cert_insert") {
        const { error } = await supabase.from("ho_certificates").insert(op.payload);
        if (error) throw error;
      } else if (op.type === "project_upsert") {
        const { error } = await supabase
          .from("ho_projects")
          .upsert(op.payload, { onConflict: "user_id,name" });
        if (error) throw error;
      }
    } catch (e) {
      kept.push(op);
    }
  }

  saveQueue(kept);
  if (kept.length === 0) {
    toast("Queue sync OK ✅");
    setOnlineBadge(true);
  } else {
    toast(`Queue restante: ${kept.length}`);
    setOnlineBadge(false);
  }
}

// retry wrapper (simple)
async function withRetry(fn, tries = 2) {
  let lastErr = null;
  for (let i = 0; i <= tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 350 * (i + 1))); }
  }
  throw lastErr;
}

// =========================================================
//  AUTH (Deep link)
// =========================================================
listen("scheme-request", async (event) => {
  try {
    const url = String(event.payload || "");
    const fragment = url.split("#")[1];
    if (!fragment) return;

    const params = new URLSearchParams(fragment);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");

    if (access_token && refresh_token) {
      await supabase.auth.setSession({ access_token, refresh_token });
      await checkSession();
      toast("Connecté ✅");
    }
  } catch (e) {
    console.error("Auth error:", e);
    toast("Auth error");
  }
});

async function checkSession() {
  const { data } = await supabase.auth.getSession();

  if (data?.session) {
    currentUser = data.session.user;
    $("login-screen").style.display = "none";
    $("app-screen").style.display = "block";
    await loadProjectList();
    await flushQueue();
  } else {
    currentUser = null;
    $("login-screen").style.display = "block";
    $("app-screen").style.display = "none";
  }
}

async function handleLogin() {
  const email = $("email").value?.trim();
  if (!email) return alert("Email requis");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "humanorigin://login", redirectTo: "humanorigin://login" },
  });

  if (error) return alert("Erreur: " + error.message);
  toast("Lien envoyé par email.");
}

async function handleLogout() {
  await supabase.auth.signOut();

  // reset state
  currentProjectName = null;
  currentProjectPath = "";
  currentProjectId = null;
  currentSessionId = null;
  lastSnapshot = null;
  resetLiveUI();

  setProjectTitle(null);
  $("controls-section").style.display = "none";
  $("project-section").style.display = "block";

  await checkSession();
}

// =========================================================
//  PROJECTS (Local + Cloud)
// =========================================================
async function loadProjectList() {
  try {
    const selector = $("project-selector");
    const projects = await invoke("get_projects");

    selector.innerHTML = '<option value="" disabled selected>— Sélectionner —</option>';
    (projects || []).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.innerText = name;
      selector.appendChild(opt);
    });

    if (currentProjectName) selector.value = currentProjectName;
  } catch (e) {
    console.error(e);
  }
}

async function ensureCloudProject(projectName) {
  if (!currentUser) throw new Error("Not authenticated");

  const payload = { user_id: currentUser.id, name: projectName };

  try {
    const { data, error } = await withRetry(async () =>
      await supabase
        .from("ho_projects")
        .upsert(payload, { onConflict: "user_id,name" })
        .select("id")
        .single()
    );
    if (error) throw error;
    return data.id;
  } catch (e) {
    // offline queue
    enqueue({ type: "project_upsert", payload });
    throw e;
  }
}

async function initializeProject() {
  const name = $("project-name").value?.trim();
  if (!name || !currentUser) return alert("Nom requis / Login requis");

  try {
    await invoke("initialize_project", { projectName: name });
    const activatedPath = await invoke("activate_project", { projectName: name });

    currentProjectPath = activatedPath;
    currentProjectId = await ensureCloudProject(name);
    currentProjectName = name;

    currentSessionId = null;
    lastSnapshot = null;
    $("finalize-btn").disabled = true;

    updateUIForProject(name);
    await loadProjectList();
    $("project-selector").value = name;

    await refreshHistory();
    toast("Projet prêt ✅");
  } catch (e) {
    console.error(e);
    alert("Erreur Init: " + (e?.message || e));
  }
}

async function switchProject(event) {
  const newName = event?.target?.value;
  if (!newName) return;

  // si scan en cours, stop d’abord
  if ($("stop-btn")?.style?.display === "block") {
    if (!confirm("Arrêter le scan en cours ?")) {
      event.target.value = currentProjectName || "";
      return;
    }
    await stopScan();
  }

  try {
    const path = await invoke("activate_project", { projectName: newName });
    currentProjectPath = path;

    currentProjectId = await ensureCloudProject(newName);
    currentProjectName = newName;

    currentSessionId = null;
    lastSnapshot = null;
    $("finalize-btn").disabled = true;

    updateUIForProject(newName);
    await refreshHistory();
    toast("Switch OK");
  } catch (e) {
    console.error(e);
    alert("Erreur Switch: " + (e?.message || e));
  }
}

function updateUIForProject(name) {
  $("project-section").style.display = "none";
  $("controls-section").style.display = "block";
  setProjectTitle(name);
}

// =========================================================
//  SESSION PIPELINE (START -> INSERT, STOP -> UPDATE, FINALIZE -> INSERT CERT)
// =========================================================
async function startScan() {
  if (!currentUser) return alert("Login requis");
  if (!currentProjectId) return alert("Sélectionnez un projet.");

  try {
    await invoke("start_scan");
    scanStartTime = new Date().toISOString();

    const payload = {
      project_id: currentProjectId,
      user_id: currentUser.id,
      started_at: scanStartTime,
      active_ms: 0,
      idle_ms: 0,
      events_count: 0,
      diag: { version: "ho2.diag.v1" }
    };

    try {
      const { data, error } = await withRetry(async () =>
        await supabase.from("ho_sessions").insert(payload).select("id").single()
      );
      if (error) throw error;
      currentSessionId = data.id;
      setOnlineBadge(true);
    } catch (e) {
      // offline: create a local placeholder id to update later is hard;
      // we enforce: if insert fails, we keep a "local session" and queue only finalize after insert works.
      currentSessionId = null;
      enqueue({ type: "session_insert", payload });
      setOnlineBadge(false);
      toast("Session en queue (offline)");
    }

    lastSnapshot = null;

    // UI
    $("start-btn").style.display = "none";
    $("stop-btn").style.display = "block";
    $("finalize-btn").disabled = true;
    $("live-dashboard").style.display = "block";

    if (scanInterval) clearInterval(scanInterval);
    scanInterval = setInterval(async () => {
      const stats = await invoke("get_live_stats");
      if (stats?.is_scanning) {
        const min = Math.floor(stats.duration_sec / 60).toString().padStart(2, "0");
        const sec = (stats.duration_sec % 60).toString().padStart(2, "0");
        $("timer").innerText = `${min}:${sec}`;
        $("keystrokes-display").innerText = String(stats.keystrokes);
        $("clicks-display").innerText = String(stats.clicks);
      }
    }, 1000);

    toast("Scan démarré");
  } catch (e) {
    console.error(e);
    alert("Erreur Start: " + (e?.message || e));
  }
}

async function stopScan() {
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = null;

  if (!currentUser) return alert("Login requis");

  try {
    const snapshot = await invoke("stop_scan");
    lastSnapshot = snapshot;

    const endTime = new Date().toISOString();

    // Update cloud only if we have a real session id
    if (currentSessionId) {
      const update = {
        ended_at: endTime,
        active_ms: snapshot.active_ms,
        idle_ms: snapshot.idle_ms,
        events_count: snapshot.events_count,
        diag: snapshot.diag
      };

      try {
        const { error } = await withRetry(async () =>
          await supabase.from("ho_sessions").update(update).eq("id", currentSessionId)
        );
        if (error) throw error;
        setOnlineBadge(true);
      } catch (e) {
        enqueue({ type: "session_update", payload: { id: currentSessionId, update } });
        setOnlineBadge(false);
        toast("Update session en queue");
      }
    } else {
      // Insert failed at start => we can't reliably update; force flush before finalize
      toast("⚠️ Session non créée côté cloud. Sync requis avant certificat.");
      setOnlineBadge(false);
    }

    // UI Reset
    $("start-btn").style.display = "block";
    $("stop-btn").style.display = "none";
    $("finalize-btn").disabled = false;
    $("live-dashboard").style.display = "none";
    resetLiveUI();

    $("last-scp").innerText = String(snapshot.scp_score);
    $("last-evidence").innerText = String(snapshot.evidence_score);

    await refreshHistory();

    alert(`Session terminée.\nSCP: ${snapshot.scp_score}/100\nPreuve: ${snapshot.evidence_score}/100`);
  } catch (e) {
    console.error(e);
    alert("Erreur Stop: " + (e?.message || e));
  }
}

async function finalizeProject() {
  if (!currentUser) return alert("Login requis");
  if (!currentProjectId) return alert("Pas de projet");
  if (!lastSnapshot) return alert("Stoppe une session avant de certifier.");

  // On exige que la session existe côté cloud (sinon chaîne cassée)
  if (!currentSessionId) {
    await flushQueue();
    if (!currentSessionId) {
      return alert("Impossible de certifier: session cloud non créée. Réessaie après sync.");
    }
  }

  if (!confirm("Générer le certificat final ?")) return;

  try {
    // 1) Génération HTML locale
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });

    // 2) Payload -> hash (SHA256 hex)
    const payload = {
      v: "cert.v1",
      user_id: currentUser.id,
      project_id: currentProjectId,
      session_id: currentSessionId,
      snapshot: lastSnapshot,
      issued_at: new Date().toISOString()
    };
    const payloadHash = await sha256Hex(JSON.stringify(payload));

    // 3) Signature Ed25519 côté Rust (clé locale persistante)
    const sigObj = await invoke("sign_payload_hash", { payloadHash });

    // 4) Cloud INSERT Certificate
    const certPayload = {
      project_id: currentProjectId,
      user_id: currentUser.id,
      session_id: currentSessionId,
      scp_score: res.scp_score,
      evidence_score: res.evidence_score,
      payload_hash: payloadHash,
      signature: JSON.stringify(sigObj) // <- on stocke JSON ici
    };

    try {
      const { error } = await withRetry(async () =>
        await supabase.from("ho_certificates").insert(certPayload)
      );
      if (error) throw error;
      setOnlineBadge(true);
      toast("Certificat cloud ✅");
    } catch (e) {
      enqueue({ type: "cert_insert", payload: certPayload });
      setOnlineBadge(false);
      toast("Certificat en queue (offline)");
    }

    await refreshHistory();
    await invoke("open_file", { path: res.html_path });

  } catch (e) {
    console.error(e);
    alert("Erreur Finalize: " + (e?.message || e));
  }
}

// =========================================================
//  HISTORY UI (Sessions + Certificates)
// =========================================================
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR");
  } catch { return iso; }
}

async function refreshHistory() {
  if (!currentUser || !currentProjectId) return;

  // sessions
  try {
    const { data: sessions, error } = await supabase
      .from("ho_sessions")
      .select("id, started_at, ended_at, active_ms, idle_ms, events_count")
      .eq("project_id", currentProjectId)
      .order("started_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const tbody = $("sessions-tbody");
    tbody.innerHTML = "";
    (sessions || []).forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${String(s.id).slice(0, 8)}…</td>
        <td>${fmtDate(s.started_at)}</td>
        <td>${fmtDate(s.ended_at)}</td>
        <td>${Math.round((s.active_ms || 0)/1000)}s</td>
        <td>${Math.round((s.idle_ms || 0)/1000)}s</td>
        <td>${s.events_count ?? 0}</td>
      `;
      tbody.appendChild(tr);
    });
    setOnlineBadge(loadQueue().length === 0);
  } catch (e) {
    console.error(e);
    setOnlineBadge(false);
  }

  // certs
  try {
    const { data: certs, error } = await supabase
      .from("ho_certificates")
      .select("id, issued_at, session_id, scp_score, evidence_score, payload_hash, signature")
      .eq("project_id", currentProjectId)
      .order("issued_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const tbody = $("certs-tbody");
    tbody.innerHTML = "";
    (certs || []).forEach((c) => {
      const tr = document.createElement("tr");
      let sig = "—";
      try {
        const o = JSON.parse(c.signature || "{}");
        sig = o?.alg ? `${o.alg} ✅` : "—";
      } catch {}
      tr.innerHTML = `
        <td class="mono">${String(c.id).slice(0, 8)}…</td>
        <td>${fmtDate(c.issued_at)}</td>
        <td class="mono">${String(c.session_id).slice(0, 8)}…</td>
        <td>${c.scp_score ?? "—"}</td>
        <td>${c.evidence_score ?? "—"}</td>
        <td class="mono">${String(c.payload_hash || "").slice(0, 10)}…</td>
        <td>${sig}</td>
      `;
      tbody.appendChild(tr);
    });
    setOnlineBadge(loadQueue().length === 0);
  } catch (e) {
    console.error(e);
    setOnlineBadge(false);
  }

  $("queue-count").innerText = String(loadQueue().length);
}

// =========================================================
//  INIT
// =========================================================
window.addEventListener("DOMContentLoaded", () => {
  $("login-btn").addEventListener("click", handleLogin);
  $("logout-btn").addEventListener("click", handleLogout);

  $("init-btn").addEventListener("click", initializeProject);

  $("start-btn").addEventListener("click", startScan);
  $("stop-btn").addEventListener("click", stopScan);
  $("finalize-btn").addEventListener("click", finalizeProject);

  $("sync-btn").addEventListener("click", async () => {
    await flushQueue();
    await refreshHistory();
  });

  const sel = $("project-selector");
  if (sel) sel.addEventListener("change", switchProject);

  $("finalize-btn").disabled = true;
  $("controls-section").style.display = "none";
  $("project-section").style.display = "block";

  saveQueue(loadQueue()); // init badges + count
  checkSession();
});
