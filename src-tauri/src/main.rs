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

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::OsRng;

mod drafts;

const EXTRA_CARRE_DRAIN: bool = true;
const EXTRA_CARRE_DRAIN_MS: u64 = 40;

const KEY_DIR_NAME: &str = "HumanOrigin";
const KEY_FILE_NAME: &str = "ho_ed25519.key";

// --- CONFIG "FORMULE 1" V12 (STRICT) ---
const GATE_MIN_EVENTS: u32 = 80;
const GATE_MIN_KEYSTROKES: u32 = 60;
const GATE_MIN_ACTIVE_SEC: u64 = 60;
const GATE_MIN_WALL_SEC: u64 = 60;
const GATE_MIN_DENSITY: f64 = 0.6;

#[derive(Serialize)]
struct LiveStats {
    is_scanning: bool,
    duration_sec: u64,
    keystrokes: u64,
    clicks: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct PasteStats {
    paste_events: u32,
    pasted_chars: u32,
    max_paste_chars: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct SessionAnalysis {
    score: i32,
    verdict_label: String,
    verdict_color: String,
    gate_passed: bool,
    gate_reason: Option<String>,
    active_est_sec: u64,
    wall_duration_sec: u64,
    total_events: u32,
    activity_histogram: Vec<u32>,
    evidence_score: i32,
    effort_score: f64,
    evidence_label: String,
    flags: Vec<String>,
    keystrokes_count: u32,
    clicks_count: u32,
    inactivity_penalty: i32,
    burst_penalty: i32,
    density_penalty: i32,
    backspace_count: u32,
    session_tier: String,
}

#[derive(Serialize)]
struct FinalizationResult {
    html_path: String,
    project_name: String,
    total_active_seconds: u64,
    total_keystrokes: u64,
    session_count: u32,
    scp_score: i32,
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
    paste_stats: PasteStats,
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
    current_session_id: Option<String>,
}

struct AppState {
    is_scanning: Arc<Mutex<bool>>,
    active_project_path: Arc<Mutex<Option<PathBuf>>>,
    runtime: Arc<Mutex<RuntimeBuffers>>,
    scan_gen: AtomicU64,
}

// --- UTILS ---
fn key_storage_path() -> Result<PathBuf, String> {
    let doc_path = dirs::document_dir().ok_or("Err Documents")?;
    let base = doc_path.join(KEY_DIR_NAME);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base.join(KEY_FILE_NAME))
}

fn ensure_signing_key() -> Result<SigningKey, String> {
    let p = key_storage_path()?;
    if p.exists() {
        let b64 = fs::read_to_string(&p).map_err(|e| e.to_string())?;
        let raw = general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| e.to_string())?;
        if raw.len() != 32 {
            return Err("Key invalid".into());
        }
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&raw);
        return Ok(SigningKey::from_bytes(&seed));
    }
    let sk = SigningKey::generate(&mut OsRng);
    let seed = sk.to_bytes();
    let b64 = general_purpose::STANDARD.encode(seed);
    fs::write(&p, b64).map_err(|e| e.to_string())?;
    Ok(sk)
}

fn hex_to_bytes32(hex: &str) -> Result<[u8; 32], String> {
    let s = hex.trim();
    if s.len() != 64 {
        return Err("hash invalid len".into());
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        let byte_str = &s[i * 2..i * 2 + 2];
        out[i] = u8::from_str_radix(byte_str, 16).map_err(|_| "hex err".to_string())?;
    }
    Ok(out)
}

fn format_duration_smart(seconds: u64) -> String {
    if seconds < 60 {
        format!("{}s", seconds)
    } else {
        let mins = seconds / 60;
        let hours = mins / 60;
        if hours > 0 {
            format!("{}h {}m", hours, mins % 60)
        } else {
            format!("{} min", mins)
        }
    }
}

fn apply_verdict(score: i32) -> (String, String) {
    if score >= 80 {
        ("COHÉRENT".to_string(), "#10b981".to_string())
    } else if score >= 50 {
        ("ATYPIQUE".to_string(), "#f59e0b".to_string())
    } else {
        ("SUSPECT".to_string(), "#ef4444".to_string())
    }
}

// --- MOTEUR ANALYSE ---
fn calculate_scp(
    start_ms: i64,
    end_ms: i64,
    keystrokes: &Vec<i64>,
    clicks: &Vec<i64>,
    backspace_count: u32,
) -> SessionAnalysis {
    let wall_duration_sec = std::cmp::max(1, (end_ms - start_ms) / 1000) as u64;

    let window_size = 5u64;
    let num_windows = (wall_duration_sec / window_size) + 1;

    let mut histogram = vec![0u32; num_windows as usize];
    let mut histogram_keys = vec![0u32; num_windows as usize];
    let mut total_events: u32 = 0;

    for k in keystrokes {
        if *k >= start_ms && *k <= end_ms {
            let idx = (((k - start_ms) / 1000) as u64 / window_size) as usize;
            if idx < histogram.len() {
                histogram[idx] += 1;
                histogram_keys[idx] += 1;
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

    let active_windows_keys = histogram_keys.iter().filter(|&&x| x > 0).count() as u32;
    let active_est_sec =
        std::cmp::min(wall_duration_sec, (active_windows_keys as u64) * window_size);

    let weighted_events = (keystrokes.len() as f64) + (clicks.len() as f64 * 0.2);
    let k_count = keystrokes.len() as u32;
    let session_tier = if k_count < 120 {
        "MINI"
    } else if k_count < 300 {
        "NORMALE"
    } else {
        "FORTE"
    }
    .to_string();

    // --- GATE ---
    let mut gate_passed = true;
    let mut gate_reasons = Vec::new();

    if weighted_events < GATE_MIN_EVENTS as f64 {
        gate_passed = false;
        gate_reasons.push(format!(
            "Volume insuffisant ({:.0} < {})",
            weighted_events, GATE_MIN_EVENTS
        ));
    }
    if k_count < GATE_MIN_KEYSTROKES {
        gate_passed = false;
        gate_reasons.push(format!(
            "Frappes insuffisantes ({} < {})",
            k_count, GATE_MIN_KEYSTROKES
        ));
    }
    if active_est_sec < GATE_MIN_ACTIVE_SEC {
        gate_passed = false;
        gate_reasons.push(format!(
            "Rédaction insuffisante ({}s < {}s)",
            active_est_sec, GATE_MIN_ACTIVE_SEC
        ));
    }
    if wall_duration_sec < GATE_MIN_WALL_SEC {
        gate_passed = false;
        gate_reasons.push(format!(
            "Trop court ({}s < {}s)",
            wall_duration_sec, GATE_MIN_WALL_SEC
        ));
    }

    let density_active = if active_est_sec > 0 {
        weighted_events / active_est_sec as f64
    } else {
        0.0
    };
    let density_wall = weighted_events / wall_duration_sec as f64;
    let density = if density_active < density_wall {
        density_active
    } else {
        density_wall
    };

    if density < GATE_MIN_DENSITY {
        gate_passed = false;
        gate_reasons.push(format!("Densité pondérée faible ({:.2})", density));
    }

    let effort_score = if active_est_sec > 0 {
        weighted_events / (active_est_sec as f64 / 60.0)
    } else {
        0.0
    };

    if !gate_passed {
        return SessionAnalysis {
            score: 0,
            verdict_label: "INSUFFISANT".to_string(),
            verdict_color: "#9ca3af".to_string(),
            gate_passed: false,
            gate_reason: Some(gate_reasons.join(", ")),
            active_est_sec,
            wall_duration_sec,
            total_events,
            activity_histogram: histogram,
            evidence_score: 0,
            effort_score,
            evidence_label: "N/A".to_string(),
            flags: vec![],
            keystrokes_count: k_count,
            clicks_count: clicks.len() as u32,
            inactivity_penalty: 0,
            burst_penalty: 0,
            density_penalty: 0,
            backspace_count,
            session_tier,
        };
    }

    // --- SCORE ---
    let mut score = 100;
    let mut flags: Vec<String> = vec![];

    let active_windows_any = histogram.iter().filter(|&&x| x > 0).count() as u32;
    let total_windows_any = std::cmp::max(1, active_windows_any) as f64;
    let active_ratio = (active_windows_keys as f64) / total_windows_any;

    if active_ratio < 0.3 {
        score -= 20;
        flags.push("LOW_CONTINUITY".to_string());
    }
    if active_ratio < 0.15 && (active_windows_any as f64) > 10.0 {
        score -= 40;
        flags.push("BURSTY_PATTERN".to_string());
    }

    if k_count > 200 && backspace_count == 0 {
        score -= 50;
        flags.push("NO_CORRECTION".to_string());
    } else if k_count > 100 && backspace_count > 5 {
        score = std::cmp::min(100, score + 5);
    }

    if session_tier == "MINI" {
        score = std::cmp::min(score, 59);
        flags.push("MINI_SESSION".to_string());
    } else if k_count < 300 {
        score = std::cmp::min(score, 74);
    }

    if flags.len() > 3 {
        flags.truncate(3);
    }
    score = score.clamp(0, 100);

    let (verdict_label, verdict_color) = apply_verdict(score);

    SessionAnalysis {
        score,
        verdict_label,
        verdict_color,
        gate_passed: true,
        gate_reason: None,
        active_est_sec,
        wall_duration_sec,
        total_events,
        activity_histogram: histogram,
        evidence_score: 100,
        effort_score,
        evidence_label: "FORT".to_string(),
        flags,
        keystrokes_count: k_count,
        clicks_count: clicks.len() as u32,
        inactivity_penalty: 0,
        burst_penalty: 0,
        density_penalty: 0,
        backspace_count,
        session_tier,
    }
}

// --- HTML SESSION (archive) ---
fn generate_session_html(proof: &BiometricProof) -> String {
    let max_val = *proof.analysis.activity_histogram.iter().max().unwrap_or(&1);
    let mut bars_html = String::new();
    let hist_len = proof.analysis.activity_histogram.len();
    let step = std::cmp::max(1, hist_len / 40);

    for (i, val) in proof.analysis.activity_histogram.iter().enumerate() {
        if i % step == 0 {
            let height = if max_val > 0 {
                (*val as f64 / max_val as f64) * 100.0
            } else {
                0.0
            };
            let color = if *val > 15 { "#ef4444" } else { "#ddd" };
            bars_html.push_str(&format!(
                "<div class='bar' style='height:{}%; background:{}'></div>",
                height, color
            ));
        }
    }

    let mut flags_line = if !proof.analysis.flags.is_empty() {
        format!(
            "<div class='flags'>Flags: {}</div>",
            proof.analysis.flags.join(" • ")
        )
    } else {
        "".to_string()
    };

    if proof.paste_stats.paste_events > 0 {
        flags_line.push_str(&format!(
            "<div class='flags'>Paste: {}× • {}ch</div>",
            proof.paste_stats.paste_events, proof.paste_stats.pasted_chars
        ));
    }

    let warn = proof.analysis.gate_reason.as_deref().unwrap_or("");
    let verdict_display = if proof.analysis.gate_passed {
        if warn.is_empty() {
            format!(
                "<h1 style='color:{}'>{}</h1>",
                proof.analysis.verdict_color, proof.analysis.verdict_label
            )
        } else {
            format!(
                "<h1 style='color:{}'>{}</h1><p class='warn'>⚠️ {}</p>",
                proof.analysis.verdict_color, proof.analysis.verdict_label, warn
            )
        }
    } else {
        format!(
            "<h1 style='color:#9ca3af'>INSUFFISANT</h1><p>{}</p>",
            warn
        )
    };

    format!(
        r#"<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Session</title>
<style>
body {{ background:#fff; font-family:-apple-system, sans-serif; padding:20px; color:#111; }}
.card {{ border:1px solid #eee; border-radius:16px; padding:28px; max-width:520px; margin:0 auto; box-shadow:0 10px 30px rgba(0,0,0,0.06); }}
h1 {{ margin:0; font-size:28px; }}
.warn {{ color:#d97706; font-weight:700; }}
.graph {{ display:flex; align-items:flex-end; height:64px; justify-content:center; gap:2px; margin:18px 0; }}
.bar {{ width:6px; border-radius:2px; }}
.big {{ font-size:46px; font-weight:900; }}
.flags {{ font-size:12px; color:#666; margin-top:6px; background:#f3f4f6; padding:8px 10px; border-radius:10px; }}
.grid {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:18px; }}
.lab {{ font-size:12px; color:#777; }}
.val {{ font-size:16px; font-weight:800; }}
</style></head><body>
<div class="card">
  <div style="font-size:12px; text-transform:uppercase; color:#777; margin-bottom:10px;">
    Session #{0} • {1}
  </div>
  {2}
  <div class="graph">{3}</div>
  <div class="big" style="color:{4}">{5} <span style="font-size:16px; color:#999;">/100</span></div>
  {6}
  <div class="grid">
    <div><div class="lab">Durée active</div><div class="val">{7}</div></div>
    <div><div class="lab">Frappes</div><div class="val">{8}</div></div>
    <div><div class="lab">Corrections</div><div class="val">{9}</div></div>
    <div><div class="lab">Tier</div><div class="val">{10}</div></div>
  </div>
</div>
</body></html>"#,
        proof.session_index,
        proof.analysis.session_tier,
        verdict_display,
        bars_html,
        proof.analysis.verdict_color,
        proof.analysis.score,
        flags_line,
        format_duration_smart(proof.analysis.active_est_sec),
        proof.keyboard_dynamics.total_keystrokes,
        proof.keyboard_dynamics.backspace_count,
        proof.analysis.session_tier
    )
}

// --- HTML FINAL PROJET (celui affiché dans l’overlay) ---
fn generate_html_certificate(metadata: &ProjectMetadata, proofs: &Vec<BiometricProof>) -> String {
    let mut total_k = 0u64;
    let mut weighted_score_sum = 0f64;
    let mut total_weight = 0f64;
    let mut session_rows = String::new();
    let mut certified_count = 0;
    let mut max_valid_keystrokes: u64 = 0;

    for p in proofs {
        total_k += p.keyboard_dynamics.total_keystrokes;

        if p.analysis.gate_passed {
            certified_count += 1;
            let weight = p.analysis.active_est_sec as f64;
            weighted_score_sum += (p.analysis.score as f64) * weight;
            total_weight += weight;
            if p.keyboard_dynamics.total_keystrokes > max_valid_keystrokes {
                max_valid_keystrokes = p.keyboard_dynamics.total_keystrokes;
            }
        }

        let max_val = *p.analysis.activity_histogram.iter().max().unwrap_or(&1);
        let mut bars_html = String::new();
        let hist_len = p.analysis.activity_histogram.len();
        let step = std::cmp::max(1, hist_len / 30);

        for (i, val) in p.analysis.activity_histogram.iter().enumerate() {
            if i % step == 0 {
                let height = if max_val > 0 {
                    (*val as f64 / max_val as f64) * 100.0
                } else {
                    0.0
                };
                let color = if *val > 15 { "#ef4444" } else { "#ddd" };
                bars_html.push_str(&format!(
                    "<div class='bar' style='height:{}%; background:{}'></div>",
                    height, color
                ));
            }
        }

        let verdict_display = if p.analysis.gate_passed {
            let mut flags_line = if !p.analysis.flags.is_empty() {
                format!(
                    "<div class='mini-flags'>Flags: {}</div>",
                    p.analysis.flags.join(" • ")
                )
            } else {
                "".to_string()
            };

            if p.paste_stats.paste_events > 0 {
                flags_line.push_str(&format!(
                    "<div class='mini-flags'>Paste: {}× • {}ch</div>",
                    p.paste_stats.paste_events, p.paste_stats.pasted_chars
                ));
            }

            let warn = p.analysis.gate_reason.as_deref().unwrap_or("");
            if warn.is_empty() {
                format!(
                    "<span class='badge' style='background:{}'>{}</span>{}",
                    p.analysis.verdict_color, p.analysis.verdict_label, flags_line
                )
            } else {
                format!(
                    "<span class='badge' style='background:{}'>{}</span><div class='warn-mini'>⚠️ {}</div>{}",
                    p.analysis.verdict_color, p.analysis.verdict_label, warn, flags_line
                )
            }
        } else {
            format!(
                "<span class='badge' style='background:#9ca3af'>INSUFFISANT</span><div class='mini-flags'>{}</div>",
                p.analysis.gate_reason.as_deref().unwrap_or("?")
            )
        };

        session_rows.push_str(&format!(
            "<tr>
              <td><strong>#{}</strong><br><span class='muted'>{}</span></td>
              <td><div class='mini-graph'>{}</div></td>
              <td><div style='font-weight:800'>{}</div><div class='muted'>{} frappes</div></td>
              <td>{}</td>
            </tr>",
            p.session_index,
            p.analysis.session_tier,
            bars_html,
            format_duration_smart(p.analysis.active_est_sec),
            p.keyboard_dynamics.total_keystrokes,
            verdict_display
        ));
    }

    let avg_scp = if total_weight > 0.0 {
        (weighted_score_sum / total_weight) as i32
    } else {
        0
    };

    let project_is_valid = certified_count >= 2 || (certified_count == 1 && max_valid_keystrokes > 300);
    let (main_title, score_color, validation_msg) = if project_is_valid {
        let col = if avg_scp >= 80 {
            "#10b981"
        } else if avg_scp >= 50 {
            "#f59e0b"
        } else {
            "#ef4444"
        };
        (
            "Certificat de Projet",
            col,
            format!(
                "Indice de continuité physique.<br>Basé sur <strong>{}</strong> sessions validées.",
                certified_count
            ),
        )
    } else {
        (
            "ÉBAUCHE (NON CERTIFIÉ)",
            "#ef4444",
            "VOLUME INSUFFISANT — Min requis : 2 sessions OU 1 session intense (>300 frappes).".to_string(),
        )
    };

    let ref_full = Uuid::new_v4().to_string();
    let ref_short = ref_full.get(0..6).unwrap_or("000000");

    format!(
        r#"<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>HumanOrigin</title>
<style>
:root {{
  --bg:#f3f4f6; --paper:#fff; --text:#0b0b0d; --muted:#6b7280; --border:#e5e7eb;
}}
*{{box-sizing:border-box}}
body {{ background:var(--bg); font-family:-apple-system, system-ui, Segoe UI, Roboto, sans-serif; padding:24px; color:var(--text); }}
.paper {{ max-width: 980px; margin: 0 auto; background: var(--paper); border:1px solid var(--border); border-top:10px solid #111; border-radius:18px;
  box-shadow:0 18px 60px rgba(0,0,0,0.10); padding:34px; }}
.header {{ display:flex; justify-content:space-between; gap:18px; border-bottom:1px solid var(--border); padding-bottom:18px; margin-bottom:22px; }}
.kicker {{ font-size:12px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); margin:0 0 6px 0; }}
.title {{ font-size:34px; font-weight:900; margin:0; }}
.mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color:var(--muted); font-size:12px; text-align:right; }}
.score {{ display:flex; gap:18px; align-items:center; background:#fafafa; border:1px solid var(--border); border-radius:16px; padding:18px; }}
.circle {{ width:96px; height:96px; border-radius:50%; border:8px solid {0}; display:flex; align-items:center; justify-content:center; font-size:34px; font-weight:950; color:{1}; background:#fff; }}
.grid {{ display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; margin:20px 0 6px 0; }}
.stat {{ border-left:3px solid #111; padding-left:14px; }}
.val {{ font-size:26px; font-weight:900; display:block; margin-bottom:2px; }}
.lab {{ font-size:12px; text-transform:uppercase; color:var(--muted); font-weight:700; letter-spacing:.06em; }}
table {{ width:100%; border-collapse:collapse; margin-top:16px; }}
th {{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); border-bottom:1px solid var(--border); padding:10px 0; }}
td {{ padding:14px 0; border-bottom:1px solid #f1f5f9; vertical-align:middle; }}
.muted {{ font-size:11px; color:var(--muted); }}
.mini-graph {{ display:flex; align-items:flex-end; height:30px; width:140px; gap:2px; }}
.bar {{ width:100%; min-height:2px; border-radius:2px; }}
.badge {{ padding:6px 10px; border-radius:10px; color:#fff; font-weight:900; font-size:11px; display:inline-block; }}
.mini-flags {{ font-size:10px; color:var(--muted); margin-top:4px; }}
.warn-mini {{ font-size:10px; color:#d97706; margin-top:4px; font-weight:800; }}
</style></head><body>
<div class="paper">
  <div class="header">
    <div>
      <div class="kicker">HumanOrigin</div>
      <div class="title">{9}</div>
    </div>
    <div class="mono">REF: #{2}<br>{3}</div>
  </div>

  <div class="score">
    <div class="circle">{4}</div>
    <div>
      <div style="font-weight:950; font-size:18px; margin-bottom:4px;">Score de Cohérence (SCP)</div>
      <div style="color:var(--muted); line-height:1.35">{10}</div>
    </div>
  </div>

  <div class="grid">
    <div class="stat"><span class="val">{5}</span><span class="lab">Temps actif (validé)</span></div>
    <div class="stat"><span class="val">{6}</span><span class="lab">Frappes totales</span></div>
    <div class="stat"><span class="val">{7}</span><span class="lab">Sessions valides</span></div>
  </div>

  <div style="margin-top:18px; font-weight:950; font-size:16px;">Détail des sessions</div>
  <table>
    <thead><tr><th>ID / Tier</th><th>Activité</th><th>Volume</th><th>Analyse</th></tr></thead>
    <tbody>{8}</tbody>
  </table>
</div>
</body></html>"#,
        score_color,
        score_color,
        ref_short,
        Utc::now().format("%d-%m-%Y"),
        avg_scp,
        format_duration_smart(metadata.total_active_seconds),
        total_k,
        certified_count,
        session_rows,
        main_title,
        validation_msg
    )
}

#[tauri::command]
fn get_live_stats(state: State<AppState>) -> Result<LiveStats, String> {
    let is_scanning = *state.is_scanning.lock().unwrap();
    let rt = state.runtime.lock().unwrap();
    if !is_scanning || rt.start_timestamp == 0 {
        return Ok(LiveStats {
            is_scanning: false,
            duration_sec: 0,
            keystrokes: 0,
            clicks: 0,
        });
    }
    let duration_sec = ((Utc::now().timestamp_millis() - rt.start_timestamp).max(0) as u64) / 1000;
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
    let _ = fs::create_dir_all(&path);

    let mut projects = Vec::new();
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Some(name) = entry.path().file_name().and_then(|n| n.to_str()) {
                if !name.starts_with('.') {
                    projects.push(name.to_string());
                }
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

    let pj = project_path.join("project.json");
    if !pj.exists() {
        let metadata = ProjectMetadata {
            project_name: project_name.clone(),
            created_at_utc: Utc::now().to_rfc3339(),
            last_activity_utc: Utc::now().to_rfc3339(),
            sessions_count: 0,
            total_active_seconds: 0,
            status: "ACTIVE".to_string(),
        };
        fs::write(&pj, serde_json::to_string_pretty(&metadata).unwrap()).map_err(|e| e.to_string())?;
    }

    Ok(project_path.to_string_lossy().to_string())
}

#[tauri::command]
fn activate_project(project_name: String, state: State<AppState>) -> Result<String, String> {
    let doc_path = dirs::document_dir().ok_or("Err Documents")?;
    let project_path = doc_path.join("HumanOrigin").join("Projets").join(&project_name);
    if !project_path.exists() {
        return Err("Projet introuvable".into());
    }
    *state.active_project_path.lock().unwrap() = Some(project_path.clone());
    Ok(project_path.to_string_lossy().to_string())
}

#[tauri::command]
fn start_scan(state: State<AppState>, session_id: String) -> Result<String, String> {
    let mut scanning = state.is_scanning.lock().unwrap();
    if *scanning {
        return Err("Déjà en cours".into());
    }
    *scanning = true;

    let gen = state.scan_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let mut rt = state.runtime.lock().unwrap();
    rt.keystroke_timestamps.clear();
    rt.backspace_timestamps.clear();
    rt.click_timestamps.clear();
    rt.start_timestamp = Utc::now().timestamp_millis();
    rt.start_rfc3339 = Utc::now().to_rfc3339();
    rt.active_gen = gen;
    rt.current_session_id = Some(session_id);

    Ok("Started".into())
}

#[tauri::command]
fn stop_scan(
    app: tauri::AppHandle,
    state: State<AppState>,
    paste: PasteStats
) -> Result<serde_json::Value, String> {
    state.scan_gen.fetch_add(1, Ordering::SeqCst);

    {
        let mut scanning = state.is_scanning.lock().unwrap();
        if !*scanning {
            return Err("Pas de session".into());
        }
        *scanning = false;
    }

    if EXTRA_CARRE_DRAIN {
        thread::sleep(Duration::from_millis(EXTRA_CARRE_DRAIN_MS));
    }

    let path_buf = state
        .active_project_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("Pas de projet actif")?;

    let (start_ms, start_rfc3339, keys, backs, clicks, session_id) = {
        let rt = state.runtime.lock().unwrap();
        (
            rt.start_timestamp,
            rt.start_rfc3339.clone(),
            rt.keystroke_timestamps.clone(),
            rt.backspace_timestamps.clone(),
            rt.click_timestamps.clone(),
            rt.current_session_id.clone().unwrap_or("unknown".to_string()),
        )
    };

    let end_ms = Utc::now().timestamp_millis();
    let backspace_count = backs.len() as u32;
    let mut analysis = calculate_scp(start_ms, end_ms, &keys, &clicks, backspace_count);

    // --- PASTE POLICY (DIAMOND) ---
    let pasted = paste.pasted_chars as f64;
    let typed = keys.len() as f64;
    let mut paste_dominant = false;
    let mut paste_heavy = false;

    if paste.paste_events > 0 && pasted >= 120.0 {
        if typed < pasted * 0.35 {
            paste_dominant = true;
        } else if typed < pasted * 0.75 {
            paste_heavy = true;
        }
    }

    if paste_dominant {
        analysis.gate_passed = false;
        analysis.gate_reason = Some(format!(
            "Collage dominant ({} collés / {} tapés)",
            paste.pasted_chars,
            keys.len()
        ));
        analysis.score = 0;
        analysis.verdict_label = "INSUFFISANT".to_string();
        analysis.verdict_color = "#9ca3af".to_string();
        analysis.evidence_score = 0;
        analysis.evidence_label = "N/A".to_string();
        analysis.flags = vec!["PASTE_DOMINANT".to_string()];
    } else {
        if paste_heavy {
            analysis.score = std::cmp::min(75, analysis.score);
            if analysis.gate_reason.is_none() {
                analysis.gate_reason = Some(format!(
                    "Collage important ({} collés / {} tapés)",
                    paste.pasted_chars,
                    keys.len()
                ));
            }
        }
        if paste.paste_events > 0 {
            analysis.flags.push(format!("PASTE:{}ch", paste.pasted_chars));
            if analysis.flags.len() > 3 {
                analysis.flags.truncate(3);
            }
        }
        let (lab, col) = apply_verdict(analysis.score);
        analysis.verdict_label = lab;
        analysis.verdict_color = col;
    }

    // --- metadata update ---
    let json_path = path_buf.join("project.json");
    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let mut metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    metadata.sessions_count += 1;
    if analysis.gate_passed {
        metadata.total_active_seconds += analysis.active_est_sec;
    }
    metadata.last_activity_utc = Utc::now().to_rfc3339();

    let proof = BiometricProof {
        session_id: session_id.clone(),
        timestamp_start: start_rfc3339,
        timestamp_end: Utc::now().to_rfc3339(),
        project_name: metadata.project_name.clone(),
        session_index: metadata.sessions_count,
        keyboard_dynamics: KeyboardStats {
            total_keystrokes: keys.len() as u64,
            backspace_count: backs.len() as u64,
        },
        mouse_dynamics: MouseStats {
            total_clicks: clicks.len() as u64,
        },
        analysis: analysis.clone(),
        paste_stats: paste.clone(),
    };

    let proof_json = serde_json::to_string_pretty(&proof).unwrap();

    // Archive JSON
    fs::write(
        path_buf
            .join("certificats")
            .join(format!("session_{}.json", metadata.sessions_count)),
        &proof_json,
    )
    .map_err(|e| e.to_string())?;

    // Archive HTML (pas d’ouverture auto)
    let session_html = generate_session_html(&proof);
    let session_html_path = path_buf
        .join("certificats")
        .join(format!("session_{}.html", metadata.sessions_count));
    fs::write(&session_html_path, session_html).map_err(|e| e.to_string())?;

    // Save metadata
    fs::write(&json_path, serde_json::to_string_pretty(&metadata).unwrap())
        .map_err(|e| e.to_string())?;

    // Draft chiffré persistant (pour le bandeau orange)
    if let Some(app_dir) = app.path_resolver().app_data_dir() {
        let created_at = Utc::now().to_rfc3339();
        let _ = drafts::save_draft(
            &app_dir,
            &session_id,
            &metadata.project_name,
            &created_at,
            &proof_json,
        );
    }

    // cleanup runtime
    {
        let mut rt = state.runtime.lock().unwrap();
        rt.current_session_id = None;
    }

    Ok(serde_json::json!({
        "session_id": session_id,
        "active_ms": analysis.active_est_sec * 1000,
        "events_count": analysis.total_events,
        "scp_score": analysis.score,
        "evidence_score": analysis.evidence_score,
        "html_path": session_html_path.to_string_lossy().to_string(),
        "diag": { "analysis": analysis, "paste": paste }
    }))
}

#[tauri::command]
fn finalize_project(project_path: String) -> Result<FinalizationResult, String> {
    let path = PathBuf::from(project_path);
    let content = fs::read_to_string(path.join("project.json")).map_err(|e| e.to_string())?;
    let metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let mut all_proofs = Vec::new();
    let mut weighted_score_sum = 0f64;
    let mut total_weight = 0f64;
    let mut total_keys = 0u64;

    if let Ok(entries) = fs::read_dir(path.join("certificats")) {
        for entry in entries.flatten() {
            if entry.path().extension().map(|s| s == "json").unwrap_or(false) {
                if let Ok(c) = fs::read_to_string(entry.path()) {
                    if let Ok(proof) = serde_json::from_str::<BiometricProof>(&c) {
                        total_keys += proof.keyboard_dynamics.total_keystrokes;
                        if proof.analysis.gate_passed {
                            let w = proof.analysis.active_est_sec as f64;
                            weighted_score_sum += (proof.analysis.score as f64) * w;
                            total_weight += w;
                        }
                        all_proofs.push(proof);
                    }
                }
            }
        }
    }
    all_proofs.sort_by_key(|k| k.session_index);

    let avg_scp = if total_weight > 0.0 {
        (weighted_score_sum / total_weight) as i32
    } else {
        0
    };

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
    })
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ✅ lecture HTML via Rust -> plus de bug scope / iframe vide
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn sign_payload_hash(payload_hash: String) -> Result<serde_json::Value, String> {
    let sk = ensure_signing_key()?;
    let bytes = hex_to_bytes32(&payload_hash)?;
    let sig = sk.sign(&bytes);

    Ok(serde_json::json!({
        "alg": "ed25519",
        "public_key": general_purpose::STANDARD.encode(sk.verifying_key().to_bytes()),
        "signature": general_purpose::STANDARD.encode(sig.to_bytes())
    }))
}

// --- DRAFT COMMANDS ---
#[tauri::command]
fn list_local_drafts(app: tauri::AppHandle) -> Result<Vec<drafts::DraftInfo>, String> {
    let dir = app.path_resolver().app_data_dir().ok_or("No AppData")?;
    drafts::list_drafts(&dir)
}
#[tauri::command]
fn load_local_draft(app: tauri::AppHandle, session_id: String) -> Result<String, String> {
    let dir = app.path_resolver().app_data_dir().ok_or("No AppData")?;
    drafts::load_draft(&dir, &session_id)
}
#[tauri::command]
fn delete_local_draft(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let dir = app.path_resolver().app_data_dir().ok_or("No AppData")?;
    drafts::delete_draft(&dir, &session_id)
}

fn main() {
    let is_scanning = Arc::new(Mutex::new(false));
    let active_project_path = Arc::new(Mutex::new(None));
    let runtime = Arc::new(Mutex::new(RuntimeBuffers {
        keystroke_timestamps: vec![],
        backspace_timestamps: vec![],
        click_timestamps: vec![],
        start_timestamp: 0,
        start_rfc3339: String::new(),
        active_gen: 0,
        current_session_id: None,
    }));

    let is_scanning_clone = is_scanning.clone();
    let runtime_clone = runtime.clone();

    let _ = tauri_plugin_deep_link::prepare("com.humanorigin.app");

    thread::spawn(move || {
        let device_state = DeviceState::new();
        let mut prev_keys = vec![];
        let mut prev_mouse: Vec<bool> = vec![];

        loop {
            thread::sleep(Duration::from_millis(20));
            if !*is_scanning_clone.lock().unwrap() {
                continue;
            }

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
            let _ = tauri_plugin_deep_link::register("humanorigin", move |request| {
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
            read_text_file,
            get_live_stats,
            sign_payload_hash,
            list_local_drafts,
            load_local_draft,
            delete_local_draft
        ])
        .run(tauri::generate_context!())
        .expect("error");
}
