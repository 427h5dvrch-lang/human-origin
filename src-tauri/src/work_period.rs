//! work_period — Format persistant d'une période HumanOrigin (Commit 3).
//!
//! Portée STRICTE : uniquement le format immuable, signé et chaîné d'une
//! `ObservationPeriod`, plus ses fonctions pures (payload canonique, hash,
//! signature, vérification, chaînage) et ses I/O (écriture unique atomique,
//! relecture vérifiée, dernière période fiable sans faire confiance au cache).
//!
//! HORS PORTÉE : aucune commande Tauri, aucun `pending`, aucun scan, aucun
//! certificat, aucune UI, aucun accès `Projects/`.
//!
//! Identité de signature : `LOCAL_DEVICE` uniquement.

// Fondation (Commit 3) : API consommée par start/stop_work_period au Commit 4.
#![allow(dead_code)]

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::work_store::WorkId;

/// Version de schéma du format période.
pub const PERIOD_SCHEMA_VERSION: u32 = 1;

const SIGN_ALG: &str = "ed25519";
const LOCAL_DEVICE_IDENTITY: &str = "LOCAL_DEVICE";
const PERIODS_DIR: &str = "periods";

/// Schéma de canonicalisation réellement appliqué au payload signé.
///
/// HO-CANON-V1 = clés d'objets JSON triées récursivement (ordre d'octets UTF-8),
/// sérialisation compacte `serde_json`, champs `signature` et
/// `period_record_sha256` exclus du payload. Indépendant de l'ordre d'insertion
/// des clés et de la feature `preserve_order`.
///
/// NOTE : ce N'EST PAS RFC 8785 (JCS). La normalisation des nombres/chaînes
/// suit `serde_json`, pas JCS. Suffisant pour l'intégrité et le round-trip
/// (le bloc `engine` est capturé une fois puis re-sérialisé tel quel). Pour une
/// interop JCS externe, une crate dédiée serait nécessaire.
const CANON_SCHEME: &str = "HO-CANON-V1";

// --- TYPES --------------------------------------------------------------------

/// Métadonnées de signature. INCLUSES dans le payload signé (sauf le champ
/// `signature` de la période, qui reste externe). Ainsi la clé publique,
/// l'identité, l'algorithme et le schéma de canonicalisation sont tous liés
/// cryptographiquement au record.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SignatureMetadata {
    pub alg: String,
    /// Clé publique Ed25519 en base64.
    pub public_key: String,
    /// Empreinte de la clé : SHA256 hex de la clé publique base64.
    pub signing_key_id: String,
    /// Identité du signataire. Toujours `LOCAL_DEVICE` en Alpha.
    pub identity: String,
    /// Schéma de canonicalisation réellement utilisé (voir `CANON_SCHEME`).
    pub canonicalization: String,
    pub schema_version: u32,
}

/// Période d'observation : enregistrement immuable, signé et chaîné.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ObservationPeriod {
    pub schema_version: u32,
    pub period_id: String,
    pub work_id: WorkId,
    pub sequence_number: u64,
    pub previous_period_id: Option<String>,
    pub previous_period_record_sha256: Option<String>,
    pub document_path: String,
    pub hash_start: String,
    pub size_start: u64,
    pub hash_end: String,
    pub size_end: u64,
    /// Le document a-t-il changé entre début et fin (hash_start != hash_end).
    pub net_document_change: bool,
    /// Signal complémentaire : des modifications ont-elles été observées
    /// pendant la période (issu du moteur). N'est pas un hard block.
    pub change_observed_during_period: bool,
    /// Données moteur/scoring sous forme compatible et découplée du core.
    pub engine: Value,
    pub signature_metadata: SignatureMetadata,
    /// Signature Ed25519 (base64) du `period_record_sha256`.
    pub signature: String,
    /// SHA256 hex du payload canonique.
    pub period_record_sha256: String,
}

/// Champs sémantiques nécessaires pour bâtir et signer une période.
pub struct PeriodInputs {
    pub period_id: String,
    pub work_id: WorkId,
    pub sequence_number: u64,
    pub previous_period_id: Option<String>,
    pub previous_period_record_sha256: Option<String>,
    pub document_path: String,
    pub hash_start: String,
    pub size_start: u64,
    pub hash_end: String,
    pub size_end: u64,
    pub change_observed_during_period: bool,
    pub engine: Value,
}

// --- FONCTIONS PURES ----------------------------------------------------------

/// Champs exclus du payload signé (le seul `signature` étant externe ; le
/// `period_record_sha256` exclu pour éviter la circularité).
const NON_SIGNED_FIELDS: [&str; 2] = ["signature", "period_record_sha256"];

/// Canonicalise récursivement une `Value` : clés d'objets triées (ordre
/// d'octets UTF-8), tableaux préservés, scalaires inchangés. Robuste à l'ordre
/// d'insertion et à la feature `preserve_order` de serde_json.
fn canonicalize_value(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted = serde_json::Map::new();
            for k in keys {
                sorted.insert(k.clone(), canonicalize_value(&map[k]));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize_value).collect()),
        other => other.clone(),
    }
}

/// SHA256 hex d'une chaîne UTF-8 (utilisé pour `signing_key_id`).
fn sha256_hex_str(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

/// Payload canonique signé (schéma `HO-CANON-V1`) : tous les champs de la
/// période — y compris `signature_metadata` — SAUF `signature` et
/// `period_record_sha256`, avec clés triées récursivement.
pub fn canonical_period_payload(period: &ObservationPeriod) -> Result<Vec<u8>, String> {
    let mut value = serde_json::to_value(period).map_err(|e| e.to_string())?;
    match value.as_object_mut() {
        Some(map) => {
            for field in NON_SIGNED_FIELDS {
                map.remove(field);
            }
        }
        None => return Err("période non sérialisable en objet JSON".to_string()),
    }
    let canonical = canonicalize_value(&value);
    serde_json::to_vec(&canonical).map_err(|e| e.to_string())
}

/// SHA256 hex du payload canonique.
pub fn compute_period_record_sha256(period: &ObservationPeriod) -> Result<String, String> {
    let payload = canonical_period_payload(period)?;
    Ok(format!("{:x}", Sha256::digest(&payload)))
}

/// Octets canoniques (HO-CANON-V1) d'une valeur sérialisable, en excluant
/// éventuellement des champs de premier niveau (ex. `signature`). Source UNIQUE
/// de canonicalisation pour la couche Work.
pub(crate) fn canonical_bytes_excluding<T: Serialize>(
    value: &T,
    exclude_top_level: &[&str],
) -> Result<Vec<u8>, String> {
    let mut v = serde_json::to_value(value).map_err(|e| e.to_string())?;
    if let Some(map) = v.as_object_mut() {
        for field in exclude_top_level {
            map.remove(*field);
        }
    }
    let canonical = canonicalize_value(&v);
    serde_json::to_vec(&canonical).map_err(|e| e.to_string())
}

/// Canonicalise (HO-CANON-V1 : clés d'objets triées récursivement) N'IMPORTE
/// quelle valeur sérialisable puis renvoie son SHA256 hex. Source UNIQUE de
/// canonicalisation pour la couche Work (réutilisée par la CoreEvidence).
pub(crate) fn canonical_sha256<T: Serialize>(value: &T) -> Result<String, String> {
    let bytes = canonical_bytes_excluding(value, &[])?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

/// Normalise une valeur `engine` vers le point-fixe de `serde_json` (round-trip
/// idempotent). Une représentation flottante capturée en amont (ex. moteur) peut
/// NE PAS être round-trippable : `serialize(x)` produit un texte qui, une fois
/// reparsé puis re-sérialisé, diffère. On force ici la forme stable AVANT de
/// hacher/signer/écrire, de sorte que hash signé == octets disque == payload
/// recalculé au verify. Sans cela, `verify_period_record` diverge après
/// relecture (bug `ChainInvalid` intermittent).
fn normalize_engine(engine: &Value) -> Result<Value, String> {
    serde_json::from_slice::<Value>(&serde_json::to_vec(engine).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Bâtit une période complète, calcule son record SHA256 et la signe.
/// `net_document_change` est dérivé objectivement de hash_start != hash_end.
pub fn sign_period_record(
    inputs: PeriodInputs,
    signing_key: &SigningKey,
) -> Result<ObservationPeriod, String> {
    let net_document_change = inputs.hash_start != inputs.hash_end;
    let public_key = general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes());
    let signing_key_id = sha256_hex_str(&public_key);
    // Point-fixe serde_json AVANT hash/signature/écriture (cf. normalize_engine).
    let engine = normalize_engine(&inputs.engine)?;

    let mut period = ObservationPeriod {
        schema_version: PERIOD_SCHEMA_VERSION,
        period_id: inputs.period_id,
        work_id: inputs.work_id,
        sequence_number: inputs.sequence_number,
        previous_period_id: inputs.previous_period_id,
        previous_period_record_sha256: inputs.previous_period_record_sha256,
        document_path: inputs.document_path,
        hash_start: inputs.hash_start,
        size_start: inputs.size_start,
        hash_end: inputs.hash_end,
        size_end: inputs.size_end,
        net_document_change,
        change_observed_during_period: inputs.change_observed_during_period,
        engine,
        signature_metadata: SignatureMetadata {
            alg: SIGN_ALG.to_string(),
            public_key,
            signing_key_id,
            identity: LOCAL_DEVICE_IDENTITY.to_string(),
            canonicalization: CANON_SCHEME.to_string(),
            schema_version: PERIOD_SCHEMA_VERSION,
        },
        signature: String::new(),
        period_record_sha256: String::new(),
    };

    let payload = canonical_period_payload(&period)?;
    let digest = Sha256::digest(&payload);
    period.period_record_sha256 = format!("{:x}", digest);
    let signature = signing_key.sign(digest.as_slice());
    period.signature = general_purpose::STANDARD.encode(signature.to_bytes());

    Ok(period)
}

fn decode_b64_fixed<const N: usize>(s: &str) -> Result<[u8; N], String> {
    let bytes = general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())?;
    if bytes.len() != N {
        return Err(format!(
            "longueur base64 inattendue : {} (attendu {N})",
            bytes.len()
        ));
    }
    let mut arr = [0u8; N];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Vérifie l'intégrité d'une période : record SHA256 recalculé == stocké, et
/// signature Ed25519 valide sur ce record avec la clé publique embarquée.
pub fn verify_period_record(period: &ObservationPeriod) -> Result<(), String> {
    let meta = &period.signature_metadata;
    if meta.alg != SIGN_ALG {
        return Err(format!("algorithme de signature inattendu : {}", meta.alg));
    }
    if meta.identity != LOCAL_DEVICE_IDENTITY {
        return Err(format!(
            "identité de signature inattendue : {}",
            meta.identity
        ));
    }
    if meta.canonicalization != CANON_SCHEME {
        return Err(format!(
            "schéma de canonicalisation inattendu : {}",
            meta.canonicalization
        ));
    }
    let expected_key_id = sha256_hex_str(&meta.public_key);
    if meta.signing_key_id != expected_key_id {
        return Err("signing_key_id incohérent avec la clé publique".to_string());
    }

    let payload = canonical_period_payload(period)?;
    let digest = Sha256::digest(&payload);
    let recomputed = format!("{:x}", digest);
    if recomputed != period.period_record_sha256 {
        return Err("period_record_sha256 ne correspond pas au payload".to_string());
    }

    let pk_bytes = decode_b64_fixed::<32>(&period.signature_metadata.public_key)?;
    let verifying_key = VerifyingKey::from_bytes(&pk_bytes).map_err(|e| e.to_string())?;
    let sig_bytes = decode_b64_fixed::<64>(&period.signature)?;
    let signature = Signature::from_bytes(&sig_bytes);

    verifying_key
        .verify_strict(digest.as_slice(), &signature)
        .map_err(|_| "signature invalide".to_string())
}

/// Vérifie le chaînage entre `previous` et `current`.
/// - `previous == None` : `current` doit être une genèse valide (seq 0, aucun
///   lien précédent).
/// - `previous == Some(p)` : intégrité des deux + linkage (séquence, id, hash,
///   même work_id).
pub fn verify_period_chain(
    previous: Option<&ObservationPeriod>,
    current: &ObservationPeriod,
) -> Result<(), String> {
    verify_period_record(current)?;

    match previous {
        None => {
            if current.sequence_number != 0 {
                return Err(format!(
                    "genèse attendue en séquence 0, trouvé {}",
                    current.sequence_number
                ));
            }
            if current.previous_period_id.is_some()
                || current.previous_period_record_sha256.is_some()
            {
                return Err("une genèse ne doit avoir aucun lien précédent".to_string());
            }
            Ok(())
        }
        Some(prev) => {
            verify_period_record(prev)?;

            if current.work_id != prev.work_id {
                return Err("work_id incohérent dans la chaîne".to_string());
            }
            if current.sequence_number != prev.sequence_number + 1 {
                return Err(format!(
                    "séquence non contiguë : {} après {}",
                    current.sequence_number, prev.sequence_number
                ));
            }
            if current.previous_period_id.as_deref() != Some(prev.period_id.as_str()) {
                return Err("previous_period_id ne pointe pas la période précédente".to_string());
            }
            if current.previous_period_record_sha256.as_deref()
                != Some(prev.period_record_sha256.as_str())
            {
                return Err("previous_period_record_sha256 incorrect".to_string());
            }
            Ok(())
        }
    }
}

// --- I/O ----------------------------------------------------------------------

fn periods_dir(works_root: &Path, work_id: &WorkId) -> PathBuf {
    works_root.join(work_id.as_str()).join(PERIODS_DIR)
}

fn period_file_path(works_root: &Path, work_id: &WorkId, sequence: u64) -> PathBuf {
    periods_dir(works_root, work_id).join(format!("period_{sequence}.json"))
}

/// Écriture atomique d'un fichier neuf, SANS écrasement possible — même sous
/// écriture concurrente. Le contenu est d'abord écrit dans un temporaire unique
/// (create_new + flush + fsync), puis publié via `hard_link`, qui échoue
/// atomiquement si la cible existe déjà (`AlreadyExists`). Aucune fenêtre de
/// course entre un test d'existence et le rename : le lien EST le test.
/// Nettoie le temporaire dans tous les cas.
fn write_atomic_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Chemin sans parent : {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nom de fichier invalide")?;
    let tmp = parent.join(format!(".{}.tmp-{}", file_name, uuid::Uuid::new_v4()));

    let write_result = (|| -> Result<(), String> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        Ok(())
    })();

    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }

    // Publication non-destructive : hard_link échoue si `path` existe déjà.
    let link_result = fs::hard_link(&tmp, path);
    let _ = fs::remove_file(&tmp); // le contenu vit désormais sous `path`
    match link_result {
        Ok(()) => {
            sync_dir(parent);
            Ok(())
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err(format!(
            "Période déjà existante, écrasement refusé (course) : {}",
            path.display()
        )),
        Err(e) => Err(e.to_string()),
    }
}

fn sync_dir(dir: &Path) {
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(f) = File::open(dir) {
            let _ = f.sync_all();
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = dir;
    }
}

/// Écrit `period_{sequence}.json` UNE SEULE FOIS. Refus absolu d'écrasement.
/// La période est vérifiée avant écriture (jamais de fichier signé incohérent).
pub fn write_period_once(works_root: &Path, period: &ObservationPeriod) -> Result<PathBuf, String> {
    verify_period_record(period)?;

    let path = period_file_path(works_root, &period.work_id, period.sequence_number);
    if path.exists() {
        return Err(format!(
            "Période déjà existante, écrasement refusé : {}",
            path.display()
        ));
    }
    let json = serde_json::to_vec_pretty(period).map_err(|e| e.to_string())?;
    write_atomic_new(&path, &json)?;
    Ok(path)
}

/// Relit une période depuis le disque et la vérifie (JSON corrompu -> Err ;
/// intégrité/signature invalide -> Err).
pub fn read_period(
    works_root: &Path,
    work_id: &WorkId,
    sequence: u64,
) -> Result<ObservationPeriod, String> {
    let path = period_file_path(works_root, work_id, sequence);
    let raw = fs::read_to_string(&path).map_err(|e| format!("{} : {}", path.display(), e))?;
    let period: ObservationPeriod =
        serde_json::from_str(&raw).map_err(|e| format!("période corrompue : {}", e))?;
    verify_period_record(&period)?;
    Ok(period)
}

/// Extrait la séquence encodée dans un nom `period_{n}.json`, si canonique.
fn parse_period_filename_seq(name: &str) -> Option<u64> {
    name.strip_prefix("period_")?
        .strip_suffix(".json")?
        .parse::<u64>()
        .ok()
}

/// Charge et vérifie la CHAÎNE COMPLÈTE 0→N d'un Work depuis le disque, SANS
/// faire confiance à `index.json` ni à aucun cache. La séquence fait autorité
/// par le CONTENU signé, pas par le nom de fichier.
///
/// Refuse : JSON corrompu, période invalide, séquence dupliquée (fork),
/// incohérence nom de fichier / contenu, trou de séquence, genèse absente, et
/// tout maillon dont le linkage (previous_id / previous_hash / séquence) est
/// faux. Retourne la chaîne ordonnée (vide si aucune période).
pub fn load_verified_chain(
    works_root: &Path,
    work_id: &WorkId,
) -> Result<Vec<ObservationPeriod>, String> {
    let dir = periods_dir(works_root, work_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    // 1) Collecte par séquence (contenu), en refusant tout doublon/fork.
    let mut by_seq: BTreeMap<u64, ObservationPeriod> = BTreeMap::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !(name.starts_with("period_") && name.ends_with(".json")) {
            continue;
        }

        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let period: ObservationPeriod =
            serde_json::from_str(&raw).map_err(|e| format!("période corrompue : {}", e))?;
        verify_period_record(&period)?;

        // Défense : le nom canonique doit refléter la séquence du contenu.
        if let Some(fname_seq) = parse_period_filename_seq(&name) {
            if fname_seq != period.sequence_number {
                return Err(format!(
                    "incohérence nom/contenu : {} déclare séquence {}",
                    name, period.sequence_number
                ));
            }
        }

        if by_seq.contains_key(&period.sequence_number) {
            return Err(format!(
                "fork détecté : deux périodes en séquence {}",
                period.sequence_number
            ));
        }
        by_seq.insert(period.sequence_number, period);
    }

    if by_seq.is_empty() {
        return Ok(Vec::new());
    }

    // 2) Contiguïté 0..=max sans trou, avec vérification de chaînage à chaque pas.
    let max_seq = *by_seq.keys().next_back().unwrap();
    let mut chain: Vec<ObservationPeriod> = Vec::with_capacity((max_seq + 1) as usize);
    for i in 0..=max_seq {
        let current = by_seq
            .get(&i)
            .ok_or_else(|| format!("séquence manquante : {i}"))?;
        let previous = if i == 0 { None } else { by_seq.get(&(i - 1)) };
        verify_period_chain(previous, current)?;
        chain.push(current.clone());
    }

    Ok(chain)
}

/// Retrouve et vérifie la DERNIÈRE période d'un Work, comme tête d'une chaîne
/// complète vérifiée de 0 à N. Source d'autorité = le disque, jamais le cache.
pub fn find_last_period(
    works_root: &Path,
    work_id: &WorkId,
) -> Result<Option<ObservationPeriod>, String> {
    Ok(load_verified_chain(works_root, work_id)?.into_iter().last())
}

// --- TESTS UNITAIRES ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;
    use serde_json::json;
    use uuid::Uuid;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("ho_period_test_{}", Uuid::new_v4()))
    }

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
    }

    fn key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn genesis_inputs(work_id: &WorkId) -> PeriodInputs {
        PeriodInputs {
            period_id: Uuid::new_v4().to_string(),
            work_id: work_id.clone(),
            sequence_number: 0,
            previous_period_id: None,
            previous_period_record_sha256: None,
            document_path: "/tmp/doc.txt".to_string(),
            hash_start: "a".repeat(64),
            size_start: 100,
            hash_end: "b".repeat(64),
            size_end: 120,
            change_observed_during_period: true,
            engine: json!({ "score": 88, "gate_passed": true }),
        }
    }

    fn child_inputs(work_id: &WorkId, prev: &ObservationPeriod) -> PeriodInputs {
        PeriodInputs {
            period_id: Uuid::new_v4().to_string(),
            work_id: work_id.clone(),
            sequence_number: prev.sequence_number + 1,
            previous_period_id: Some(prev.period_id.clone()),
            previous_period_record_sha256: Some(prev.period_record_sha256.clone()),
            document_path: "/tmp/doc.txt".to_string(),
            hash_start: prev.hash_end.clone(),
            size_start: prev.size_end,
            hash_end: "c".repeat(64),
            size_end: 130,
            change_observed_during_period: true,
            engine: json!({ "score": 90, "gate_passed": true }),
        }
    }

    #[test]
    fn test_record_sha256_stable() {
        let k = key();
        let wid = WorkId::new();
        // Mêmes inputs -> même record SHA256 (déterministe).
        let mut inputs_a = genesis_inputs(&wid);
        let fixed_id = "fixed-period-id".to_string();
        inputs_a.period_id = fixed_id.clone();
        let p1 = sign_period_record(inputs_a, &k).unwrap();

        let mut inputs_b = genesis_inputs(&wid);
        inputs_b.period_id = fixed_id;
        let p2 = sign_period_record(inputs_b, &k).unwrap();

        assert_eq!(p1.period_record_sha256, p2.period_record_sha256);
        // Et recalcul cohérent.
        assert_eq!(
            p1.period_record_sha256,
            compute_period_record_sha256(&p1).unwrap()
        );
    }

    #[test]
    fn test_signature_valide() {
        let k = key();
        let wid = WorkId::new();
        let p = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        assert!(verify_period_record(&p).is_ok());
        assert_eq!(p.signature_metadata.identity, "LOCAL_DEVICE");
        // net_document_change dérivé (hash_start != hash_end).
        assert!(p.net_document_change);
    }

    #[test]
    fn test_alteration_champ_echoue() {
        let k = key();
        let wid = WorkId::new();
        let mut p = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        // Altère un champ signé sans re-signer.
        p.size_end += 1;
        assert!(verify_period_record(&p).is_err());

        // Altère le hash_end (impacte aussi net_document_change logique).
        let mut p2 = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        p2.hash_end = "z".repeat(64);
        assert!(verify_period_record(&p2).is_err());
    }

    #[test]
    fn test_chainage_correct() {
        let k = key();
        let wid = WorkId::new();
        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        let child = sign_period_record(child_inputs(&wid, &genesis), &k).unwrap();

        assert!(verify_period_chain(None, &genesis).is_ok());
        assert!(verify_period_chain(Some(&genesis), &child).is_ok());
    }

    #[test]
    fn test_previous_hash_incorrect_refuse() {
        let k = key();
        let wid = WorkId::new();
        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();

        let mut inputs = child_inputs(&wid, &genesis);
        inputs.previous_period_record_sha256 = Some("d".repeat(64)); // faux
        let child = sign_period_record(inputs, &k).unwrap();

        // L'enfant est individuellement valide, mais le chaînage échoue.
        assert!(verify_period_record(&child).is_ok());
        assert!(verify_period_chain(Some(&genesis), &child).is_err());
    }

    #[test]
    fn test_sequence_incorrecte_refuse() {
        let k = key();
        let wid = WorkId::new();
        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();

        let mut inputs = child_inputs(&wid, &genesis);
        inputs.sequence_number = 5; // devrait être 1
        let child = sign_period_record(inputs, &k).unwrap();

        assert!(verify_period_chain(Some(&genesis), &child).is_err());
    }

    #[test]
    fn test_genese_correcte() {
        let k = key();
        let wid = WorkId::new();
        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        assert!(verify_period_chain(None, &genesis).is_ok());

        // Un non-genèse passé comme genèse est refusé.
        let child = sign_period_record(child_inputs(&wid, &genesis), &k).unwrap();
        assert!(verify_period_chain(None, &child).is_err());
    }

    #[test]
    fn test_refus_ecrasement() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        fs::create_dir_all(works.join(wid.as_str())).unwrap();
        let k = key();
        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();

        write_period_once(&works, &genesis).unwrap();
        let second = write_period_once(&works, &genesis);
        assert!(second.is_err(), "écrasement d'une période refusé");
        cleanup(&root);
    }

    #[test]
    fn test_json_corrompu_refuse() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let dir = periods_dir(&works, &wid);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("period_0.json"), b"{ pas du json valide").unwrap();

        assert!(read_period(&works, &wid, 0).is_err());
        assert!(find_last_period(&works, &wid).is_err());
        cleanup(&root);
    }

    #[test]
    fn test_cache_mensonger_sans_effet_sur_chaine() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        fs::create_dir_all(works.join(wid.as_str())).unwrap();
        let k = key();

        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        write_period_once(&works, &genesis).unwrap();
        let child = sign_period_record(child_inputs(&wid, &genesis), &k).unwrap();
        write_period_once(&works, &child).unwrap();

        // Cache Work mensonger : prétend des choses fausses.
        fs::write(
            works.join("index.json"),
            br#"{"schema_version":1,"entries":[{"work_id":"menteur","lifecycle":"ACTIVE"}]}"#,
        )
        .unwrap();

        // find_last_period lit les périodes du disque, ignore le cache.
        let last = find_last_period(&works, &wid).unwrap().unwrap();
        assert_eq!(last.sequence_number, 1);
        assert_eq!(last.period_id, child.period_id);
        assert!(verify_period_chain(Some(&genesis), &last).is_ok());
        cleanup(&root);
    }

    // --- AUDIT COMMIT 3 : tests supplémentaires ------------------------------

    #[test]
    fn test_engine_ordre_cles_meme_hash() {
        let k = key();
        let wid = WorkId::new();

        // Deux objets engine au même contenu logique, insérés dans un ordre
        // différent.
        let mut m1 = serde_json::Map::new();
        m1.insert("score".into(), json!(88));
        m1.insert("gate_passed".into(), json!(true));
        m1.insert("nested".into(), json!({ "b": 2, "a": 1 }));

        let mut m2 = serde_json::Map::new();
        m2.insert("nested".into(), json!({ "a": 1, "b": 2 }));
        m2.insert("gate_passed".into(), json!(true));
        m2.insert("score".into(), json!(88));

        let mut i1 = genesis_inputs(&wid);
        i1.period_id = "same-id".into();
        i1.engine = Value::Object(m1);
        let mut i2 = genesis_inputs(&wid);
        i2.period_id = "same-id".into();
        i2.engine = Value::Object(m2);

        let p1 = sign_period_record(i1, &k).unwrap();
        let p2 = sign_period_record(i2, &k).unwrap();
        assert_eq!(
            p1.period_record_sha256, p2.period_record_sha256,
            "l'ordre d'insertion des clés ne doit pas changer le hash"
        );
    }

    #[test]
    fn test_alteration_signature_metadata_echoue() {
        let k = key();
        let wid = WorkId::new();

        // Altération de l'identité (champ signé) -> échec.
        let mut p = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        p.signature_metadata.identity = "REMOTE".to_string();
        assert!(verify_period_record(&p).is_err());

        // Altération de la clé publique embarquée -> échec.
        let mut p2 = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        let other = key();
        p2.signature_metadata.public_key =
            general_purpose::STANDARD.encode(other.verifying_key().to_bytes());
        assert!(verify_period_record(&p2).is_err());
    }

    #[test]
    fn test_signing_key_id_incoherent_refuse() {
        let k = key();
        let wid = WorkId::new();
        let mut p = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        p.signature_metadata.signing_key_id = "0".repeat(64);
        assert!(verify_period_record(&p).is_err());
    }

    #[test]
    fn test_double_sequence_number_refuse() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let dir = periods_dir(&works, &wid);
        fs::create_dir_all(&dir).unwrap();
        let k = key();

        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        write_period_once(&works, &genesis).unwrap();
        let child = sign_period_record(child_inputs(&wid, &genesis), &k).unwrap();
        write_period_once(&works, &child).unwrap();

        // Deuxième période à la séquence 1 (fork), sous un autre nom de fichier.
        let mut fork_inputs = child_inputs(&wid, &genesis);
        fork_inputs.period_id = Uuid::new_v4().to_string();
        let fork = sign_period_record(fork_inputs, &k).unwrap();
        let fork_json = serde_json::to_vec_pretty(&fork).unwrap();
        fs::write(dir.join("period_1_fork.json"), &fork_json).unwrap();

        assert!(load_verified_chain(&works, &wid).is_err());
        assert!(find_last_period(&works, &wid).is_err());
        cleanup(&root);
    }

    #[test]
    fn test_trou_de_sequence_refuse() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        fs::create_dir_all(works.join(wid.as_str())).unwrap();
        let k = key();

        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        write_period_once(&works, &genesis).unwrap();

        // Période en séquence 2 (saute la 1), pointant un « previous » fictif.
        let mut inputs = child_inputs(&wid, &genesis);
        inputs.sequence_number = 2;
        inputs.previous_period_id = Some("fantome".to_string());
        inputs.previous_period_record_sha256 = Some("e".repeat(64));
        let seq2 = sign_period_record(inputs, &k).unwrap();
        write_period_once(&works, &seq2).unwrap();

        assert!(
            load_verified_chain(&works, &wid).is_err(),
            "trou de séquence refusé"
        );
        cleanup(&root);
    }

    #[test]
    fn test_fork_chaine_linkage_faux_refuse() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        fs::create_dir_all(works.join(wid.as_str())).unwrap();
        let k = key();

        let genesis = sign_period_record(genesis_inputs(&wid), &k).unwrap();
        write_period_once(&works, &genesis).unwrap();

        // Enfant seq 1 valide en soi, mais previous_hash faux -> linkage cassé.
        let mut inputs = child_inputs(&wid, &genesis);
        inputs.previous_period_record_sha256 = Some("f".repeat(64));
        let bad_child = sign_period_record(inputs, &k).unwrap();
        write_period_once(&works, &bad_child).unwrap();

        assert!(
            load_verified_chain(&works, &wid).is_err(),
            "linkage faux refusé"
        );
        cleanup(&root);
    }

    #[test]
    fn test_ecritures_concurrentes_une_seule_reussit() {
        use std::sync::Arc;
        use std::thread;

        let root = temp_root();
        let works = Arc::new(root.join("Works"));
        let wid = WorkId::new();
        fs::create_dir_all(works.join(wid.as_str())).unwrap();
        let k = key();
        let period = Arc::new(sign_period_record(genesis_inputs(&wid), &k).unwrap());

        let mut handles = Vec::new();
        for _ in 0..8 {
            let works = Arc::clone(&works);
            let period = Arc::clone(&period);
            handles.push(thread::spawn(move || {
                write_period_once(&works, &period).is_ok()
            }));
        }
        let successes = handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|&ok| ok)
            .count();

        assert_eq!(successes, 1, "exactement une écriture doit réussir");
        // Et le fichier final est bien une période valide.
        assert!(read_period(&works, &wid, 0).is_ok());
        cleanup(&root);
    }

    /// Non-régression du bug `ChainInvalid` intermittent : un flottant engine
    /// non round-trippable (parseur float serde_json imprécis) faisait diverger
    /// `period_record_sha256` après relecture disque. `normalize_engine` (au
    /// moment de la signature) doit rendre la période stable au round-trip.
    #[test]
    fn test_engine_float_non_roundtrip_reste_valide_apres_disque() {
        // (1) Précondition : la valeur choisie EST bien un cas de drift, sinon
        //     ce test ne garderait rien.
        let raw_engine = json!({ "analysis": { "effort_score": 241.33333333333334_f64 } });
        let once = serde_json::to_vec(&raw_engine).unwrap();
        let reparsed: Value = serde_json::from_slice(&once).unwrap();
        let twice = serde_json::to_vec(&reparsed).unwrap();
        assert_ne!(
            once, twice,
            "la valeur de test doit reproduire le drift float serde_json"
        );

        // (2) Signature d'une période portant ce flottant.
        let k = key();
        let wid = WorkId::new();
        let mut inputs = genesis_inputs(&wid);
        inputs.engine = json!({
            "analysis": { "effort_score": 241.33333333333334_f64, "score": 100 }
        });
        let period = sign_period_record(inputs, &k).unwrap();

        // (3) Simule l'écriture disque (write_period_once) + relecture
        //     (load_verified_chain) : sérialisation -> relecture serde_json.
        let bytes = serde_json::to_vec_pretty(&period).unwrap();
        let reread: ObservationPeriod = serde_json::from_slice(&bytes).unwrap();

        // (4) verify_period_record après relecture doit PASSER (échouait avant le fix).
        verify_period_record(&reread)
            .expect("période doit rester valide après round-trip disque");
        // (5) period_record_sha256 stable.
        assert_eq!(reread.period_record_sha256, period.period_record_sha256);
        assert_eq!(
            reread.period_record_sha256,
            compute_period_record_sha256(&reread).unwrap()
        );
    }

    /// `normalize_engine` doit être idempotent : normalize(normalize(x)) == normalize(x).
    #[test]
    fn test_normalize_engine_idempotent() {
        let engine = json!({
            "analysis": { "effort_score": 241.33333333333334_f64, "rhythm_cv": 2.9419373553875756_f64, "score": 100 },
            "nested": { "b": 1, "a": 2.5, "z": [0.1, 0.2, 0.3] }
        });
        let once = normalize_engine(&engine).unwrap();
        let twice = normalize_engine(&once).unwrap();
        assert_eq!(once, twice, "normalize_engine doit être idempotent (Value)");
        // Point-fixe au niveau des octets sérialisés.
        assert_eq!(
            serde_json::to_vec(&once).unwrap(),
            serde_json::to_vec(&twice).unwrap(),
            "la forme normalisée doit être un point-fixe de sérialisation"
        );
    }
}
