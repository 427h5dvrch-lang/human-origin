import { invoke, convertFileSrc } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { createClient } from "@supabase/supabase-js";
import { writeTextFile, BaseDirectory } from "@tauri-apps/api/fs";

// -------------------- SUPABASE --------------------
const supabaseUrl = "https://bhlisgvozsgqxugrfsiu.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXHVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJobGlzZ3ZvenNncXh1Z3Jmc2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTI5NDEsImV4cCI6MjA4MzcyODk0MX0.L43rUuDFtg-QH7lVCFTFkJzMTjNUX7BWVXqmVMvIwZ0";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// -------------------- STATE --------------------
let currentUser = null;
let currentProjectName = null;
let currentProjectId = null;
let currentProjectPath = "";
let currentSessionId = null;
let lastSnapshot = null;

let scanInterval = null;
let isExpert = false;

// MODE SIMPLE pointers
let lastCertifiedSessionCertPath = null; // html_path local (session)
let lastMasterHtmlString = null;         // master HTML string (in-app viewer)
let lastMasterFilename = null;           // export name

// -------------------- HELPERS --------------------
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.innerText = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.style.display = "none"), 3500);
}

function setCloudBadge(ok, extra = "") {
  const b = $("cloud-badge");
  if (!b) return;
  b.className = "badge " + (ok ? "ok" : "warn");
  b.innerText = ok ? `CLOUD: OK${extra ? " • " + extra : ""}` : `CLOUD: ERROR${extra ? " • " + extra : ""}`;
}

function showLogin() {
  $("login-screen").classList.remove("hidden");
  $("app-screen").classList.add("hidden");
}

function showApp() {
  $("login-screen").classList.add("hidden");
  $("app-screen").classList.remove("hidden");
}

function setMode(expert) {
  isExpert = !!expert;
  $("expert-history").classList.toggle("hidden", !isExpert);
  $("expert-actions").classList.toggle("hidden", !isExpert);

  // Simple sections are always visible, but you can hide subtitle if you want
  // Keep them visible: simpler mental model.
}

function resetLiveUI() {
  $("timer").innerText = "00:00";
  $("keystrokes-display").innerText = "0";
  $("clicks-display").innerText = "0";
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString("fr-FR"); } catch { return "—"; }
}

function shortHash(s, n = 10) {
  if (!s) return "—";
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function sourceBadge(authoritySignature) {
  if (!authoritySignature) return "⚠️ LOCAL";
  return authoritySignature.includes("auth") ? "✅ AUTH" : "⚠️ LOCAL";
}

// -------------------- CRYPTO --------------------
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalStringify(value) {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(value[k]));
  return "{" + parts.join(",") + "}";
}

// -------------------- DB HELPER --------------------
async function dbOrThrow(where, promise) {
  const { data, error } = await promise;
  if (error) {
    console.error(`[DB ERROR] ${where}`, error);
    throw error;
  }
  return data;
}

// -------------------- AUTH (Deep Link) --------------------
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
      toast("Connexion réussie ✅");
    }
  } catch (e) {
    console.error("scheme-request error", e);
  }
});

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    currentUser = data.session.user;
    $("user-email-display").innerText = currentUser.email || "—";
    showApp();
    await loadProjectList();
    setTimeout(checkForDrafts, 800);
    setCloudBadge(true);
  } else {
    currentUser = null;
    $("user-email-display").innerText = "—";
    showLogin();
    setCloudBadge(false, "non connecté");
  }
}

async function handleLogin() {
  const email = $("email")?.value?.trim();
  if (!email) return alert("Email requis");
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "humanorigin://login" },
  });
  if (error) return alert("Erreur: " + error.message);
  toast("Lien envoyé. Vérifiez vos emails.");
}

async function handleLogout() {
  await supabase.auth.signOut();
  window.location.reload();
}

// -------------------- PROJECTS --------------------
async function loadProjectList() {
  const sel = $("project-selector");
  const projects = await invoke("get_projects");
  sel.innerHTML = '<option value="" disabled selected>— Vos projets —</option>';
  (projects || []).forEach((n) => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.innerText = n;
    sel.appendChild(opt);
  });
}

async function ensureCloudProject(name) {
  if (!currentUser) throw new Error("Not logged in");

  const payload = { user_id: currentUser.id, name, updated_at: new Date().toISOString() };

  try {
    const row = await dbOrThrow(
      "upsert project",
      supabase.from("ho_projects").upsert(payload, { onConflict: "user_id,name" }).select("id").single()
    );
    return row.id;
  } catch (e) {
    const { data } = await supabase
      .from("ho_projects")
      .select("id")
      .eq("user_id", currentUser.id)
      .eq("name", name)
      .single();
    return data?.id || null;
  }
}

async function initializeProject() {
  if (!currentUser) return alert("Connectez-vous d'abord");
  const name = ($("project-name")?.value || "").trim() || $("project-selector")?.value;
  if (!name) return alert("Nom de projet requis");

  try {
    currentProjectPath = await invoke("initialize_project", { projectName: name });
    currentProjectPath = await invoke("activate_project", { projectName: name });
    currentProjectId = await ensureCloudProject(name);
    currentProjectName = name;

    $("current-project-title").innerText = name;
    $("project-section").classList.add("hidden");
    $("controls-section").classList.remove("hidden");

    $("session-hint").innerText = "Prêt. Démarrez une session ou consultez les certificats.";

    await refreshAll();
    toast("Projet chargé ✅");
  } catch (e) {
    console.error(e);
    alert("Erreur projet: " + (e?.message || e));
  }
}

// -------------------- POINT 1/2/3 : MODE SIMPLE/EXPERT + Viewer in-app + Bibliothèque --------------------
function openViewerWithSrc(title, srcUrl, openExternalPath = null) {
  $("viewer-title").innerText = title || "Certificat";
  const frame = $("viewer-frame");
  frame.removeAttribute("srcdoc");
  frame.src = srcUrl || "about:blank";

  $("viewer-open-external-btn").onclick = async () => {
    if (!openExternalPath) return toast("Aucun fichier à ouvrir.");
    try {
      await invoke("open_file", { path: openExternalPath });
    } catch (e) {
      alert("Impossible d'ouvrir: " + e);
    }
  };

  $("viewer-modal").style.display = "flex";
}

function openViewerWithHtml(title, htmlString) {
  $("viewer-title").innerText = title || "Certificat";
  const frame = $("viewer-frame");
  frame.src = "about:blank";
  frame.srcdoc = htmlString || "<html><body>Vide</body></html>";

  $("viewer-open-external-btn").onclick = async () => {
    // Export then open external
    try {
      const filename = lastMasterFilename || `HUMANORIGIN_MASTER_${Date.now()}.html`;
      await writeTextFile(filename, htmlString, { dir: BaseDirectory.Download });
      toast("Exporté dans Téléchargements ✅");
    } catch (e) {
      alert("Erreur export: " + e);
    }
  };

  $("viewer-modal").style.display = "flex";
}

// -------------------- POINT 6 : AUTH vs LOCAL clair --------------------
function setFinalizeEnabled(enabled) {
  $("finalize-btn").disabled = !enabled;
}

function setSimpleButtonsState() {
  $("open-last-session-cert-btn").disabled = !lastCertifiedSessionCertPath;
  $("open-project-master-btn").disabled = !lastMasterHtmlString;
}

// -------------------- SCAN FLOW --------------------
let scanStartTime = 0;

async function startScan() {
  if (!currentUser) return toast("Connectez-vous d'abord");
  if (!currentProjectId) return alert("Projet non chargé");

  try {
    currentSessionId = crypto.randomUUID();

    await dbOrThrow(
      "insert session RUNNING",
      supabase.from("ho_sessions").insert({
        id: currentSessionId,
        user_id: currentUser.id,
        project_id: currentProjectId,
        started_at: new Date().toISOString(),
        status: "RUNNING",
      })
    );

    await invoke("start_scan", { sessionId: currentSessionId });

    scanStartTime = Date.now();
    resetLiveUI();

    $("start-btn").classList.add("hidden");
    $("stop-btn").classList.remove("hidden");
    setFinalizeEnabled(false);
    $("live-dashboard").style.display = "block";

    if (scanInterval) clearInterval(scanInterval);
    scanInterval = setInterval(async () => {
      const s = await invoke("get_live_stats");
      if (s?.is_scanning) {
        const min = Math.floor(s.duration_sec / 60).toString().padStart(2, "0");
        const sec = (s.duration_sec % 60).toString().padStart(2, "0");
        $("timer").innerText = `${min}:${sec}`;
        $("keystrokes-display").innerText = String(s.keystrokes ?? 0);
        $("clicks-display").innerText = String(s.clicks ?? 0);
      }
    }, 1000);

    toast("Session démarrée ✅");
  } catch (e) {
    console.error(e);
    alert("Erreur start: " + (e?.message || e));
  }
}

async function stopScan() {
  if (scanInterval) clearInterval(scanInterval);

  try {
    const snap = await invoke("stop_scan");
    lastSnapshot = snap;

    await supabase
      .from("ho_sessions")
      .update({
        ended_at: new Date().toISOString(),
        status: "STOPPED",
        active_ms: snap.active_ms || 0,
        events_count: snap.events_count || 0,
        scp_score: snap.scp_score || 0,
        evidence_score: snap.evidence_score || 0,
        diag: snap.diag || {},
      })
      .eq("id", currentSessionId);

    $("start-btn").classList.remove("hidden");
    $("stop-btn").classList.add("hidden");
    $("live-dashboard").style.display = "none";
    setFinalizeEnabled(true);

    toast("Session arrêtée. Vous pouvez certifier ✅");
    await refreshAll();
  } catch (e) {
    console.error(e);
    alert("Erreur stop: " + (e?.message || e));
  }
}

// -------------------- POINT 4 : Chain-of-custody (prev hash) --------------------
async function getPrevCertifiedSessionHash() {
  // on prend la dernière session CERTIFIED (par date)
  const { data } = await supabase
    .from("ho_sessions")
    .select("id, started_at, cert_id")
    .eq("project_id", currentProjectId)
    .eq("status", "CERTIFIED")
    .order("started_at", { ascending: false })
    .limit(1);

  const prev = data?.[0];
  if (!prev?.cert_id) return null;

  const { data: cert } = await supabase
    .from("ho_certificates")
    .select("payload_hash")
    .eq("id", prev.cert_id)
    .single();

  return cert?.payload_hash || null;
}

// -------------------- FINALIZE SESSION (AUTH -> fallback LOCAL) --------------------
async function finalizeProject() {
  if (!currentUser) return alert("Connectez-vous d'abord");
  if (!currentProjectId) return alert("Projet non chargé");
  if (!currentSessionId) return toast("Aucune session active");
  if (!lastSnapshot) return toast("Aucune preuve à certifier");

  try {
    const prevHash = await getPrevCertifiedSessionHash(); // chain-of-custody

    const certUnsigned = {
      protocol: "ho3.cert.v1",
      meta: {
        user_id: currentUser.id,
        project_id: currentProjectId,
        session_id: currentSessionId,
        created_at: new Date().toISOString(),
        client: "tauri",
        prev_session_hash: prevHash, // ✅ chain
      },
      scores: {
        scp: lastSnapshot?.scp_score ?? 0,
        evidence: lastSnapshot?.evidence_score ?? 0,
      },
      diag: lastSnapshot?.diag ?? null,
    };

    const canonical = canonicalStringify(certUnsigned);
    const payloadHash = await sha256Hex(canonical);
    const deviceSig = await invoke("sign_payload_hash", { payloadHash });
    const deviceSigObj = {
      alg: "ed25519",
      public_key: deviceSig.public_key,
      signature: deviceSig.signature,
      key_id: "device-key-v1",
    };

    toast("Signature Cloud en cours...");
    setCloudBadge(true, "signature…");

    // AUTH call
    const { data, error } = await supabase.functions.invoke("sign-cert", {
      body: {
        cert_unsigned: certUnsigned,
        payload_hash: payloadHash,
        device_signature: JSON.stringify(deviceSigObj),
      },
    });

    let certId = null;
    let authoritySig = null;

    if (!error && data?.cert_id) {
      certId = data.cert_id;
      authoritySig = data.authority_signature || "auth-v1";
      toast("Certifié par Autorité ✅");
      setCloudBadge(true, "AUTH");
    } else {
      // ✅ Point 6 : rendre l’échec explicite
      console.warn("AUTH failed => LOCAL fallback", error);
      setCloudBadge(false, error?.message || "AUTH failed");

      certId = crypto.randomUUID();
      authoritySig = "local-bypass-mode";

      await dbOrThrow(
        "insert LOCAL cert",
        supabase.from("ho_certificates").insert({
          id: certId,
          user_id: currentUser.id,
          project_id: currentProjectId,
          session_id: currentSessionId,
          issued_at: new Date().toISOString(),
          payload_hash: payloadHash,
          device_signature: deviceSigObj,
          authority_signature: authoritySig,
          cert_json: certUnsigned,
        })
      );

      toast("Certifié LOCAL (autorité indisponible)");
    }

    // Update session status CERTIFIED in all cases
    await supabase
      .from("ho_sessions")
      .update({
        status: "CERTIFIED",
        cert_id: certId,
        certified_at: new Date().toISOString(),
      })
      .eq("id", currentSessionId);

    // Generate local HTML session certificate (Rust)
    try {
      const res = await invoke("finalize_project", { projectPath: currentProjectPath });
      if (res?.html_path) {
        lastCertifiedSessionCertPath = res.html_path;
      }
    } catch (e) {
      console.warn("finalize_project (html) failed", e);
    }

    // UI reset
    setFinalizeEnabled(false);
    lastSnapshot = null;
    currentSessionId = null;

    await refreshAll();
    toast("OK ✅");
  } catch (e) {
    console.error(e);
    alert("Erreur certification: " + (e?.message || e));
  } finally {
    setSimpleButtonsState();
  }
}

// -------------------- POINT 3/4 : Master certificate (projet) + hash agrégé + chain --------------------
async function buildMasterCertificateData() {
  // Sessions certifiées, chronologiques
  const sessions = await dbOrThrow(
    "fetch certified sessions",
    supabase
      .from("ho_sessions")
      .select("id, started_at, active_ms, events_count, cert_id")
      .eq("project_id", currentProjectId)
      .eq("status", "CERTIFIED")
      .order("started_at", { ascending: true })
  );

  if (!sessions || sessions.length === 0) return null;

  // Load certs referenced by sessions
  const certIds = sessions.map((s) => s.cert_id).filter(Boolean);
  const certs = certIds.length
    ? await dbOrThrow(
        "fetch cert rows",
        supabase
          .from("ho_certificates")
          .select("id, payload_hash, authority_signature, cert_json, issued_at")
          .in("id", certIds)
      )
    : [];

  const certById = new Map((certs || []).map((c) => [c.id, c]));

  // Totals + chain
  let totalActiveMs = 0;
  let totalEvents = 0;

  const chainRows = sessions.map((s, idx) => {
    totalActiveMs += s.active_ms || 0;
    totalEvents += s.events_count || 0;

    const cert = certById.get(s.cert_id) || null;
    const payloadHash = cert?.payload_hash || "";
    const authSig = cert?.authority_signature || "local-bypass-mode";
    const prevHash = cert?.cert_json?.meta?.prev_session_hash || null;

    return {
      index: idx + 1,
      session_id: s.id,
      started_at: s.started_at,
      active_ms: s.active_ms || 0,
      events_count: s.events_count || 0,
      payload_hash: payloadHash,
      authority_signature: authSig,
      prev_session_hash: prevHash,
    };
  });

  // Master hash: concat of payload_hash in order + each prev hash string (to bind chain)
  const chainMaterial = chainRows
    .map((r) => `${r.payload_hash}|${r.prev_session_hash || "GENESIS"}`)
    .join("\n");

  const masterHash = await sha256Hex(chainMaterial);

  // Determine MASTER source: AUTH only if all rows are AUTH
  const isAuth = chainRows.length > 0 && chainRows.every((r) => String(r.authority_signature || "").includes("auth"));
  const source = isAuth ? "AUTH" : "LOCAL";

  return {
    project_name: currentProjectName,
    user_email: currentUser?.email || "",
    created_at: new Date().toISOString(),
    sessions_count: chainRows.length,
    total_active_ms: totalActiveMs,
    total_events: totalEvents,
    master_hash: masterHash,
    source,
    chain: chainRows,
  };
}

function masterHtmlFromData(m) {
  const totalHours = (m.total_active_ms / 1000 / 3600).toFixed(1);
  const created = fmtDate(m.created_at);

  const badgeClass = m.source === "AUTH" ? "ok" : "warn";
  const badgeText = m.source === "AUTH" ? "AUTH" : "LOCAL";

  const rows = m.chain
    .map((r) => {
      const activeSec = Math.round((r.active_ms || 0) / 1000);
      return `
        <tr>
          <td>#${r.index}</td>
          <td class="mono">${r.session_id.slice(0, 8)}…</td>
          <td>${fmtDate(r.started_at)}</td>
          <td>${activeSec}s</td>
          <td class="mono">${shortHash(r.payload_hash, 14)}</td>
          <td>${String(r.authority_signature || "").includes("auth") ? "✅ AUTH" : "⚠️ LOCAL"}</td>
        </tr>
      `;
    })
    .join("");

  return `
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HumanOrigin — Certificat final</title>
<style>
  :root{ --bg:#f5f5f7; --card:#fff; --text:#1d1d1f; --muted:#86868b; --border:#d2d2d7; --ok:#2e7d32; --warn:#e65100; }
  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--bg); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--text); }
  .wrap{ max-width:980px; margin:0 auto; padding:28px 18px; }
  .card{ background:var(--card); border:1px solid rgba(0,0,0,0.04); border-radius:16px; box-shadow:0 2px 14px rgba(0,0,0,0.06); padding:18px; }
  .muted{ color:var(--muted); font-size:12px; }
  h1{ margin:6px 0 0 0; font-size:20px; }
  .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; }
  .kpi{ padding:12px; border-radius:12px; border:1px solid var(--border); }
  .kpi b{ display:block; font-size:18px; margin-top:4px; }
  .mono{ font-family: ui-monospace, Menlo, Monaco, Consolas, "Courier New", monospace; }
  table{ width:100%; border-collapse:collapse; margin-top:14px; font-size:13px; }
  th{ text-align:left; color:var(--muted); border-bottom:1px solid var(--border); padding:8px 0; }
  td{ padding:10px 0; border-bottom:1px solid #eee; }
  tr:last-child td{ border-bottom:none; }
  .badge{ display:inline-block; padding:4px 10px; border-radius:999px; font-weight:700; font-size:12px; }
  .badge.ok{ background:#e8f5e9; color:var(--ok); }
  .badge.warn{ background:#fff3e0; color:var(--warn); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="muted">HUMANORIGIN // CERTIFICAT FINAL (PROJET)</div>
      <h1>${escapeHtml(m.project_name || "Projet")}</h1>
      <div class="muted">Auteur: ${escapeHtml(m.user_email || "—")} • Date: ${escapeHtml(created)}</div>

      <div class="grid">
        <div class="kpi"><div class="muted">Sessions certifiées</div><b>${m.sessions_count}</b></div>
        <div class="kpi"><div class="muted">Temps actif total</div><b>${totalHours} h</b></div>
        <div class="kpi"><div class="muted">Actions</div><b>${m.total_events}</b></div>
        <div class="kpi"><div class="muted">MASTER HASH</div><b class="mono" style="font-size:12px; line-height:1.25;">${m.master_hash}</b></div>
      </div>

      <div style="margin-top:14px;">
        <span class="badge ${badgeClass}">${badgeText}</span>
        <span class="muted">Ce document agrège cryptographiquement les sessions certifiées du projet.</span>
      </div>

      <div class="muted" style="margin-top:14px;">Chaîne de sessions</div>
      <table>
        <thead><tr><th>#</th><th>Session</th><th>Début</th><th>Actif</th><th>Activ.Hash</th><th>Source</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="muted" style="margin-top:10px;">
        Vérification V1 : hash maître = SHA-256(concat(hash_session | prev_hash)).
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function buildAndCacheMaster() {
  const m = await buildMasterCertificateData();
  if (!m) {
    lastMasterHtmlString = null;
    lastMasterFilename = null;
    setSimpleButtonsState();
    return null;
  }
  lastMasterHtmlString = masterHtmlFromData(m);
  lastMasterFilename = `HUMANORIGIN_MASTER_${safeName(currentProjectName)}_${new Date().toISOString().slice(0,10)}.html`;
  setSimpleButtonsState();
  return m;
}

function safeName(name) {
  return String(name || "projet").replaceAll(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40);
}

// -------------------- POINT 5 : Verifier (intégrité) --------------------
async function verifyProjectIntegrity() {
  if (!currentProjectId) return;
  toast("Vérification en cours…");

  const m = await buildMasterCertificateData();
  if (!m) return alert("Aucune session certifiée à vérifier.");

  // 1) Vérif : chaque cert_json recalcule son payload_hash
  const certIds = m.chain.map((r) => r.session_id);
  // We already have hashes in chain, but we need cert_json rows:
  const sessions = await supabase
    .from("ho_sessions")
    .select("id, cert_id")
    .eq("project_id", currentProjectId)
    .eq("status", "CERTIFIED");

  const certIdList = (sessions.data || []).map((s) => s.cert_id).filter(Boolean);
  const certRows = certIdList.length
    ? await supabase.from("ho_certificates").select("id, payload_hash, cert_json").in("id", certIdList)
    : { data: [] };

  const byId = new Map((certRows.data || []).map((c) => [c.id, c]));
  for (const s of (sessions.data || [])) {
    const c = byId.get(s.cert_id);
    if (!c?.cert_json || !c?.payload_hash) {
      return alert(`❌ Vérif KO : certificat manquant pour session ${s.id}`);
    }
    const canonical = canonicalStringify(c.cert_json);
    const recomputed = await sha256Hex(canonical);
    if (recomputed !== c.payload_hash) {
      return alert(`❌ Vérif KO : hash mismatch sur cert ${c.id}\nDB: ${c.payload_hash}\nRE: ${recomputed}`);
    }
  }

  // 2) Vérif : master hash recomputed from chain data
  const chainMaterial = m.chain
    .map((r) => `${r.payload_hash}|${r.prev_session_hash || "GENESIS"}`)
    .join("\n");
  const recomputedMaster = await sha256Hex(chainMaterial);
  if (recomputedMaster !== m.master_hash) {
    return alert(`❌ Vérif KO : master hash mismatch\nDB: ${m.master_hash}\nRE: ${recomputedMaster}`);
  }

  alert("✅ Vérification OK : hashes + chaîne cohérents.");
}

// -------------------- HISTORY / REFRESH --------------------
async function refreshHistorySimple() {
  // Show only: last session certified + project master availability
  const tbody = $("simple-history-tbody");
  tbody.innerHTML = "";

  // last certified cert
  const { data: lastCert } = await supabase
    .from("ho_certificates")
    .select("id, issued_at, payload_hash, authority_signature, cert_json")
    .eq("project_id", currentProjectId)
    .order("issued_at", { ascending: false })
    .limit(1);

  const c = lastCert?.[0];
  if (c) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(c.issued_at)}</td>
      <td class="mono">${shortHash(c.payload_hash, 16)}</td>
      <td>${sourceBadge(c.authority_signature)}</td>
    `;
    tbody.appendChild(tr);
  } else {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Aucun certificat pour l’instant.</td>`;
    tbody.appendChild(tr);
  }
}

async function refreshHistoryExpert() {
  // Certs
  const { data: certs } = await supabase
    .from("ho_certificates")
    .select("id, issued_at, payload_hash, authority_signature, cert_json")
    .eq("project_id", currentProjectId)
    .order("issued_at", { ascending: false })
    .limit(10);

  $("certs-tbody").innerHTML = (certs || [])
    .map((c) => {
      const type = c?.cert_json?.protocol === "ho3.cert.v1" ? "SESSION" : (c?.cert_json?.protocol || "—");
      return `
        <tr data-cert-id="${c.id}" style="cursor:pointer;">
          <td>${fmtDate(c.issued_at)}</td>
          <td class="mono">${shortHash(c.payload_hash, 18)}</td>
          <td>${sourceBadge(c.authority_signature)}</td>
          <td>${escapeHtml(type)}</td>
        </tr>
      `;
    })
    .join("");

  // Click to view JSON (expert)
  [...$("certs-tbody").querySelectorAll("tr[data-cert-id]")].forEach((tr) => {
    tr.onclick = async () => {
      const id = tr.getAttribute("data-cert-id");
      const { data } = await supabase.from("ho_certificates").select("*").eq("id", id).single();
      if (!data) return;
      // Expert viewing: show JSON in viewer as HTML block (simple)
      const html = `
        <html><body style="font-family: -apple-system, sans-serif; padding: 18px;">
          <h3>Certificat (JSON)</h3>
          <div style="margin:10px 0; font-size:13px; color:#666;">${fmtDate(data.issued_at)} • ${sourceBadge(data.authority_signature)} • ${data.id}</div>
          <pre style="background:#f5f5f7; padding:12px; border-radius:12px; overflow:auto;">${escapeHtml(JSON.stringify(data.cert_json || {}, null, 2))}</pre>
        </body></html>
      `;
      openViewerWithHtml("Détails techniques (JSON)", html);
    };
  });

  // Sessions
  const { data: sessions } = await supabase
    .from("ho_sessions")
    .select("id, started_at, status, events_count")
    .eq("project_id", currentProjectId)
    .order("started_at", { ascending: false })
    .limit(10);

  $("sessions-tbody").innerHTML = (sessions || [])
    .map((s) => {
      return `
        <tr>
          <td>${fmtDate(s.started_at)}</td>
          <td>${escapeHtml(s.status || "—")}</td>
          <td style="text-align:right;">${Number(s.events_count || 0)}</td>
        </tr>
      `;
    })
    .join("");
}

async function refreshAll() {
  if (!currentProjectId) return;

  $("history-subtitle").innerText = currentProjectName ? `Projet: ${currentProjectName}` : "—";

  // Build master cache (mode simple button + in-app view)
  await buildAndCacheMaster();

  // Simple history always refreshed
  await refreshHistorySimple();

  // Expert if toggled
  if (isExpert) await refreshHistoryExpert();

  // Update simple buttons and optionally session cert availability
  setSimpleButtonsState();
}

// -------------------- EXPORT MASTER (Expert) --------------------
async function exportMasterHtml() {
  if (!lastMasterHtmlString) {
    await buildAndCacheMaster();
    if (!lastMasterHtmlString) return alert("Aucune session certifiée à exporter.");
  }
  try {
    const filename = lastMasterFilename || `HUMANORIGIN_MASTER_${Date.now()}.html`;
    await writeTextFile(filename, lastMasterHtmlString, { dir: BaseDirectory.Download });
    toast("Exporté dans Téléchargements ✅");
  } catch (e) {
    alert("Erreur export: " + e);
  }
}

// -------------------- OPEN SESSION CERT (Simple) --------------------
async function openLastSessionCert() {
  if (!lastCertifiedSessionCertPath) return toast("Pas de certificat session local.");
  // Use convertFileSrc for local path
  const url = convertFileSrc(lastCertifiedSessionCertPath);
  openViewerWithSrc("Certificat de session", url, lastCertifiedSessionCertPath);
}

// -------------------- OPEN MASTER (Simple) --------------------
async function openProjectMaster() {
  if (!lastMasterHtmlString) {
    await buildAndCacheMaster();
    if (!lastMasterHtmlString) return alert("Aucune session certifiée pour ce projet.");
  }
  openViewerWithHtml("Certificat final (projet)", lastMasterHtmlString);
}

// -------------------- DRAFT RECOVERY --------------------
async function checkForDrafts() {
  try {
    const drafts = await invoke("list_local_drafts");
    const banner = $("draft-banner");
    if (!banner) return;

    if (drafts && drafts.length > 0) {
      banner.style.display = "flex";
      $("btn-recover-draft").onclick = () => recoverDraft(drafts[0].session_id);
    } else {
      banner.style.display = "none";
    }
  } catch (e) {
    console.warn("checkForDrafts error", e);
  }
}

async function recoverDraft(sessionId) {
  if (!currentUser) return alert("Login requis");
  try {
    toast("Récupération…");
    const jsonStr = await invoke("load_local_draft", { sessionId });
    const proof = JSON.parse(jsonStr);

    currentSessionId = proof.session_id;

    // lastSnapshot minimal
    lastSnapshot = {
      session_id: proof.session_id,
      scp_score: proof.analysis?.score ?? 0,
      evidence_score: proof.analysis?.evidence_score ?? 0,
      diag: { version: "ho2.diag.v1", analysis: proof.analysis || {} },
      active_ms: (proof.analysis?.active_est_sec || 0) * 1000,
      events_count: proof.keystrokes?.length || 0,
    };

    // UI
    $("start-btn").classList.remove("hidden");
    $("stop-btn").classList.add("hidden");
    $("live-dashboard").style.display = "none";
    setFinalizeEnabled(true);

    $("draft-banner").style.display = "none";
    await invoke("delete_local_draft", { sessionId: proof.session_id });

    toast("Récupération OK. Certifiez la session.");
  } catch (e) {
    alert("Erreur récupération: " + (e?.message || e));
  }
}

// -------------------- BOOT --------------------
window.addEventListener("DOMContentLoaded", async () => {
  // Bind UI
  $("login-btn").onclick = handleLogin;
  $("logout-btn").onclick = handleLogout;

  $("refresh-projects-btn").onclick = loadProjectList;
  $("init-btn").onclick = initializeProject;

  $("start-btn").onclick = startScan;
  $("stop-btn").onclick = stopScan;
  $("finalize-btn").onclick = finalizeProject;
  $("sync-btn").onclick = refreshAll;

  $("open-last-session-cert-btn").onclick = openLastSessionCert;
  $("open-project-master-btn").onclick = openProjectMaster;

  $("export-project-master-btn").onclick = exportMasterHtml;
  $("verify-project-btn").onclick = verifyProjectIntegrity;

  $("viewer-close-btn").onclick = () => ($("viewer-modal").style.display = "none");
  $("viewer-modal").onclick = (e) => {
    if (e.target === $("viewer-modal")) $("viewer-modal").style.display = "none";
  };

  $("expert-toggle").onchange = async (e) => {
    setMode(e.target.checked);
    if (isExpert && currentProjectId) await refreshHistoryExpert();
  };

  // Start in simple mode
  setMode(false);
  resetLiveUI();
  setSimpleButtonsState();

  await checkSession();
});
