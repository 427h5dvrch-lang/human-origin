//! work_certificate — Logique PURE de CoreEvidence cumulative (Commit 6A).
//!
//! Portée STRICTE : construire, EN MÉMOIRE, l'évidence cumulative d'un Work à
//! partir de sa chaîne de périodes vérifiée. AUCUNE écriture disque, AUCUN
//! HO-JSON, AUCUN PDF, AUCUN manifest, AUCUNE signature, AUCUNE commande Tauri,
//! AUCUNE UI. Ne touche ni PDF/cartouche/verifier ni Supabase.
//!
//! Règles :
//! - `included_periods` = TOUTE la chaîne vérifiée, dans l'ordre (jamais de
//!   sélection opportuniste) ;
//! - certifiable ssi : chaîne valide non vide, ≥ 1 NOUVELLE période qualifiante,
//!   et hash actuel du document == hash_end de la dernière période ;
//! - période qualifiante = `gate_passed && net_document_change` ;
//! - continuité DOCUMENTAIRE FULL/GAPPED (hash_start[i] == hash_end[i-1]) — ce
//!   n'est PAS l'intégrité cryptographique de chaîne (elle, garantie par
//!   `load_verified_chain`, échoue durement).

// Fondation (Commit 6A) : logique pure consommée par l'écriture certificat (6B).
#![allow(dead_code)]

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::work_period::{self, ObservationPeriod};
use crate::work_store::{self, WorkId};

/// Version de schéma du HO-JSON Work Certificate.
pub(crate) const CERTIFICATE_SCHEMA_VERSION: u32 = 1;

const SIGN_ALG: &str = "ed25519";
const LOCAL_DEVICE_IDENTITY: &str = "LOCAL_DEVICE";
const CERTIFICATES_DIR: &str = "certificates";

/// Version de schéma de la CoreEvidence.
pub(crate) const CORE_EVIDENCE_SCHEMA_VERSION: u32 = 1;

// --- TYPES --------------------------------------------------------------------

/// Version cumulative du certificat.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub(crate) enum CertificateVersion {
    V1,
    V2,
}

/// Continuité documentaire de la chaîne.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub(crate) enum ContinuityKind {
    Full,
    Gapped,
}

/// Verdict conservateur — jamais de surpromesse (pas de PROOF/AUTHENTIC/etc.).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ProofVerdict {
    ObservedWorkConsistent,
    ObservedWorkWithGaps,
}

/// Erreurs de (non-)certifiabilité.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CertificateError {
    NoPeriods,
    NoQualifyingNewPeriod,
    DocumentModifiedAfterStop,
    DocumentUnavailable(String),
    ChainInvalid(String),
    PreviousCertificateMismatch,
    /// Un certificat existant est corrompu, mal signé, ou incohérent en
    /// chaîne/séquence. Erreur DURE : jamais de skip silencieux (garde-fou B).
    CertificateChainTampered(String),
    /// Échec d'écriture / d'accès disque.
    Io(String),
}

/// Vue d'une période incluse dans l'évidence.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct IncludedPeriod {
    pub period_id: String,
    pub sequence_number: u64,
    pub hash_start: String,
    pub hash_end: String,
    pub size_start: u64,
    pub size_end: u64,
    pub net_document_change: bool,
    pub gate_passed: bool,
    pub qualifying: bool,
    pub period_record_sha256: String,
}

/// Continuité documentaire : FULL, sinon les `sequence_number` en rupture.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct Continuity {
    pub kind: ContinuityKind,
    /// `sequence_number` des périodes dont `hash_start != hash_end` précédent.
    pub gaps: Vec<u64>,
}

/// Résumé de verdict agrégé (signaux, sans surpromesse).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct VerdictEngineSummary {
    pub total_periods: u32,
    pub qualifying_periods: u32,
    pub total_active_seconds: u64,
    pub continuity: ContinuityKind,
    pub verdict: ProofVerdict,
}

/// Référence documentaire à l'instant de la construction.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct DocumentRef {
    pub document_path: String,
    pub hash_current: String,
    pub size_current: u64,
}

/// Évidence cumulative (NON signée en 6A).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct CoreEvidence {
    pub schema_version: u32,
    pub work_id: WorkId,
    pub certificate_version: CertificateVersion,
    pub document: DocumentRef,
    pub included_periods: Vec<IncludedPeriod>,
    pub new_period_ids: Vec<String>,
    pub qualifying_new_period_count: u32,
    pub continuity: Continuity,
    pub verdict: VerdictEngineSummary,
    pub previous_certificate_id: Option<String>,
    pub previous_core_evidence_sha256: Option<String>,
}

/// Référence minimale au certificat précédent (fournie par 6B ; `None` sinon).
pub(crate) struct PreviousCertificateRef {
    pub certificate_id: String,
    pub core_evidence_sha256: String,
    pub included_period_ids: Vec<String>,
}

/// Bundle en mémoire : l'évidence + les périodes ordonnées (pour 6B).
pub(crate) struct CertificateDraft {
    pub core_evidence: CoreEvidence,
    pub periods: Vec<ObservationPeriod>,
}

// --- EXTRACTION DE SIGNAUX MOTEUR ---------------------------------------------

/// `gate_passed` extrait de `engine.analysis.gate_passed` (défaut conservateur
/// `false` si absent/malformé).
fn period_gate_passed(p: &ObservationPeriod) -> bool {
    p.engine
        .get("analysis")
        .and_then(|a| a.get("gate_passed"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Secondes actives estimées (`engine.analysis.active_est_sec`, défaut 0).
fn period_active_sec(p: &ObservationPeriod) -> u64 {
    p.engine
        .get("analysis")
        .and_then(|a| a.get("active_est_sec"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

/// Période qualifiante = gate franchi ET changement documentaire net.
/// `pub(crate)` : réutilisée en lecture seule par `get_work_summary` (aucune
/// duplication de la définition de qualification).
pub(crate) fn period_is_qualifying(p: &ObservationPeriod) -> bool {
    period_gate_passed(p) && p.net_document_change
}

fn to_included(p: &ObservationPeriod) -> IncludedPeriod {
    let gate_passed = period_gate_passed(p);
    IncludedPeriod {
        period_id: p.period_id.clone(),
        sequence_number: p.sequence_number,
        hash_start: p.hash_start.clone(),
        hash_end: p.hash_end.clone(),
        size_start: p.size_start,
        size_end: p.size_end,
        net_document_change: p.net_document_change,
        gate_passed,
        qualifying: gate_passed && p.net_document_change,
        period_record_sha256: p.period_record_sha256.clone(),
    }
}

// --- CONTINUITÉ / VERDICT -----------------------------------------------------

/// Continuité documentaire : gap au `sequence_number` d'une période dont le
/// `hash_start` diffère du `hash_end` de la période précédente.
fn compute_continuity(chain: &[ObservationPeriod]) -> Continuity {
    let mut gaps: Vec<u64> = Vec::new();
    for i in 1..chain.len() {
        if chain[i].hash_start != chain[i - 1].hash_end {
            gaps.push(chain[i].sequence_number);
        }
    }
    let kind = if gaps.is_empty() {
        ContinuityKind::Full
    } else {
        ContinuityKind::Gapped
    };
    Continuity { kind, gaps }
}

fn summarize_verdict(
    included: &[IncludedPeriod],
    chain: &[ObservationPeriod],
    continuity: &Continuity,
) -> VerdictEngineSummary {
    let qualifying_periods = included.iter().filter(|p| p.qualifying).count() as u32;
    let total_active_seconds: u64 = chain.iter().map(period_active_sec).sum();
    let verdict = match continuity.kind {
        ContinuityKind::Full => ProofVerdict::ObservedWorkConsistent,
        ContinuityKind::Gapped => ProofVerdict::ObservedWorkWithGaps,
    };
    VerdictEngineSummary {
        total_periods: included.len() as u32,
        qualifying_periods,
        total_active_seconds,
        continuity: continuity.kind,
        verdict,
    }
}

// --- PRÉFIXE V2 ---------------------------------------------------------------

/// Vérifie que `previous.included_period_ids` est EXACTEMENT un préfixe ordonné
/// de la chaîne courante, et renvoie la longueur du préfixe (index de départ des
/// nouvelles périodes). Sinon `PreviousCertificateMismatch`.
fn validate_previous_prefix(
    chain: &[ObservationPeriod],
    previous: &PreviousCertificateRef,
) -> Result<usize, CertificateError> {
    if previous.included_period_ids.len() > chain.len() {
        return Err(CertificateError::PreviousCertificateMismatch);
    }
    for (i, pid) in previous.included_period_ids.iter().enumerate() {
        if &chain[i].period_id != pid {
            return Err(CertificateError::PreviousCertificateMismatch);
        }
    }
    Ok(previous.included_period_ids.len())
}

// --- CONSTRUCTION -------------------------------------------------------------

/// Construit la CoreEvidence cumulative d'un Work (draft en mémoire, non signé).
pub(crate) fn build_certificate_draft(
    works_root: &Path,
    work_id: &WorkId,
    previous: Option<&PreviousCertificateRef>,
) -> Result<CertificateDraft, CertificateError> {
    // Document courant (chemin depuis les métadonnées du Work).
    let record = work_store::read_work_metadata(works_root, work_id)
        .map_err(CertificateError::DocumentUnavailable)?;
    let document_path = record.document.document_path.clone();

    // Chaîne vérifiée 0->N (fork/trou/altération/linkage -> erreur dure).
    let chain = work_period::load_verified_chain(works_root, work_id)
        .map_err(CertificateError::ChainInvalid)?;
    if chain.is_empty() {
        return Err(CertificateError::NoPeriods);
    }

    // Préfixe V2 exact (ou 0 en V1).
    let prefix_len = match previous {
        Some(prev) => validate_previous_prefix(&chain, prev)?,
        None => 0,
    };

    // included = TOUTE la chaîne (jamais de sélection opportuniste).
    let included_periods: Vec<IncludedPeriod> = chain.iter().map(to_included).collect();

    // Nouvelles périodes = suffixe après le préfixe.
    let new_periods = &chain[prefix_len..];
    let new_period_ids: Vec<String> = new_periods.iter().map(|p| p.period_id.clone()).collect();
    let qualifying_new_period_count = new_periods
        .iter()
        .filter(|p| period_is_qualifying(p))
        .count() as u32;
    if qualifying_new_period_count == 0 {
        return Err(CertificateError::NoQualifyingNewPeriod);
    }

    // Document inchangé depuis le dernier stop : hash actuel == hash_end final.
    let last = chain.last().expect("chaîne non vide");
    let (_p, hash_current, size_current) =
        crate::work_commands::capture_start_boundary(&document_path)
            .map_err(CertificateError::DocumentUnavailable)?;
    if hash_current != last.hash_end {
        return Err(CertificateError::DocumentModifiedAfterStop);
    }

    let continuity = compute_continuity(&chain);
    let verdict = summarize_verdict(&included_periods, &chain, &continuity);
    let certificate_version = if previous.is_some() {
        CertificateVersion::V2
    } else {
        CertificateVersion::V1
    };

    let core_evidence = CoreEvidence {
        schema_version: CORE_EVIDENCE_SCHEMA_VERSION,
        work_id: work_id.clone(),
        certificate_version,
        document: DocumentRef {
            document_path,
            hash_current,
            size_current,
        },
        included_periods,
        new_period_ids,
        qualifying_new_period_count,
        continuity,
        verdict,
        previous_certificate_id: previous.map(|p| p.certificate_id.clone()),
        previous_core_evidence_sha256: previous.map(|p| p.core_evidence_sha256.clone()),
    };

    Ok(CertificateDraft {
        core_evidence,
        periods: chain,
    })
}

/// SHA256 canonique (HO-CANON-V1) de la CoreEvidence PRIVÉE (avec document_path).
/// À usage interne uniquement — JAMAIS dans le HO-JSON public (garde-fou A).
pub(crate) fn compute_core_evidence_sha256(ev: &CoreEvidence) -> Result<String, String> {
    work_period::canonical_sha256(ev)
}

// --- HO-JSON PUBLIC (6B) ------------------------------------------------------

/// Référence documentaire PUBLIQUE — AUCUN champ chemin (impossible d'exposer
/// un `document_path` : le champ n'existe pas).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicDocumentRef {
    pub hash_current: String,
    pub size_current: u64,
}

/// Projection PARTAGEABLE de `CoreEvidence` : path-free (garde-fou #1).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicCoreEvidence {
    pub schema_version: u32,
    pub work_id: WorkId,
    pub certificate_version: CertificateVersion,
    pub document: PublicDocumentRef,
    pub included_period_summaries: Vec<IncludedPeriod>,
    pub new_period_ids: Vec<String>,
    pub qualifying_new_period_count: u32,
    pub continuity: Continuity,
    pub verdict: VerdictEngineSummary,
    pub previous_certificate_id: Option<String>,
    pub previous_core_evidence_sha256: Option<String>,
}

/// Projette la CoreEvidence privée en évidence publique (retire `document_path`
/// et n'embarque JAMAIS d'`ObservationPeriod` complète).
fn project_public(ev: &CoreEvidence) -> PublicCoreEvidence {
    PublicCoreEvidence {
        schema_version: ev.schema_version,
        work_id: ev.work_id.clone(),
        certificate_version: ev.certificate_version,
        document: PublicDocumentRef {
            hash_current: ev.document.hash_current.clone(),
            size_current: ev.document.size_current,
        },
        included_period_summaries: ev.included_periods.clone(),
        new_period_ids: ev.new_period_ids.clone(),
        qualifying_new_period_count: ev.qualifying_new_period_count,
        continuity: ev.continuity.clone(),
        verdict: ev.verdict.clone(),
        previous_certificate_id: ev.previous_certificate_id.clone(),
        previous_core_evidence_sha256: ev.previous_core_evidence_sha256.clone(),
    }
}

/// SHA256 canonique de l'évidence PUBLIQUE (garde-fou A : c'est CE hash qui va
/// dans le certificat, jamais celui de la CoreEvidence privée).
pub(crate) fn compute_public_core_evidence_sha256(
    p: &PublicCoreEvidence,
) -> Result<String, String> {
    work_period::canonical_sha256(p)
}

/// Métadonnées de signature du certificat (incluses dans le corps signé).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct CertificateSignatureMetadata {
    pub signature_algorithm: String,
    pub public_key: String,
    pub signing_key_id: String,
    pub identity_status: String,
    pub schema_version: u32,
}

/// HO-JSON Work Certificate : résumé path-free signé par la clé device.
/// Ne prétend PAS permettre la re-vérification indépendante des signatures de
/// période (garde-fou #1) : c'est un engagement device sur des summaries.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkCertificate {
    pub schema_version: u32,
    pub certificate_id: String,
    pub certificate_sequence: u64,
    pub created_at: String,
    pub work_id: WorkId,
    pub certificate_version: CertificateVersion,
    pub public_core_evidence: PublicCoreEvidence,
    pub core_evidence_sha256: String,
    pub previous_certificate_id: Option<String>,
    pub previous_core_evidence_sha256: Option<String>,
    pub signature_metadata: CertificateSignatureMetadata,
    pub signature: String,
}

fn sha256_hex_str(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

fn decode_b64_fixed<const N: usize>(s: &str) -> Result<[u8; N], String> {
    let bytes = general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())?;
    if bytes.len() != N {
        return Err(format!("longueur base64 inattendue : {}", bytes.len()));
    }
    let mut arr = [0u8; N];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Vérifie un certificat : algo, identité, `signing_key_id`, cohérence du
/// `core_evidence_sha256` public, et signature Ed25519 sur le corps canonique
/// excluant UNIQUEMENT `signature`. `Err(raison)` si invalide.
pub(crate) fn verify_certificate(cert: &WorkCertificate) -> Result<(), String> {
    let meta = &cert.signature_metadata;
    if meta.signature_algorithm != SIGN_ALG {
        return Err(format!(
            "algorithme inattendu : {}",
            meta.signature_algorithm
        ));
    }
    if meta.identity_status != LOCAL_DEVICE_IDENTITY {
        return Err(format!("identité inattendue : {}", meta.identity_status));
    }
    if meta.signing_key_id != sha256_hex_str(&meta.public_key) {
        return Err("signing_key_id incohérent avec la clé publique".to_string());
    }

    let expected = compute_public_core_evidence_sha256(&cert.public_core_evidence)?;
    if cert.core_evidence_sha256 != expected {
        return Err("core_evidence_sha256 ne correspond pas à public_core_evidence".to_string());
    }

    let body = work_period::canonical_bytes_excluding(cert, &["signature"])?;
    let digest = Sha256::digest(&body);
    let pk = decode_b64_fixed::<32>(&meta.public_key)?;
    let verifying_key = VerifyingKey::from_bytes(&pk).map_err(|e| e.to_string())?;
    let sig = Signature::from_bytes(&decode_b64_fixed::<64>(&cert.signature)?);
    verifying_key
        .verify_strict(digest.as_slice(), &sig)
        .map_err(|_| "signature de certificat invalide".to_string())
}

// --- I/O ATOMIQUE -------------------------------------------------------------

fn certificates_dir(works_root: &Path, work_id: &WorkId) -> PathBuf {
    works_root.join(work_id.as_str()).join(CERTIFICATES_DIR)
}

fn certificate_path(works_root: &Path, work_id: &WorkId, sequence: u64) -> PathBuf {
    certificates_dir(works_root, work_id).join(format!("certificate_{sequence}.json"))
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

/// Écriture atomique SANS écrasement (temp + fsync + hard_link + fsync parent).
fn write_atomic_new(path: &Path, bytes: &[u8]) -> Result<(), CertificateError> {
    let parent = path
        .parent()
        .ok_or_else(|| CertificateError::Io("chemin sans parent".into()))?;
    fs::create_dir_all(parent).map_err(|e| CertificateError::Io(e.to_string()))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| CertificateError::Io("nom de fichier invalide".into()))?;
    let tmp = parent.join(format!(".{}.tmp-{}", file_name, uuid::Uuid::new_v4()));

    let write = (|| -> Result<(), String> {
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
    if let Err(e) = write {
        let _ = fs::remove_file(&tmp);
        return Err(CertificateError::Io(e));
    }

    let link = fs::hard_link(&tmp, path);
    let _ = fs::remove_file(&tmp);
    match link {
        Ok(()) => {
            sync_dir(parent);
            Ok(())
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err(CertificateError::Io(format!(
            "certificat déjà existant, écrasement refusé : {}",
            path.display()
        ))),
        Err(e) => Err(CertificateError::Io(e.to_string())),
    }
}

// --- CHARGEMENT / CHAÎNE V1/V2 ------------------------------------------------

fn parse_certificate_filename_seq(name: &str) -> Option<u64> {
    name.strip_prefix("certificate_")?
        .strip_suffix(".json")?
        .parse::<u64>()
        .ok()
}

/// Charge et vérifie DUREMENT la chaîne de certificats d'un Work (garde-fou B).
/// Aucun skip silencieux : tout certificat corrompu / mal signé /
/// `core_evidence_sha256` faux / séquence ou linkage incohérent ->
/// `CertificateChainTampered`. Retourne la chaîne ordonnée (vide si aucun).
pub(crate) fn load_certificates(
    works_root: &Path,
    work_id: &WorkId,
) -> Result<Vec<WorkCertificate>, CertificateError> {
    let dir = certificates_dir(works_root, work_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut by_seq: BTreeMap<u64, WorkCertificate> = BTreeMap::new();
    for entry in fs::read_dir(&dir).map_err(|e| CertificateError::Io(e.to_string()))? {
        let entry = entry.map_err(|e| CertificateError::Io(e.to_string()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !(name.starts_with("certificate_") && name.ends_with(".json")) {
            continue;
        }

        let raw = fs::read_to_string(&path).map_err(|e| CertificateError::Io(e.to_string()))?;
        let cert: WorkCertificate = serde_json::from_str(&raw).map_err(|e| {
            CertificateError::CertificateChainTampered(format!("JSON invalide : {e}"))
        })?;
        verify_certificate(&cert).map_err(CertificateError::CertificateChainTampered)?;

        if let Some(fname_seq) = parse_certificate_filename_seq(&name) {
            if fname_seq != cert.certificate_sequence {
                return Err(CertificateError::CertificateChainTampered(format!(
                    "nom/contenu incohérents : {name}"
                )));
            }
        }
        if by_seq.contains_key(&cert.certificate_sequence) {
            return Err(CertificateError::CertificateChainTampered(format!(
                "doublon de séquence {}",
                cert.certificate_sequence
            )));
        }
        by_seq.insert(cert.certificate_sequence, cert);
    }

    if by_seq.is_empty() {
        return Ok(Vec::new());
    }

    // Séquence contiguë 1..=max + linkage previous_* correct.
    let max_seq = *by_seq.keys().next_back().unwrap();
    let mut chain: Vec<WorkCertificate> = Vec::with_capacity(max_seq as usize);
    for seq in 1..=max_seq {
        let cur = by_seq.get(&seq).ok_or_else(|| {
            CertificateError::CertificateChainTampered(format!("séquence manquante : {seq}"))
        })?;
        if seq == 1 {
            if cur.previous_certificate_id.is_some() || cur.previous_core_evidence_sha256.is_some()
            {
                return Err(CertificateError::CertificateChainTampered(
                    "le premier certificat ne doit avoir aucun lien précédent".into(),
                ));
            }
        } else {
            let prev = &chain[(seq - 2) as usize];
            if cur.previous_certificate_id.as_deref() != Some(prev.certificate_id.as_str()) {
                return Err(CertificateError::CertificateChainTampered(
                    "previous_certificate_id incohérent".into(),
                ));
            }
            if cur.previous_core_evidence_sha256.as_deref()
                != Some(prev.core_evidence_sha256.as_str())
            {
                return Err(CertificateError::CertificateChainTampered(
                    "previous_core_evidence_sha256 incohérent".into(),
                ));
            }
        }
        chain.push(cur.clone());
    }
    Ok(chain)
}

/// Dernier certificat valide (tête de chaîne vérifiée) ou `None`.
pub(crate) fn find_last_valid_certificate(
    works_root: &Path,
    work_id: &WorkId,
) -> Result<Option<WorkCertificate>, CertificateError> {
    Ok(load_certificates(works_root, work_id)?.into_iter().last())
}

// --- CRÉATION DU CERTIFICAT (interne, non exposé Tauri en 6B) -----------------

/// Construit + signe + écrit le certificat HO-JSON path-free d'un Work.
/// `created_at` fourni par l'appelant (déterminisme). Clé injectée (`sign_fn`
/// interne) pour l'isolation des tests. Écrit `certificate_{seq}.json`.
fn create_work_certificate_with(
    works_root: &Path,
    work_id: &WorkId,
    created_at: &str,
    signing_key: &SigningKey,
) -> Result<WorkCertificate, CertificateError> {
    // Chaîne de certificats existante (erreur dure si un certificat est invalide).
    let existing = load_certificates(works_root, work_id)?;
    let last = existing.last();

    let previous_ref = last.map(|c| PreviousCertificateRef {
        certificate_id: c.certificate_id.clone(),
        core_evidence_sha256: c.core_evidence_sha256.clone(),
        included_period_ids: c
            .public_core_evidence
            .included_period_summaries
            .iter()
            .map(|p| p.period_id.clone())
            .collect(),
    });

    // Évidence (6A) : impose ≥1 nouvelle qualifiante, doc inchangé, préfixe exact.
    let draft = build_certificate_draft(works_root, work_id, previous_ref.as_ref())?;
    let public = project_public(&draft.core_evidence);
    let core_evidence_sha256 =
        compute_public_core_evidence_sha256(&public).map_err(CertificateError::Io)?;

    let certificate_sequence = last.map(|c| c.certificate_sequence + 1).unwrap_or(1);
    let previous_certificate_id = last.map(|c| c.certificate_id.clone());
    let previous_core_evidence_sha256 = last.map(|c| c.core_evidence_sha256.clone());

    let public_key = general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes());
    let signing_key_id = sha256_hex_str(&public_key);

    let mut cert = WorkCertificate {
        schema_version: CERTIFICATE_SCHEMA_VERSION,
        certificate_id: uuid::Uuid::new_v4().to_string(),
        certificate_sequence,
        created_at: created_at.to_string(),
        work_id: work_id.clone(),
        certificate_version: draft.core_evidence.certificate_version,
        public_core_evidence: public,
        core_evidence_sha256,
        previous_certificate_id,
        previous_core_evidence_sha256,
        signature_metadata: CertificateSignatureMetadata {
            signature_algorithm: SIGN_ALG.to_string(),
            public_key,
            signing_key_id,
            identity_status: LOCAL_DEVICE_IDENTITY.to_string(),
            schema_version: CERTIFICATE_SCHEMA_VERSION,
        },
        signature: String::new(),
    };

    // Signature sur corps canonique excluant UNIQUEMENT `signature`.
    let body = work_period::canonical_bytes_excluding(&cert, &["signature"])
        .map_err(CertificateError::Io)?;
    let digest = Sha256::digest(&body);
    cert.signature =
        general_purpose::STANDARD.encode(signing_key.sign(digest.as_slice()).to_bytes());

    // Écriture atomique, refus d'écrasement.
    let path = certificate_path(works_root, work_id, certificate_sequence);
    let json = serde_json::to_vec_pretty(&cert).map_err(|e| CertificateError::Io(e.to_string()))?;
    write_atomic_new(&path, &json)?;

    Ok(cert)
}

/// Point d'entrée production : signe avec la clé device (`ensure_signing_key`).
/// Non exposé en commande Tauri en 6B.
pub(crate) fn create_work_certificate_core(
    works_root: &Path,
    work_id: &WorkId,
    created_at: &str,
) -> Result<WorkCertificate, CertificateError> {
    let key = crate::ensure_signing_key().map_err(CertificateError::Io)?;
    create_work_certificate_with(works_root, work_id, created_at, &key)
}

// --- TESTS UNITAIRES ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn temp_base() -> PathBuf {
        std::env::temp_dir().join(format!("ho_cert_test_{}", Uuid::new_v4()))
    }

    fn cleanup(p: &Path) {
        let _ = fs::remove_dir_all(p);
    }

    fn sha_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Crée un vrai document + un Work ; renvoie (works, wid, doc_path, doc_hash).
    fn make_work(base: &Path, content: &[u8]) -> (PathBuf, WorkId, PathBuf, String) {
        let works = base.join("Works");
        let docs = base.join("docs");
        fs::create_dir_all(&docs).unwrap();
        let doc = docs.join("sujet.txt");
        fs::write(&doc, content).unwrap();
        let outcome =
            crate::work_commands::create_work_core(&works, doc.to_str().unwrap(), None, None)
                .unwrap();
        let wid = match outcome {
            crate::work_commands::CreateWorkOutcome::Created { work_id } => work_id,
            other => panic!("attendu Created, reçu {:?}", other),
        };
        (works, wid, doc, sha_hex(content))
    }

    #[allow(clippy::too_many_arguments)]
    fn seed(
        works: &Path,
        wid: &WorkId,
        seq: u64,
        prev: Option<&ObservationPeriod>,
        hash_start: &str,
        hash_end: &str,
        gate_passed: bool,
    ) -> ObservationPeriod {
        let key = SigningKey::generate(&mut OsRng);
        let inputs = work_period::PeriodInputs {
            period_id: Uuid::new_v4().to_string(),
            work_id: wid.clone(),
            sequence_number: seq,
            previous_period_id: prev.map(|p| p.period_id.clone()),
            previous_period_record_sha256: prev.map(|p| p.period_record_sha256.clone()),
            document_path: "/tmp/sujet.txt".to_string(),
            hash_start: hash_start.to_string(),
            size_start: 10,
            hash_end: hash_end.to_string(),
            size_end: 20,
            change_observed_during_period: false,
            engine: json!({ "analysis": { "gate_passed": gate_passed, "active_est_sec": 60 } }),
        };
        let p = work_period::sign_period_record(inputs, &key).unwrap();
        work_period::write_period_once(works, &p).unwrap();
        p
    }

    #[test]
    fn test_1_work_sans_periode_no_periods() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_work(&base, b"x");
        let res = build_certificate_draft(&works, &wid, None);
        assert_eq!(res.err(), Some(CertificateError::NoPeriods));
        cleanup(&base);
    }

    #[test]
    fn test_2_periode_non_qualifiante_refuse() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"contenu");
        // gate_passed=false -> non qualifiante (hash_end == h pour isoler la cause).
        seed(&works, &wid, 0, None, &"a".repeat(64), &h, false);
        let res = build_certificate_draft(&works, &wid, None);
        assert_eq!(res.err(), Some(CertificateError::NoQualifyingNewPeriod));
        cleanup(&base);
    }

    #[test]
    fn test_3_periode_qualifiante_ok() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"contenu");
        // qualifiante : gate true, net true (hash_start != hash_end), hash_end == doc courant.
        seed(&works, &wid, 0, None, &"a".repeat(64), &h, true);
        let draft = build_certificate_draft(&works, &wid, None).unwrap();
        assert_eq!(
            draft.core_evidence.certificate_version,
            CertificateVersion::V1
        );
        assert_eq!(draft.core_evidence.included_periods.len(), 1);
        assert_eq!(draft.core_evidence.qualifying_new_period_count, 1);
        assert_eq!(draft.core_evidence.document.hash_current, h);
        assert_eq!(
            draft.core_evidence.verdict.verdict,
            ProofVerdict::ObservedWorkConsistent
        );
        // sha canonique déterministe.
        let s1 = compute_core_evidence_sha256(&draft.core_evidence).unwrap();
        let s2 = compute_core_evidence_sha256(&draft.core_evidence).unwrap();
        assert_eq!(s1, s2);
        cleanup(&base);
    }

    #[test]
    fn test_4_document_modifie_apres_stop_refuse() {
        let base = temp_base();
        let (works, wid, doc, h) = make_work(&base, b"avant");
        seed(&works, &wid, 0, None, &"a".repeat(64), &h, true);
        // Modifie le document APRÈS le stop (hash courant != hash_end).
        fs::write(&doc, b"apres modifie").unwrap();
        let res = build_certificate_draft(&works, &wid, None);
        assert_eq!(res.err(), Some(CertificateError::DocumentModifiedAfterStop));
        cleanup(&base);
    }

    #[test]
    fn test_5_periodes_cumulatives_dans_ordre() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"final");
        let p0 = seed(
            &works,
            &wid,
            0,
            None,
            &"a".repeat(64),
            &"b".repeat(64),
            true,
        );
        let p1 = seed(
            &works,
            &wid,
            1,
            Some(&p0),
            &"b".repeat(64),
            &"c".repeat(64),
            true,
        );
        seed(&works, &wid, 2, Some(&p1), &"c".repeat(64), &h, true);
        let draft = build_certificate_draft(&works, &wid, None).unwrap();
        let seqs: Vec<u64> = draft
            .core_evidence
            .included_periods
            .iter()
            .map(|p| p.sequence_number)
            .collect();
        assert_eq!(seqs, vec![0, 1, 2]);
        cleanup(&base);
    }

    #[test]
    fn test_6_gap_documentaire() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"final");
        let p0 = seed(
            &works,
            &wid,
            0,
            None,
            &"a".repeat(64),
            &"b".repeat(64),
            true,
        );
        // p1.hash_start = "x" != p0.hash_end "b" -> gap au sequence_number 1.
        seed(&works, &wid, 1, Some(&p0), &"x".repeat(64), &h, true);
        let draft = build_certificate_draft(&works, &wid, None).unwrap();
        assert_eq!(draft.core_evidence.continuity.kind, ContinuityKind::Gapped);
        assert_eq!(draft.core_evidence.continuity.gaps, vec![1]);
        assert_eq!(
            draft.core_evidence.verdict.verdict,
            ProofVerdict::ObservedWorkWithGaps
        );
        cleanup(&base);
    }

    #[test]
    fn test_7_melange_qualifiantes_non_qualifiantes_toutes_incluses() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"final");
        // p0 non qualifiante (gate false), p1 qualifiante.
        let p0 = seed(
            &works,
            &wid,
            0,
            None,
            &"a".repeat(64),
            &"b".repeat(64),
            false,
        );
        seed(&works, &wid, 1, Some(&p0), &"b".repeat(64), &h, true);
        let draft = build_certificate_draft(&works, &wid, None).unwrap();
        // TOUTES incluses (aucune sélection opportuniste).
        assert_eq!(draft.core_evidence.included_periods.len(), 2);
        assert_eq!(draft.core_evidence.qualifying_new_period_count, 1);
        cleanup(&base);
    }

    #[test]
    fn test_8_v2_prefix_valide_new_est_suffix() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"final");
        let p0 = seed(
            &works,
            &wid,
            0,
            None,
            &"a".repeat(64),
            &"b".repeat(64),
            true,
        );
        let p1 = seed(&works, &wid, 1, Some(&p0), &"b".repeat(64), &h, true);

        let previous = PreviousCertificateRef {
            certificate_id: "cert-1".to_string(),
            core_evidence_sha256: "0".repeat(64),
            included_period_ids: vec![p0.period_id.clone()],
        };
        let draft = build_certificate_draft(&works, &wid, Some(&previous)).unwrap();
        assert_eq!(
            draft.core_evidence.certificate_version,
            CertificateVersion::V2
        );
        assert_eq!(draft.core_evidence.included_periods.len(), 2);
        assert_eq!(
            draft.core_evidence.new_period_ids,
            vec![p1.period_id.clone()]
        );
        assert_eq!(
            draft.core_evidence.previous_certificate_id.as_deref(),
            Some("cert-1")
        );
        cleanup(&base);
    }

    #[test]
    fn test_9_v2_previous_non_prefixe_mismatch() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"final");
        let p0 = seed(
            &works,
            &wid,
            0,
            None,
            &"a".repeat(64),
            &"b".repeat(64),
            true,
        );
        let p1 = seed(&works, &wid, 1, Some(&p0), &"b".repeat(64), &h, true);

        // previous = [p1] n'est PAS un préfixe (chain[0] == p0 != p1).
        let previous = PreviousCertificateRef {
            certificate_id: "cert-x".to_string(),
            core_evidence_sha256: "0".repeat(64),
            included_period_ids: vec![p1.period_id.clone()],
        };
        let res = build_certificate_draft(&works, &wid, Some(&previous));
        assert_eq!(
            res.err(),
            Some(CertificateError::PreviousCertificateMismatch)
        );
        cleanup(&base);
    }

    #[test]
    fn test_10_v2_sans_nouvelle_qualifiante_refuse() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"final");
        let p0 = seed(
            &works,
            &wid,
            0,
            None,
            &"a".repeat(64),
            &"b".repeat(64),
            true,
        );
        let p1 = seed(&works, &wid, 1, Some(&p0), &"b".repeat(64), &h, true);

        // previous couvre TOUTE la chaîne -> aucune nouvelle période.
        let previous = PreviousCertificateRef {
            certificate_id: "cert-2".to_string(),
            core_evidence_sha256: "0".repeat(64),
            included_period_ids: vec![p0.period_id.clone(), p1.period_id.clone()],
        };
        let res = build_certificate_draft(&works, &wid, Some(&previous));
        assert_eq!(res.err(), Some(CertificateError::NoQualifyingNewPeriod));
        cleanup(&base);
    }

    #[test]
    fn test_11_alteration_periode_chain_invalid() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_work(&base, b"final");
        let p0 = seed(
            &works,
            &wid,
            0,
            None,
            &"a".repeat(64),
            &"b".repeat(64),
            true,
        );
        seed(&works, &wid, 1, Some(&p0), &"b".repeat(64), &h, true);
        // Corrompt period_1.json sur disque.
        let periods_dir = works.join(wid.as_str()).join("periods");
        fs::write(periods_dir.join("period_1.json"), b"{ corrompu").unwrap();

        let res = build_certificate_draft(&works, &wid, None);
        assert!(matches!(res, Err(CertificateError::ChainInvalid(_))));
        cleanup(&base);
    }

    // --- 6B : HO-JSON Work Certificate signé -------------------------------

    fn key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    /// Work certifiable minimal : 1 période qualifiante, doc courant == hash_end.
    fn make_certifiable(base: &Path, content: &[u8]) -> (PathBuf, WorkId, PathBuf, String) {
        let (works, wid, doc, h) = make_work(base, content);
        seed(&works, &wid, 0, None, &"a".repeat(64), &h, true);
        (works, wid, doc, h)
    }

    fn cert_dir(works: &Path, wid: &WorkId) -> PathBuf {
        works.join(wid.as_str()).join("certificates")
    }

    #[test]
    fn test_6b_1_certificat_v1_signe_verifiable() {
        let base = temp_base();
        let (works, wid, _doc, h) = make_certifiable(&base, b"contenu");
        let k = key();
        let cert = create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &k).unwrap();

        assert_eq!(cert.certificate_version, CertificateVersion::V1);
        assert_eq!(cert.certificate_sequence, 1);
        assert!(cert.previous_certificate_id.is_none());
        assert_eq!(cert.public_core_evidence.document.hash_current, h);
        assert_eq!(cert.signature_metadata.identity_status, "LOCAL_DEVICE");
        assert!(verify_certificate(&cert).is_ok());
        // Fichier écrit.
        assert!(cert_dir(&works, &wid).join("certificate_1.json").exists());
        cleanup(&base);
    }

    #[test]
    fn test_6b_2_signature_echoue_si_body_change() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_certifiable(&base, b"contenu");
        let cert =
            create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &key()).unwrap();

        // Altère un champ du corps -> signature invalide.
        let mut c1 = cert.clone();
        c1.certificate_id = "falsifie".to_string();
        assert!(verify_certificate(&c1).is_err());

        // Altère signature_metadata -> invalide.
        let mut c2 = cert.clone();
        c2.signature_metadata.identity_status = "REMOTE".to_string();
        assert!(verify_certificate(&c2).is_err());

        // Altère public_core_evidence -> core_evidence_sha256 ne correspond plus.
        let mut c3 = cert.clone();
        c3.public_core_evidence.qualifying_new_period_count += 1;
        assert!(verify_certificate(&c3).is_err());
        cleanup(&base);
    }

    #[test]
    fn test_6b_3_json_sans_document_path_ni_users_ni_periode_complete() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_certifiable(&base, b"contenu");
        create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &key()).unwrap();

        let json = fs::read_to_string(cert_dir(&works, &wid).join("certificate_1.json")).unwrap();
        // Pas de clé document_path, pas de chemin absolu du document, pas de /Users/.
        assert!(!json.contains("document_path"), "document_path exposé !");
        assert!(!json.contains("/Users/"), "chemin /Users/ exposé !");
        let doc_path = work_store::read_work_metadata(&works, &wid)
            .unwrap()
            .document
            .document_path;
        assert!(!json.contains(&doc_path), "chemin document exposé !");
        // Pas d'ObservationPeriod complète : marqueur `engine` absent.
        assert!(
            !json.contains("\"engine\""),
            "ObservationPeriod complète exposée !"
        );
        cleanup(&base);
    }

    #[test]
    fn test_6b_4_certificat_v2_avec_previous_valide() {
        let base = temp_base();
        // v1 sur le contenu C1.
        let (works, wid, doc, _h1) = make_certifiable(&base, b"C1-contenu");
        let k = key();
        let v1 = create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &k).unwrap();

        // Le document évolue -> C2 ; nouvelle période qualifiante p1 (continuité FULL).
        let h1 = sha_hex(b"C1-contenu");
        let h2 = sha_hex(b"C2-modifie");
        fs::write(&doc, b"C2-modifie").unwrap();
        // p0 (seq 0) a hash_end == h1 ; on lit p0 pour chaîner p1.
        let p0 = work_period::read_period(&works, &wid, 0).unwrap();
        let p1 = seed(&works, &wid, 1, Some(&p0), &h1, &h2, true);

        let v2 = create_work_certificate_with(&works, &wid, "2026-08-02T10:00:00Z", &k).unwrap();
        assert_eq!(v2.certificate_version, CertificateVersion::V2);
        assert_eq!(v2.certificate_sequence, 2);
        assert_eq!(
            v2.previous_certificate_id.as_deref(),
            Some(v1.certificate_id.as_str())
        );
        assert_eq!(
            v2.previous_core_evidence_sha256.as_deref(),
            Some(v1.core_evidence_sha256.as_str())
        );
        assert_eq!(
            v2.public_core_evidence.new_period_ids,
            vec![p1.period_id.clone()]
        );
        assert_eq!(v2.public_core_evidence.document.hash_current, h2);
        assert!(verify_certificate(&v2).is_ok());
        cleanup(&base);
    }

    #[test]
    fn test_6b_5_v2_sans_nouvelle_qualifiante_refuse() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_certifiable(&base, b"contenu");
        let k = key();
        create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &k).unwrap();
        // Aucune nouvelle période -> v2 refusé.
        let res = create_work_certificate_with(&works, &wid, "2026-08-02T10:00:00Z", &k);
        assert_eq!(res.err(), Some(CertificateError::NoQualifyingNewPeriod));
        cleanup(&base);
    }

    #[test]
    fn test_6b_6_certificat_existant_invalide_refuse_sans_skip() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_certifiable(&base, b"contenu");
        let k = key();
        create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &k).unwrap();
        // Corrompt le certificat existant sur disque.
        fs::write(
            cert_dir(&works, &wid).join("certificate_1.json"),
            b"{ pas un certificat }",
        )
        .unwrap();
        // Toute nouvelle création DOIT échouer durement (pas de skip silencieux).
        let res = create_work_certificate_with(&works, &wid, "2026-08-02T10:00:00Z", &k);
        assert!(matches!(
            res,
            Err(CertificateError::CertificateChainTampered(_))
        ));
        cleanup(&base);
    }

    #[test]
    fn test_6b_7_document_modifie_apres_stop_refuse() {
        let base = temp_base();
        let (works, wid, doc, _h) = make_certifiable(&base, b"contenu");
        fs::write(&doc, b"modifie apres").unwrap();
        let res = create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &key());
        assert_eq!(res.err(), Some(CertificateError::DocumentModifiedAfterStop));
        cleanup(&base);
    }

    #[test]
    fn test_6b_8_ecriture_atomique_sans_overwrite() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_certifiable(&base, b"contenu");
        let path = certificate_path(&works, &wid, 1);
        write_atomic_new(&path, b"{}").unwrap();
        // Deuxième écriture sur la même séquence -> refus.
        let second = write_atomic_new(&path, b"{}");
        assert!(matches!(second, Err(CertificateError::Io(_))));
        cleanup(&base);
    }

    #[test]
    fn test_6b_9_aucun_pdf_ni_manifest_genere() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_certifiable(&base, b"contenu");
        create_work_certificate_with(&works, &wid, "2026-08-01T10:00:00Z", &key()).unwrap();

        // certificates/ ne contient QUE certificate_*.json.
        let only_certs = fs::read_dir(cert_dir(&works, &wid))
            .unwrap()
            .filter_map(|e| e.ok())
            .all(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.starts_with("certificate_") && n.ends_with(".json")
            });
        assert!(
            only_certs,
            "certificates/ ne doit contenir que des certificate_*.json"
        );
        // Aucun .pdf ni manifest nulle part dans le Work.
        let work_dir = works.join(wid.as_str());
        for entry in walk(&work_dir) {
            let n = entry.to_string_lossy().to_lowercase();
            assert!(!n.ends_with(".pdf"), "PDF généré : {n}");
            assert!(!n.contains("manifest"), "manifest généré : {n}");
        }
        cleanup(&base);
    }

    #[test]
    fn test_6b_10_public_sha_change_si_public_evidence_change() {
        let base = temp_base();
        let (works, wid, _doc, _h) = make_certifiable(&base, b"contenu");
        let draft = build_certificate_draft(&works, &wid, None).unwrap();
        let public = project_public(&draft.core_evidence);
        let s1 = compute_public_core_evidence_sha256(&public).unwrap();

        let mut public2 = public.clone();
        public2.qualifying_new_period_count += 1;
        let s2 = compute_public_core_evidence_sha256(&public2).unwrap();
        assert_ne!(s1, s2, "le sha public doit changer si l'évidence change");
        cleanup(&base);
    }

    /// Parcours récursif simple (tests uniquement).
    fn walk(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Ok(rd) = fs::read_dir(dir) {
            for e in rd.filter_map(|e| e.ok()) {
                let p = e.path();
                if p.is_dir() {
                    out.extend(walk(&p));
                } else {
                    out.push(p);
                }
            }
        }
        out
    }
}
