import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { createClient } from "@supabase/supabase-js";

// --- ⚠️ TES CLÉS SUPABASE ICI ⚠️ ---
const supabaseUrl = "https://bhlisgvozsgqxugrfsiu.supabase.co";
const supabaseAnonKey = "sb_publishable_eR_vQL3H4TmpsUlZeoICXw_3HN4G2kn";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

let currentProjectPath = "";
let currentProjectId = null;
let scanInterval = null;
let currentUser = null;
let scanStartTime = null;

// --- 1. GESTION AUTH ---
listen("scheme-request", async (event) => {
  const url = event.payload;
  const fragment = url.split("#")[1];
  if (!fragment) return;

  const params = new URLSearchParams(fragment);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
    await checkSession();
  }
});

async function checkSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("getSession error:", error);

  if (data?.session) {
    currentUser = data.session.user;
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("app-screen").style.display = "block";
  } else {
    currentUser = null;
    document.getElementById("login-screen").style.display = "block";
    document.getElementById("app-screen").style.display = "none";
  }
}

async function handleLogin() {
  const email = document.getElementById("email").value;
  if (!email) return alert("Email requis");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: "humanorigin://login",
      redirectTo: "humanorigin://login", // compat
    },
  });

  if (error) alert("Erreur: " + error.message);
  else alert("Lien de connexion envoyé. Ouvrez votre email pour finaliser la connexion.");
}

async function handleLogout() {
  await supabase.auth.signOut();

  // reset local state
  currentUser = null;
  currentProjectPath = "";
  currentProjectId = null;
  scanStartTime = null;

  await checkSession();
}

// --- 2. GESTION PROJET (UPSERT ho_projects) ---
async function initializeProject() {
  const name = document.getElementById("project-name").value;
  if (!name) return alert("Nom requis");
  if (!currentUser) return alert("Veuillez vous connecter");

  try {
    // A. Init Local (Rust)
    const path = await invoke("initialize_project", { projectName: name });
    currentProjectPath = path;

    // B. Init Cloud (Supabase) -> UPSERT DIRECT
    const { data, error } = await supabase
      .from("ho_projects")
      .upsert({ user_id: currentUser.id, name }, { onConflict: "user_id,name" })
      .select("id")
      .single();

    if (error) throw error;
    currentProjectId = data.id;

    // UI Update
    document.getElementById("project-section").style.display = "none";
    document.getElementById("controls-section").style.display = "block";
    document.getElementById("current-project-title").innerText = name;

    await invoke("activate_project", { projectPath: path });
  } catch (error) {
    alert("Erreur Init: " + (error?.message || error));
  }
}

// --- 3. SCAN + LIVE ---
async function startScan() {
  try {
    await invoke("start_scan");
    scanStartTime = new Date().toISOString();

    document.getElementById("start-btn").style.display = "none";
    document.getElementById("stop-btn").style.display = "block";
    document.getElementById("finalize-btn").disabled = true;
    document.getElementById("live-dashboard").style.display = "block";

    if (scanInterval) clearInterval(scanInterval);
    scanInterval = setInterval(async () => {
      try {
        const stats = await invoke("get_live_stats");
        if (!stats.is_scanning) return;

        const min = Math.floor(stats.duration_sec / 60).toString().padStart(2, "0");
        const sec = (stats.duration_sec % 60).toString().padStart(2, "0");
        document.getElementById("timer").innerText = `${min}:${sec}`;
        document.getElementById("keystrokes-display").innerText = stats.keystrokes;
        document.getElementById("clicks-display").innerText = stats.clicks;
      } catch (e) {
        console.error("get_live_stats error:", e);
      }
    }, 1000);
  } catch (error) {
    alert("Erreur Start: " + (error?.message || error));
  }
}

// --- 4. STOP & INSERT SESSION (ho_sessions) ---
async function stopScan() {
  if (scanInterval) clearInterval(scanInterval);

  try {
    const analysis = await invoke("stop_scan");
    const endTime = new Date().toISOString();

    if (currentUser && currentProjectId) {
      const { error } = await supabase.from("ho_sessions").insert({
        project_id: currentProjectId,
        user_id: currentUser.id,
        started_at: scanStartTime,
        ended_at: endTime,

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

      if (error) console.error("Erreur Sync Cloud ho_sessions:", error);
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
      `Session terminée.\nVerdict: ${analysis.verdict_label}\nSCP: ${analysis.score} | Preuve: ${analysis.evidence_score}`
    );
  } catch (error) {
    alert("Erreur Stop: " + (error?.message || error));
  }
}

// --- 5. FINALIZE & UPSERT CERTIFICAT (ho_certificates) ---
async function finalizeProject() {
  if (!confirm("Générer le certificat final et sceller le projet ?")) return;

  try {
    const res = await invoke("finalize_project", { projectPath: currentProjectPath });

    if (currentUser && currentProjectId) {
      // ... dans finalizeProject ...

      const { error } = await supabase.from("ho_certificates").upsert(
        {
          project_id: currentProjectId,
          session_count: res.session_count,
          total_active_seconds: res.total_active_seconds,
          total_keystrokes: res.total_keystrokes,

          // ✅ CORRECTION : On enlève "avg_" pour matcher ta table SQL
          scp_score: res.scp_score,
          evidence_score: res.evidence_score,

          signature_hash: "PENDING_SHA256",
        },
        { onConflict: "project_id" }
      );

// ...

      if (error) console.error("Erreur Sync Cloud ho_certificates:", error);
    }

    alert(`Certificat généré.\nScore global: ${res.scp_score}`);
    await invoke("open_file", { path: res.html_path });
  } catch (error) {
    alert("Erreur Finalize: " + (error?.message || error));
  }
}

// INIT
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("login-btn").addEventListener("click", handleLogin);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);
  document.getElementById("init-btn").addEventListener("click", initializeProject);
  document.getElementById("start-btn").addEventListener("click", startScan);
  document.getElementById("stop-btn").addEventListener("click", stopScan);
  document.getElementById("finalize-btn").addEventListener("click", finalizeProject);

  checkSession();
});
