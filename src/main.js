import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { createClient } from "@supabase/supabase-js";

// --- SUPABASE ---
const supabaseUrl = "https://bhlisgvozsgqxugrfsiu.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJobGlzZ3ZvenNncXh1Z3Jmc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTI5NDEsImV4cCI6MjA4MzcyODk0MX0.L43rUuDFtg-QH7lVCFTFkJzMTjNUX7BWVXqmVMvIwZ0"; 
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- STATE ---
let currentUser = null;

let currentProjectName = null;   // ex: "Mon Roman"
let currentProjectPath = "";     // chemin local renvoyé par Rust
let currentProjectId = null;     // UUID Supabase (ho_projects.id)

let scanInterval = null;
let scanStartTime = null;

// =========================================================
//  AUTH (lien email Supabase)
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
    console.error("scheme-request error:", e);
  }
});

async function checkSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("getSession error:", error);

  if (data?.session) {
    currentUser = data.session.user;

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-screen").style.display = "block";

    await loadProjectList();
  } else {
    currentUser = null;

    document.getElementById("login-screen").style.display = "block";
    document.getElementById("app-screen").style.display = "none";

    // reset state local
    currentProjectName = null;
    currentProjectPath = "";
    currentProjectId = null;
  }
}

async function handleLogin() {
  const email = document.getElementById("email").value?.trim();
  if (!email) return alert("Email requis");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: "humanorigin://login",
      redirectTo: "humanorigin://login", // compat
    },
  });

  if (error) return alert("Erreur: " + error.message);

  alert("Un lien de connexion a été envoyé par email.");
}

async function handleLogout() {
  await supabase.auth.signOut();
  await checkSession();
}

// =========================================================
//  PROJECT LIST (local from Rust)
// =========================================================
async function loadProjectList() {
  try {
    const selector = document.getElementById("project-selector");
    if (!selector) return;

    const projects = await invoke("get_projects"); // ["A","B",...]

    selector.innerHTML = '<option value="" disabled selected>— Sélectionner —</option>';

    (projects || []).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.innerText = name;
      selector.appendChild(opt);
    });

    // si un projet est déjà actif, on le reflète
    if (currentProjectName) selector.value = currentProjectName;
  } catch (e) {
    console.error("loadProjectList error:", e);
  }
}

// =========================================================
//  CLOUD HELPERS
// =========================================================
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

// =========================================================
//  PROJECT ACTIONS
// =========================================================
async function initializeProject() {
  const name = document.getElementById("project-name").value?.trim();
  if (!name) return alert("Nom requis");
  if (!currentUser) return alert("Veuillez vous connecter");

  try {
    // 1) create local
    const path = await invoke("initialize_project", { projectName: name });
    currentProjectPath = path;

    // 2) activate local by name (Rust renvoie le path complet)
    const activatedPath = await invoke("activate_project", { projectName: name });
    currentProjectPath = activatedPath;

    // 3) ensure cloud project
    currentProjectId = await ensureCloudProject(name);

    // 4) UI/state
    currentProjectName = name;

    document.getElementById("project-section").style.display = "none";
    document.getElementById("controls-section").style.display = "block";
    document.getElementById("current-project-title").innerText = name;

    await loadProjectList();
    const selector = document.getElementById("project-selector");
    if (selector) selector.value = name;
  } catch (e) {
    alert("Erreur Init: " + (e?.message || e));
  }
}

async function switchProject(event) {
  const newName = event?.target?.value;
  if (!newName) return;
  if (!currentUser) return alert("Veuillez vous connecter");

  // si scan en cours => stop ou annule
  const stopBtnVisible = document.getElementById("stop-btn")?.style?.display === "block";
  if (stopBtnVisible) {
    const ok = confirm(`Un scan est en cours. L'arrêter pour passer sur "${newName}" ?`);
    if (!ok) {
      event.target.value = currentProjectName || "";
      return;
    }
    await stopScan();
  }

  try {
    // local activate
    const path = await invoke("activate_project", { projectName: newName });
    currentProjectPath = path;

    // cloud project id
    currentProjectId = await ensureCloudProject(newName);

    // UI
    currentProjectName = newName;
    document.getElementById("project-section").style.display = "none";
    document.getElementById("controls-section").style.display = "block";
    document.getElementById("current-project-title").innerText = newName;
  } catch (e) {
    alert("Erreur switch: " + (e?.message || e));
  }
}

// =========================================================
//  SCAN
// =========================================================
async function startScan() {
  if (!currentProjectName || !currentProjectPath) {
    return alert("Veuillez sélectionner ou créer un projet.");
  }

  try {
    await invoke("start_scan");
    scanStartTime = new Date().toISOString();

    // UI
    document.getElementById("start-btn").style.display = "none";
    document.getElementById("stop-btn").style.display = "block";
    document.getElementById("finalize-btn").disabled = true;
    document.getElementById("live-dashboard").style.display = "block";

    // live loop
    if (scanInterval) clearInterval(scanInterval);
    scanInterval = setInterval(async () => {
      try {
        const stats = await invoke("get_live_stats");
        if (stats?.is_scanning) {
          const min = Math.floor(stats.duration_sec / 60).toString().padStart(2, "0");
          const sec = (stats.duration_sec % 60).toString().padStart(2, "0");

          document.getElementById("timer").innerText = `${min}:${sec}`;
          document.getElementById("keystrokes-display").innerText = String(stats.keystrokes ?? 0);
          document.getElementById("clicks-display").innerText = String(stats.clicks ?? 0);
        }
      } catch (e) {
        console.error("get_live_stats error:", e);
      }
    }, 1000);
  } catch (e) {
    alert("Erreur Start: " + (e?.message || e));
  }
}

async function stopScan() {
  if (scanInterval) clearInterval(scanInterval);

  try {
    const analysis = await invoke("stop_scan");
    const endTime = new Date().toISOString();

    // INSERT ho_sessions (aligné SQL)
    if (currentUser && currentProjectId) {
      const { error } = await supabase.from("ho_sessions").insert({
        project_id: currentProjectId,
        user_id: currentUser.id,

        started_at: scanStartTime,
        ended_at: endTime,

        session_index: null,

        wall_duration_sec: analysis.wall_duration_sec,
        active_est_sec: analysis.active_est_sec,
        keystrokes_count: analysis.keystrokes_count,
        clicks_count: analysis.clicks_count,
        total_events: analysis.total_events,

        scp_score: analysis.score,
        evidence_score: analysis.evidence_score,
        effort_score: analysis.effort_score,

        flags: analysis.flags ?? [],
        verdict_label: analysis.verdict_label,
      });

      if (error) console.error("ho_sessions insert error:", error);
    }

    // UI reset
    document.getElementById("start-btn").style.display = "block";
    document.getElementById("stop-btn").style.display = "none";
    document.getElementById("finalize-btn").disabled = false;

    document.getElementById("live-dashboard").style.display = "none";
    document.getElementById("timer").innerText = "00:00";
    document.getElementById("keystrokes-display").innerText = "0";
    document.getElementById("clicks-display").innerText = "0";

    alert(
      `Session terminée.\nVerdict: ${analysis.verdict_label}\nSCP: ${analysis.score} / 100\nPreuve: ${analysis.evidence_score} / 100`
    );
  } catch (e) {
    alert("Erreur Stop: " + (e?.message || e));
  }
}

async function finalizeProject() {
  if (!currentProjectPath) return alert("Aucun projet actif.");
  const ok = confirm("Générer le certificat final et sceller le projet ?");
  if (!ok) return;

  try {
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });

    // UPSERT ho_certificates (aligné SQL)
    if (currentUser && currentProjectId) {
      const { error } = await supabase.from("ho_certificates").upsert(
        {
          project_id: currentProjectId,

          session_count: res.session_count,
          total_active_seconds: res.total_active_seconds,
          total_keystrokes: res.total_keystrokes,

          scp_score: res.scp_score,
          evidence_score: res.evidence_score,

          signature_hash: "PENDING_SHA256",
        },
        { onConflict: "project_id" }
      );

      if (error) console.error("ho_certificates upsert error:", error);
    }

    alert(`Certificat généré.\nScore global: ${res.scp_score} / 100`);
    await invoke("open_file", { path: res.html_path });
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

  const selector = document.getElementById("project-selector");
  if (selector) selector.addEventListener("change", switchProject);

  checkSession();
});
