use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce, // Or generic_array if version mismatch, but usually implicit
};
use base64::{engine::general_purpose, Engine as _};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use rand::RngCore;

// --- CONSTANTES ---
const KEYCHAIN_SERVICE: &str = "humanorigin";
const KEYCHAIN_ACCOUNT: &str = "ho_draft_key_v1";
const DRAFTS_DIR: &str = "ho_drafts";
const VERSION: u8 = 1;
const NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftInfo {
    pub session_id: String,
    pub path: String,
    pub size_bytes: u64,
}

// --- UTILS ---

pub fn drafts_dir(app_data_dir: &Path) -> PathBuf {
    let mut p = app_data_dir.to_path_buf();
    p.push(DRAFTS_DIR);
    p
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Récupère ou crée la clé de chiffrement dans le Keychain du Mac
fn get_or_create_key_b64() -> Result<String, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())?;
    
    match entry.get_password() {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => {
            // Génération nouvelle clé 32 bytes
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            let b64 = general_purpose::STANDARD.encode(key);
            entry.set_password(&b64).map_err(|e| e.to_string())?;
            Ok(b64)
        }
    }
}

fn cipher_from_key() -> Result<Aes256Gcm, String> {
    let key_b64 = get_or_create_key_b64()?;
    let key_bytes = general_purpose::STANDARD
        .decode(key_b64.trim())
        .map_err(|e| e.to_string())?;
    
    if key_bytes.len() != 32 {
        return Err("La clé Draft doit faire 32 bytes".into());
    }
    
    Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| e.to_string())
}

pub fn draft_path(app_data_dir: &Path, session_id: &str) -> PathBuf {
    let mut p = drafts_dir(app_data_dir);
    p.push(format!("{}.bin", session_id));
    p
}

// --- FONCTIONS PUBLIQUES (Appelées par main.rs) ---

pub fn save_draft(app_data_dir: &Path, session_id: &str, snapshot_json: &str) -> Result<PathBuf, String> {
    let dir = drafts_dir(app_data_dir);
    ensure_dir(&dir)?;

    let cipher = cipher_from_key()?;
    
    // Nonce unique par fichier
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // On lie le chiffrement à l'ID de session (Associated Data) pour éviter le swap de fichiers
    let aad = session_id.as_bytes();

    let ciphertext = cipher
        .encrypt(nonce, Payload { msg: snapshot_json.as_bytes(), aad })
        .map_err(|_| "Erreur chiffrement draft".to_string())?;

    // Format binaire : [VERSION 1o] [NONCE 12o] [CIPHERTEXT...]
    let mut out = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    out.push(VERSION);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);

    let path = draft_path(app_data_dir, session_id);
    fs::write(&path, out).map_err(|e| e.to_string())?;
    
    Ok(path)
}

pub fn load_draft(app_data_dir: &Path, session_id: &str) -> Result<String, String> {
    let path = draft_path(app_data_dir, session_id);
    let bytes = fs::read(&path).map_err(|e| format!("Fichier introuvable ou illisible: {}", e))?;

    if bytes.len() < 1 + NONCE_LEN {
        return Err("Fichier draft corrompu (trop court)".into());
    }
    if bytes[0] != VERSION {
        return Err("Version draft incompatible".into());
    }

    let nonce_bytes = &bytes[1..1 + NONCE_LEN];
    let ciphertext = &bytes[1 + NONCE_LEN..];
    
    let cipher = cipher_from_key()?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let aad = session_id.as_bytes();

    let plaintext = cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|_| "Erreur déchiffrement (Clé invalide ou fichier altéré)".to_string())?;

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

pub fn delete_draft(app_data_dir: &Path, session_id: &str) -> Result<(), String> {
    let path = draft_path(app_data_dir, session_id);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_drafts(app_data_dir: &Path) -> Result<Vec<DraftInfo>, String> {
    let dir = drafts_dir(app_data_dir);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut out = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        
        // On ne regarde que les .bin
        if path.extension().and_then(|s| s.to_str()) != Some("bin") {
            continue;
        }

        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let session_id = path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        if !session_id.is_empty() {
            out.push(DraftInfo {
                session_id,
                path: path.to_string_lossy().to_string(),
                size_bytes: metadata.len(),
            });
        }
    }
    
    // Optionnel : Trier par date de modification si besoin, 
    // mais pour l'instant l'ordre FS suffit.
    Ok(out)
}