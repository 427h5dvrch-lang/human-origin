import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { createClient } from "@supabase/supabase-js";

// --- SUPABASE KEYS ---
const supabaseUrl = "https://bhlisgvozsgqxugrfsiu.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJobGlzZ3ZvenNncXh1Z3Jmc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTI5NDEsImV4cCI6MjA4MzcyODk0MX0.L43rUuDFtg-QH7lVCFTFkJzMTjNUX7BWVXqmVMvIwZ0";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- STATE ---
let currentUser = null;

let currentProjectName = null;
let currentProjectPath = "";
let currentProjectId = null;

let currentSessionId = null;     // session row id (cloud)
let lastSnapshot = null;         // snapshot Rust (pour finalize)

let scanInterval = null;
let scanStartTime = null;

// =========================================================
//  CRYPTO (SHA-256 réel)
// =========================================================
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    }
  } catch (e) {
    console.error("Auth error:", e);
  }
});

async function checkSession() {
  const { data } = await supabase.auth.getSession();

  if (data?.session) {
    currentUser = data.session.user;
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-screen").style.display = "block";
    await loadProjectList();
  } else {
    currentUser = null;
    document.getElementById("login-screen").style.display = "block";
    document.getElementById("app-screen").style.display = "none";
  }
}

async function handleLogin() {
  const email = document.getElementById("email").value?.trim();
  if (!email) return alert("Email requis");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "humanorigin://login", redirectTo: "humanorigin://login" },
  });

  if (error) return alert("Erreur: " + error.message);
  alert("Lien envoyé par email.");
}

async function handleLogout() {
  await supabase.auth.signOut();
  // reset state
  currentProjectName = null;
  currentProjectPath = "";
  currentProjectId = null;
  currentSessionId = null;
  lastSnapshot = null;
  await checkSession();
}

// =========================================================
//  PROJECTS (Local + Cloud)
// =========================================================
async function loadProjectList() {
  try {
    const selector = document.getElementById("project-selector");
    if (!selector) return;

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

  const { data, error } = await supabase
    .from("ho_projects")
    .upsert(
      { user_id: currentUser.id, name: projectName },
      { onConflict: "user_id,name" }
    )
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function initializeProject() {
  const name = document.getElementById("project-name").value?.trim();
  if (!name || !currentUser) return alert("Nom requis / Login requis");

  try {
    await invoke("initialize_project", { projectName: name });
    const activatedPath = await invoke("activate_project", { projectName: name });

    currentProjectPath = activatedPath;
    currentProjectId = await ensureCloudProject(name);
    currentProjectName = name;

    // reset session context
    currentSessionId = null;
    lastSnapshot = null;
    document.getElementById("finalize-btn").disabled = true;

    updateUIForProject(name);
    await loadProjectList();
    document.getElementById("project-selector").value = name;
  } catch (e) {
    alert("Erreur Init: " + e);
  }
}

async function switchProject(event) {
  const newName = event?.target?.value;
  if (!newName) return;

  // si scan en cours, stop d’abord
  if (document.getElementById("stop-btn")?.style?.display === "block") {
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

    // reset session context
    currentSessionId = null;
    lastSnapshot = null;
    document.getElementById("finalize-btn").disabled = true;

    updateUIForProject(newName);
  } catch (e) {
    alert("Erreur Switch: " + e);
  }
}

function updateUIForProject(name) {
  document.getElementById("project-section").style.display = "none";
  document.getElementById("controls-section").style.display = "block";
  document.getElementById("current-project-title").innerText = name;
}

// =========================================================
//  SESSION PIPELINE (START -> INSERT, STOP -> UPDATE, FINALIZE -> INSERT CERT)
// =========================================================
async function startScan() {
  if (!currentUser) return alert("Login requis");
  if (!currentProjectId) return alert("Sélectionnez un projet.");

  try {
    // 1) Rust Start
    await invoke("start_scan");
    scanStartTime = new Date().toISOString();

    // 2) Cloud INSERT Session (Started)
    const { data, error } = await supabase
      .from("ho_sessions")
      .insert({
        project_id: currentProjectId,
        user_id: currentUser.id,
        started_at: scanStartTime,
        active_ms: 0,
        idle_ms: 0,
        events_count: 0,
        diag: { version: "ho2.diag.v1" }
      })
      .select("id")
      .single();

    if (error) throw error;
    currentSessionId = data.id;
    lastSnapshot = null;

    // UI
    document.getElementById("start-btn").style.display = "none";
    document.getElementById("stop-btn").style.display = "block";
    document.getElementById("finalize-btn").disabled = true;
    document.getElementById("live-dashboard").style.display = "block";

    if (scanInterval) clearInterval(scanInterval);
    scanInterval = setInterval(async () => {
      const stats = await invoke("get_live_stats");
      if (stats?.is_scanning) {
        const min = Math.floor(stats.duration_sec / 60).toString().padStart(2, "0");
        const sec = (stats.duration_sec % 60).toString().padStart(2, "0");
        document.getElementById("timer").innerText = `${min}:${sec}`;
        document.getElementById("keystrokes-display").innerText = stats.keystrokes;
        document.getElementById("clicks-display").innerText = stats.clicks;
      }
    }, 1000);

  } catch (e) {
    alert("Erreur Start: " + (e?.message || e));
  }
}

async function stopScan() {
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = null;

  if (!currentUser) return alert("Login requis");
  if (!currentSessionId) return alert("Pas de session cloud active");

  try {
    // 1) Rust Stop & Snapshot
    const snapshot = await invoke("stop_scan");
    lastSnapshot = snapshot;

    const endTime = new Date().toISOString();

    // 2) Cloud UPDATE Session (Ended)
    const { error } = await supabase
      .from("ho_sessions")
      .update({
        ended_at: endTime,
        active_ms: snapshot.active_ms,
        idle_ms: snapshot.idle_ms,
        events_count: snapshot.events_count,
        diag: snapshot.diag
      })
      .eq("id", currentSessionId);

    if (error) throw error;

    // UI Reset
    document.getElementById("start-btn").style.display = "block";
    document.getElementById("stop-btn").style.display = "none";
    document.getElementById("finalize-btn").disabled = false;
    document.getElementById("live-dashboard").style.display = "none";
    document.getElementById("timer").innerText = "00:00";
    document.getElementById("keystrokes-display").innerText = "0";
    document.getElementById("clicks-display").innerText = "0";

    alert(`Session terminée.\nSCP: ${snapshot.scp_score}/100\nPreuve: ${snapshot.evidence_score}/100`);
  } catch (e) {
    alert("Erreur Stop: " + (e?.message || e));
  }
}

async function finalizeProject() {
  if (!currentUser) return alert("Login requis");
  if (!currentProjectId) return alert("Pas de projet");
  if (!currentSessionId) return alert("Aucune session récente.");
  if (!lastSnapshot) return alert("Stoppe une session avant de certifier.");

  if (!confirm("Générer le certificat final ?")) return;

  try {
    // 1) Génération HTML locale
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });

    // 2) Hash cryptographique réel
    const payload = {
      v: "cert.v1",
      user_id: currentUser.id,
      project_id: currentProjectId,
      session_id: currentSessionId,
      snapshot: lastSnapshot,
      issued_at: new Date().toISOString()
    };
    const payloadHash = await sha256Hex(JSON.stringify(payload));

    // 3) Cloud INSERT Certificate
    const { error } = await supabase
      .from("ho_certificates")
      .insert({
        project_id: currentProjectId,
        user_id: currentUser.id,
        session_id: currentSessionId,
        scp_score: res.scp_score,
        evidence_score: res.evidence_score,
        payload_hash: payloadHash,
        signature: null
      });

    if (error) throw error;

    alert("Certificat enregistré dans le Cloud ✅");
    await invoke("open_file", { path: res.html_path });

    // Optionnel : “verrouiller” finalize jusqu’à nouvelle session
    // document.getElementById("finalize-btn").disabled = true;

  } catch (e) {
    alert("Erreur Finalize: " + (e?.message || e));
  }
}

// =========================================================
//  INIT
// =========================================================
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("login-btn").addEventListener("click", handleLogin);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);

  document.getElementById("init-btn").addEventListener("click", initializeProject);

  document.getElementById("start-btn").addEventListener("click", startScan);
  document.getElementById("stop-btn").addEventListener("click", stopScan);
  document.getElementById("finalize-btn").addEventListener("click", finalizeProject);

  const sel = document.getElementById("project-selector");
  if (sel) sel.addEventListener("change", switchProject);

  checkSession();
});
