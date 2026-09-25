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
// Seule destination possible pour ce build. Défaut production ; un build RC la remplace à la
// COMPILATION. Aucune valeur d'exécution, aucun fichier de configuration, aucun hôte arbitraire.
const REGISTRY_URL: &str = match option_env!("HO_REGISTRY_URL") {
    Some(v) => v,
    None => "https://registry.humanorigin.io",
};
// Débounce : on ne lit pas un fichier que Word vient d'écrire. Ce n'est PAS un délai
// d'éligibilité — un document reste finalisable des heures ou des jours après sa sauvegarde.
const SETTLE_MS: u64 = 1200;

// ---------------------------------------------------------------- état
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct FinalizerConfig {
    /// Dossiers explicitement autorisés par l'utilisateur. Vide = le finalizer ne lit rien.
    pub folders: Vec<String>,
    /// Conservé pour que les configurations existantes se désérialisent. PLUS JAMAIS LU :
    /// la destination est compilée. Voir REGISTRY_URL.
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

/// Accès de banc : ho_version doit prouver qu'il emploie LA MÊME primitive. Deux
/// engagements calculés différemment rendraient la relation V1→V2 invérifiable.
#[cfg(test)]
pub(crate) fn commit_bytes_pour_test(bytes: &[u8]) -> String {
    commit_bytes(bytes)
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
/// Écrit un fichier d'en-têtes lisible du seul propriétaire, dans un répertoire lui-même
/// restreint. La capability ne doit apparaître NI dans argv — donc visible par `ps` —, ni
/// dans un journal. `curl -H @fichier` est la seule voie qui évite la ligne de commande.
fn fichier_entetes(capability: &str) -> Result<(PathBuf, PathBuf), String> {
    use std::io::Write as _;
    let mut dir = std::env::temp_dir();
    let mut alea = [0u8; 12];
    OsRng.fill_bytes(&mut alea);
    dir.push(format!("ho-hdr-{}", hex(&alea)));
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let f = dir.join("h");
    let mut h = fs::File::create(&f).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        h.set_permissions(fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    writeln!(h, "authorization: Bearer {}", capability).map_err(|e| e.to_string())?;
    writeln!(h, "content-type: application/json").map_err(|e| e.to_string())?;
    h.sync_all().map_err(|e| e.to_string())?;
    Ok((dir, f))
}

fn put_record(registry: &str, record_id: &str, body: &str, capability: &str) -> Result<(), String> {
    // HTTPS sans ajouter de dépendance : on délègue au curl du système, présent sur macOS.
    let url = format!("{}/r/{}", registry.trim_end_matches('/'), record_id);
    let (dir, entetes) = fichier_entetes(capability)?;
    let arg_entetes = format!("@{}", entetes.to_string_lossy());
    let out = std::process::Command::new("/usr/bin/curl")
        .args([
            "-sS", "-m", "15", "-X", "POST",
            "-H", &arg_entetes,
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
        .map_err(|e| e.to_string());
    // Le fichier d'en-têtes disparaît quel que soit l'issue de l'appel.
    let _ = fs::remove_dir_all(&dir);
    let out = out?;
    let code = String::from_utf8_lossy(&out.stdout).trim().to_string();
    match code.as_str() {
        "201" | "200" | "204" => Ok(()),
        "409" => Ok(()), // ce record existe déjà : rien à refaire, et jamais de remplacement
        // Le code seul remonte : jamais la capability, jamais le corps de la réponse.
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
/// Le seul état qui autorise à engager le document : aucune référence HumanOrigin ne subsiste
/// dans le paquet tel qu'il est sur le disque.
///
/// Un scrub REFUSÉ — structure partagée avec un autre complément — laisse le paquet intact, donc
/// porteur de la référence au complément HumanOrigin. Engager ce fichier reviendrait à sceller un
/// objet qui dépend encore du complément : on refuse, et la finalisation s'arrête sans liaison,
/// sans Record, sans succès, sans renommage. Un scrub RÉUSSI a réécrit le fichier : la liaison
/// attendra le passage suivant, sur les octets réellement présents.
pub(crate) fn binding_allowed(
    outcome: &Result<crate::ho_docx_scrub::Outcome, crate::ho_docx_scrub::ScrubError>,
) -> bool {
    matches!(outcome, Ok(crate::ho_docx_scrub::Outcome::NotPresent))
}

/// Construit le Record V1 — tout sauf la signature, qui dépend d'un aléa.
///
/// Fonction PURE : mêmes entrées, même sortie, aucune entrée-sortie, aucun aléa. C'est
/// ce qui la rend testable, et c'est la seule raison de l'avoir extraite de
/// `finalize_file`. Le contrat de référence est `record_synthetic.json` du banc Verify.
///
/// Les identifiants sont stables et accompagnent une prose INCHANGÉE : ils portent le
/// sens, le texte reste ce qu'il était. Aucun identifiant n'est dérivé du texte.
fn build_record_v1(
    record_id: &str,
    filename: &str,
    bytes_len: usize,
    bytes_sha256: &str,
    commitment: &str,
    facts_arr: Vec<serde_json::Value>,
    periods: Option<&[serde_json::Value]>,
    lineage: Option<&serde_json::Value>,
) -> serde_json::Value {
    let undetermined = facts_arr
        .iter()
        .filter(|f| f.get("source").and_then(|s| s.as_str()) == Some("unknown"))
        .count();
    let chain_head = sha256_hex(
        serde_json::to_string(&facts_arr)
            .unwrap_or_default()
            .as_bytes(),
    );
    let event_count = facts_arr.len();

    let mut evidence = serde_json::json!({
        "schema": "ho-evidence/1.0",
        "session_id": format!("c6-{}", &record_id[..record_id.len().min(15)]),
        "object_id": filename,
        "event_count": event_count,
        "chain_head_hash": chain_head,
        "final_state_commit": commitment,
        "events": facts_arr,
        "record_id": record_id,
        "artifact": {
            "filename": filename,
            "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "size_bytes": bytes_len,
            "sha256": bytes_sha256
        },
        "process_evidence": {
            "observation_method": "événements de paragraphe de l'application hôte",
            "capability": ["identité de paragraphe", "horodatage", "variation de longueur"],
            "capability_ids": [
                "process.capability.paragraphIdentity",
                "process.capability.timestamping",
                "process.capability.lengthVariation"
            ],
            "adapter": "word-office-js",
            "observed_facts": { "recorded_changes": event_count, "undetermined_source": undetermined },
            "blind_spots": [
                { "fact_id": "process.blindSpot.nonObservableIngressOrigin",
                  "fact": "l'origine d'un contenu entrant hors événement observable n'est pas déterminée" },
                { "fact_id": "process.blindSpot.nonParagraphRegions",
                  "fact": "en-têtes, pieds de page, notes et zones de texte ne produisent pas d'événement de paragraphe" }
            ],
            "cannot_establish": [
                { "fact_id": "process.cannotEstablish.composedVsRetyped",
                  "fact": "une observation de saisie ne distingue pas la composition de la transcription" }
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
        ],
        "limitation_ids": [
            "process.limitation.composedVsRetyped",
            "process.limitation.completenessNotIndependentlyVerifiable",
            "process.limitation.nonObservableIngressOrigin"
        ]
    });

    // Plusieurs périodes d'observation : elles sont reprises telles que le volet les a scellées,
    // et la preuve dit explicitement que l'intervalle entre deux périodes n'a pas été observé.
    if let Some(p) = periods {
        let several = p.len() > 1;
        evidence["process_evidence"]["observation_periods"] = serde_json::Value::Array(p.to_vec());
        if several {
            if let Some(b) = evidence["process_evidence"]["blind_spots"].as_array_mut() {
                b.push(serde_json::json!({
                    "fact_id": "process.blindSpot.betweenObservationPeriods",
                    "fact": "entre deux périodes d'observation, le document n'a pas été observé ; ce qui s'y est passé n'est pas établi"
                }));
            }
            // La prose et son identifiant sont ajoutés ENSEMBLE : les deux tableaux ne
            // doivent jamais se désaligner, sous peine de rendre un sens à un autre texte.
            if let Some(l) = evidence["limitations"].as_array_mut() {
                l.push(serde_json::json!("l'observation n'est pas continue : les intervalles entre les périodes d'observation n'ont pas été observés"));
            }
            if let Some(l) = evidence["limitation_ids"].as_array_mut() {
                l.push(serde_json::json!("process.limitation.observationNotContinuous"));
            }
        }
    }

    // Versioning V1. Le lineage est OPTIONNEL : sans lui, ce Record est exactement celui
    // qu'il aurait été avant l'existence du versioning. Avec lui, la preuve dit d'où vient
    // ce qu'elle n'a pas observé — et le dit comme une déclaration, pas comme un constat.
    if let Some(vl) = lineage {
        evidence["version_lineage"] = vl.clone();

        let mut blind = vec![serde_json::json!({
            "fact_id": "process.blindSpot.inheritedBaselineNotObserved",
            "fact": "le contenu hérité de la version précédente n'a pas été observé dans cette version ; son origine n'est pas déterminée ici"
        })];

        // Écart temporel entre la création de cette version et le début de la première
        // période observée. On ne prétend RIEN sur ce qui s'y est passé.
        let cree_a = vl["initial_state"]["measured_at"].as_str().unwrap_or_default().to_string();
        let debut = periods
            .and_then(|p| p.first())
            .and_then(|p| p.get("started_at").and_then(|x| x.as_str()))
            .map(|s| s.to_string())
            .or_else(|| evidence["events"].as_array()
                .and_then(|e| e.first())
                .and_then(|e| e.get("at").and_then(|x| x.as_str()))
                .map(|s| s.to_string()));
        if !cree_a.is_empty() {
            if let Some(d) = debut {
                blind.push(serde_json::json!({
                    "fact_id": "process.blindSpot.betweenVersionCreationAndObservation",
                    "fact": "entre la création de cette version et le début de l'observation, le document n'a pas été observé ; ce qui s'y est passé n'est pas établi",
                    "from": cree_a,
                    "to": d
                }));
            }
        }

        // L'état source ne correspondait pas à ce que la version précédente avait engagé.
        // `null` n'est PAS `false` : une correspondance indéterminée n'ajoute rien.
        if vl["source_matches_predecessor_final_state"] == serde_json::Value::Bool(false) {
            blind.push(serde_json::json!({
                "fact_id": "process.blindSpot.sourceDivergedFromPredecessorFinalState",
                "fact": "l'état source ne correspondait pas à l'état final engagé par la version précédente ; ce qui a changé entre les deux n'a pas été observé"
            }));
        }

        if let Some(b) = evidence["process_evidence"]["blind_spots"].as_array_mut() {
            b.extend(blind);
        }
        // Prose et identifiant poussés ENSEMBLE : les deux tableaux ne doivent jamais se
        // désaligner, sous peine de rendre un sens à un autre texte.
        if let Some(l) = evidence["limitations"].as_array_mut() {
            l.push(serde_json::json!("la relation avec la version précédente est déclarée par cette preuve ; elle n'est établie que si la version précédente est fournie au vérificateur"));
        }
        if let Some(l) = evidence["limitation_ids"].as_array_mut() {
            l.push(serde_json::json!("process.limitation.versionRelationDeclaredNotEstablished"));
        }
    }

    evidence
}

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
        // Sans capability, aucune publication : le dépôt anonyme n'existe plus. On s'arrête
        // avant tout travail coûteux, et le document sera repris au prochain passage si la
        // capability réapparaît — par exemple après une ré-émission.
        let capability = crate::ho_capability::lire(&m.record_id)?;

        let facts = decrypt_facts(&m.facts_blob, &m.key, &m.record_id)?;
        let (facts_arr, periods) = split_facts(&facts);

        // Le document envoyé ne doit pas dépendre du complément Office : la référence HumanOrigin,
        // et elle seule, est retirée du paquet AVANT la liaison. Si le fichier est remplacé, rien
        // n'est engagé maintenant : le passage suivant lie les octets réellement présents sur le
        // disque, une fois le fichier stable.
        {
            use crate::ho_docx_scrub::{scrub_file_atomic, HUMANORIGIN_ADDIN_IDS};
            if !binding_allowed(&scrub_file_atomic(path, &bytes, &after, HUMANORIGIN_ADDIN_IDS)) {
                return None;
            }
        }

        let commitment = commit_bytes(&bytes);
        let filename = path.file_name()?.to_string_lossy().to_string();
        let undetermined = facts_arr
            .iter()
            .filter(|f| f.get("source").and_then(|s| s.as_str()) == Some("unknown"))
            .count();

        let mut evidence = build_record_v1(
            &m.record_id,
            &filename,
            bytes.len(),
            &sha256_hex(&bytes),
            &commitment,
            facts_arr,
            periods.as_deref(),
            crate::ho_version::lire_sidecar(&self.dir, &m.record_id).as_ref(),
        );

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

        match put_record(registry, &m.record_id, &record, &capability) {
            Ok(()) => {
                // Deux clés : la signature exacte (octets engagés) et le record_id seul, qui
                // garantit qu'un document revu — même modifié — ne redonne jamais de preuve.
                self.remember(sig);
                self.remember(m.record_id.clone());
                // Le lineage a rempli son office : il est DANS la preuve, définitivement.
                // Le garder sur disque n'ajouterait rien et laisserait traîner un état.
                crate::ho_version::oublier_sidecar(&self.dir, &m.record_id);
                Some(m.record_id)
            }
            Err(_) => None, // registre indisponible : on retentera au prochain passage
        }
    }

    /// Documents HumanOrigin FINALISÉS et actuellement ouverts dans Word, parmi les seuls
    /// dossiers autorisés.
    ///
    /// « Ouvert » est déduit du fichier de verrou que Word pose à côté du document :
    /// `~$` suivi du nom privé de ses deux premiers caractères. C'est un indice, pas une
    /// certitude — Word peut laisser un verrou après un arrêt brutal. Il n'a donc aucune
    /// conséquence : il ne fait que proposer, l'utilisateur décide.
    ///
    /// « Finalisé » n'est PAS déduit de la présence d'un marqueur : il faut que la preuve
    /// ait réellement été déposée, ce que l'état local sait. Proposer de versionner un
    /// document dont rien n'est publié n'aurait aucun sens.
    ///
    /// Le chemin n'est jamais rendu à l'interface : seul un identifiant opaque l'est.
    pub fn documents_versionnables(&self) -> Vec<serde_json::Value> {
        let cfg = self.config();
        let mut out = vec![];
        for folder in cfg.folders.iter() {
            let dir = PathBuf::from(folder);
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for e in entries.flatten() {
                let p = e.path();
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if !name.ends_with(".docx") || name.starts_with("~$") {
                    continue;
                }
                let Some(xml) = read_custom_part(&p) else { continue };
                let Some(m) = parse_marker(&xml) else { continue };
                if !self.already(&m.record_id) {
                    continue; // aucune preuve déposée : rien à versionner
                }
                if name.chars().count() < 2 {
                    continue;
                }
                let verrou: String = format!("~${}", name.chars().skip(2).collect::<String>());
                if !dir.join(&verrou).exists() {
                    continue; // pas ouvert dans Word
                }
                out.push(serde_json::json!({
                    "record_id": m.record_id,
                    "name": name.trim_end_matches(".docx"),
                }));
            }
        }
        out
    }

    /// Le document versionnable désigné par son `record_id`, dans les dossiers autorisés.
    /// Rend `None` si aucun, ou si plusieurs fichiers portent le même identifiant — une
    /// ambiguïté ne se tranche pas au hasard.
    pub fn chemin_versionnable(&self, record_id: &str) -> Option<PathBuf> {
        let cfg = self.config();
        let mut trouve: Option<PathBuf> = None;
        for folder in cfg.folders.iter() {
            let Ok(entries) = fs::read_dir(PathBuf::from(folder)) else { continue };
            for e in entries.flatten() {
                let p = e.path();
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if !name.ends_with(".docx") || name.starts_with("~$") {
                    continue;
                }
                let Some(xml) = read_custom_part(&p) else { continue };
                let Some(m) = parse_marker(&xml) else { continue };
                if m.record_id != record_id {
                    continue;
                }
                if trouve.is_some() {
                    return None; // deux fichiers, même identifiant : on refuse
                }
                trouve = Some(p);
            }
        }
        trouve
    }

    /// L'état local se souvient de `record_id:sha256(octets)` au moment du dépôt. Comparer
    /// à cette empreinte dit si la source est encore ce qui avait été scellé.
    /// `None` quand l'état local ne connaît pas ce Record : indéterminé n'est pas « modifié ».
    pub fn correspond_a_l_etat_depose(&self, record_id: &str, bytes: &[u8]) -> Option<bool> {
        let etat = self.state.lock().ok()?;
        let prefixe = format!("{}:", record_id);
        let connue = etat.done.keys().any(|k| k.starts_with(&prefixe));
        if !connue {
            return None;
        }
        Some(etat.done.contains_key(&format!("{}:{}", record_id, sha256_hex(bytes))))
    }

    /// Un passage sur les dossiers autorisés. Ne descend pas dans les sous-dossiers.
    pub fn scan_once(&self) -> Vec<String> {
        let cfg = self.config();
        // Destination COMPILÉE. Un build de production ne peut viser que l'URL canonique, un
        // build RC que son URL locale. `cfg.registry` n'est plus lu : une écriture dans
        // finalizer_config.json ne peut plus rediriger les dépôts vers un hôte arbitraire.
        // Ferme le P1 « Registry destination pinning ».
        let registry = REGISTRY_URL;
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
                if let Some(rid) = self.finalize_file(&p, registry) {
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

    /// INVARIANT DE DÉPLOIEMENT : un SEUL identifiant traverse toute la moitié native.
    ///
    /// Les briques étaient éprouvées séparément ; rien ne démontrait qu'il s'agit du MÊME
    /// identifiant d'un bout à l'autre. Un rollout désynchronisé publierait sous un identifiant
    /// non réservé si cette chaîne se rompait quelque part.
    #[test]
    fn un_seul_identifiant_traverse_toute_la_chaine_native() {
        const RID: &str = "HO-CHAINE7890ab";

        // 1 -> 2. L'identifiant réservé est semé dans le document, et relu depuis le paquet.
        let docx = crate::ho_word_setup::bootstrap_docx(&["/tmp/x".to_string()], RID).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(docx)).unwrap();
        let mut custom = String::new();
        {
            use std::io::Read as _;
            z.by_name("docProps/custom.xml").unwrap().read_to_string(&mut custom).unwrap();
        }
        let seme = super::prop(&custom, "HOReservedId").expect("HOReservedId present");
        assert_eq!(seme, RID, "le document porte exactement l'identifiant reserve");

        // 2 -> 3. Le volet compose le locator à partir de cet identifiant, et de lui seul.
        // Le document finalisé porte alors HOLocator et HOFacts.
        let cle = [7u8; 32];
        let locator = format!("ho1.{}.{}", seme, super::b64u(&cle));
        let xml = format!(
            "<p name=\"HOLocator\"><vt:lpwstr>{}</vt:lpwstr></p>\
             <p name=\"HOFacts\"><vt:lpwstr>blob</vt:lpwstr></p>",
            locator);

        // 3 -> 4. Le finalizer relit le locator : c'est CET identifiant qui sert de clé au
        // trousseau, jamais un autre, et jamais une valeur dérivée du texte du document.
        let m = super::parse_marker(&xml).expect("marqueur lisible");
        assert_eq!(m.record_id, RID, "le finalizer relit exactement l'identifiant seme");
        assert!(crate::ho_capability::record_id_valide(&m.record_id),
            "la cle du trousseau est cet identifiant");

        // 4 -> 5. L'URL du dépôt est bâtie sur ce même identifiant. Contrôle de SOURCE :
        // l'envoi réel exige le réseau, mais la construction de l'URL et l'argument passé
        // au point d'appel sont vérifiables ici.
        let src = include_str!("ho_finalizer.rs");
        assert!(src.contains("let url = format!(\"{}/r/{}\", registry.trim_end_matches('/'), record_id);"),
            "l'URL est batie sur le record_id recu");
        assert!(src.contains("match put_record(registry, &m.record_id, &record, &capability)"),
            "le point d'appel passe l'identifiant du marqueur, et pas un autre");
        assert!(src.contains("let capability = crate::ho_capability::lire(&m.record_id)?;"),
            "la capability est lue sous ce meme identifiant, avant tout travail");
    }

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

    // ---------------------------------------------------------------- contrat Record V1
    // Référence : record_synthetic.json du banc Verify. Les identifiants sont stables et
    // accompagnent une prose inchangée. Aucun identifiant dérivé du texte.

    fn rec(periods: Option<Vec<serde_json::Value>>) -> serde_json::Value {
        rec_avec(periods, None)
    }

    /// Le même Record, éventuellement accompagné d'un lineage de version. Sans lineage,
    /// le Record doit rester EXACTEMENT celui d'avant l'existence du versioning.
    fn rec_avec(
        periods: Option<Vec<serde_json::Value>>,
        lineage: Option<serde_json::Value>,
    ) -> serde_json::Value {
        let faits = vec![
            serde_json::json!({ "sequence": 0, "source": "local_editing", "length_delta": 8,
                                "at": "2026-09-25T10:00:00.000Z" }),
            serde_json::json!({ "sequence": 1, "source": "unknown", "length_delta": 0,
                                "at": "2026-09-25T10:00:05.000Z" }),
        ];
        super::build_record_v1(
            "HO-CONTRAT000001",
            "contrat.docx",
            123456,
            "aa".repeat(32).as_str(),
            "bb".repeat(32).as_str(),
            faits,
            periods.as_deref(),
            lineage.as_ref(),
        )
    }

    fn lineage_de_test(correspondance: Option<bool>) -> serde_json::Value {
        crate::ho_version::lineage(
            "HO-PREDECESSEUR1", "aa".repeat(32).as_str(), "2026-09-25T09:00:00.000Z",
            "cc".repeat(32).as_str(), "2026-09-25T09:00:02.000Z", correspondance)
    }
    fn ids(v: &serde_json::Value, chemin: &str, champ: &str) -> Vec<String> {
        v[chemin].as_array().map(|a| a.iter()
            .filter_map(|x| x.get(champ).and_then(|y| y.as_str()).map(String::from))
            .collect()).unwrap_or_default()
    }

    /// NON-RÉGRESSION. Sans sidecar, le Record doit être EXACTEMENT celui d'avant le
    /// versioning : ni champ nouveau, ni blind spot nouveau, ni limitation nouvelle.
    #[test]
    fn sans_lineage_le_record_est_inchange() {
        let r = rec(None);
        assert!(r.get("version_lineage").is_none(), "version_lineage apparaît sans sidecar");
        let bs = ids(&r["process_evidence"], "blind_spots", "fact_id");
        assert_eq!(bs.len(), 2, "le nombre de blind spots a changé : {:?}", bs);
        assert!(!bs.iter().any(|x| x.contains("Version") || x.contains("inheritedBaseline")));
        assert_eq!(r["limitations"].as_array().unwrap().len(), 3);
        assert_eq!(r["limitation_ids"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn avec_lineage_la_preuve_dit_ce_qu_elle_n_a_pas_observe() {
        let r = rec_avec(None, Some(lineage_de_test(Some(true))));
        assert_eq!(r["version_lineage"]["schema"], "ho-version-lineage/1");
        assert_eq!(r["version_lineage"]["baseline"]["observed"], serde_json::json!(false));
        assert_eq!(r["version_lineage"]["predecessor_record_id"], "HO-PREDECESSEUR1");

        let bs = ids(&r["process_evidence"], "blind_spots", "fact_id");
        assert!(bs.contains(&"process.blindSpot.inheritedBaselineNotObserved".to_string()),
            "la baseline héritée n'est pas déclarée non observée : {:?}", bs);
        assert!(r["limitation_ids"].as_array().unwrap().iter()
            .any(|x| x == "process.limitation.versionRelationDeclaredNotEstablished"),
            "la relation n'est pas déclarée non établie");
        assert_eq!(r["limitations"].as_array().unwrap().len(),
                   r["limitation_ids"].as_array().unwrap().len(),
                   "prose et identifiants désalignés");
    }

    /// L'intervalle entre la création de la version et le début de l'observation est
    /// déclaré non observé, avec ses deux bornes — sans rien affirmer de son contenu.
    #[test]
    fn l_intervalle_avant_observation_est_declare() {
        let r = rec_avec(None, Some(lineage_de_test(Some(true))));
        let bs = r["process_evidence"]["blind_spots"].as_array().unwrap().clone();
        let t = bs.iter().find(|b| b["fact_id"] == "process.blindSpot.betweenVersionCreationAndObservation")
            .expect("blind spot temporel absent");
        assert_eq!(t["from"], "2026-09-25T09:00:02.000Z");
        assert_eq!(t["to"], "2026-09-25T10:00:00.000Z", "la borne haute n'est pas le premier événement");
        let prose = t["fact"].as_str().unwrap();
        assert!(!prose.contains("aucune modification") && !prose.contains("rien n'a changé"),
            "l'intervalle prétend quelque chose : {}", prose);
    }

    /// CONTRÔLE NÉGATIF DÉCISIF. `false` ajoute le blind spot de divergence ; `null`, qui
    /// signifie « indéterminé », ne doit RIEN ajouter — sans quoi une comparaison
    /// impossible se lirait comme une divergence constatée.
    #[test]
    fn indetermine_n_ajoute_aucune_divergence() {
        let divergent = "process.blindSpot.sourceDivergedFromPredecessorFinalState".to_string();

        let faux = rec_avec(None, Some(lineage_de_test(Some(false))));
        assert!(ids(&faux["process_evidence"], "blind_spots", "fact_id").contains(&divergent),
            "une source divergente n'est pas signalée");

        let nul = rec_avec(None, Some(lineage_de_test(None)));
        assert!(!ids(&nul["process_evidence"], "blind_spots", "fact_id").contains(&divergent),
            "indéterminé a été rendu comme une divergence");
        assert_eq!(nul["version_lineage"]["source_matches_predecessor_final_state"],
                   serde_json::Value::Null);

        let vrai = rec_avec(None, Some(lineage_de_test(Some(true))));
        assert!(!ids(&vrai["process_evidence"], "blind_spots", "fact_id").contains(&divergent));
    }

    /// Le versioning ne doit pas déplacer les faits du Record : cœur signé et champs
    /// historiques restent identiques, lineage ou non.
    #[test]
    fn le_lineage_ne_touche_a_rien_d_autre() {
        let sans = rec(None);
        let avec = rec_avec(None, Some(lineage_de_test(Some(true))));
        for champ in ["schema", "session_id", "object_id", "event_count",
                      "chain_head_hash", "final_state_commit", "record_id", "events",
                      "artifact", "causal_reconstruction", "final_object_binding"] {
            assert_eq!(sans[champ], avec[champ], "le champ « {} » a changé", champ);
        }
    }

    fn textes(v: &serde_json::Value, champ: &str) -> Vec<String> {
        v[champ].as_array().unwrap().iter()
            .map(|x| x.as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn capability_ids_accompagnent_les_capacites() {
        let r = rec(None);
        let pe = &r["process_evidence"];
        let caps = textes(pe, "capability");
        let ids = textes(pe, "capability_ids");
        assert_eq!(caps.len(), ids.len(), "un identifiant par capacité, même ordre");
        assert_eq!(ids, vec![
            "process.capability.paragraphIdentity",
            "process.capability.timestamping",
            "process.capability.lengthVariation",
        ]);
        // La prose reste celle du contrat.
        assert_eq!(caps, vec!["identité de paragraphe", "horodatage", "variation de longueur"]);
    }

    #[test]
    fn blind_spots_portent_un_fact_id() {
        let r = rec(None);
        let bs = r["process_evidence"]["blind_spots"].as_array().unwrap().clone();
        let ids: Vec<&str> = bs.iter().map(|b| b["fact_id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec![
            "process.blindSpot.nonObservableIngressOrigin",
            "process.blindSpot.nonParagraphRegions",
        ]);
        assert!(bs.iter().all(|b| b["fact"].as_str().map(|x| !x.is_empty()).unwrap_or(false)),
            "chaque angle mort garde sa prose");
    }

    #[test]
    fn cannot_establish_porte_un_fact_id() {
        let r = rec(None);
        let ce = r["process_evidence"]["cannot_establish"].as_array().unwrap().clone();
        assert_eq!(ce.len(), 1);
        assert_eq!(ce[0]["fact_id"].as_str().unwrap(), "process.cannotEstablish.composedVsRetyped");
        assert_eq!(ce[0]["fact"].as_str().unwrap(),
            "une observation de saisie ne distingue pas la composition de la transcription");
    }

    #[test]
    fn limitation_ids_accompagnent_les_limitations() {
        let r = rec(None);
        let lim = textes(&r, "limitations");
        let ids = textes(&r, "limitation_ids");
        assert_eq!(lim.len(), ids.len(), "un identifiant par limitation, même ordre");
        assert_eq!(ids, vec![
            "process.limitation.composedVsRetyped",
            "process.limitation.completenessNotIndependentlyVerifiable",
            "process.limitation.nonObservableIngressOrigin",
        ]);
    }

    #[test]
    fn plusieurs_periodes_ajoutent_des_elements_identifies() {
        let p = vec![serde_json::json!({ "period": 1 }), serde_json::json!({ "period": 2 })];
        let r = rec(Some(p));
        let bs = r["process_evidence"]["blind_spots"].as_array().unwrap().clone();
        let lim = textes(&r, "limitations");
        let ids_lim = textes(&r, "limitation_ids");
        assert_eq!(bs.len(), 3, "un angle mort de plus");
        assert_eq!(lim.len(), 4, "une limitation de plus");
        assert_eq!(lim.len(), ids_lim.len(), "l'alignement survit à l'ajout");
        // L'élément ajouté doit lui aussi porter une identité stable.
        assert_eq!(bs[2]["fact_id"].as_str().unwrap(), "process.blindSpot.betweenObservationPeriods");
        assert_eq!(ids_lim[3], "process.limitation.observationNotContinuous");
    }

    #[test]
    fn une_seule_periode_n_ajoute_rien() {
        let p = vec![serde_json::json!({ "period": 1 })];
        let r = rec(Some(p));
        assert_eq!(r["process_evidence"]["blind_spots"].as_array().unwrap().len(), 2);
        assert_eq!(textes(&r, "limitations").len(), 3);
        assert_eq!(textes(&r, "limitation_ids").len(), 3);
        assert!(r["process_evidence"]["observation_periods"].is_array(),
            "les périodes restent reprises telles quelles");
    }

    #[test]
    fn construction_deterministe() {
        assert_eq!(rec(None), rec(None), "mêmes entrées, même sortie");
        let p = vec![serde_json::json!({ "period": 1 }), serde_json::json!({ "period": 2 })];
        assert_eq!(rec(Some(p.clone())), rec(Some(p)));
    }

    #[test]
    fn aucun_identifiant_derive_du_texte() {
        let r = rec(None);
        let tous: Vec<String> = textes(&r["process_evidence"], "capability_ids")
            .into_iter()
            .chain(textes(&r, "limitation_ids"))
            .collect();
        for id in &tous {
            assert!(id.starts_with("process."), "espace de noms stable : {}", id);
            assert!(!id.contains(' '), "un identifiant n'est pas une phrase : {}", id);
            assert!(id.is_ascii(), "un identifiant ne porte pas d'accent : {}", id);
        }
    }

    #[test]
    fn aucune_pretention_nouvelle() {
        let r = rec(None).to_string().to_lowercase();
        for interdit in ["humain", "ai-free", "sans ia", "authentique", "certifi",
                         "human verified", "pensée originale"] {
            assert!(!r.contains(interdit), "prétention interdite : {}", interdit);
        }
    }

    #[test]
    fn le_coeur_signe_reste_intact() {
        let r = rec(None);
        // Les six champs de cœur sont ceux que la signature engage : leur forme ne bouge pas.
        assert_eq!(r["schema"].as_str().unwrap(), "ho-evidence/1.0");
        assert_eq!(r["event_count"].as_u64().unwrap(), 2);
        assert_eq!(r["chain_head_hash"].as_str().unwrap().len(), 64);
        assert_eq!(r["final_state_commit"].as_str().unwrap(), "bb".repeat(32));
        assert!(r["session_id"].as_str().unwrap().starts_with("c6-"));
        assert_eq!(r["object_id"].as_str().unwrap(), "contrat.docx");
    }

    // ---------------------------------------------------------------- capability
    #[test]
    fn le_fichier_d_entetes_est_restreint_et_ephemere() {
        let cap = "ZmFrZS1jYXBhYmlsaXR5LXBvdXItbGUtdGVzdA";
        let (dir, f) = super::fichier_entetes(cap).unwrap();
        let contenu = std::fs::read_to_string(&f).unwrap();
        assert!(contenu.contains("authorization: Bearer "), "l'en-tête est posé");
        assert!(contenu.contains("content-type: application/json"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600,
                "lisible du seul propriétaire");
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700,
                "répertoire restreint lui aussi");
        }
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(!f.exists(), "le fichier disparaît avec son répertoire");
    }

    #[test]
    fn la_capability_ne_passe_jamais_par_argv() {
        // Invariant de source : l'appel à curl ne doit porter QUE la référence au fichier
        // d'en-têtes. Un « Bearer » construit dans les arguments serait visible par `ps`.
        let src = include_str!("ho_finalizer.rs");
        let i = src.find("Command::new(\"/usr/bin/curl\")").expect("appel curl");
        let bloc = &src[i..i + 400];
        assert!(!bloc.contains("Bearer"), "aucun Bearer dans les arguments de curl");
        assert!(bloc.contains("&arg_entetes"), "seule la référence au fichier est passée");
    }

    #[test]
    fn la_capability_n_apparait_dans_aucun_message() {
        // Le message d'erreur ne porte que le code HTTP : ni la capability, ni le corps de
        // la réponse, ni l'URL. Contrôle de source, faute de pouvoir provoquer un refus ici.
        let src = include_str!("ho_finalizer.rs");
        let i = src.find("match code.as_str()").expect("aiguillage du code HTTP");
        // Commentaires retirés : ils parlent de la capability, le CODE ne doit pas la porter.
        let bloc: String = src[i..i + 400]
            .lines()
            .map(|l| l.split("//").next().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(bloc.contains("format!(\"registre : {}\", other)"),
            "le message ne joint que le code");
        assert!(!bloc.contains("capability"), "la capability n'entre dans aucun message");
        assert!(!bloc.contains("stdout"), "le corps de la réponse ne remonte pas");
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

// ---------------------------------------------------------------- E2E d'écriture authentifiée
/// Banc de bout en bout : capability -> trousseau -> finalizer réel -> handler Registry
/// sécurisé -> 201, puis rejeu -> 409.
///
/// Il n'est pas joué par `cargo test` ordinaire : il exige node, le dépôt du registre et
/// une écriture réelle dans le trousseau. On le lance explicitement :
///
///   HO_REGISTRY_DIR=/chemin/vers/registry cargo test --ignored e2e_ecriture_authentifiee
///
/// CE QU'IL DISCRIMINE. L'ancien `put_record` n'émettait aucun en-tête d'autorisation :
/// le handler sécurisé répond 401, `put_record` rend Err, le banc échoue. Aucune assertion
/// sur la source ne le remplace — c'est la requête réellement émise qui est jugée.
#[cfg(test)]
mod e2e_registre {
    use super::*;
    use std::io::{BufRead as _, BufReader};

    const RECORD_ID: &str = "HO-E2EAUTH000001";
    const PORT: u16 = 18444;

    fn depot_registre() -> PathBuf {
        if let Ok(d) = std::env::var("HO_REGISTRY_DIR") {
            let p = PathBuf::from(d);
            assert!(p.join("netlify/functions/capability.mjs").exists(),
                "HO_REGISTRY_DIR ne désigne pas le dépôt du registre : {}", p.display());
            return p;
        }
        for c in ["/private/tmp/rwa/registry", "/tmp/rwa/registry"] {
            let p = PathBuf::from(c);
            if p.join("netlify/functions/capability.mjs").exists() { return p; }
        }
        panic!("dépôt du registre introuvable : renseigner HO_REGISTRY_DIR");
    }

    fn corps_conforme() -> String {
        // alg, iv(16), tag(22), ciphertext — la forme qu'exige le schéma du registre.
        serde_json::json!({ "alg": "aes-256-gcm", "iv": "A".repeat(16),
                            "tag": "B".repeat(22), "ciphertext": "Q2hpZmZyZS1FMkU" }).to_string()
    }

    #[test]
    #[ignore]
    fn e2e_ecriture_authentifiee_vers_registre_securise() {
        let reg = depot_registre();
        let racine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");

        // 1. Capability émise par le même énoncé canonique que le registre. Le porteur
        //    arrive par un pipe : ni argv, ni disque, ni journal.
        let out = std::process::Command::new("node")
            .arg(racine.join("tools/rc/e2e_capability.mjs"))
            .arg(&reg).arg(RECORD_ID)
            .output().expect("émetteur de capability");
        assert!(out.status.success(), "émetteur en échec");
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).expect("JSON de l'émetteur");
        let pub_b64 = v["pub"].as_str().unwrap().to_string();
        let capability = v["capability"].as_str().unwrap().to_string();

        // 2. Registre RC : le handler de PRODUCTION, qui ne reçoit que la clé publique.
        let mut srv = std::process::Command::new("node")
            .current_dir(&reg)
            .args(["rc_local_server.mjs", "--key", &pub_b64, "--port", &PORT.to_string()])
            .stdout(std::process::Stdio::piped())
            .spawn().expect("registre RC");
        {
            let mut lignes = BufReader::new(srv.stdout.as_mut().unwrap()).lines();
            let mut pret = false;
            for _ in 0..40 {
                match lignes.next() {
                    Some(Ok(l)) if l.contains("registre RC") => { pret = true; break; }
                    Some(Ok(_)) => continue,
                    _ => break,
                }
            }
            assert!(pret, "le registre RC n'a pas démarré");
        }
        let url = format!("http://127.0.0.1:{}", PORT);
        let fin = |mut s: std::process::Child| { let _ = s.kill(); let _ = s.wait();
                                                 crate::ho_capability::oublier(RECORD_ID); };

        // 3. Trousseau : le contrat canonique, service humanorigin.registry-write.v1.
        crate::ho_capability::oublier(RECORD_ID);
        if let Err(e) = crate::ho_capability::stocker(RECORD_ID, &capability) {
            fin(srv); panic!("trousseau indisponible : {}", e);
        }

        // 4. Sans capability, AUCUNE requête : c'est la lecture du trousseau qui décide.
        let relu = crate::ho_capability::lire(RECORD_ID);
        if relu.as_deref() != Some(capability.as_str()) { fin(srv); panic!("relecture du trousseau"); }
        if crate::ho_capability::lire("HO-JAMAISRESERVE").is_some() {
            fin(srv); panic!("un identifiant jamais réservé ne doit rien rendre");
        }

        // 5. Le chemin réel : put_record, avec la capability relue du trousseau.
        let corps = corps_conforme();
        let premier = put_record(&url, RECORD_ID, &corps, relu.as_ref().unwrap());
        let rejeu = put_record(&url, RECORD_ID, &corps, relu.as_ref().unwrap());

        // 6. Le record est bien là, et son contenu n'a pas bougé.
        let lecture = std::process::Command::new("/usr/bin/curl")
            .args(["-sS", "-m", "10", &format!("{}/r/{}", url, RECORD_ID)])
            .output().expect("lecture");
        let lu = String::from_utf8_lossy(&lecture.stdout).to_string();

        // 7. Une capability légitime mais émise pour un AUTRE identifiant est refusée.
        let croise = put_record(&url, "HO-E2EAUTH000002", &corps, relu.as_ref().unwrap());

        fin(srv);

        assert!(premier.is_ok(), "écriture authentifiée refusée : {:?} \
            (l'ancien client, sans en-tête d'autorisation, échoue ici)", premier);
        assert!(rejeu.is_ok(), "le rejeu doit valoir 409, donc succès sans remplacement : {:?}", rejeu);
        assert!(lu.contains("Q2hpZmZyZS1FMkU"), "contenu absent ou altéré : {}", lu);
        assert!(croise.is_err(), "une capability d'un autre identifiant doit être refusée");
    }
}

/// Banc sur l'installation RÉELLE, hors `cargo test` ordinaire. La détection dépend de
/// choses qu'aucun paquet synthétique ne reproduit : le nom exact du dossier surveillé —
/// qui peut comporter une espace finale —, le nom que Word donne à son fichier de verrou,
/// et l'état local du finalizer. Ce banc les éprouve là où elles vivent.
///
///   HO_DATA_DIR=<répertoire de données> HO_ATTENDU=<record_id> \
///     cargo test detection_sur_installation_reelle -- --ignored --nocapture
#[cfg(test)]
mod detection_reelle {
    use super::*;

    #[test]
    #[ignore]
    fn detection_sur_installation_reelle() {
        let dir = PathBuf::from(std::env::var("HO_DATA_DIR").expect("HO_DATA_DIR"));
        let f = Finalizer::new(dir);
        let cfg = f.config();
        println!("  dossiers surveillés :");
        for d in cfg.folders.iter() {
            println!("    [{}] existe={}", d, PathBuf::from(d).is_dir());
        }
        let docs = f.documents_versionnables();
        println!("  documents finalisés ET ouverts : {}", docs.len());
        for d in &docs {
            println!("    {} — {}", d["record_id"].as_str().unwrap_or("?"),
                     d["name"].as_str().unwrap_or("?"));
        }
        if let Ok(attendu) = std::env::var("HO_ATTENDU") {
            let trouve = docs.iter().any(|d| d["record_id"].as_str() == Some(attendu.as_str()));
            assert!(trouve, "le document attendu n'est pas détecté : {}", attendu);
            let chemin = f.chemin_versionnable(&attendu);
            assert!(chemin.is_some(), "le document attendu n'est pas résolu sans ambiguïté");
            println!("  résolution : {}", chemin.unwrap().display());
        }
    }
}
