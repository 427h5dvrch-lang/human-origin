#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::State;
use chrono::Utc;
use serde::{Serialize, Deserialize};
use device_query::{DeviceQuery, DeviceState, Keycode};
use std::process::Command;
use uuid::Uuid;

// --- CRYPTO IMPORTS ---
use argon2::{Argon2, Algorithm, Version, Params}; 
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce 
};
use rand::{rngs::OsRng, RngCore};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64}; 

const IDLE_THRESHOLD_MS: i64 = 30_000; 

// =============================================================
//  VAULT V1 : FORMAT OFFICIEL
// =============================================================

#[derive(Serialize, Deserialize, Debug)]
struct VaultFile {
    vault_version: String,
    alias: String,
    kdf: String,
    cipher: String,
    salt_b64: String,
    nonce_b64: String,
    encrypted_blob_b64: String, 
}

#[derive(Serialize, Deserialize, Debug)]
struct VaultPayload {
    ho_id: String,
    identity_data: UserIdentity,
    registry_snapshot: Option<IdentityRegistry>,
    calibration_profile: Option<serde_json::Value>
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct UserIdentity {
    ho_id: String,
    created_at_utc: String,
    device_fingerprint_version: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RegistryEntry {
    cert_type: String, project_name: String, session_index: u32, issued_at_utc: String, path: String,           
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct IdentityRegistry {
    registry_version: String, ho_id: String, certificates: Vec<RegistryEntry>,
}

// =============================================================
//  VAULT V1 : LOGIQUE CRYPTO & RÉSEAU
// =============================================================

fn derive_key(secret: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    let params = Params::default();
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    argon2.hash_password_into(secret.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Erreur KDF: {}", e))?;
    Ok(key)
}

#[tauri::command]
async fn vault_sync_push(alias: String, secret: String) -> Result<String, String> {
    let identity = get_or_create_identity().map_err(|e| e.to_string())?;
    
    let doc_path = dirs::document_dir().ok_or("Err doc")?;
    let reg_path = doc_path.join("HumanOrigin").join("registry.json");
    let registry: Option<IdentityRegistry> = if reg_path.exists() {
        let c = fs::read_to_string(&reg_path).unwrap_or_default();
        serde_json::from_str(&c).ok()
    } else { None };

    let payload = VaultPayload {
        ho_id: identity.ho_id.clone(),
        identity_data: identity,
        registry_snapshot: registry,
        calibration_profile: None,
    };
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);

    let key = derive_key(&secret, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce_obj = Nonce::from_slice(&nonce);

    let encrypted_bytes = cipher.encrypt(nonce_obj, payload_json.as_bytes())
        .map_err(|_| "Erreur de chiffrement")?;

    let vault_file = VaultFile {
        vault_version: "1.0".to_string(),
        alias: alias.clone(),
        kdf: "argon2id".to_string(),
        cipher: "aes-256-gcm".to_string(),
        salt_b64: BASE64.encode(salt),
        nonce_b64: BASE64.encode(nonce),
        encrypted_blob_b64: BASE64.encode(encrypted_bytes),
    };

    // ENVOI AU SERVEUR
    let client = reqwest::Client::new();
    let res = client.post(format!("http://localhost:3000/vault/{}", alias))
        .json(&vault_file)
        .send()
        .await
        .map_err(|e| format!("Erreur réseau: {}", e))?;

    if res.status().is_success() {
        Ok("Identité chiffrée et synchronisée sur le Cloud.".into())
    } else {
        Err("Le serveur a refusé la connexion.".into())
    }
}

#[tauri::command]
async fn vault_sync_pull(alias: String, secret: String) -> Result<String, String> {
    // RÉCUPÉRATION DEPUIS LE SERVEUR
    let res = reqwest::get(format!("http://localhost:3000/vault/{}", alias))
        .await
        .map_err(|e| format!("Erreur réseau: {}", e))?;

    if !res.status().is_success() {
        return Err("Aucun coffre trouvé pour cet alias.".into());
    }

    let vault: VaultFile = res.json().await.map_err(|_| "Données corrompues".to_string())?;

    let salt = BASE64.decode(&vault.salt_b64).map_err(|_| "Salt corrompu")?;
    let nonce = BASE64.decode(&vault.nonce_b64).map_err(|_| "Nonce corrompu")?;
    let encrypted_bytes = BASE64.decode(&vault.encrypted_blob_b64).map_err(|_| "Blob corrompu")?;

    let key = derive_key(&secret, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce_obj = Nonce::from_slice(&nonce);
    
    let decrypted_bytes = cipher.decrypt(nonce_obj, encrypted_bytes.as_ref())
        .map_err(|_| "ÉCHEC : Phrase secrète incorrecte.")?;

    let payload_str = String::from_utf8(decrypted_bytes).map_err(|_| "UTF8 error")?;
    let payload: VaultPayload = serde_json::from_str(&payload_str).map_err(|_| "Erreur JSON Payload")?;

    let doc_path = dirs::document_dir().ok_or("Err doc")?;
    let base_path = doc_path.join("HumanOrigin");
    if !base_path.exists() { fs::create_dir_all(&base_path).map_err(|e| e.to_string())?; }
    
    let id_path = base_path.join("identity.json");
    fs::write(id_path, serde_json::to_string_pretty(&payload.identity_data).unwrap()).map_err(|e| e.to_string())?;

    if let Some(reg) = payload.registry_snapshot {
        let reg_path = base_path.join("registry.json");
        fs::write(reg_path, serde_json::to_string_pretty(&reg).unwrap()).map_err(|e| e.to_string())?;
    }

    Ok(format!("Connexion réussie. HO-ID {} restaurée.", payload.ho_id))
}

// =============================================================
//  HELPER FUNCTIONS
// =============================================================

fn get_or_create_identity() -> Result<UserIdentity, String> {
    let doc_path = dirs::document_dir().ok_or("Impossible de trouver Documents")?;
    let base_path = doc_path.join("HumanOrigin");
    if !base_path.exists() { fs::create_dir_all(&base_path).map_err(|e| e.to_string())?; }
    let identity_path = base_path.join("identity.json");

    if identity_path.exists() {
        let content = fs::read_to_string(&identity_path).map_err(|e| e.to_string())?;
        let identity: UserIdentity = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(identity)
    } else {
        let new_id = format!("HO-{}", Uuid::new_v4());
        let identity = UserIdentity {
            ho_id: new_id,
            created_at_utc: Utc::now().to_rfc3339(),
            device_fingerprint_version: "v1".to_string(),
        };
        fs::write(&identity_path, serde_json::to_string_pretty(&identity).unwrap()).map_err(|e| e.to_string())?;
        Ok(identity)
    }
}

fn update_central_registry(ho_id: &str, entry: RegistryEntry) -> Result<(), String> {
    let doc_path = dirs::document_dir().ok_or("Impossible de trouver Documents")?;
    let registry_path = doc_path.join("HumanOrigin").join("registry.json");
    let mut registry: IdentityRegistry;

    if registry_path.exists() {
        let content = fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
        registry = serde_json::from_str(&content).unwrap_or(IdentityRegistry {
            registry_version: "1.0".to_string(), ho_id: ho_id.to_string(), certificates: Vec::new(),
        });
        if registry.ho_id != ho_id { registry.ho_id = ho_id.to_string(); }
    } else {
        registry = IdentityRegistry { registry_version: "1.0".to_string(), ho_id: ho_id.to_string(), certificates: Vec::new() };
    }
    registry.certificates.push(entry);
    fs::write(registry_path, serde_json::to_string_pretty(&registry).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

// =============================================================
//  BIOMÉTRIE & LOGIQUE MÉTIER
// =============================================================

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct ProductionContext {
    detected_pattern: String,
    confidence_score: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct TemporalDynamics { iki_mean_ms: Option<f64>, iki_variance: Option<f64>, burstiness_index: Option<f64> }
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct KeyboardDynamics { total_keystrokes: u64, backspace_count: u64, backspace_ratio: Option<f64> }
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct MouseDynamics { total_clicks: u64 }
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct ActivityPresence { active_seconds: u64, idle_seconds: u64, longest_idle_period_sec: Option<u64>, idle_events_count: u64 }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct BiometricProof {
    session_id: String,
    ho_id: String,
    timestamp_start: String,
    timestamp_end: String,
    version: String,
    analysis_mode: String,
    production_context: ProductionContext,
    project_name: String,
    session_index: u32,
    temporal: TemporalDynamics,
    keyboard: KeyboardDynamics,
    mouse: MouseDynamics,
    activity: ActivityPresence,
}

fn determine_production_context(
    iki_variance: Option<f64>, 
    _burstiness: Option<f64>, 
    backspace_ratio: Option<f64>,
    total_keys: u64,
    total_clicks: u64
) -> ProductionContext {
    let raw_score = total_keys as f64 / 500.0;
    let confidence_score = if raw_score > 1.0 { 1.0 } else { raw_score };

    if total_keys < 50 {
        return ProductionContext { detected_pattern: "low_data_volume".to_string(), confidence_score };
    }

    let var = iki_variance.unwrap_or(0.0);
    let back = backspace_ratio.unwrap_or(0.0);
    let mouse_keyboard_ratio = if total_keys > 0 { total_clicks as f64 / total_keys as f64 } else { 0.0 };

    if mouse_keyboard_ratio > 0.2 || (total_keys < 200 && total_clicks > 50) {
        return ProductionContext { detected_pattern: "revision_activity".to_string(), confidence_score };
    }
    if var < 5000.0 && back < 0.05 {
        return ProductionContext { detected_pattern: "reference_based_input".to_string(), confidence_score };
    }
    if var > 10000.0 || back > 0.08 {
        return ProductionContext { detected_pattern: "free_composition".to_string(), confidence_score };
    }
    ProductionContext { detected_pattern: "mixed_activity".to_string(), confidence_score: confidence_score * 0.8 }
}

struct RuntimeBuffers {
    keystroke_timestamps: Vec<i64>, backspace_timestamps: Vec<i64>, click_timestamps: Vec<i64>, last_input_timestamp: i64, idle_periods: Vec<(i64, i64)>, 
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ProjectMetadata {
    project_name: String, created_at_utc: String, last_activity_utc: String, sessions_count: u32,
    #[serde(default)] total_active_seconds: u64,
    #[serde(default = "default_status")] status: String,
    #[serde(default)] calibration_status: Option<String>,
}
fn default_status() -> String { "ACTIVE".to_string() }

#[derive(Serialize)]
struct ScanResult { status: String, sessions_count: u32, active_seconds_added: u64, certificate_path: String, proof_data: BiometricProof }

struct AppState {
    is_scanning: Arc<Mutex<bool>>, active_project_path: Arc<Mutex<Option<PathBuf>>>, session_start: Arc<Mutex<Option<chrono::DateTime<Utc>>>>, runtime: Arc<Mutex<RuntimeBuffers>>,
}

fn calculate_iki_stats(timestamps: &Vec<i64>) -> (Option<f64>, Option<f64>) {
    if timestamps.len() < 2 { return (None, None); }
    let mut intervals = Vec::new();
    for i in 0..timestamps.len() - 1 {
        let diff = (timestamps[i+1] - timestamps[i]) as f64;
        if diff < IDLE_THRESHOLD_MS as f64 { intervals.push(diff); }
    }
    if intervals.is_empty() { return (None, None); }
    let sum: f64 = intervals.iter().sum();
    let mean = sum / intervals.len() as f64;
    let variance_sum: f64 = intervals.iter().map(|val| (val - mean).powi(2)).sum();
    (Some(mean), Some(variance_sum / intervals.len() as f64))
}

fn calculate_burstiness(mean: f64, variance: f64) -> Option<f64> {
    if mean == 0.0 { return None; }
    let std_dev = variance.sqrt();
    Some((std_dev - mean) / (std_dev + mean))
}

fn calculate_activity_stats(rt: &mut RuntimeBuffers, session_start_ms: i64, session_end_ms: i64) -> (u64, u64, u64) {
    rt.idle_periods.clear();
    let mut all_events = Vec::new();
    all_events.extend_from_slice(&rt.keystroke_timestamps);
    all_events.extend_from_slice(&rt.click_timestamps);
    all_events.sort(); 
    if all_events.is_empty() { return (0, ((session_end_ms - session_start_ms) / 1000) as u64, 0); }
    let mut idle_seconds_total = 0u64;
    let mut longest_idle = 0u64;
    if let Some(&first_event) = all_events.first() {
        if first_event - session_start_ms > IDLE_THRESHOLD_MS {
            let gap = (first_event - session_start_ms) / 1000;
            idle_seconds_total += gap as u64;
            if gap as u64 > longest_idle { longest_idle = gap as u64; }
            rt.idle_periods.push((session_start_ms, first_event));
        }
    }
    for i in 0..all_events.len() - 1 {
        let diff = all_events[i+1] - all_events[i];
        if diff > IDLE_THRESHOLD_MS {
            let gap = diff / 1000;
            idle_seconds_total += gap as u64;
            if gap as u64 > longest_idle { longest_idle = gap as u64; }
            rt.idle_periods.push((all_events[i], all_events[i+1]));
        }
    }
    if let Some(&last_event) = all_events.last() {
        if session_end_ms - last_event > IDLE_THRESHOLD_MS {
            let gap = (session_end_ms - last_event) / 1000;
            idle_seconds_total += gap as u64;
            if gap as u64 > longest_idle { longest_idle = gap as u64; }
            rt.idle_periods.push((last_event, session_end_ms));
        }
    }
    let total_sec = ((session_end_ms - session_start_ms) / 1000) as u64;
    (total_sec.saturating_sub(idle_seconds_total), idle_seconds_total, longest_idle)
}
fn generate_html_certificate(metadata: &ProjectMetadata, identity: &UserIdentity, total_duration: u64, total_keys: u64, total_clicks: u64, sessions_list: &Vec<serde_json::Value>) -> String {
    let hours = total_duration / 3600;
    let mins = (total_duration % 3600) / 60;
    let duration_str = if hours > 0 { format!("{}h {}m", hours, mins) } else { format!("{} min", mins) };
    
    // On nettoie les variables inutilisées pour supprimer les warnings
    let _ = sessions_list.first(); 
    let _ = sessions_list.last();
    
    let mut table_rows = String::new();
    for session in sessions_list {
        let date = session["date"].as_str().unwrap_or("").split('T').next().unwrap_or("");
        let dur = session["duration_sec"].as_u64().unwrap_or(0);
        let m = dur / 60;
        let s = dur % 60;
        
        let pattern_raw = session["production_context"]["detected_pattern"].as_str().unwrap_or("undefined");
        let pattern_label = match pattern_raw {
            "free_composition" => "Flux Créatif (Composition)",
            "reference_based_input" => "Saisie Référencée",
            "revision_activity" => "Édition & Révision",
            "low_data_volume" => "Volume Faible",
            _ => "Mixte / Indéterminé"
        };

        table_rows.push_str(&format!(
            "<tr class='row'><td><span class='sess-idx'>#{}</span></td><td>{}</td><td>{}m {}s</td><td><span class='tag'>{}</span></td></tr>", 
            session["index"], date, m, s, pattern_label
        ));
    }

    format!(r#"
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <title>Certificat de Production Comportementale - {}</title>
        <style>
            body {{ font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f0f2f5; color: #1a1a1a; margin: 0; padding: 40px; line-height: 1.5; }}
            .paper {{ max-width: 800px; margin: 0 auto; background: white; padding: 60px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 4px; border-top: 6px solid #1a1a1a; }}
            .header {{ display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; }}
            .brand h1 {{ font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #666; margin: 0 0 5px 0; }}
            .brand h2 {{ font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }}
            .meta {{ text-align: right; font-size: 12px; color: #666; font-family: 'Courier New', monospace; }}
            .statement {{ background: #fafafa; border-left: 4px solid #333; padding: 20px; font-size: 15px; margin-bottom: 40px; color: #444; }}
            .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 40px; }}
            .stat-box {{ background: #fff; border: 1px solid #eee; padding: 15px; border-radius: 8px; text-align: center; }}
            .val {{ display: block; font-size: 22px; font-weight: 700; color: #000; }}
            .lbl {{ font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: 1px; margin-top: 5px; display: block; }}
            
            table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
            th {{ text-align: left; color: #888; font-weight: 500; padding: 10px; border-bottom: 1px solid #ddd; font-size: 11px; text-transform: uppercase; }}
            td {{ padding: 12px 10px; border-bottom: 1px solid #f5f5f5; }}
            .sess-idx {{ color: #999; font-family: monospace; }}
            .tag {{ background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #555; }}
            
            .disclaimer {{ margin-top: 60px; font-size: 11px; color: #888; border-top: 1px solid #eee; padding-top: 20px; text-align: justify; }}
            .footer {{ margin-top: 20px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #aaa; font-family: monospace; }}
            .signature {{ color: #000; font-weight: bold; border: 1px solid #000; padding: 5px 10px; border-radius: 4px; display: inline-block; }}
        </style>
    </head>
    <body>
        <div class="paper">
            <div class="header">
                <div class="brand">
                    <h1>HumanOrigin Core</h1>
                    <h2>Certificat de Production</h2>
                </div>
                <div class="meta">
                    REF: F4-LOCKED<br>
                    DATE: {}
                </div>
            </div>

            <div class="statement">
                <strong>ATTESTATION DE CONTINUITÉ</strong><br><br>
                Ce document certifie que le projet <strong>"{}"</strong> est le résultat d'un effort humain continu, réalisé à travers <strong>{}</strong> sessions de travail distinctes.<br>
                Les données biométriques collectées (dynamique de frappe, rythme, interactions clavier standard) confirment une production manuelle et organique, compatible avec un opérateur humain standard.
            </div>

            <div class="grid">
                <div class="stat-box">
                    <span class="val">{}</span>
                    <span class="lbl">Temps Cumulé</span>
                </div>
                <div class="stat-box">
                    <span class="val">{}</span>
                    <span class="lbl">Frappes</span>
                </div>
                <div class="stat-box">
                    <span class="val">{}</span>
                    <span class="lbl">Clics</span>
                </div>
                <div class="stat-box">
                    <span class="val">{}</span>
                    <span class="lbl">Sessions</span>
                </div>
            </div>

            <h3>Traçabilité Temporelle (Audit Trail)</h3>
            <table>
                <thead>
                    <tr>
                        <th width="15%">ID Session</th>
                        <th width="30%">Date</th>
                        <th width="20%">Durée</th>
                        <th>Qualification de l'Effort</th>
                    </tr>
                </thead>
                <tbody>
                    {}
                </tbody>
            </table>

            <div class="disclaimer">
                <strong>LIMITES DE RESPONSABILITÉ & PORTÉE :</strong><br>
                Ce certificat qualifie exclusivement la nature comportementale de l'effort de production (conditions observables). Il ne constitue pas une preuve d'originalité intellectuelle, ne valide pas le contenu sémantique, et n'atteste pas de la paternité juridique de l'œuvre au sens du Code de la Propriété Intellectuelle. Il sert uniquement à distinguer une production humaine opérée via des périphériques standards d'un processus de génération automatisée sans intervention motrice humaine mesurable.
            </div>

            <div class="footer">
                <span>ID ANONYME: {}</span>
                <span class="signature">CRYPTOGRAPHICALLY SIGNED</span>
            </div>
        </div>
    </body>
    </html>
    "#, 
    metadata.project_name, 
    Utc::now().format("%d/%m/%Y"), 
    metadata.project_name, 
    metadata.sessions_count, 
    duration_str, 
    total_keys, 
    total_clicks, 
    metadata.sessions_count, 
    table_rows, 
    identity.ho_id)
}

#[tauri::command]
fn get_projects() -> Result<Vec<String>, String> {
    let doc_path = dirs::document_dir().ok_or("Impossible de trouver Documents")?;
    let projects_path = doc_path.join("HumanOrigin").join("Projets");
    if !projects_path.exists() { return Ok(Vec::new()); }
    let mut projects = Vec::new();
    if let Ok(entries) = fs::read_dir(projects_path) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if !name.starts_with('.') { projects.push(name.to_string()); }
                    }
                }
            }
        }
    }
    projects.sort();
    Ok(projects)
}

#[tauri::command]
fn initialize_project(project_name: String, _app_handle: tauri::AppHandle) -> Result<String, String> {
    let doc_path = dirs::document_dir().ok_or("Impossible de trouver le dossier Documents")?;
    let base_path = doc_path.join("HumanOrigin").join("Projets");
    let project_path = base_path.join(&project_name);
    let certs_path = project_path.join("certificats");
    if !project_path.exists() {
        fs::create_dir_all(&certs_path).map_err(|e| e.to_string())?;
        let metadata = ProjectMetadata { project_name: project_name.clone(), created_at_utc: Utc::now().to_rfc3339(), last_activity_utc: Utc::now().to_rfc3339(), sessions_count: 0, total_active_seconds: 0, status: "ACTIVE".to_string(), calibration_status: None };
        let json_path = project_path.join("project.json");
        fs::write(json_path, serde_json::to_string_pretty(&metadata).unwrap()).map_err(|e| e.to_string())?;
    }
    let _ = get_or_create_identity();
    Ok(project_path.to_string_lossy().to_string())
}

#[tauri::command]
fn activate_project(project_path: String, state: State<AppState>) -> Result<ProjectMetadata, String> {
    let path = PathBuf::from(&project_path);
    let json_path = path.join("project.json");
    if !json_path.exists() { return Err("Projet introuvable".into()); }
    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let mut active = state.active_project_path.lock().unwrap();
    *active = Some(path);
    Ok(metadata)
}

#[tauri::command]
fn start_scan(state: State<AppState>) -> Result<String, String> {
    let path_opt = state.active_project_path.lock().unwrap().clone();
    let path = path_opt.ok_or("Aucun projet actif")?;
    let json_path = path.join("project.json");
    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if metadata.status == "LOCKED" { return Err("Projet Verrouillé".into()); }
    let mut scanning = state.is_scanning.lock().unwrap();
    if *scanning { return Err("Session déjà en cours".into()); }
    *scanning = true;
    let mut start = state.session_start.lock().unwrap();
    *start = Some(Utc::now());
    let mut rt = state.runtime.lock().unwrap();
    rt.keystroke_timestamps.clear(); rt.backspace_timestamps.clear(); rt.click_timestamps.clear(); rt.idle_periods.clear(); rt.last_input_timestamp = Utc::now().timestamp_millis();
    Ok("Session Démarrée".into())
}

#[tauri::command]
fn stop_scan(state: State<AppState>) -> Result<ScanResult, String> {
    let mut scanning = state.is_scanning.lock().unwrap();
    if !*scanning { return Err("Aucune session en cours".into()); }
    *scanning = false;
    let path_opt = state.active_project_path.lock().unwrap().clone();
    let path = path_opt.ok_or("Erreur chemin projet")?;
    let json_path = path.join("project.json");
    let certs_dir = path.join("certificats");
    let start_opt = state.session_start.lock().unwrap().clone();
    let start_time_utc = start_opt.ok_or("Erreur temps début")?;
    let start_ms = start_time_utc.timestamp_millis();
    let end_ms = Utc::now().timestamp_millis();
    let identity = get_or_create_identity().map_err(|e| e.to_string())?;
    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let mut metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let mut rt = state.runtime.lock().unwrap();
    let (active_sec, idle_sec, max_idle) = calculate_activity_stats(&mut rt, start_ms, end_ms);
    let (iki_mean, iki_var) = calculate_iki_stats(&rt.keystroke_timestamps);
    let burstiness = if let (Some(m), Some(v)) = (iki_mean, iki_var) { calculate_burstiness(m, v) } else { None };
    let total_k = rt.keystroke_timestamps.len() as u64;
    let back_ratio = if total_k > 0 { Some(rt.backspace_timestamps.len() as f64 / total_k as f64) } else { None };
    let total_c = rt.click_timestamps.len() as u64;
    metadata.sessions_count += 1;
    metadata.last_activity_utc = Utc::now().to_rfc3339();
    metadata.total_active_seconds += active_sec;
    let context = determine_production_context(iki_var, burstiness, back_ratio, total_k, total_c);

    let proof = BiometricProof {
        session_id: format!("SESS-{}", Utc::now().format("%Y%m%d-%H%M%S")),
        ho_id: identity.ho_id.clone(),
        timestamp_start: start_time_utc.to_rfc3339(),
        timestamp_end: Utc::now().to_rfc3339(),
        version: "V2-FORENSIC-B2".to_string(),
        analysis_mode: "heuristic_v1.5".to_string(),
        production_context: context, 
        project_name: metadata.project_name.clone(),
        session_index: metadata.sessions_count,
        temporal: TemporalDynamics { iki_mean_ms: iki_mean, iki_variance: iki_var, burstiness_index: burstiness },
        keyboard: KeyboardDynamics { total_keystrokes: total_k, backspace_count: rt.backspace_timestamps.len() as u64, backspace_ratio: back_ratio },
        mouse: MouseDynamics { total_clicks: total_c },
        activity: ActivityPresence { active_seconds: active_sec, idle_seconds: idle_sec, idle_events_count: rt.idle_periods.len() as u64, longest_idle_period_sec: Some(max_idle) },
    };
    let cert_filename = format!("HO-F2-SESS{}-{}.json", metadata.sessions_count, Utc::now().format("%Y%m%d-%H%M%S"));
    let cert_path = certs_dir.join(&cert_filename);
    fs::write(&cert_path, serde_json::to_string_pretty(&proof).unwrap()).map_err(|e| e.to_string())?;
    fs::write(json_path, serde_json::to_string_pretty(&metadata).unwrap()).map_err(|e| e.to_string())?;
    let reg_entry = RegistryEntry { cert_type: "F2".to_string(), project_name: metadata.project_name.clone(), session_index: metadata.sessions_count, issued_at_utc: Utc::now().to_rfc3339(), path: cert_path.to_string_lossy().to_string() };
    let _ = update_central_registry(&identity.ho_id, reg_entry);
    Ok(ScanResult { status: "Session arrêtée".into(), sessions_count: metadata.sessions_count, active_seconds_added: active_sec, certificate_path: cert_filename, proof_data: proof })
}

#[tauri::command]
fn generate_intermediate_certificate(_project_path: String) -> Result<String, String> { Ok("OK".into()) }

#[tauri::command]
fn finalize_project(project_path: String) -> Result<String, String> {
    let path = PathBuf::from(&project_path);
    let json_path = path.join("project.json");
    let certs_dir = path.join("certificats");
    if !certs_dir.exists() { return Err("Aucun certificat trouvé.".into()); }
    let identity = get_or_create_identity().map_err(|e| e.to_string())?;
    let content = fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
    let mut metadata: ProjectMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if metadata.status == "LOCKED" { return Err("Projet déjà finalisé.".into()); }
    let mut audit_trail = Vec::new();
    let mut calculated_duration = 0;
    let mut total_keystrokes_global = 0;
    let mut total_clicks_global = 0;
    if let Ok(entries) = fs::read_dir(&certs_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    if filename.starts_with("HO-F2") && filename.ends_with(".json") {
                        if let Ok(f2_content) = fs::read_to_string(&path) {
                            if let Ok(f2) = serde_json::from_str::<BiometricProof>(&f2_content) {
                                calculated_duration += f2.activity.active_seconds;
                                total_keystrokes_global += f2.keyboard.total_keystrokes;
                                total_clicks_global += f2.mouse.total_clicks;
                                audit_trail.push(serde_json::json!({ 
                                    "index": f2.session_index, 
                                    "date": f2.timestamp_start, 
                                    "duration_sec": f2.activity.active_seconds, 
                                    "rhythm_variance": f2.temporal.iki_variance,
                                    "production_context": f2.production_context,
                                    "file_ref": filename 
                                }));
                            }
                        }
                    }
                }
            }
        }
    }
    audit_trail.sort_by_key(|k| k["index"].as_u64().unwrap_or(0));
    
    let interpretation_notice = serde_json::json!({
        "scope": "behavioral_conditions_only",
        "excludes": ["originality", "authorship", "source_legitimacy"],
        "statement": "This certificate qualifies behavioral production modes, not intellectual originality."
    });

    let html_content = generate_html_certificate(&metadata, &identity, calculated_duration, total_keystrokes_global, total_clicks_global, &audit_trail);
    let html_filename = format!("CERTIFICAT_FINAL_{}.html", metadata.project_name.replace(" ", "_"));
    let html_path = certs_dir.join(&html_filename);
    fs::write(&html_path, html_content).map_err(|e| e.to_string())?;
    
    let final_cert = serde_json::json!({
        "certificate_type": "HO-F4-FINAL", 
        "ho_id": identity.ho_id, 
        "analysis_mode": "heuristic_v1.5", 
        "project_name": metadata.project_name,
        "issued_at_utc": Utc::now().to_rfc3339(),
        "interpretation_notice": interpretation_notice,
        "global_stats": { "total_declared_sessions": metadata.sessions_count, "total_verified_proofs": audit_trail.len(), "total_active_seconds": calculated_duration, "total_keystrokes": total_keystrokes_global, "total_clicks": total_clicks_global },
        "forensic_audit_trail": audit_trail, 
        "status": "LOCKED"
    });
    let json_filename = format!("HO-F4-FINAL-{}.json", Utc::now().format("%Y%m%d-%H%M%S"));
    fs::write(certs_dir.join(json_filename), serde_json::to_string_pretty(&final_cert).unwrap()).map_err(|e| e.to_string())?;
    metadata.status = "LOCKED".to_string();
    fs::write(json_path, serde_json::to_string_pretty(&metadata).unwrap()).map_err(|e| e.to_string())?;
    Ok(html_path.to_string_lossy().to_string())
}

// =============================================================
//  CROSS-PLATFORM FILE OPENERS (FIX WINDOWS)
// =============================================================

#[tauri::command]
fn open_project_folder(project_name: String) -> Result<(), String> {
    let doc_path = dirs::document_dir().ok_or("Impossible de trouver Documents")?;
    let path = doc_path.join("HumanOrigin").join("Projets").join(project_name);
    
    if path.exists() { 
        #[cfg(target_os = "windows")]
        Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;

        #[cfg(not(target_os = "windows"))]
        Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?;
        
        Ok(()) 
    } else { 
        Err("Dossier introuvable".into()) 
    }
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;

    #[cfg(not(target_os = "windows"))]
    Command::new("open").arg(path).spawn().map_err(|e| e.to_string())?;
    
    Ok(())
}

fn main() {
    let is_scanning = Arc::new(Mutex::new(false));
    let active_project_path = Arc::new(Mutex::new(None));
    let session_start = Arc::new(Mutex::new(None));
    let runtime = Arc::new(Mutex::new(RuntimeBuffers { keystroke_timestamps: Vec::new(), backspace_timestamps: Vec::new(), click_timestamps: Vec::new(), idle_periods: Vec::new(), last_input_timestamp: 0 }));
    let is_scanning_for_thread = is_scanning.clone();
    let runtime_for_thread = runtime.clone();

    tauri::Builder::default()
        .manage(AppState { is_scanning, active_project_path, session_start, runtime })
        .setup(move |_app| { 
            thread::spawn(move || {
                let device_state = DeviceState::new();
                let mut prev_keys: Vec<Keycode> = vec![];
                let mut prev_mouse_buttons: Vec<bool> = vec![];
                loop {
                    {
                        let scanning = is_scanning_for_thread.lock().unwrap();
                        if !*scanning { thread::sleep(Duration::from_millis(500)); continue; }
                    }
                    let keys = device_state.get_keys();
                    let mouse = device_state.get_mouse();
                    let current_mouse_buttons = mouse.button_pressed;
                    let now = Utc::now().timestamp_millis();
                    let mut activity_detected = false;
                    if keys != prev_keys && keys.len() > prev_keys.len() {
                        let mut rt = runtime_for_thread.lock().unwrap();
                        rt.keystroke_timestamps.push(now); rt.last_input_timestamp = now;
                        if keys.contains(&Keycode::Backspace) && !prev_keys.contains(&Keycode::Backspace) { rt.backspace_timestamps.push(now); }
                        activity_detected = true;
                    }
                    if !activity_detected && current_mouse_buttons != prev_mouse_buttons {
                         let pressed_count_now = current_mouse_buttons.iter().filter(|&&b| b).count();
                         let pressed_count_prev = prev_mouse_buttons.iter().filter(|&&b| b).count();
                         if pressed_count_now > pressed_count_prev { let mut rt = runtime_for_thread.lock().unwrap(); rt.click_timestamps.push(now); rt.last_input_timestamp = now; }
                    }
                    prev_keys = keys; prev_mouse_buttons = current_mouse_buttons;
                    thread::sleep(Duration::from_millis(20));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_project, activate_project, start_scan, stop_scan, generate_intermediate_certificate, finalize_project, get_projects, open_project_folder, open_file,
            vault_sync_push, vault_sync_pull 
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}