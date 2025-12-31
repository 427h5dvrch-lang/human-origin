const { invoke } = window.__TAURI__.tauri;

let isScanning = false;
let activeProjectName = "";

window.addEventListener('DOMContentLoaded', () => { refreshProjectList(); });

async function refreshProjectList() {
  try {
    const projects = await invoke("get_projects");
    const container = document.getElementById("project-list");
    if(container) {
        container.innerHTML = ""; 
        if (projects.length === 0) {
        container.innerHTML = "<div style='font-size:12px; color:#999; margin-top:5px'>Aucun projet trouvé</div>";
        return;
        }
        projects.forEach(name => {
        const div = document.createElement("div");
        div.className = "project-item";
        div.textContent = name;
        div.onclick = () => loadProjectByName(name);
        container.appendChild(div);
        });
    }
  } catch (err) { console.error("Erreur liste projets:", err); }
}

async function createProject() {
  const input = document.getElementById("project-input");
  const name = input.value.trim();
  if (!name) return alert("Nom invalide");
  loadProjectByName(name);
}

async function loadProjectByName(name) {
  try {
    const projectPath = await invoke("initialize_project", { projectName: name });
    const metadata = await invoke("activate_project", { projectPath: projectPath });
    activeProjectName = name;
    if (metadata.status === "LOCKED") {
        alert("Ce projet est finalisé (LOCKED). Vous pouvez consulter les certificats.");
    }
    document.getElementById("project-ui").style.display = "none";
    document.getElementById("scan-ui").style.display = "block";
    document.getElementById("current-project-name").textContent = activeProjectName;
  } catch (error) { alert("Erreur chargement : " + error); }
}

async function toggleScan() {
  if (!isScanning) {
    try {
      await invoke("start_scan");
      isScanning = true;
      updateUIState("scanning");
    } catch (error) { alert("Impossible de démarrer : " + error); }
  } else {
    try {
      const result = await invoke("stop_scan");
      isScanning = false;
      showResults(result);
    } catch (error) { alert("Erreur arrêt : " + error); }
  }
}

async function openFolder() {
    if(!activeProjectName) return;
    try { await invoke("open_project_folder", { projectName: activeProjectName }); } 
    catch (e) { alert("Impossible d'ouvrir le dossier : " + e); }
}

async function finalizeProject() {
    if(!activeProjectName) return;
    if(!confirm("Êtes-vous sûr de vouloir FINALISER ce projet ?\n\nCela va générer le certificat final et empêcher toute modification.")) return;

    try {
        const path = await invoke("initialize_project", { projectName: activeProjectName });
        const htmlPath = await invoke("finalize_project", { projectPath: path });
        await invoke("open_file", { path: htmlPath });
        resetApp(); 
    } catch (e) {
        alert("Erreur finalisation : " + e);
    }
}

// --- CLOUD SYNC LOGIC ---

async function syncPush() {
    const aliasInput = document.getElementById("vault-alias");
    const secretInput = document.getElementById("vault-secret");

    const alias = aliasInput.value.trim();
    const secret = secretInput.value.trim();

    if (!alias || !secret) {
        return alert("Veuillez entrer un Alias et une Phrase Secrète.");
    }

    try {
        const msg = await invoke("vault_sync_push", { alias, secret });
        alert("✅ " + msg);
    } catch (e) {
        alert("Erreur Connexion : " + e);
    }
}

async function syncPull() {
    const aliasInput = document.getElementById("vault-alias");
    const secretInput = document.getElementById("vault-secret");

    const alias = aliasInput.value.trim();
    const secret = secretInput.value.trim();

    if (!alias || !secret) {
        return alert("Veuillez entrer votre Alias et Phrase Secrète.");
    }

    try {
        const msg = await invoke("vault_sync_pull", { alias, secret });
        alert("✅ " + msg);
        refreshProjectList();
    } catch (e) {
        alert("Erreur Récupération : " + e);
    }
}

// --------------------------------

function updateUIState(state) {
  const btn = document.getElementById("btn-main");
  const dot = document.getElementById("status-dot");
  const txt = document.getElementById("status-text");
  if (state === "scanning") {
    btn.textContent = "Arrêter & Signer";
    btn.style.backgroundColor = "#ff3b30";
    dot.className = "dot active";
    txt.textContent = "Enregistrement sécurisé...";
  } else {
    btn.textContent = "Commencer la Session";
    btn.style.backgroundColor = "#000";
    dot.className = "dot ready";
    txt.textContent = "Prêt à capturer";
  }
}

function showResults(result) {
  document.getElementById("scan-ui").style.display = "none";
  document.getElementById("result-card").style.display = "block";
  const proof = result.proof_data;
  const activeSec = proof.activity.active_seconds;
  const mins = Math.floor(activeSec / 60);
  const secs = activeSec % 60;
  document.getElementById("res-time").textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  document.getElementById("res-keys").textContent = proof.keyboard.total_keystrokes;
  
  const badge = document.getElementById("res-rhythm");
  const variance = proof.temporal.iki_variance;
  
  if (proof.keyboard.total_keystrokes < 10) {
    badge.textContent = "Données insuffisantes";
    badge.style.background = "#eee"; badge.style.color = "#666";
  } else if (variance > 10000) {
    badge.textContent = "✨ Rythme Organique";
    badge.style.background = "#eaffef"; badge.style.color = "#008a2e";
  } else {
    badge.textContent = "⚡ Flux Rapide";
    badge.style.background = "#fff0e6"; badge.style.color = "#cc5200";
  }
}

function returnToScan() {
  document.getElementById("result-card").style.display = "none";
  document.getElementById("scan-ui").style.display = "block";
  updateUIState("idle");
}

function resetApp() {
  isScanning = false;
  document.getElementById("scan-ui").style.display = "none";
  document.getElementById("result-card").style.display = "none";
  document.getElementById("project-ui").style.display = "block";
  const input = document.getElementById("project-input");
  if(input) input.value = "";
  refreshProjectList();
}