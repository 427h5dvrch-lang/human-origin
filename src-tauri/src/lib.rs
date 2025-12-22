use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use std::fs::File;
use std::io::Write;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};

use device_query::{DeviceQuery, DeviceState, Keycode};
use chrono::prelude::*;
use serde_json;

// ======================================================
// PAYLOAD FRONT
// ======================================================

#[derive(Clone, serde::Serialize)]
struct AnalysisPayload {
    status: String,
    certificate_path: String,
    is_official: bool,
}

// ======================================================
// BASELINE (CALIBRAGE IMPLICITE LOCAL)
// ======================================================

#[derive(serde::Serialize, serde::Deserialize, Clone, Default, Debug)]
struct UserBaseline {
    samples: usize,
    avg_std_dev: f64,
    avg_pause_ratio: f64,
    avg_irregular_ratio: f64,
}

fn update_and_check_baseline(
    std_dev: f64,
    pause_ratio: f64,
    irregular_ratio: f64,
) -> bool {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return true,
    };

    let dir = std::path::Path::new(&home)
        .join("Library/Application Support/HumanOrigin");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("baseline.json");

    let mut baseline: UserBaseline = if path.exists() {
        File::open(&path)
            .ok()
            .and_then(|f| serde_json::from_reader(std::io::BufReader::new(f)).ok())
            .unwrap_or_default()
    } else {
        UserBaseline::default()
    };

    let mut is_consistent = true;

    if baseline.samples >= 3 {
        let check = |v: f64, ref_v: f64| -> bool {
            if ref_v < 0.01 {
                true
            } else {
                v >= ref_v * 0.5 && v <= ref_v * 2.5
            }
        };

        let ok_std = check(std_dev, baseline.avg_std_dev);
        let ok_pause = check(pause_ratio, baseline.avg_pause_ratio);
        let ok_irreg = check(irregular_ratio, baseline.avg_irregular_ratio);

        let score = (ok_std as u8) + (ok_pause as u8) + (ok_irreg as u8);
        if score < 2 {
            is_consistent = false;
        }
    }

    if is_consistent {
        let n = baseline.samples as f64;
        baseline.avg_std_dev = (baseline.avg_std_dev * n + std_dev) / (n + 1.0);
        baseline.avg_pause_ratio =
            (baseline.avg_pause_ratio * n + pause_ratio) / (n + 1.0);
        baseline.avg_irregular_ratio =
            (baseline.avg_irregular_ratio * n + irregular_ratio) / (n + 1.0);
        baseline.samples += 1;

        if let Ok(f) = File::create(&path) {
            let _ = serde_json::to_writer(f, &baseline);
        }
    }

    is_consistent
}

// ======================================================
// SESSION
// ======================================================

struct Session {
    is_active: bool,
    last_tap: Option<Instant>,
    intervals: Vec<f64>,
    backspace_count: usize,
}

struct AppState {
    session: Arc<Mutex<Session>>,
}

// ======================================================
// CERTIFICAT
// ======================================================

struct CertificateData {
    count: usize,
    avg: f64,
    std_dev: f64,
    pause_ratio: f64,
    correction_ratio: f64,
    irregular_ratio: f64,
    profil_type: String,
    session_id: String,
    timestamp: String,
    signature: String,
    authority: String,
    status_label: String,
}

// ======================================================
// CLASSIFICATION COGNITIVE
// ======================================================

fn classify_session(
    count: usize,
    avg: f64,
    std_dev: f64,
    pause_count: usize,
    backspace_count: usize,
    intervals: &[f64],
) -> (String, String, String, String, bool, f64, f64, f64) {
    if count < 30 {
        return (
            "N/A".into(),
            "Local".into(),
            "REJETÉ : VOLUME INSUFFISANT".into(),
            "INCONNU".into(),
            false,
            0.0,
            0.0,
            0.0,
        );
    }

    let pause_ratio = pause_count as f64 / count as f64 * 100.0;
    let correction_ratio = backspace_count as f64 / count as f64 * 100.0;

    let mut irregular = 0usize;
    for w in intervals.windows(2) {
        if (w[1] - w[0]).abs() > 20.0 {
            irregular += 1;
        }
    }

    let denom = if intervals.len() > 1 {
        (intervals.len() - 1) as f64
    } else {
        1.0
    };

    let irregular_ratio = irregular as f64 / denom * 100.0;

    if std_dev < 4.0 && pause_ratio < 1.0 && irregular_ratio < 1.0 {
        return (
            format!("BOT-SIG-{:X}", count),
            "HumanOrigin™ Protection Layer".into(),
            "REJETÉ : SIGNATURE ROBOTIQUE".into(),
            "AUTOMATE".into(),
            false,
            pause_ratio,
            correction_ratio,
            irregular_ratio,
        );
    }

    let profil = if std_dev > 30.0
        || pause_ratio > 10.0
        || correction_ratio > 5.0
        || irregular_ratio > 5.0
    {
        "HUMAIN — CRÉATION"
    } else {
        "HUMAIN — SAISIE CONTINUE"
    };

    (
        format!("LOCAL-HASH-{:X}-{:X}", count, avg as u64),
        "Local Device (Pre-Certification)".into(),
        "PRÉ-CERTIFICAT — EN ATTENTE DE SIGNATURE".into(),
        profil.into(),
        true,
        pause_ratio,
        correction_ratio,
        irregular_ratio,
    )
}

// ======================================================
// HTML GENERATION (V1.2 - COHERENCE AUTHORITY)
// ======================================================

fn generate_html(data: &CertificateData, path: &str) -> Result<(), std::io::Error> {

    let watermark = if data.status_label.contains("REJETÉ") {
        "REJETÉ"
    } else {
        "EN ATTENTE"
    };

    // Le Disclaimer Juridique & Produit
    let disclaimer = r#"
    <div class="disclaimer">
        <strong>PÉRIMÈTRE DE LA CERTIFICATION</strong><br>
        Ce certificat atteste que le texte associé a été produit par un effort humain mesurable 
        (réflexion, hésitation, correction) durant une session de rédaction identifiable.<br>
        Il ne couvre pas l'usage d'outils externes en dehors de cette session.
    </div>
    "#;

    let html = format!(r#"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>HumanOrigin™ — Preuve d'Acte de Rédaction</title>
<style>
body {{ font-family: 'Georgia', serif; background:#f4f4f4; color:#333; padding:40px; line-height:1.5; }}
.watermark {{
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-45deg);
    font-size:6rem; color:rgba(0,0,0,0.04); font-weight:bold; z-index:0; pointer-events:none; border: 5px solid rgba(0,0,0,0.04); padding: 20px;
}}
.document {{
    background:#fff; max-width:750px; margin:auto; padding:60px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.05); position:relative; z-index:1; border-top: 5px solid #333;
}}
h1 {{ text-align:center; text-transform:uppercase; letter-spacing:3px; font-size:1.1rem; margin-bottom: 5px; color:#111; }}
h2 {{ text-align:center; font-weight:normal; font-size: 0.9rem; color:#666; margin-top:0; margin-bottom:40px; font-style:italic; }}

.status-badge {{
    text-align:center; margin-bottom:30px;
}}
.status-pill {{
    background:#eee; padding:5px 15px; border-radius:20px; font-family:sans-serif; font-size:0.75rem; text-transform:uppercase; letter-spacing:1px; font-weight:bold; color:#555;
}}

.profil-box {{
    border: 2px solid #eee; padding:20px; text-align:center; margin-bottom:30px; background:#fafafa;
}}
.profil-label {{ font-family:sans-serif; font-size:0.7rem; color:#999; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px; }}
.profil-val {{ font-size:1.4rem; font-weight:bold; color:#000; }}

.metrics-grid {{ display:flex; justify-content:space-between; margin-bottom:30px; border-bottom:1px solid #eee; padding-bottom:30px; }}
.metric {{ width:23%; text-align:center; }}
.m-val {{ font-family:'Courier New', monospace; font-weight:bold; font-size:1.1rem; display:block; }}
.m-label {{ font-family:sans-serif; font-size:0.6rem; color:#888; text-transform:uppercase; margin-top:5px; display:block; }}

.disclaimer {{
    background: #fff; border-left: 3px solid #ccc; padding: 15px; font-size: 0.8rem; color: #555; margin-bottom: 40px; font-style: italic;
}}
.disclaimer strong {{ color:#333; font-style:normal; font-size:0.7rem; display:block; margin-bottom:5px; }}

.tech-footer {{
    font-family:'Courier New', monospace; font-size:0.75rem; color:#777; border-top:1px solid #eee; padding-top:20px;
}}
.row {{ display:flex; justify-content:space-between; }}
</style>
</head>
<body>
<div class="watermark">{}</div>
<div class="document">

<h1>HumanOrigin™</h1>
<h2>Certificat d'Acte de Rédaction</h2>

<div class="status-badge">
    <span class="status-pill">Statut : {}</span>
</div>

<div class="profil-box">
    <div class="profil-label">Profil Cognitif Identifié</div>
    <div class="profil-val">{}</div>
</div>

<div class="metrics-grid">
    <div class="metric">
        <span class="m-val">{}</span>
        <span class="m-label">Volume (Frappes)</span>
    </div>
    <div class="metric">
        <span class="m-val">{:.1} ms</span>
        <span class="m-label">Stabilité Neuro-Motrice</span>
    </div>
    <div class="metric">
        <span class="m-val">{:.1}%</span>
        <span class="m-label">Indice de Réflexion</span>
    </div>
    <div class="metric">
        <span class="m-val">{:.1}%</span>
        <span class="m-label">Indice d'Hésitation</span>
    </div>
</div>

{}

<div class="tech-footer">
    <div class="row"><span>SESSION ID</span> <span>{}</span></div>
    <div class="row"><span>SIGNATURE</span> <span>{}</span></div>
    <div class="row"><span>AUTORITÉ</span> <span>{}</span></div>
    <br>
    <div style="text-align:center; font-size:0.7rem; color:#aaa;">
        Généré le {} • Trust Layer V1.2
    </div>
</div>

</div>
</body>
</html>"#,
        watermark,
        data.status_label,
        data.profil_type,
        data.count,
        data.std_dev, // Stabilité
        data.pause_ratio, // Reflexion
        data.correction_ratio, // Hésitation
        disclaimer,
        data.session_id,
        data.signature,
        data.authority,
        data.timestamp
    );

    let mut f = File::create(path)?;
    f.write_all(html.as_bytes())?;
    Ok(())
}

// ======================================================
// FIN DE SESSION
// ======================================================

fn process_session_end(session: &Session) -> (String, bool) {
    let count = session.intervals.len();
    let avg = if count > 0 {
        session.intervals.iter().sum::<f64>() / count as f64
    } else {
        0.0
    };

    let variance = if count > 0 {
        session.intervals
            .iter()
            .map(|v| (v - avg).powi(2))
            .sum::<f64>()
            / count as f64
    } else {
        0.0
    };

    let std_dev = variance.sqrt();
    let pause_count = session.intervals.iter().filter(|&&x| x > 300.0).count();

    let (
        signature,
        authority,
        status_label,
        profil_type,
        valid,
        pause_ratio,
        correction_ratio,
        irregular_ratio,
    ) = classify_session(
        count,
        avg,
        std_dev,
        pause_count,
        session.backspace_count,
        &session.intervals,
    );

    if valid {
        let _ = update_and_check_baseline(std_dev, pause_ratio, irregular_ratio);
    }

    let is_official = !authority.contains("Local");

    if let Ok(home) = std::env::var("HOME") {
        let now = Local::now();
        let suffix = if valid { "CERT" } else { "REJET" };
        let path = format!(
            "{}/Desktop/HO_{}_{}.html",
            home,
            suffix,
            now.format("%Y%m%d-%H%M%S")
        );

        let cert = CertificateData {
            count,
            avg,
            std_dev,
            pause_ratio,
            correction_ratio,
            irregular_ratio,
            profil_type,
            session_id: format!("{:X}-HO", Utc::now().timestamp()),
            timestamp: now.to_rfc3339(),
            signature,
            authority,
            status_label,
        };

        let _ = generate_html(&cert, &path);
        return (path, is_official);
    }

    ("ERREUR_IO".into(), false)
}

// ======================================================
// COMMANDES & MAIN
// ======================================================

#[tauri::command]
fn start_scan(state: State<AppState>) {
    if let Ok(mut s) = state.session.lock() {
        s.is_active = true;
        s.intervals.clear();
        s.backspace_count = 0;
        s.last_tap = None;
    }
}

#[tauri::command]
fn stop_scan(app: AppHandle, state: State<AppState>) {
    let (path, official) = {
        let mut s = state.session.lock().unwrap();
        if !s.is_active {
            return;
        }
        s.is_active = false;
        let result = process_session_end(&s);
        s.intervals.clear();
        result
    };

    let payload = AnalysisPayload {
        status: if path.contains("REJET") {
            "Session rejetée"
        } else {
            "Analyse terminée"
        }
        .into(),
        certificate_path: path,
        is_official: official,
    };

    if let Some(w) = app.webview_windows().values().next() {
        let _ = w.emit("analysis-result", payload);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session = Arc::new(Mutex::new(Session {
        is_active: false,
        last_tap: None,
        intervals: Vec::new(),
        backspace_count: 0,
    }));

    let session_thread = session.clone();

    thread::spawn(move || {
        let device = DeviceState::new();
        let mut last_keys: Vec<Keycode> = Vec::new();

        loop {
            let keys = device.get_keys();
            let now = Instant::now();

            if let Ok(mut s) = session_thread.lock() {
                if s.is_active {
                    if keys.len() > last_keys.len() {
                        if let Some(last) = s.last_tap {
                            let d = now.duration_since(last).as_secs_f64() * 1000.0;
                            if d < 2000.0 {
                                s.intervals.push(d);
                            }
                        }
                        s.last_tap = Some(now);
                    }

                    if keys.contains(&Keycode::Backspace)
                        && !last_keys.contains(&Keycode::Backspace)
                    {
                        s.backspace_count += 1;
                    }
                }
            }

            last_keys = keys;
            thread::sleep(Duration::from_millis(15));
        }
    });

    tauri::Builder::default()
        .manage(AppState { session })
        .invoke_handler(tauri::generate_handler![start_scan, stop_scan])
        .setup(|app| {
            let quit =
                MenuItem::with_id(app, "quit", "Quitter HumanOrigin", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .title("HO")
                .menu(&menu)
                .on_menu_event(|app: &AppHandle, e| {
                    if e.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running HumanOrigin");
}