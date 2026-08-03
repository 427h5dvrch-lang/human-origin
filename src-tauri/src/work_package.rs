//! work_package — PackageManifest final signé (Commit 6C-1, backend pur).
//!
//! Portée STRICTE : à partir d'un `certificate_N.json` (6B) et d'un
//! `labeled_document.pdf` DÉJÀ EXISTANTS, assembler un package reproductible :
//!   Works/{work_id}/packages/package_{N}/
//!     certificate.json        (copie byte-identique du certificat)
//!     labeled_document.pdf     (copie du PDF fourni)
//!     manifest.json            (PackageManifest signé)
//!
//! AUCUNE génération de PDF, AUCUN PDFium, AUCUN publish_pdf_core, AUCUNE
//! cartouche, AUCUN DOCX->PDF, AUCUNE commande Tauri, AUCUNE UI, AUCUN verifier,
//! AUCUNE Supabase. Ne touche ni `publication_core.rs` ni `drafts.rs`.
//!
//! Garde-fous :
//! - `verify_manifest` vérifie AUSSI `certificate.json` (parse + `verify_certificate`
//!   + cohérence des champs manifest<->certificat) ;
//! - la clé du manifest doit être CELLE du certificat (`signing_key_id` égal) ;
//! - construction dans un dossier temporaire sibling, publication atomique par
//!   `rename` seulement après `verify_manifest(temp)` OK ; cleanup sinon ;
//! - refus d'écrasement d'un `package_{N}/` existant ;
//! - `manifest.json` écrit EN DERNIER, signature après hash réel des copies.

// Fondation (6C-1) : logique pure ; orchestration PDF/exposition = 6C-2/6D.
#![allow(dead_code)]

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::work_certificate::{
    verify_certificate, CertificateVersion, ProofVerdict, WorkCertificate,
};
use crate::work_period;
use crate::work_store::WorkId;

pub(crate) const PACKAGE_MANIFEST_SCHEMA_VERSION: u32 = 1;

const SIGN_ALG: &str = "ed25519";
const LOCAL_DEVICE_IDENTITY: &str = "LOCAL_DEVICE";
const PACKAGES_DIR: &str = "packages";
const CERTIFICATE_FILENAME: &str = "certificate.json";
const LABELED_PDF_FILENAME: &str = "labeled_document.pdf";
const MANIFEST_FILENAME: &str = "manifest.json";

// --- TYPES --------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PackageError {
    CertificateUnavailable(String),
    CertificateInvalid(String),
    LabeledPdfUnavailable(String),
    KeyMismatch,
    AlreadyExists(String),
    VerifyFailed(String),
    Io(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct FileRef {
    pub filename: String,
    pub sha256: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct ManifestFiles {
    pub certificate: FileRef,
    pub labeled_pdf: FileRef,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct ManifestSignatureMetadata {
    pub signature_algorithm: String,
    pub public_key: String,
    pub signing_key_id: String,
    pub identity_status: String,
    pub schema_version: u32,
}

/// Manifest final signé : lie `certificate.json` et `labeled_document.pdf` par
/// leurs SHA256, sans aucun chemin absolu (filenames relatifs uniquement).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct PackageManifest {
    pub schema_version: u32,
    pub package_id: String,
    pub work_id: WorkId,
    pub certificate_id: String,
    pub certificate_sequence: u64,
    pub created_at: String,
    pub certificate_version: CertificateVersion,
    pub verdict: ProofVerdict,
    pub files: ManifestFiles,
    pub signature_metadata: ManifestSignatureMetadata,
    pub signature: String,
}

// --- HELPERS ------------------------------------------------------------------

fn sha256_hex_str(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

fn sha256_hex_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn sha256_file_hex(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(sha256_hex_bytes(&bytes))
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

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), PackageError> {
    let mut f = File::create(path).map_err(|e| PackageError::Io(e.to_string()))?;
    f.write_all(bytes)
        .map_err(|e| PackageError::Io(e.to_string()))?;
    f.sync_all().map_err(|e| PackageError::Io(e.to_string()))?;
    Ok(())
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

fn packages_dir(works_root: &Path, work_id: &WorkId) -> PathBuf {
    works_root.join(work_id.as_str()).join(PACKAGES_DIR)
}

fn package_dir(works_root: &Path, work_id: &WorkId, sequence: u64) -> PathBuf {
    packages_dir(works_root, work_id).join(format!("package_{sequence}"))
}

// --- SIGNATURE MANIFEST -------------------------------------------------------

/// Corps canonique signé du manifest (HO-CANON-V1, exclut UNIQUEMENT `signature`).
fn manifest_body_digest(manifest: &PackageManifest) -> Result<[u8; 32], String> {
    let body = work_period::canonical_bytes_excluding(manifest, &["signature"])?;
    let d = Sha256::digest(&body);
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&d);
    Ok(arr)
}

// --- VÉRIFICATION -------------------------------------------------------------

/// Vérifie un package complet dans `package_dir` :
/// 1. signature Ed25519 du manifest (corps hors `signature`), algo, identité,
///    `signing_key_id == SHA256(public_key)` ;
/// 2. SHA256 recalculés des fichiers == `files.*.sha256` ;
/// 3. `certificate.json` parsé + `verify_certificate` OK ;
/// 4. cohérence manifest<->certificat : work_id, certificate_id,
///    certificate_sequence, certificate_version, verdict, signing_key_id.
pub(crate) fn verify_manifest(package_dir: &Path) -> Result<(), String> {
    let manifest_raw = fs::read_to_string(package_dir.join(MANIFEST_FILENAME))
        .map_err(|e| format!("manifest illisible : {e}"))?;
    let manifest: PackageManifest =
        serde_json::from_str(&manifest_raw).map_err(|e| format!("manifest invalide : {e}"))?;

    // 1) Signature du manifest.
    let meta = &manifest.signature_metadata;
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
    let digest = manifest_body_digest(&manifest)?;
    let vk = VerifyingKey::from_bytes(&decode_b64_fixed::<32>(&meta.public_key)?)
        .map_err(|e| e.to_string())?;
    let sig = Signature::from_bytes(&decode_b64_fixed::<64>(&manifest.signature)?);
    vk.verify_strict(&digest, &sig)
        .map_err(|_| "signature de manifest invalide".to_string())?;

    // 2) Hashes réels des fichiers copiés.
    let cert_path = package_dir.join(&manifest.files.certificate.filename);
    let pdf_path = package_dir.join(&manifest.files.labeled_pdf.filename);
    if sha256_file_hex(&cert_path)? != manifest.files.certificate.sha256 {
        return Err("certificate.json altéré (SHA256 ≠ manifest)".to_string());
    }
    if sha256_file_hex(&pdf_path)? != manifest.files.labeled_pdf.sha256 {
        return Err("labeled_document.pdf altéré (SHA256 ≠ manifest)".to_string());
    }

    // 3) Le certificat embarqué doit être valide.
    let cert_raw = fs::read_to_string(&cert_path).map_err(|e| e.to_string())?;
    let cert: WorkCertificate =
        serde_json::from_str(&cert_raw).map_err(|e| format!("certificat invalide : {e}"))?;
    verify_certificate(&cert)?;

    // 4) Cohérence manifest <-> certificat.
    if manifest.work_id != cert.work_id {
        return Err("work_id manifest ≠ certificat".to_string());
    }
    if manifest.certificate_id != cert.certificate_id {
        return Err("certificate_id manifest ≠ certificat".to_string());
    }
    if manifest.certificate_sequence != cert.certificate_sequence {
        return Err("certificate_sequence manifest ≠ certificat".to_string());
    }
    if manifest.certificate_version != cert.certificate_version {
        return Err("certificate_version manifest ≠ certificat".to_string());
    }
    if manifest.verdict != cert.public_core_evidence.verdict.verdict {
        return Err("verdict manifest ≠ certificat".to_string());
    }
    if manifest.signature_metadata.signing_key_id != cert.signature_metadata.signing_key_id {
        return Err("signing_key_id manifest ≠ certificat".to_string());
    }
    Ok(())
}

// --- CONSTRUCTION -------------------------------------------------------------

/// Cœur avec seam de test `on_before_publish` (appelé après `verify_manifest(temp)`
/// OK et AVANT la publication atomique). En prod : no-op.
fn create_work_package_inner<H>(
    works_root: &Path,
    certificate_path: &Path,
    labeled_pdf_path: &Path,
    created_at: &str,
    signing_key: &SigningKey,
    on_before_publish: H,
) -> Result<PackageManifest, PackageError>
where
    H: FnOnce() -> Result<(), PackageError>,
{
    // Certificat : lecture + parse + vérification (invalide/absent -> aucun package).
    let cert_bytes = fs::read(certificate_path)
        .map_err(|e| PackageError::CertificateUnavailable(e.to_string()))?;
    let cert: WorkCertificate = serde_json::from_slice(&cert_bytes)
        .map_err(|e| PackageError::CertificateInvalid(format!("JSON : {e}")))?;
    verify_certificate(&cert).map_err(PackageError::CertificateInvalid)?;

    // PDF labellisé : doit exister (aucun package sinon).
    let pdf_bytes = fs::read(labeled_pdf_path)
        .map_err(|e| PackageError::LabeledPdfUnavailable(e.to_string()))?;

    // Garde-fou #2 : la clé du manifest doit être CELLE du certificat.
    let public_key = general_purpose::STANDARD.encode(signing_key.verifying_key().to_bytes());
    let signing_key_id = sha256_hex_str(&public_key);
    if signing_key_id != cert.signature_metadata.signing_key_id {
        return Err(PackageError::KeyMismatch);
    }

    let work_id = cert.work_id.clone();
    let sequence = cert.certificate_sequence;
    let final_dir = package_dir(works_root, &work_id, sequence);
    if final_dir.exists() {
        return Err(PackageError::AlreadyExists(final_dir.display().to_string()));
    }

    let pkgs = packages_dir(works_root, &work_id);
    fs::create_dir_all(&pkgs).map_err(|e| PackageError::Io(e.to_string()))?;
    let temp_dir = pkgs.join(format!(".tmp_package_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).map_err(|e| PackageError::Io(e.to_string()))?;

    // Tout ce qui suit est protégé : erreur -> cleanup du temp, aucun final.
    let built = (|| -> Result<PackageManifest, PackageError> {
        // Copies (certificate byte-identique).
        let cert_dst = temp_dir.join(CERTIFICATE_FILENAME);
        let pdf_dst = temp_dir.join(LABELED_PDF_FILENAME);
        write_synced(&cert_dst, &cert_bytes)?;
        write_synced(&pdf_dst, &pdf_bytes)?;

        // Hashes calculés sur les fichiers RÉELLEMENT copiés.
        let certificate_sha256 = sha256_file_hex(&cert_dst).map_err(PackageError::Io)?;
        let labeled_pdf_sha256 = sha256_file_hex(&pdf_dst).map_err(PackageError::Io)?;

        // Manifest (path-free ; filenames relatifs).
        let mut manifest = PackageManifest {
            schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
            package_id: uuid::Uuid::new_v4().to_string(),
            work_id: work_id.clone(),
            certificate_id: cert.certificate_id.clone(),
            certificate_sequence: sequence,
            created_at: created_at.to_string(),
            certificate_version: cert.certificate_version,
            verdict: cert.public_core_evidence.verdict.verdict,
            files: ManifestFiles {
                certificate: FileRef {
                    filename: CERTIFICATE_FILENAME.to_string(),
                    sha256: certificate_sha256,
                },
                labeled_pdf: FileRef {
                    filename: LABELED_PDF_FILENAME.to_string(),
                    sha256: labeled_pdf_sha256,
                },
            },
            signature_metadata: ManifestSignatureMetadata {
                signature_algorithm: SIGN_ALG.to_string(),
                public_key,
                signing_key_id,
                identity_status: LOCAL_DEVICE_IDENTITY.to_string(),
                schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
            },
            signature: String::new(),
        };

        // Signature APRÈS hash réel des copies ; corps hors `signature`.
        let digest = manifest_body_digest(&manifest).map_err(PackageError::Io)?;
        manifest.signature = general_purpose::STANDARD.encode(signing_key.sign(&digest).to_bytes());

        // manifest.json écrit EN DERNIER.
        let manifest_json =
            serde_json::to_vec_pretty(&manifest).map_err(|e| PackageError::Io(e.to_string()))?;
        write_synced(&temp_dir.join(MANIFEST_FILENAME), &manifest_json)?;

        // Garde-fou #3 : vérifier le package temporaire AVANT publication.
        verify_manifest(&temp_dir).map_err(PackageError::VerifyFailed)?;

        // Seam de test : injection d'échec avant publication.
        on_before_publish()?;

        Ok(manifest)
    })();

    let manifest = match built {
        Ok(m) => m,
        Err(e) => {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(e);
        }
    };

    // Publication atomique : rename temp -> package_{N} (refus si apparu entre-temps).
    if final_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(PackageError::AlreadyExists(final_dir.display().to_string()));
    }
    if let Err(e) = fs::rename(&temp_dir, &final_dir) {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(PackageError::Io(e.to_string()));
    }
    sync_dir(&pkgs);
    Ok(manifest)
}

/// Assemble le package avec une clé fournie (seam de test / injection).
pub(crate) fn create_work_package_with(
    works_root: &Path,
    certificate_path: &Path,
    labeled_pdf_path: &Path,
    created_at: &str,
    signing_key: &SigningKey,
) -> Result<PackageManifest, PackageError> {
    create_work_package_inner(
        works_root,
        certificate_path,
        labeled_pdf_path,
        created_at,
        signing_key,
        || Ok(()),
    )
}

/// Point d'entrée production : signe avec la clé device (`ensure_signing_key`).
/// Non exposé en commande Tauri en 6C-1.
pub(crate) fn create_work_package_core(
    works_root: &Path,
    certificate_path: &Path,
    labeled_pdf_path: &Path,
    created_at: &str,
) -> Result<PackageManifest, PackageError> {
    let key = crate::ensure_signing_key().map_err(PackageError::Io)?;
    create_work_package_with(
        works_root,
        certificate_path,
        labeled_pdf_path,
        created_at,
        &key,
    )
}

// --- TESTS UNITAIRES ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_certificate::compute_public_core_evidence_sha256;
    use crate::work_certificate::{
        CertificateSignatureMetadata, Continuity, ContinuityKind, IncludedPeriod,
        PublicCoreEvidence, PublicDocumentRef, VerdictEngineSummary, CERTIFICATE_SCHEMA_VERSION,
        CORE_EVIDENCE_SCHEMA_VERSION,
    };
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn temp_base() -> PathBuf {
        std::env::temp_dir().join(format!("ho_pkg_test_{}", Uuid::new_v4()))
    }

    fn cleanup(p: &Path) {
        let _ = fs::remove_dir_all(p);
    }

    fn key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    /// Fabrique un `WorkCertificate` valide signé par `k` (contenu minimal mais
    /// cohérent : `verify_certificate` le valide).
    fn make_cert(k: &SigningKey, work_id: &WorkId, sequence: u64) -> WorkCertificate {
        let public = PublicCoreEvidence {
            schema_version: CORE_EVIDENCE_SCHEMA_VERSION,
            work_id: work_id.clone(),
            certificate_version: CertificateVersion::V1,
            document: PublicDocumentRef {
                hash_current: "a".repeat(64),
                size_current: 42,
            },
            included_period_summaries: vec![IncludedPeriod {
                period_id: Uuid::new_v4().to_string(),
                sequence_number: 0,
                hash_start: "b".repeat(64),
                hash_end: "a".repeat(64),
                size_start: 10,
                size_end: 42,
                net_document_change: true,
                gate_passed: true,
                qualifying: true,
                period_record_sha256: "c".repeat(64),
            }],
            new_period_ids: vec![],
            qualifying_new_period_count: 1,
            continuity: Continuity {
                kind: ContinuityKind::Full,
                gaps: vec![],
            },
            verdict: VerdictEngineSummary {
                total_periods: 1,
                qualifying_periods: 1,
                total_active_seconds: 60,
                continuity: ContinuityKind::Full,
                verdict: ProofVerdict::ObservedWorkConsistent,
            },
            previous_certificate_id: None,
            previous_core_evidence_sha256: None,
        };
        let core_evidence_sha256 = compute_public_core_evidence_sha256(&public).unwrap();
        let public_key = general_purpose::STANDARD.encode(k.verifying_key().to_bytes());
        let signing_key_id = sha256_hex_str(&public_key);
        let mut cert = WorkCertificate {
            schema_version: CERTIFICATE_SCHEMA_VERSION,
            certificate_id: Uuid::new_v4().to_string(),
            certificate_sequence: sequence,
            created_at: "2026-08-01T10:00:00Z".to_string(),
            work_id: work_id.clone(),
            certificate_version: CertificateVersion::V1,
            public_core_evidence: public,
            core_evidence_sha256,
            previous_certificate_id: None,
            previous_core_evidence_sha256: None,
            signature_metadata: CertificateSignatureMetadata {
                signature_algorithm: "ed25519".to_string(),
                public_key,
                signing_key_id,
                identity_status: "LOCAL_DEVICE".to_string(),
                schema_version: CERTIFICATE_SCHEMA_VERSION,
            },
            signature: String::new(),
        };
        let body = work_period::canonical_bytes_excluding(&cert, &["signature"]).unwrap();
        let digest = Sha256::digest(&body);
        cert.signature = general_purpose::STANDARD.encode(k.sign(digest.as_slice()).to_bytes());
        cert
    }

    /// Écrit un certificat + un PDF factice ; renvoie (works, wid, cert_path, pdf_path, k).
    fn setup(base: &Path) -> (PathBuf, WorkId, PathBuf, PathBuf, SigningKey) {
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let cert = make_cert(&k, &wid, 1);
        let inbox = base.join("inbox");
        fs::create_dir_all(&inbox).unwrap();
        let cert_path = inbox.join("certificate_1.json");
        fs::write(&cert_path, serde_json::to_vec_pretty(&cert).unwrap()).unwrap();
        let pdf_path = inbox.join("labeled.pdf");
        fs::write(&pdf_path, b"%PDF-1.4 fake pdf bytes").unwrap();
        (works, wid, cert_path, pdf_path, k)
    }

    fn final_dir(works: &Path, wid: &WorkId, seq: u64) -> PathBuf {
        works
            .join(wid.as_str())
            .join("packages")
            .join(format!("package_{seq}"))
    }

    #[test]
    fn test_1_manifest_verifiable() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "2026-08-02T10:00:00Z", &k)
            .unwrap();
        let dir = final_dir(&works, &wid, 1);
        assert!(dir.join("certificate.json").exists());
        assert!(dir.join("labeled_document.pdf").exists());
        assert!(dir.join("manifest.json").exists());
        assert!(verify_manifest(&dir).is_ok());
        cleanup(&base);
    }

    #[test]
    fn test_2_verify_verifie_aussi_certificate_json() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "2026-08-02T10:00:00Z", &k)
            .unwrap();
        let dir = final_dir(&works, &wid, 1);

        // Casse la signature du certificat embarqué, recalcule son sha, re-signe le
        // manifest pour matcher le nouveau sha -> le hash passe mais verify_certificate échoue.
        let cert_dst = dir.join("certificate.json");
        let mut cert: WorkCertificate =
            serde_json::from_slice(&fs::read(&cert_dst).unwrap()).unwrap();
        cert.signature = "A".repeat(88); // signature invalide mais bien formée base64
        let new_cert_bytes = serde_json::to_vec_pretty(&cert).unwrap();
        fs::write(&cert_dst, &new_cert_bytes).unwrap();

        let mut manifest: PackageManifest =
            serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        manifest.files.certificate.sha256 = sha256_hex_bytes(&new_cert_bytes);
        manifest.signature = String::new();
        let digest = manifest_body_digest(&manifest).unwrap();
        manifest.signature = general_purpose::STANDARD.encode(k.sign(&digest).to_bytes());
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        // Hash OK, signature manifest OK, mais certificat embarqué invalide -> refus.
        assert!(verify_manifest(&dir).is_err());
        cleanup(&base);
    }

    #[test]
    fn test_3_certificate_invalide_refuse() {
        let base = temp_base();
        let works = base.join("Works");
        let inbox = base.join("inbox");
        fs::create_dir_all(&inbox).unwrap();
        let cert_path = inbox.join("bad.json");
        fs::write(&cert_path, b"{ pas un certificat }").unwrap();
        let pdf_path = inbox.join("labeled.pdf");
        fs::write(&pdf_path, b"pdf").unwrap();

        let res = create_work_package_with(&works, &cert_path, &pdf_path, "t", &key());
        assert!(matches!(res, Err(PackageError::CertificateInvalid(_))));
        assert!(!works.exists(), "aucun package si certificat invalide");
        cleanup(&base);
    }

    #[test]
    fn test_4_signing_key_mismatch_refuse() {
        let base = temp_base();
        let (works, _wid, cert_path, pdf_path, _k) = setup(&base);
        // Autre clé que celle du certificat.
        let res = create_work_package_with(&works, &cert_path, &pdf_path, "t", &key());
        assert_eq!(res.err(), Some(PackageError::KeyMismatch));
        cleanup(&base);
    }

    #[test]
    fn test_5_signature_echoue_si_manifest_modifie() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        let mut m: PackageManifest =
            serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        m.created_at = "falsifie".to_string(); // corps modifié, signature inchangée
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec_pretty(&m).unwrap(),
        )
        .unwrap();
        assert!(verify_manifest(&dir).is_err());
        cleanup(&base);
    }

    #[test]
    fn test_6_signature_echoue_si_signature_metadata_modifie() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        let mut m: PackageManifest =
            serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        m.signature_metadata.identity_status = "REMOTE".to_string();
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_vec_pretty(&m).unwrap(),
        )
        .unwrap();
        assert!(verify_manifest(&dir).is_err());
        cleanup(&base);
    }

    #[test]
    fn test_7_manifest_echoue_si_pdf_modifie() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        fs::write(dir.join("labeled_document.pdf"), b"pdf altere").unwrap();
        assert!(verify_manifest(&dir).is_err());
        cleanup(&base);
    }

    #[test]
    fn test_8_manifest_echoue_si_certificate_modifie() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        fs::write(dir.join("certificate.json"), b"{}").unwrap();
        assert!(verify_manifest(&dir).is_err());
        cleanup(&base);
    }

    #[test]
    fn test_9_certificate_copie_byte_identique() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        assert_eq!(
            fs::read(dir.join("certificate.json")).unwrap(),
            fs::read(&cert_path).unwrap()
        );
        cleanup(&base);
    }

    #[test]
    fn test_10_hashes_manifest_egaux_hashes_reels() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        let m: PackageManifest =
            serde_json::from_slice(&fs::read(dir.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(
            m.files.certificate.sha256,
            sha256_file_hex(&dir.join("certificate.json")).unwrap()
        );
        assert_eq!(
            m.files.labeled_pdf.sha256,
            sha256_file_hex(&dir.join("labeled_document.pdf")).unwrap()
        );
        cleanup(&base);
    }

    #[test]
    fn test_11_aucun_chemin_absolu_ni_prive_dans_manifest() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        let json = fs::read_to_string(dir.join("manifest.json")).unwrap();
        assert!(!json.contains("/Users/"), "chemin /Users/ dans manifest");
        assert!(
            !json.contains(&works.to_string_lossy().to_string()),
            "chemin absolu works dans manifest"
        );
        assert!(!json.contains("document_path"));
        assert!(!json.contains("\"engine\""));
        assert!(!json.contains("period_record_sha256"));
        // filenames relatifs uniquement.
        assert!(json.contains("certificate.json"));
        assert!(json.contains("labeled_document.pdf"));
        cleanup(&base);
    }

    #[test]
    fn test_12_no_overwrite_si_package_existe() {
        let base = temp_base();
        let (works, _wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let res = create_work_package_with(&works, &cert_path, &pdf_path, "t", &k);
        assert!(matches!(res, Err(PackageError::AlreadyExists(_))));
        cleanup(&base);
    }

    #[test]
    fn test_13_erreur_avant_publication_aucun_final_ni_temp() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        // Injecte un échec juste avant la publication.
        let res = create_work_package_inner(&works, &cert_path, &pdf_path, "t", &k, || {
            Err(PackageError::Io("échec injecté".into()))
        });
        assert!(res.is_err());
        // Aucun package_1 final.
        assert!(!final_dir(&works, &wid, 1).exists());
        // Aucun temp résiduel.
        let pkgs = works.join(wid.as_str()).join("packages");
        if pkgs.exists() {
            let leftover = fs::read_dir(&pkgs)
                .unwrap()
                .filter_map(|e| e.ok())
                .any(|e| e.file_name().to_string_lossy().starts_with(".tmp_package_"));
            assert!(!leftover, "temp résiduel après échec");
        }
        cleanup(&base);
    }

    #[test]
    fn test_14_aucun_pdf_genere_seulement_copie() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let dir = final_dir(&works, &wid, 1);
        // Le PDF du package == le PDF fourni (copie, pas génération).
        assert_eq!(
            fs::read(dir.join("labeled_document.pdf")).unwrap(),
            fs::read(&pdf_path).unwrap()
        );
        // package_1/ ne contient QUE les 3 fichiers attendus.
        let mut names: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "certificate.json".to_string(),
                "labeled_document.pdf".to_string(),
                "manifest.json".to_string()
            ]
        );
        cleanup(&base);
    }

    #[test]
    fn test_15_aucun_package_si_certificat_absent() {
        let base = temp_base();
        let works = base.join("Works");
        let inbox = base.join("inbox");
        fs::create_dir_all(&inbox).unwrap();
        let pdf_path = inbox.join("labeled.pdf");
        fs::write(&pdf_path, b"pdf").unwrap();
        let res =
            create_work_package_with(&works, &inbox.join("absent.json"), &pdf_path, "t", &key());
        assert!(matches!(res, Err(PackageError::CertificateUnavailable(_))));
        assert!(!works.exists());
        cleanup(&base);
    }

    #[test]
    fn test_16_aucun_package_si_pdf_absent() {
        let base = temp_base();
        let (works, _wid, cert_path, _pdf_path, k) = setup(&base);
        let res =
            create_work_package_with(&works, &cert_path, &base.join("inbox/absent.pdf"), "t", &k);
        assert!(matches!(res, Err(PackageError::LabeledPdfUnavailable(_))));
        assert!(!works.exists(), "aucun package si PDF absent");
        cleanup(&base);
    }

    #[test]
    fn test_17_aucun_label_interdit() {
        let base = temp_base();
        let (works, wid, cert_path, pdf_path, k) = setup(&base);
        create_work_package_with(&works, &cert_path, &pdf_path, "t", &k).unwrap();
        let json = fs::read_to_string(final_dir(&works, &wid, 1).join("manifest.json")).unwrap();
        for forbidden in [
            "NO_AI",
            "HUMAN_PROVEN",
            "AUTHENTIC",
            "GUARANTEED",
            "AUTHORSHIP",
            "ORIGINAL",
        ] {
            assert!(!json.contains(forbidden), "label interdit : {forbidden}");
        }
        cleanup(&base);
    }
}
