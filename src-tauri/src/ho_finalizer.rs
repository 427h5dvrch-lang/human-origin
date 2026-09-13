//! ho_finalizer — composant natif de finalisation.
//!
//! Il ne réobserve rien, ne calcule aucun score, n'ouvre aucun port et n'accepte de chemin de
//! personne. Il ne regarde que les dossiers que l'utilisateur a explicitement autorisés, et n'y
//! traite qu'un document portant déjà un marqueur HumanOrigin valide.
//!
//! PROTOCOLE INCHANGÉ : engagement sha256 sur l'encodage base64 des octets EXACTS du fichier
//! enregistré, HO Evidence V1, signature Ed25519, chiffrement AES-256-GCM C2.1.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};

const LOCATOR_PREFIX: &str = "ho1";
const CUSTOM_PART: &str = "docProps/custom.xml";
const MAX_DOC_BYTES: u64 = 128 * 1024 * 1024;
// Débounce : on ne lit pas un fichier que Word vient d'écrire. Ce n'est PAS un délai
// d'éligibilité — un document reste finalisable des heures ou des jours après sa sauvegarde.
const SETTLE_MS: u64 = 1200;

// ---------------------------------------------------------------- état
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct FinalizerConfig {
    /// Dossiers explicitement autorisés par l'utilisateur. Vide = le finalizer ne lit rien.
    pub folders: Vec<String>,
    pub registry: Option<String>,
}
#[derive(Serialize, Deserialize, Default)]
struct Processed {
    done: HashMap<String, String>, // "record_id:sha256(octets)" -> horodatage
}

pub struct Finalizer {
    dir: PathBuf,
    state: Mutex<Processed>,
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn sha256_hex(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    hex(&h.finalize())
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}
fn b64u(b: &[u8]) -> String {
    general_purpose::URL_SAFE_NO_PAD.encode(b)
}
fn unb64u(s: &str) -> Option<Vec<u8>> {
    general_purpose::URL_SAFE_NO_PAD.decode(s.trim()).ok()
}

/// Engagement de fin de processus. MÊME primitive que le kernel : sha256 du texte normalisé,
/// le texte étant l'encodage base64 (bijectif) des octets du fichier.
fn commit_bytes(bytes: &[u8]) -> String {
    sha256_hex(general_purpose::STANDARD.encode(bytes).as_bytes())
}

// ---------------------------------------------------------------- lecture ciblée du paquet
/// Lit UNIQUEMENT `docProps/custom.xml`. Un document sans cette partie est écarté sans que son
/// contenu soit lu : c'est le filtre le moins intrusif possible.
fn read_custom_part(path: &Path) -> Option<String> {
    let f = fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(f).ok()?;
    let mut part = zip.by_name(CUSTOM_PART).ok()?;
    if part.size() > 1024 * 1024 {
        return None;
    }
    let mut s = String::new();
    part.read_to_string(&mut s).ok()?;
    Some(s)
}
fn prop(xml: &str, name: &str) -> Option<String> {
    let key = format!("name=\"{}\"", name);
    let i = xml.find(&key)?;
    let rest = &xml[i..];
    let a = rest.find("<vt:lpwstr>")? + "<vt:lpwstr>".len();
    let b = rest[a..].find("</vt:lpwstr>")?;
    Some(rest[a..a + b].to_string())
}

struct Marker {
    record_id: String,
    key: [u8; 32],
    facts_blob: String,
}
/// Validation stricte : version, forme du locator, longueur de clé, présence des faits.
fn parse_marker(xml: &str) -> Option<Marker> {
    let locator = prop(xml, "HOLocator")?;
    let facts_blob = prop(xml, "HOFacts")?;
    let parts: Vec<&str> = locator.split('.').collect();
    if parts.len() != 3 || parts[0] != LOCATOR_PREFIX {
        return None;
    }
    if parts[1].len() < 6 || parts[1].len() > 64
        || !parts[1].chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    let raw = unb64u(parts[2])?;
    if raw.len() != 32 {
        return None;
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&raw);
    Some(Marker { record_id: parts[1].to_string(), key, facts_blob })
}

/// Déchiffre les faits scellés par le volet. Disposition WebCrypto : iv(12) | chiffré | tag(16).
fn decrypt_facts(blob: &str, key: &[u8; 32], record_id: &str) -> Option<serde_json::Value> {
    let raw = unb64u(blob)?;
    if raw.len() < 12 + 16 {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce = Nonce::from_slice(&raw[..12]);
    let aad = format!("facts:{}", record_id);
    let pt = cipher
        .decrypt(nonce, Payload { msg: &raw[12..], aad: aad.as_bytes() })
        .ok()?;
    serde_json::from_slice(&pt).ok()
}

/// Charge scellée par le volet. Forme 1 : le tableau des faits (une seule période d'observation,
/// forme historique, inchangée). Forme 2 : `{ "schema": "ho-facts/2", "periods": [...], "facts": [...] }`
/// lorsque le document a connu plusieurs périodes d'observation.
fn split_facts(v: &serde_json::Value) -> (Vec<serde_json::Value>, Option<Vec<serde_json::Value>>) {
    match v {
        serde_json::Value::Array(a) => (a.clone(), None),
        serde_json::Value::Object(o) if o.get("schema").and_then(|s| s.as_str()) == Some("ho-facts/2") => (
            o.get("facts").and_then(|f| f.as_array()).cloned().unwrap_or_default(),
            o.get("periods").and_then(|p| p.as_array()).cloned(),
        ),
        _ => (vec![], None),
    }
}

// ---------------------------------------------------------------- dépôt au registre
fn put_record(registry: &str, record_id: &str, body: &str) -> Result<(), String> {
    // HTTPS sans ajouter de dépendance : on délègue au curl du système, présent sur macOS.
    let url = format!("{}/r/{}", registry.trim_end_matches('/'), record_id);
    let out = std::process::Command::new("/usr/bin/curl")
        .args([
            "-sS", "-m", "15", "-X", "POST",
            "-H", "content-type: application/json",
            "--data-binary", "@-",
            "-o", "/dev/null", "-w", "%{http_code}",
            &url,
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut c| {
            use std::io::Write as _;
            c.stdin.as_mut().unwrap().write_all(body.as_bytes())?;
            c.wait_with_output()
        })
        .map_err(|e| e.to_string())?;
    let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
    match code.as_str() {
        "201" | "200" | "204" => Ok(()),
        "409" => Ok(()), // ce record existe déjà : rien à refaire, et jamais de remplacement
        other => Err(format!("registre : {}", other)),
    }
}

// ---------------------------------------------------------------- dossiers de travail
/// Refuse un dossier de travail situé dans le conteneur d'une application (~/Library/Containers,
/// ~/Library/Group Containers). Examen du seul texte du chemin : aucun accès au disque.
pub fn forbidden_work_folder(folder: &str) -> Option<&'static str> {
    let parts: Vec<String> = folder.split('/').map(|s| s.to_lowercase()).collect();
    let inside = parts.windows(2).any(|w| {
        w[0] == "library" && (w[1] == "containers" || w[1] == "group containers")
    });
    if inside {
        Some("Ce dossier appartient au conteneur d'une application. Choisissez un dossier ordinaire, \
              par exemple dans Documents ou sur le Bureau.")
    } else {
        None
    }
}

// ---------------------------------------------------------------- finalisation
impl Finalizer {
    pub fn new(dir: PathBuf) -> Self {
        fs::create_dir_all(&dir).ok();
        let state = fs::read_to_string(dir.join("finalizer_state.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Finalizer { dir, state: Mutex::new(state) }
    }
    fn remember(&self, sig: String) {
        let mut st = self.state.lock().unwrap();
        st.done.insert(sig, now_rfc3339());
        let _ = fs::write(
            self.dir.join("finalizer_state.json"),
            serde_json::to_string_pretty(&*st).unwrap_or_default(),
        );
    }
    fn already(&self, sig: &str) -> bool {
        self.state.lock().unwrap().done.contains_key(sig)
    }

    pub fn config(&self) -> FinalizerConfig {
        fs::read_to_string(self.dir.join("finalizer_config.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }
    pub fn set_config(&self, cfg: &FinalizerConfig) -> Result<(), String> {
        fs::write(
            self.dir.join("finalizer_config.json"),
            serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }

    /// Traite un fichier candidat. Renvoie Some(record_id) si une preuve a été déposée.
    fn finalize_file(&self, path: &Path, registry: &str) -> Option<String> {
        let meta = fs::metadata(path).ok()?;
        if meta.len() == 0 || meta.len() > MAX_DOC_BYTES {
            return None;
        }
        // Un document encore en cours d'écriture : on attend le prochain passage. Aucune borne
        // haute — l'ancienneté n'est pas un critère d'éligibilité.
        let age = SystemTime::now().duration_since(meta.modified().ok()?).ok()?;
        if age < Duration::from_millis(SETTLE_MS) {
            return None;
        }
        let xml = read_custom_part(path)?;          // aucun autre contenu n'est lu
        let m = parse_marker(&xml)?;                 // sans marqueur valide, on s'arrête ici

        // Ce record_id a-t-il déjà donné une preuve ? On s'arrête avant tout travail coûteux,
        // quelles que soient les modifications ultérieures du document.
        if self.already(&m.record_id) {
            return None;
        }

        // Stabilité : les octets lus doivent être ceux d'un fichier qui ne bouge pas. On compare
        // taille et date de part et d'autre de la lecture ; sinon on réessaiera au prochain tour.
        let before = fs::metadata(path).ok()?;
        let bytes = fs::read(path).ok()?;
        let after = fs::metadata(path).ok()?;
        if before.len() != after.len()
            || before.len() != bytes.len() as u64
            || before.modified().ok()? != after.modified().ok()?
        {
            return None;
        }

        let sig = format!("{}:{}", m.record_id, sha256_hex(&bytes));
        if self.already(&sig) {
            return None;
        }
        let facts = decrypt_facts(&m.facts_blob, &m.key, &m.record_id)?;
        let (facts_arr, periods) = split_facts(&facts);

        // Le document envoyé ne doit pas dépendre du complément Office : la référence HumanOrigin,
        // et elle seule, est retirée du paquet AVANT la liaison. Si le fichier est remplacé, rien
        // n'est engagé maintenant : le passage suivant lie les octets réellement présents sur le
        // disque, une fois le fichier stable.
        {
            use crate::ho_docx_scrub::{scrub_file_atomic, Outcome, ScrubError, HUMANORIGIN_ADDIN_IDS};
            match scrub_file_atomic(path, &bytes, &after, HUMANORIGIN_ADDIN_IDS) {
                Ok(Outcome::NotPresent) => {}
                Ok(Outcome::Scrubbed(_)) => return None,
                Err(ScrubError::Transient(_)) => return None,
                // Structure non reconnue avec certitude : paquet laissé intact, liaison inchangée.
                Err(ScrubError::Refused(_)) => {}
            }
        }

        let commitment = commit_bytes(&bytes);
        let filename = path.file_name()?.to_string_lossy().to_string();
        let undetermined = facts_arr
            .iter()
            .filter(|f| f.get("source").and_then(|s| s.as_str()) == Some("unknown"))
            .count();

        let mut evidence = serde_json::json!({
            "schema": "ho-evidence/1.0",
            "session_id": format!("c6-{}", &m.record_id[..m.record_id.len().min(15)]),
            "object_id": filename,
            "event_count": facts_arr.len(),
            "chain_head_hash": sha256_hex(serde_json::to_string(&facts_arr).ok()?.as_bytes()),
            "final_state_commit": commitment,
            "events": facts_arr,
            "record_id": m.record_id,
            "artifact": {
                "filename": filename,
                "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "size_bytes": bytes.len(),
                "sha256": sha256_hex(&bytes)
            },
            "process_evidence": {
                "observation_method": "événements de paragraphe de l'application hôte",
                "capability": ["identité de paragraphe", "horodatage", "variation de longueur"],
                "adapter": "word-office-js",
                "observed_facts": { "recorded_changes": facts_arr.len(), "undetermined_source": undetermined },
                "blind_spots": [
                    { "fact": "l'origine d'un contenu entrant hors événement observable n'est pas déterminée" },
                    { "fact": "en-têtes, pieds de page, notes et zones de texte ne produisent pas d'événement de paragraphe" }
                ],
                "cannot_establish": [
                    { "fact": "une observation de saisie ne distingue pas la composition de la transcription" }
                ]
            },
            "final_object_binding": {
                "commitment": commitment,
                "commitment_algorithm": "sha256-over-base64-bytes",
                "computed_on": "les octets du fichier enregistré sur le disque",
                "establishes": "cette preuve engage cet artefact",
                "does_not_establish": "rien sur le contenu de l'artefact"
            },
            "causal_reconstruction": {
                "established": false,
                "measured_by": "non mesurable depuis des événements de paragraphe",
                "reason": "les faits observés décrivent des variations de paragraphes ; ils ne reconstruisent pas les octets d'un conteneur OOXML",
                "never_inferred_from": ["process_evidence", "final_object_binding"]
            },
            "limitations": [
                "une observation de saisie ne distingue pas la composition de la transcription",
                "l'exhaustivité de l'observation est déclarée par l'outil et n'est pas vérifiable indépendamment",
                "l'origine d'un contenu entrant hors événement observable n'est pas établie"
            ]
        });

        // Plusieurs périodes d'observation : elles sont reprises telles que le volet les a scellées,
        // et la preuve dit explicitement que l'intervalle entre deux périodes n'a pas été observé.
        if let Some(p) = periods {
            let several = p.len() > 1;
            evidence["process_evidence"]["observation_periods"] = serde_json::Value::Array(p);
            if several {
                if let Some(b) = evidence["process_evidence"]["blind_spots"].as_array_mut() {
                    b.push(serde_json::json!({ "fact": "entre deux périodes d'observation, le document n'a pas été observé ; ce qui s'y est passé n'est pas établi" }));
                }
                if let Some(l) = evidence["limitations"].as_array_mut() {
                    l.push(serde_json::json!("l'observation n'est pas continue : les intervalles entre les périodes d'observation n'ont pas été observés"));
                }
            }
        }

        // signature Ed25519 sur les champs de cœur
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let sk = SigningKey::from_bytes(&seed);
        let core = serde_json::json!({
            "schema": "ho-evidence/1.0",
            "session_id": evidence["session_id"],
            "object_id": evidence["object_id"],
            "event_count": evidence["event_count"],
            "chain_head_hash": evidence["chain_head_hash"],
            "final_state_commit": evidence["final_state_commit"]
        })
        .to_string();
        let sig_bytes = sk.sign(core.as_bytes());
        evidence["signature"] = serde_json::json!({
            "algorithm": "ed25519",
            "signed_field": "core_fields",
            "public_key": general_purpose::STANDARD.encode(sk.verifying_key().to_bytes()),
            "key_fingerprint": sha256_hex(&sk.verifying_key().to_bytes()),
            "signature": general_purpose::STANDARD.encode(sig_bytes.to_bytes())
        });

        // chiffrement C2.1 : le registre ne reçoit que du chiffré
        let cipher = Aes256Gcm::new_from_slice(&m.key).ok()?;
        let mut iv = [0u8; 12];
        OsRng.fill_bytes(&mut iv);
        let nonce = Nonce::from_slice(&iv);
        let pt = serde_json::to_vec(&evidence).ok()?;
        let sealed = cipher
            .encrypt(nonce, Payload { msg: &pt, aad: m.record_id.as_bytes() })
            .ok()?;
        let (ct, tag) = sealed.split_at(sealed.len() - 16);
        let record = serde_json::json!({
            "alg": "aes-256-gcm", "iv": b64u(&iv), "tag": b64u(tag), "ciphertext": b64u(ct)
        })
        .to_string();

        match put_record(registry, &m.record_id, &record) {
            Ok(()) => {
                // Deux clés : la signature exacte (octets engagés) et le record_id seul, qui
                // garantit qu'un document revu — même modifié — ne redonne jamais de preuve.
                self.remember(sig);
                self.remember(m.record_id.clone());
                Some(m.record_id)
            }
            Err(_) => None, // registre indisponible : on retentera au prochain passage
        }
    }

    /// Un passage sur les dossiers autorisés. Ne descend pas dans les sous-dossiers.
    pub fn scan_once(&self) -> Vec<String> {
        let cfg = self.config();
        let registry = cfg.registry.unwrap_or_else(|| "https://registry.humanorigin.io".to_string());
        let mut done = vec![];
        for folder in cfg.folders.iter() {
            // Un dossier situé dans le conteneur d'une application n'est jamais lu : macOS
            // redemanderait l'autorisation à chaque lancement.
            if forbidden_work_folder(folder).is_some() {
                continue;
            }
            let dir = PathBuf::from(folder);
            let entries = match fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue, // dossier non autorisé ou absent : on passe
            };
            for e in entries.flatten() {
                let p = e.path();
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if !name.ends_with(".docx") || name.starts_with("~$") {
                    continue;
                }
                if let Some(rid) = self.finalize_file(&p, &registry) {
                    done.push(rid);
                }
            }
        }
        done
    }
}

#[cfg(test)]
mod tests {
    use super::forbidden_work_folder;

    #[test]
    fn facts_payload_forms() {
        let v1 = serde_json::json!([{ "sequence": 0, "length_delta": 3 }]);
        let (f, p) = super::split_facts(&v1);
        assert_eq!(f.len(), 1);
        assert!(p.is_none());
        let v2 = serde_json::json!({ "schema": "ho-facts/2",
            "periods": [{ "period": 1 }, { "period": 2 }],
            "facts": [{ "sequence": 0, "period": 1 }, { "sequence": 1, "period": 2 }, { "sequence": 2, "period": 2 }] });
        let (f, p) = super::split_facts(&v2);
        assert_eq!((f.len(), p.map(|x| x.len())), (3, Some(2)));
        let (f, p) = super::split_facts(&serde_json::json!({ "facts": [1] }));
        assert!(f.is_empty() && p.is_none());
    }

    #[test]
    fn container_folders_are_refused() {
        assert!(forbidden_work_folder("/Users/x/Library/Containers/com.microsoft.Word/Data/Documents").is_some());
        assert!(forbidden_work_folder("/Users/x/Library/Group Containers/UBF8T346G9.Office").is_some());
        assert!(forbidden_work_folder("/Users/x/library/containers/foo").is_some());
        assert!(forbidden_work_folder("/Users/x/Desktop/human origin test ").is_none());
        assert!(forbidden_work_folder("/Users/x/Documents/Library/Notes").is_none());
    }
}
