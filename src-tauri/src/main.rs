#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use chrono::Utc;
use device_query::{DeviceQuery, DeviceState, Keycode};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, State};
use uuid::Uuid;

// =============================================================
//  CONSTANTES
// =============================================================
const EXTRA_CARRE_DRAIN: bool = true;
const EXTRA_CARRE_DRAIN_MS: u64 = 40;

// =============================================================
//  STRUCTURES
// =============================================================
#[derive(Serialize)]
struct LiveStats {
    is_scanning: bool,
    duration_sec: u64,
    keystrokes: u64,
    clicks: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct SessionAnalysis {
    score: i32,
    verdict_label: String,
    verdict_color: String,
    inactivity_penalty: i32,
    burst_penalty: i32,
    density_penalty: i32,
    activity_histogram: Vec<u32>,
    evidence_score: i32,
    evidence_label: String,
    flags: Vec<String>,
    total_events: u32,

    keystrokes_count: u32,
    clicks_count: u32,

    wall_duration_sec: u64,
    active_est_sec: u64,
    effort_score: f64,
}

#[derive(Serialize)]
struct FinalizationResult {
    html_path: String,
    project_name: String,
    total_active_seconds: u64,
    total_keystrokes: u64,
    session_count: u32,
    scp_score: i32,
    evidence_score: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ProjectMetadata {
    project_name: String,
    created_at_utc: String,
    last_activity_utc: String,
    sessions_count: u32,
    total_active_seconds: u64,
    status: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct BiometricProof {
    session_id: String,
    timestamp_start: String,
    timestamp_end: String,
    project_name: String,
    session_index: u32,
    keyboard_dynamics: KeyboardStats,
    mouse_dynamics: MouseStats,
    analysis: SessionAnalysis,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct KeyboardStats {
    total_keystrokes: u64,
    backspace_count: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct MouseStats {
    total_clicks: u64,
}

struct RuntimeBuffers {
    keystroke_timestamps: Vec<i64>,
    backspace_timestamps: Vec<i64>,
    click_timestamps: Vec<i64>,
    start_timestamp: i64,
    start_rfc3339: String,
    active_gen: u64,
}

struct AppState {
    is_scanning: Arc<Mutex<bool>>,
    active_project_path: Arc<Mutex<Option<PathBuf>>>,
    runtime: Arc<Mutex<RuntimeBuffers>>,
    scan_gen: AtomicU64,
}

// =============================================================
//  MOTEUR HO-2
// =============================================================
fn calculate_scp(start_ms: i64, end_ms: i64, keystrokes: &Vec<i64>, clicks: &Vec<i64>) -> SessionAnalysis {
    let wall_duration_sec = std::cmp::max(1, (end_ms - start_ms) / 1000) as u64;
    let window_size = 30u64;
    let num_windows = (wall_duration_sec / window_size) + 1;

    let mut histogram = vec![0u32; num_windows as usize];
    let mut total_events: u32 = 0;
    let keystrokes_count = keystrokes.len() as u32;
    let clicks_count = clicks.len() as u32;

    for k in keystrokes {
        if *k >= start_ms && *k <= end_ms {
            let idx = (((k - start_ms) / 1000) as u64 / window_size) as usize;
            if idx < histogram.len() {
                histogram[idx] += 1;
                total_events += 1;
            }
        }
    }
    for c in clicks {
        if *c >= start_ms && *c <= end_ms {
            let idx = (((c - start_ms) / 1000) as u64 / window_size) as usize;
            if idx < histogram.len() {
                histogram[idx] += 1;
                total_events += 1;
            }
        }
    }

    let active_windows = histogram.iter().filter(|&&x| x > 0).count() as u32;
    let active_est_sec = std::cmp::min(wall_duration_sec, (active_windows as u64) * 30);

    let mut score = 100;
    let inactivity_ratio = if num_windows > 0 {
        1.0 - (active_windows as f64 / num_windows as f64)
    } else {
        0.0
    };

    let mut pen_inactivity = 0;
    if inactivity_ratio > 0.4 { pen_inactivity = 15; }
    if inactivity_ratio > 0.7 { pen_inactivity = 30; }

    let mut pen_burst = 0;
    if num_windows >= 6 && total_events > 50 {
        let mut sorted_hist = histogram.clone();
        sorted_hist.sort_by(|a, b| b.cmp(a));
        let top_10_percent_count = (num_windows as f64 * 0.1).ceil() as usize;
        let events_in_top: u32 = sorted_hist.iter().take(top_10_percent_count).sum();
        let burst_ratio = events_in_top as f64 / total_events as f64;
        if burst_ratio > 0.6 { pen_burst = 20; }
        if burst_ratio > 0.85 { pen_burst = 40; }
    }

    let max_events = *histogram.iter().max().unwrap_or(&0);
    let mut pen_density = 0;
    if max_events > 300 { pen_density = 25; }

    score = score - pen_inactivity - pen_burst - pen_density;
    if score < 0 { score = 0; }

    let (mut verdict_label, mut verdict_color) = if score >= 80 {
        ("COHÉRENT".to_string(), "#10b981".to_string())
    } else if score >= 50 {
        ("IRRÉGULIER".to_string(), "#f59e0b".to_string())
    } else {
        ("ATYPIQUE".to_string(), "#ef4444".to_string())
    };

    let mut evidence_score = 100;
    let mut flags: Vec<String> = vec![];

    if total_events < 30 {
        flags.push("LOW_EVENTS".into());
        evidence_score -= 60;
    }
    if wall_duration_sec < 45 {
        flags.push("SHORT_SESSION".into());
        evidence_score -= 40;
    }
    if active_windows < 2 {
        flags.push("LOW_ACTIVE_WINDOWS".into());
        evidence_score -= 40;
    }
    if evidence_score < 0 { evidence_score = 0; }

    let evidence_label = if evidence_score >= 70 { "FORT" }
    else if evidence_score >= 40 { "MOYEN" }
    else if evidence_score >= 15 { "FAIBLE" }
    else { "NON_CONCLUANT" };

    if evidence_label == "NON_CONCLUANT" {
        verdict_label = "NON CONCLUANT".into();
        verdict_color = "#6b7280".into();
    }

    let active_minutes = (active_est_sec as f64) / 60.0;
    let total_actions = total_events as f64;
    let effort_score = if active_minutes > 0.0 { total_actions / active_minutes } else { 0.0 };

    SessionAnalysis {
        score, verdict_label, verdict_color,
        inactivity_penalty: pen_inactivity, burst_penalty: pen_burst, density_penalty: pen_density,
        activity_histogram: histogram, evidence_score, evidence_label: evidence_label.to_string(), flags,
        total_events, keystrokes_count, clicks_count,
        wall_duration_sec, active_est_sec, effort_score,
    }
}

// =============================================================
//  HTML CERTIFICATE
// =============================================================
fn generate_html_certificate(metadata: &ProjectMetadata, proofs: &Vec<BiometricProof>) -> String {
    let mut total_k = 0u64;
    let mut total_clicks = 0u64;
    let mut weighted_scp = 0i32;
    let mut weighted_evidence = 0i32;
    let mut session_rows = String::new();

    for p in proofs {
        total_k += p.keyboard_dynamics.total_keystrokes;
        total_clicks += p.mouse_dynamics.total_clicks;
        weighted_scp += p.analysis.score;
        weighted_evidence += p.analysis.evidence_score;

        let mut bars_html = String::new();
        let max_val = *p.analysis.activity_histogram.iter().max().unwrap_or(&1);
        for val in &p.analysis.activity_histogram {
            let height = if max_val > 0 { (*val as f64 / max_val as f64) * 100.0 } else { 0.0 };
            let color = if *val > 300 { "#ef4444" } else { "#ddd" };
            bars_html.push_str(&format!(
                "<div class='bar' style='height:{}%; background:{}'></div>",
                height, color
            ));
        }

        let flags_html = if !p.analysis.flags.is_empty() {
            format!(
                "<br><span style='font-size:9px; color:#ef4444'>⚠️ {}</span>",
                p.analysis.flags.join(", ")
            )
        } else {
            "".to_string()
        };

        session_rows.push_str(&format!(
            "<tr><td><strong>#{}</strong></td><td><div class='mini-graph'>{}</div></td><td>{} frappes • {} clics<br><span style='font-size:10px; color:#666'>{} acts/min</span></td><td><span class='badge' style='background:{}'>{}</span><div style='font-size:10px; margin-top:4px; color:#666'>SCP: {} | Preuve: <strong>{}</strong>{}</div></td></tr>",
            p.session_index,
            bars_html,
            p.keyboard_dynamics.total_keystrokes,
            p.mouse_dynamics.total_clicks,
            p.analysis.effort_score.round(),
            p.analysis.verdict_color,
            p.analysis.verdict_label,
            p.analysis.score,
            p.analysis.evidence_label,
            flags_html
        ));
    }

    let avg_scp = if !proofs.is_empty() { weighted_scp / proofs.len() as i32 } else { 0 };
    let avg_evidence = if !proofs.is_empty() { weighted_evidence / proofs.len() as i32 } else { 0 };

    let global_color = if avg_evidence < 30 {
        "#6b7280"
    } else if avg_scp >= 80 {
        "#10b981"
    } else if avg_scp >= 50 {
        "#f59e0b"
    } else {
        "#ef4444"
    };

    let active_display = if metadata.total_active_seconds < 60 {
        format!("{} sec", metadata.total_active_seconds)
    } else {
        format!("{} min", (metadata.total_active_seconds as f64 / 60.0).ceil())
    };

    let ref_short = &Uuid::new_v4().to_string()[..6];

    format!(
        r#"<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Certificat HumanOrigin</title><style>body {{ background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:40px; color:#111; }} .paper {{ max-width:850px; margin:0 auto; background:white; padding:60px; box-shadow:0 10px 30px rgba(0,0,0,0.05); border-top:8px solid #000; }} .header {{ display:flex; justify-content:space-between; border-bottom:2px solid #eee; padding-bottom:30px; margin-bottom:40px; }} .brand h1 {{ font-size:14px; letter-spacing:-1px; margin:0; color:#666; text-transform:uppercase; }} .brand h2 {{ font-size:32px; font-weight:800; margin:5px 0 0 0; letter-spacing:-1px; }} .meta {{ text-align:right; font-size:12px; color:#888; font-family:monospace; }} .score-card {{ background:#fafafa; border:1px solid #eee; padding:30px; display:flex; align-items:center; justify-content:space-between; border-radius:8px; margin-bottom:40px; }} .score-circle {{ width:100px; height:100px; border-radius:50%; border:8px solid {0}; display:flex; align-items:center; justify-content:center; font-size:32px; font-weight:800; color:{1}; }} .score-details {{ flex:1; margin-left:30px; }} .grid {{ display:grid; grid-template-columns:repeat(3,1fr); gap:20px; margin-bottom:50px; }} .stat {{ border-left:3px solid #000; padding-left:15px; }} .stat .val {{ font-size:24px; font-weight:700; display:block; }} .stat .lbl {{ font-size:12px; text-transform:uppercase; color:#666; }} table {{ width:100%; border-collapse:collapse; margin-top:20px; font-size:14px; }} th {{ text-align:left; color:#999; font-size:11px; text-transform:uppercase; padding-bottom:15px; border-bottom:1px solid #ddd; }} td {{ padding:15px 0; border-bottom:1px solid #f5f5f5; vertical-align:middle; }} .badge {{ padding:6px 12px; border-radius:20px; color:white; font-weight:600; font-size:12px; }} .mini-graph {{ display:flex; align-items:flex-end; height:30px; width:150px; gap:2px; }} .bar {{ width:100%; min-height:2px; }} .footer {{ margin-top:80px; padding-top:20px; border-top:1px solid #eee; font-size:11px; color:#999; font-family:monospace; display:flex; justify-content:space-between; }}</style></head><body><div class="paper"><div class="header"><div class="brand"><h1>HUMAN ORIGIN // CORE</h1><h2>Audit de Cohérence</h2></div><div class="meta">REF: #{2}<br>DATE: {3}</div></div><div class="score-card"><div class="score-circle">{4}</div><div class="score-details"><h3>Score de Cohérence (SCP)</h3><p>Indice de continuité physique (HO-2).</p><p style="font-size:12px; color:#666; margin-top:5px;">Qualité de la preuve : <strong>{5} / 100</strong></p></div></div><div class="grid"><div class="stat"><span class="val">{6}</span><span class="lbl">Temps Actif (Est.)</span></div><div class="stat"><span class="val">{7}</span><span class="lbl">Frappes Totales</span><div style="font-size:11px; color:#666;">{8} clics</div></div><div class="stat"><span class="val">{9}</span><span class="lbl">Sessions</span></div></div><h3>Signature Temporelle</h3><table><thead><tr><th width="10%">ID</th><th width="40%">Histogramme (30s)</th><th width="20%">Volume</th><th width="30%">Analyse (Gate & SCP)</th></tr></thead><tbody>{10}</tbody></table><div class="footer"><span>Généré par HumanOrigin v1.0 (Forensic Engine)</span><span>CRYPTOGRAPHIC PROOF: SHA-256 (Simulated)</span></div></div></body></html>"#,
        global_color,
        global_color,
        ref_short,
        Utc::now().format("%d-%m-%Y"),
        avg_scp,
        avg_evidence,
        active_display,
        total_k,
        total_clicks,
        metadata.sessions_count,
        session_rows
    )
}

// =============================================================
//  COMMANDES TAURI
// =============================================================
#[tauri::command]
fn get_live_stats(state: State<AppState>) -> Result<LiveStats, String> {
    let is_scanning = *state.is_scanning.lock().unwrap();
    let rt = state.runtime.lock().unwrap();

    if !is_scanning || rt.start_timestamp == 0 {
        return Ok(LiveStats { is_scanning: false, duration_sec: 0, keystrokes: 0, clicks: 0 });
    }
    let now_ms = Utc::now().timestamp_millis();
    let duration_sec = ((now_ms - rt.start_timestamp).max(0) as u64) / 1000;
    Ok(LiveStats {
        is_scanning: true,
        duration_sec,
        keystrokes: rt.keystroke_timestamps.len() as u64,
        clicks: rt.click_timestamps.len() as u64,
    })
}

#[tauri::command]
fn get_projects() -> Result<Vec<String>, String> {
    let doc_path = dirs::document_dir().ok_or("Err Documents")?;
    let path = doc_path.join("HumanOrigin").join("Projets");
    let mut projects = Vec::new();
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Some(name) = entry.path().file_name().and_then(|n| n.to_str()) {
                if !name.starts_with('.') { projects.push(name.to_string()); }
            }
        }
    }
    Ok(projects)
}

#[tauri::command]
fn initialize_project(project_name: String) -> Result<String, String> {
    let doc_path = dirs::document_dir().ok_or("Err Documents")?;
    let project_path = doc_path.join("HumanOrigin").join("Projets").join(&project_name);
    fs::create_dir_all(project_path.join("certificats")).map_err(|e| e.to_string())?;

    let metadata = ProjectMetadata {
        project_name: project_name.clone(),
        created_at_utc: Utc::now().to_rfc3339(),
        last_activity_utc: Utc::now().to_rfc3339(),
        sessions_count: 0,
        total_active_seconds: 0,
        status: "ACTIVE".to_string(),
    };

    fs::write(
        project_path.join("project.json"),
        serde_json::to_string_pretty(&metadata).unwrap()
    ).map_err(|e| e.to_string())?;

    Ok(project_path.to_string_lossy().to_string())
}

#[tauri::command]
fn activate_project(project_name: String, state: State<AppState>) -> Result<String, String> {
    let doc_path = dirs::document_dir().ok_or("Err Documents")?;
    let project_path = doc_path.join("HumanOrigin").join("Projets").join(&project_name);
    if !project_path.exists() {
        return Err(format!("Le projet '{}' n'existe pas.", project_name));
    }
    let mut active = state.active_project_path.lock().unwrap();
    *active = Some(project_path.clone());
    Ok(project_path.to_string_lossy().to_string())
}

#[tauri::command]
fn start_scan(state: State<AppState>) -> Result<String, String> {
    let mut scanning = state.is_scanning.lock().unwrap();
    if *scanning { return Err("Déjà en cours".into()); }

    let gen = state.scan_gen.fetch_add(1, Ordering::SeqCst) + 1;
    *scanning = true;

    let mut rt = state.runtime.lock().unwrap();
    rt.keystroke_timestamps.clear();
    rt.backspace_timestamps.clear();
    rt.click_timestamps.clear();
    rt.start_timestamp = Utc::now().timestamp_millis();
    rt.start_rfc3339 = Utc::now().to_rfc3339();
    rt.active_gen = gen;

    Ok("Scan Démarré".into())
}

#[tauri::command]
fn stop_scan(state: State<AppState>) -> Result<serde_json::Value, String> {
    state.scan_gen.fetch_add(1, Ordering::SeqCst);

    {
        let mut scanning = state.is_scanning.lock().unwrap();
        if !*scanning { return Err("Pas de session".into()); }
        *scanning = false;
    }

    if EXTRA_CARRE_DRAIN {
        thread::sleep(Duration::from_millis(EXTRA_CARRE_DRAIN_MS));
    }

    let path_buf = state.active_project_path.lock().unwrap().clone().ok_or("Pas de projet actif")?;

    let (start_ms, start_rfc3339, keys, backs, clicks) = {
        let rt = state.runtime.lock().unwrap();
        (
            rt.start_timestamp,
            rt.start_rfc3339.clone(),
            rt.keystroke_timestamps.clone(),
            rt.backspace_timestamps.clone(),
            rt.click_timestamps.clone()
        )
    };

    let end_ms = Utc::now().timestamp_millis();
    let analysis = calculate_scp(start_ms, end_ms, &keys, &clicks);

    // ----- Update Local Metadata
    let json_path = path_buf.join("project.json");
    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let mut metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    metadata.sessions_count += 1;
    metadata.total_active_seconds += analysis.active_est_sec;
    metadata.last_activity_utc = Utc::now().to_rfc3339();

    let proof = BiometricProof {
        session_id: Uuid::new_v4().to_string(),
        timestamp_start: start_rfc3339,
        timestamp_end: Utc::now().to_rfc3339(),
        project_name: metadata.project_name.clone(),
        session_index: metadata.sessions_count,
        keyboard_dynamics: KeyboardStats {
            total_keystrokes: keys.len() as u64,
            backspace_count: backs.len() as u64,
        },
        mouse_dynamics: MouseStats { total_clicks: clicks.len() as u64 },
        analysis: analysis.clone(),
    };

    fs::write(
        path_buf.join("certificats").join(format!("session_{}.json", metadata.sessions_count)),
        serde_json::to_string_pretty(&proof).unwrap()
    ).map_err(|e| e.to_string())?;

    fs::write(
        json_path,
        serde_json::to_string_pretty(&metadata).unwrap()
    ).map_err(|e| e.to_string())?;

    // ----- Snapshot Cloud V2
    let active_ms: u64 = analysis.active_est_sec.saturating_mul(1000);
    let total_duration_ms: u64 = (end_ms - start_ms).max(0) as u64;
    let idle_ms: u64 = total_duration_ms.saturating_sub(active_ms);

    let diag_analysis = serde_json::to_value(&analysis).map_err(|e| e.to_string())?;
    let diag_json = serde_json::json!({
        "version": "ho2.diag.v1",
        "analysis": diag_analysis
    });

    Ok(serde_json::json!({
        "active_ms": active_ms,
        "idle_ms": idle_ms,
        "events_count": analysis.total_events as i64,
        "scp_score": analysis.score,
        "evidence_score": analysis.evidence_score,
        "diag": diag_json
    }))
}

#[tauri::command]
fn finalize_project(project_path: String) -> Result<FinalizationResult, String> {
    let path = PathBuf::from(project_path);
    let content = fs::read_to_string(path.join("project.json")).map_err(|e| e.to_string())?;
    let metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mut all_proofs: Vec<BiometricProof> = Vec::new();
    let mut total_keys = 0u64;
    let mut avg_scp = 0i32;
    let mut avg_evidence = 0i32;

    if let Ok(entries) = fs::read_dir(path.join("certificats")) {
        for entry in entries.flatten() {
            if entry.path().extension().map(|s| s == "json").unwrap_or(false) {
                if let Ok(c) = fs::read_to_string(entry.path()) {
                    if let Ok(proof) = serde_json::from_str::<BiometricProof>(&c) {
                        total_keys += proof.keyboard_dynamics.total_keystrokes;
                        avg_scp += proof.analysis.score;
                        avg_evidence += proof.analysis.evidence_score;
                        all_proofs.push(proof);
                    }
                }
            }
        }
    }

    all_proofs.sort_by_key(|k| k.session_index);

    if !all_proofs.is_empty() {
        avg_scp /= all_proofs.len() as i32;
        avg_evidence /= all_proofs.len() as i32;
    }

    let html = generate_html_certificate(&metadata, &all_proofs);
    let html_path = path.join("CERTIFICAT_FINAL.html");
    fs::write(&html_path, html).map_err(|e| e.to_string())?;

    Ok(FinalizationResult {
        html_path: html_path.to_string_lossy().to_string(),
        project_name: metadata.project_name,
        total_active_seconds: metadata.total_active_seconds,
        total_keystrokes: total_keys,
        session_count: metadata.sessions_count,
        scp_score: avg_scp,
        evidence_score: avg_evidence,
    })
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// =============================================================
//  MAIN (CORRECTION ICI : PLUS DE CRASH DEEP LINK)
// =============================================================
fn main() {
    let is_scanning = Arc::new(Mutex::new(false));
    let active_project_path = Arc::new(Mutex::new(None));
    let runtime = Arc::new(Mutex::new(RuntimeBuffers {
        keystroke_timestamps: Vec::new(),
        backspace_timestamps: Vec::new(),
        click_timestamps: Vec::new(),
        start_timestamp: 0,
        start_rfc3339: String::new(),
        active_gen: 0,
    }));

    let is_scanning_clone = is_scanning.clone();
    let runtime_clone = runtime.clone();

    // On ignore le résultat de prepare ici pour ne pas bloquer
    let _ = tauri_plugin_deep_link::prepare("com.humanorigin.app");

    thread::spawn(move || {
        let device_state = DeviceState::new();
        let mut prev_keys: Vec<Keycode> = vec![];
        let mut prev_mouse: Vec<bool> = vec![];

        loop {
            thread::sleep(Duration::from_millis(20));

            { let scanning = is_scanning_clone.lock().unwrap(); if !*scanning { continue; } }

            let keys = device_state.get_keys();
            let mouse = device_state.get_mouse();
            let now = Utc::now().timestamp_millis();

            if keys != prev_keys && keys.len() > prev_keys.len() {
                let mut rt = runtime_clone.lock().unwrap();
                if rt.active_gen != 0 {
                    rt.keystroke_timestamps.push(now);
                    if keys.contains(&Keycode::Backspace) && !prev_keys.contains(&Keycode::Backspace) {
                        rt.backspace_timestamps.push(now);
                    }
                }
            }
            prev_keys = keys;

            let current_buttons = mouse.button_pressed;
            if current_buttons.iter().filter(|&&b| b).count()
                > prev_mouse.iter().filter(|&&b| b).count()
            {
                let mut rt = runtime_clone.lock().unwrap();
                if rt.active_gen != 0 {
                    rt.click_timestamps.push(now);
                }
            }
            prev_mouse = current_buttons;
        }
    });

    tauri::Builder::default()
        .manage(AppState {
            is_scanning,
            active_project_path,
            runtime,
            scan_gen: AtomicU64::new(0),
        })
        .setup(|app| {
            let handle = app.handle();
            // ✅ CORRECTION MAJEURE : On enlève le .unwrap() ici.
            // Si le deep link échoue (fréquent en dev), on log juste l'erreur au lieu de crasher.
            let _ = tauri_plugin_deep_link::register("humanorigin", move |request| {
                println!("Deep Link Request: {:?}", request);
                let _ = handle.emit_all("scheme-request", request);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_projects,
            initialize_project,
            activate_project,
            start_scan,
            stop_scan,
            finalize_project,
            open_file,
            get_live_stats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}