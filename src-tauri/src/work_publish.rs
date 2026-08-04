//! work_publish — Orchestration runtime PDF labellisé -> package (Commit 6C-2).
//!
//! Enchaîne : (créer OU réutiliser) le certificat Work -> valider que le PDF
//! source correspond au document certifié -> produire `labeled_document.pdf`
//! avec le pipeline existant (`publish_pdf_core`, appelé TEL QUEL) -> appeler
//! `create_work_package_core` (6C-1) avec le PDF réellement écrit.
//!
//! N'ajoute AUCUN claim, ne modifie NI la cartouche NI `publication_core.rs`.
//! AUCUNE commande Tauri, AUCUNE UI, AUCUN verifier, AUCUNE Supabase, AUCUN
//! DOCX->PDF (PDF source déjà disponible), AUCUNE génération de cartouche.
//!
//! Garde-fous : (1) SHA256(source_pdf) == certificat.document.hash_current ;
//! (2) create-or-load du certificat + no-overwrite avant génération PDF ;
//! (3) verify_url strictement public (http/https) ; (4) aucun package si PDFium
//! échoue ou si le PDF n'existe pas ; (5) cartouche/PDF inchangés.
//!
//! La partie PDFium/clé device est INTÉGRATION-only (bundle app). Les tests
//! unitaires utilisent des seams (aucune couverture PDFium en `cargo test`).

// Fondation (6C-2) : orchestration ; exposition Tauri/UI = 6D.
#![allow(dead_code)]

use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

use crate::work_certificate::{ProofVerdict, WorkCertificate};
use crate::work_package::PackageManifest;
use crate::work_store::WorkId;

const CERTIFICATES_DIR: &str = "certificates";
const PACKAGES_DIR: &str = "packages";
const LABELED_PDF_FILENAME: &str = "labeled_document.pdf";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PublishError {
    InvalidVerifyUrl,
    SourcePdfUnavailable(String),
    SourcePdfDoesNotMatchCertifiedDocument,
    AlreadyExists(String),
    CartoucheGenerationFailed(String),
    CartoucheNotProduced,
    PdfGenerationFailed(String),
    PdfNotProduced,
    Certificate(String),
    Package(String),
    Io(String),
}

// --- HELPERS ------------------------------------------------------------------

fn certificate_json_path(works_root: &Path, work_id: &WorkId, sequence: u64) -> PathBuf {
    works_root
        .join(work_id.as_str())
        .join(CERTIFICATES_DIR)
        .join(format!("certificate_{sequence}.json"))
}

fn packages_dir(works_root: &Path, work_id: &WorkId) -> PathBuf {
    works_root.join(work_id.as_str()).join(PACKAGES_DIR)
}

fn package_dir(works_root: &Path, work_id: &WorkId, sequence: u64) -> PathBuf {
    packages_dir(works_root, work_id).join(format!("package_{sequence}"))
}

fn sha256_file_hex(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

/// Garde-fou #3 : verify_url strictement public.
fn is_public_url(url: &str) -> bool {
    if url.is_empty() {
        return false;
    }
    if url.starts_with("file://") {
        return false;
    }
    if url.contains("/Users/") {
        return false;
    }
    // Exige http:// ou https:// (rejette de fait les chemins absolus locaux).
    url.starts_with("http://") || url.starts_with("https://")
}

fn verdict_label(verdict: ProofVerdict) -> &'static str {
    match verdict {
        ProofVerdict::ObservedWorkConsistent => "OBSERVED_WORK_CONSISTENT",
        ProofVerdict::ObservedWorkWithGaps => "OBSERVED_WORK_WITH_GAPS",
    }
}

// --- ORCHESTRATION (cœur seamed) ----------------------------------------------

/// Cœur testable : les seams `create_cert_fn` / `generate_pdf_fn` /
/// `make_package_fn` isolent PDFium et la clé device.
///
/// `create_cert_fn` n'est appelé QUE dans la branche « créer un nouveau
/// certificat » (jamais lors d'une réutilisation).
fn create_labeled_package_inner<CF, CT, GF, PF>(
    works_root: &Path,
    work_id: &WorkId,
    source_pdf_path: &Path,
    verify_url: &str,
    create_cert_fn: CF,
    cartouche_fn: CT,
    generate_pdf_fn: GF,
    make_package_fn: PF,
) -> Result<PackageManifest, PublishError>
where
    CF: FnOnce() -> Result<WorkCertificate, PublishError>,
    CT: FnOnce(&WorkCertificate, &Path) -> Result<(), PublishError>,
    GF: FnOnce(&Path, &Path, &Path, &str, &str, &str) -> Result<(), PublishError>,
    PF: FnOnce(&Path, &Path) -> Result<PackageManifest, PublishError>,
{
    // Garde-fou #3 : verify_url public.
    if !is_public_url(verify_url) {
        return Err(PublishError::InvalidVerifyUrl);
    }

    // Garde-fou #2 : create-or-load.
    let last = crate::work_certificate::find_last_valid_certificate(works_root, work_id)
        .map_err(|e| PublishError::Certificate(format!("{e:?}")))?;
    let cert = match last {
        Some(c) if !package_dir(works_root, work_id, c.certificate_sequence).exists() => {
            // Réutilisation (ex. retry après échec PDF) : ne PAS recréer.
            c
        }
        _ => create_cert_fn()?,
    };
    let certificate_path = certificate_json_path(works_root, work_id, cert.certificate_sequence);
    let final_dir = package_dir(works_root, work_id, cert.certificate_sequence);

    // No-overwrite AVANT toute génération de PDF.
    if final_dir.exists() {
        return Err(PublishError::AlreadyExists(final_dir.display().to_string()));
    }

    // Garde-fou #1 : le PDF source doit correspondre au document certifié.
    let source_hash =
        sha256_file_hex(source_pdf_path).map_err(PublishError::SourcePdfUnavailable)?;
    if source_hash != cert.public_core_evidence.document.hash_current {
        return Err(PublishError::SourcePdfDoesNotMatchCertifiedDocument);
    }

    let verdict = verdict_label(cert.public_core_evidence.verdict.verdict);

    // PDF labellisé dans un dossier temporaire ; cleanup dans tous les cas.
    let pkgs = packages_dir(works_root, work_id);
    fs::create_dir_all(&pkgs).map_err(|e| PublishError::Io(e.to_string()))?;
    let temp_dir = pkgs.join(format!(".tmp_labeled_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).map_err(|e| PublishError::Io(e.to_string()))?;
    let cartouche_png = temp_dir.join("cartouche.png");
    let output_pdf = temp_dir.join(LABELED_PDF_FILENAME);

    let result = (|| -> Result<PackageManifest, PublishError> {
        // Cartouche (native ou fournie) générée dans le temp, APRÈS certificat +
        // no-overwrite + hash check, AVANT toute génération PDF.
        cartouche_fn(&cert, &cartouche_png)?;
        // Garde-fou : la cartouche doit exister et être non vide.
        let cartouche_ok = fs::metadata(&cartouche_png)
            .map(|m| m.len() > 0)
            .unwrap_or(false);
        if !cartouche_ok {
            return Err(PublishError::CartoucheNotProduced);
        }
        generate_pdf_fn(
            source_pdf_path,
            &output_pdf,
            &cartouche_png,
            &cert.certificate_id,
            verify_url,
            verdict,
        )?;
        // Garde-fou #4 : le PDF doit exister réellement.
        if !output_pdf.exists() {
            return Err(PublishError::PdfNotProduced);
        }
        // 6C-1 gère l'atomicité + no-overwrite + signature du manifest.
        make_package_fn(&certificate_path, &output_pdf)
    })();

    let _ = fs::remove_dir_all(&temp_dir);
    result
}

/// Génération PDF réelle : appelle `publish_pdf_core` TEL QUEL (PDFium runtime).
fn generate_pdf_real(
    source_pdf: &Path,
    output_pdf: &Path,
    cartouche_png: &Path,
    certificate_id: &str,
    verify_url: &str,
    verdict: &str,
) -> Result<(), PublishError> {
    let job = serde_json::json!({
        "job_version": "1.0",
        "job_type": "pdf_publication",
        "source_pdf_path": source_pdf.to_string_lossy(),
        "output_pdf_path": output_pdf.to_string_lossy(),
        "cartouche_png_path": cartouche_png.to_string_lossy(),
        "certificate_id": certificate_id,
        "verify_url": verify_url,
        "verdict": verdict,
        "render": {
            "mode": "compact_cartouche",
            "pages": "all",
            "first_page_scale": 1.0,
            "other_pages_scale": 0.85,
            "anchor": "bottom_right",
            "margin_pt": 34.0
        }
    });
    let res = crate::publication_core::publish_pdf_core(job)
        .map_err(PublishError::PdfGenerationFailed)?;
    let ok = res.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        let msg = res
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("échec publication PDF")
            .to_string();
        return Err(PublishError::PdfGenerationFailed(msg));
    }
    Ok(())
}

/// Point d'entrée production (INTÉGRATION-only : PDFium + clé device).
/// Non exposé en commande Tauri en 6C-2.
pub(crate) fn create_labeled_package_core(
    works_root: &Path,
    work_id: &WorkId,
    source_pdf_path: &Path,
    cartouche_png_path: &Path,
    verify_url: &str,
    created_at: &str,
) -> Result<PackageManifest, PublishError> {
    let cartouche_src = cartouche_png_path.to_path_buf();
    create_labeled_package_inner(
        works_root,
        work_id,
        source_pdf_path,
        verify_url,
        || {
            crate::work_certificate::create_work_certificate_core(works_root, work_id, created_at)
                .map_err(|e| PublishError::Certificate(format!("{e:?}")))
        },
        // Fallback manuel : la cartouche fournie est simplement copiée dans le temp.
        move |_cert, out| {
            fs::copy(&cartouche_src, out)
                .map(|_| ())
                .map_err(|e| PublishError::Io(e.to_string()))
        },
        generate_pdf_real,
        |certificate_path, labeled_pdf_path| {
            crate::work_package::create_work_package_core(
                works_root,
                certificate_path,
                labeled_pdf_path,
                created_at,
            )
            .map_err(|e| PublishError::Package(format!("{e:?}")))
        },
    )
}

/// Point d'entrée production NATIF (INTÉGRATION-only : PDFium + clé device).
/// Identique à `create_labeled_package_core` mais la cartouche Work est GÉNÉRÉE
/// nativement depuis le certificat réel (aucun `cartouche_png_path` fourni).
pub(crate) fn create_native_labeled_package_core(
    works_root: &Path,
    work_id: &WorkId,
    source_pdf_path: &Path,
    verify_url: &str,
    created_at: &str,
) -> Result<PackageManifest, PublishError> {
    let verify_url_owned = verify_url.to_string();
    create_labeled_package_inner(
        works_root,
        work_id,
        source_pdf_path,
        verify_url,
        || {
            crate::work_certificate::create_work_certificate_core(works_root, work_id, created_at)
                .map_err(|e| PublishError::Certificate(format!("{e:?}")))
        },
        // Cartouche Work native : construite depuis le certificat réel.
        move |cert, out| {
            let inputs = crate::work_cartouche::WorkCartoucheInputs {
                certificate_id: cert.certificate_id.clone(),
                verdict: verdict_label(cert.public_core_evidence.verdict.verdict).to_string(),
                identity_status: "LOCAL_DEVICE".to_string(),
                verify_url: verify_url_owned.clone(),
                signing_key_id: Some(cert.signature_metadata.signing_key_id.clone()),
                created_at: Some(cert.created_at.clone()),
            };
            crate::work_cartouche::render_work_cartouche_png(&inputs, out)
                .map_err(PublishError::CartoucheGenerationFailed)
        },
        generate_pdf_real,
        |certificate_path, labeled_pdf_path| {
            crate::work_package::create_work_package_core(
                works_root,
                certificate_path,
                labeled_pdf_path,
                created_at,
            )
            .map_err(|e| PublishError::Package(format!("{e:?}")))
        },
    )
}

// --- COMMANDE TAURI (fine enveloppe 6D) --------------------------------------

/// Commande dev/e2e : génère certificat + PDF labellisé + package pour un Work
/// dont le document final est un PDF. `created_at` = maintenant (runtime).
/// Retour : `package_dir` (chemin LOCAL, pour ouvrir le PDF côté app) + résumé
/// du manifest. Aucune logique PDF nouvelle : délègue à `create_labeled_package_core`.
#[tauri::command]
pub fn create_labeled_work_package(
    work_id: String,
    source_pdf_path: String,
    cartouche_png_path: String,
    verify_url: String,
) -> Result<serde_json::Value, String> {
    let root = crate::work_store::works_root()?;
    let wid = crate::work_store::WorkId(work_id);
    let created_at = chrono::Utc::now().to_rfc3339();

    let manifest = create_labeled_package_core(
        &root,
        &wid,
        Path::new(&source_pdf_path),
        Path::new(&cartouche_png_path),
        &verify_url,
        &created_at,
    )
    .map_err(|e| format!("{e:?}"))?;

    let dir = package_dir(&root, &manifest.work_id, manifest.certificate_sequence);
    Ok(serde_json::json!({
        "package_dir": dir.to_string_lossy(),
        "manifest": {
            "schema_version": manifest.schema_version,
            "package_id": manifest.package_id,
            "work_id": manifest.work_id,
            "certificate_id": manifest.certificate_id,
            "certificate_sequence": manifest.certificate_sequence,
            "certificate_version": manifest.certificate_version,
            "verdict": manifest.verdict,
            "files": manifest.files,
            "identity_status": manifest.signature_metadata.identity_status,
            "signing_key_id": manifest.signature_metadata.signing_key_id,
        }
    }))
}

/// Commande dev/e2e NATIVE : identique à `create_labeled_work_package` mais la
/// cartouche Work est générée nativement depuis le certificat (pas de PNG fourni).
/// C'est le chemin principal du panneau dev.
#[tauri::command]
pub fn create_native_labeled_work_package(
    work_id: String,
    source_pdf_path: String,
    verify_url: String,
) -> Result<serde_json::Value, String> {
    let root = crate::work_store::works_root()?;
    let wid = crate::work_store::WorkId(work_id);
    let created_at = chrono::Utc::now().to_rfc3339();

    let manifest = create_native_labeled_package_core(
        &root,
        &wid,
        Path::new(&source_pdf_path),
        &verify_url,
        &created_at,
    )
    .map_err(|e| format!("{e:?}"))?;

    let dir = package_dir(&root, &manifest.work_id, manifest.certificate_sequence);
    Ok(serde_json::json!({
        "package_dir": dir.to_string_lossy(),
        "manifest": {
            "schema_version": manifest.schema_version,
            "package_id": manifest.package_id,
            "work_id": manifest.work_id,
            "certificate_id": manifest.certificate_id,
            "certificate_sequence": manifest.certificate_sequence,
            "certificate_version": manifest.certificate_version,
            "verdict": manifest.verdict,
            "files": manifest.files,
            "identity_status": manifest.signature_metadata.identity_status,
            "signing_key_id": manifest.signature_metadata.signing_key_id,
        }
    }))
}

// --- TESTS UNITAIRES (seams uniquement, aucun PDFium) -------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_certificate::{
        compute_public_core_evidence_sha256, CertificateSignatureMetadata, CertificateVersion,
        Continuity, ContinuityKind, IncludedPeriod, PublicCoreEvidence, PublicDocumentRef,
        VerdictEngineSummary, WorkCertificate, CERTIFICATE_SCHEMA_VERSION,
        CORE_EVIDENCE_SCHEMA_VERSION,
    };
    use base64::{engine::general_purpose, Engine as _};
    use ed25519_dalek::{Signer, SigningKey};
    use rand_core::OsRng;
    use uuid::Uuid;

    const URL: &str = "https://verify.humanorigin.app/r/abc";

    fn temp_base() -> PathBuf {
        std::env::temp_dir().join(format!("ho_publish_test_{}", Uuid::new_v4()))
    }

    fn cleanup(p: &Path) {
        let _ = fs::remove_dir_all(p);
    }

    fn key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn sha_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Fabrique un `WorkCertificate` valide signé par `k`, `hash_current` donné.
    fn build_cert(
        k: &SigningKey,
        work_id: &WorkId,
        sequence: u64,
        hash_current: &str,
    ) -> WorkCertificate {
        let public = PublicCoreEvidence {
            schema_version: CORE_EVIDENCE_SCHEMA_VERSION,
            work_id: work_id.clone(),
            certificate_version: CertificateVersion::V1,
            document: PublicDocumentRef {
                hash_current: hash_current.to_string(),
                size_current: 100,
            },
            included_period_summaries: vec![IncludedPeriod {
                period_id: Uuid::new_v4().to_string(),
                sequence_number: 0,
                hash_start: "b".repeat(64),
                hash_end: hash_current.to_string(),
                size_start: 10,
                size_end: 100,
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
        let signing_key_id = sha_hex(public_key.as_bytes());
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
        let body = crate::work_period::canonical_bytes_excluding(&cert, &["signature"]).unwrap();
        cert.signature =
            general_purpose::STANDARD.encode(k.sign(Sha256::digest(&body).as_slice()).to_bytes());
        cert
    }

    /// Écrit un certificat dans `certificates/certificate_{seq}.json`.
    fn write_cert(works: &Path, wid: &WorkId, cert: &WorkCertificate) {
        let dir = works.join(wid.as_str()).join("certificates");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(format!("certificate_{}.json", cert.certificate_sequence)),
            serde_json::to_vec_pretty(cert).unwrap(),
        )
        .unwrap();
    }

    /// Écrit un PDF source de contenu donné ; renvoie (chemin, hash).
    fn write_source_pdf(base: &Path, content: &[u8]) -> (PathBuf, String) {
        fs::create_dir_all(base).unwrap();
        let p = base.join("source.pdf");
        fs::write(&p, content).unwrap();
        (p, sha_hex(content))
    }

    /// Fichier cartouche source sur disque (pour le fallback manuel).
    fn cartouche_file(base: &Path) -> PathBuf {
        fs::create_dir_all(base).unwrap();
        let p = base.join("cartouche.png");
        fs::write(&p, b"PNG fake").unwrap();
        p
    }

    /// cartouche_fn de test : écrit une cartouche factice non vide dans le temp.
    fn write_cartouche(_cert: &WorkCertificate, out: &Path) -> Result<(), PublishError> {
        fs::write(out, b"PNG fake").map_err(|e| PublishError::Io(e.to_string()))
    }

    /// cartouche_fn de test : panique si appelée (chemin court-circuité avant).
    fn panic_cartouche(_cert: &WorkCertificate, _out: &Path) -> Result<(), PublishError> {
        panic!("la cartouche ne doit PAS être générée ici")
    }

    /// seam make_package : 6C-1 réel avec la clé fournie.
    fn pkg_fn<'a>(
        works: &'a Path,
        k: &'a SigningKey,
    ) -> impl FnOnce(&Path, &Path) -> Result<PackageManifest, PublishError> + 'a {
        move |cert_path: &Path, pdf_path: &Path| {
            crate::work_package::create_work_package_with(works, cert_path, pdf_path, "t", k)
                .map_err(|e| PublishError::Package(format!("{e:?}")))
        }
    }

    fn no_leftover_temp(works: &Path, wid: &WorkId) -> bool {
        let pkgs = works.join(wid.as_str()).join("packages");
        if !pkgs.exists() {
            return true;
        }
        !fs::read_dir(&pkgs)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with(".tmp_labeled_"))
    }

    #[test]
    fn test_1_succes_hash_match_reutilisation() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"CERTIFIED PDF CONTENT");
        // Certificat existant (hash_current == hash du PDF source), sans package.
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));

        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!("ne doit PAS créer un certificat (réutilisation)"),
            write_cartouche,
            |_s, output, _c, _id, _u, _v| {
                fs::write(output, b"LABELED PDF").unwrap();
                Ok(())
            },
            pkg_fn(&works, &k),
        );
        assert!(res.is_ok());
        let dir = package_dir(&works, &wid, 1);
        assert!(dir.join("manifest.json").exists());
        assert!(crate::work_package::verify_manifest(&dir).is_ok());
        assert!(no_leftover_temp(&works, &wid), "temp non nettoyé");
        cleanup(&base);
    }

    #[test]
    fn test_2_hash_mismatch_refuse() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, _h) = write_source_pdf(&base, b"ARBITRARY PDF");
        // Certificat avec un hash_current DIFFÉRENT du PDF source.
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &"a".repeat(64)));

        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!("réutilisation"),
            panic_cartouche,
            |_s, _o, _c, _id, _u, _v| panic!("le PDF ne doit PAS être généré sur mismatch"),
            pkg_fn(&works, &k),
        );
        assert_eq!(
            res.err(),
            Some(PublishError::SourcePdfDoesNotMatchCertifiedDocument)
        );
        assert!(!package_dir(&works, &wid, 1).exists());
        assert!(no_leftover_temp(&works, &wid));
        cleanup(&base);
    }

    #[test]
    fn test_3_certificat_existant_reutilise_au_retry() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"RETRY PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));

        // create_cert_fn panique si appelé -> prouve la réutilisation.
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!("doit réutiliser certificate_1.json"),
            write_cartouche,
            |_s, o, _c, _id, _u, _v| {
                fs::write(o, b"LABELED").unwrap();
                Ok(())
            },
            pkg_fn(&works, &k),
        );
        assert!(res.is_ok());
        assert!(package_dir(&works, &wid, 1).join("manifest.json").exists());
        cleanup(&base);
    }

    #[test]
    fn test_4_package_existant_refuse_avant_pdf() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"PDF");
        // Pas de certificat sur disque -> branche create ; le seam renvoie un
        // certificat seq 1 dont le package existe DÉJÀ.
        let cert = build_cert(&k, &wid, 1, &h);
        fs::create_dir_all(package_dir(&works, &wid, 1)).unwrap();

        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || Ok(cert.clone()),
            panic_cartouche,
            |_s, _o, _c, _id, _u, _v| panic!("le PDF ne doit PAS être généré (package existe)"),
            pkg_fn(&works, &k),
        );
        assert!(matches!(res, Err(PublishError::AlreadyExists(_))));
        cleanup(&base);
    }

    #[test]
    fn test_5_verify_url_file_refuse() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            "file:///Users/x/doc.pdf",
            || panic!(),
            panic_cartouche,
            |_s, _o, _c, _id, _u, _v| panic!(),
            pkg_fn(&works, &k),
        );
        assert_eq!(res.err(), Some(PublishError::InvalidVerifyUrl));
        cleanup(&base);
    }

    #[test]
    fn test_6_verify_url_users_refuse() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            "https://x.app/Users/secret",
            || panic!(),
            panic_cartouche,
            |_s, _o, _c, _id, _u, _v| panic!(),
            pkg_fn(&works, &k),
        );
        assert_eq!(res.err(), Some(PublishError::InvalidVerifyUrl));
        cleanup(&base);
    }

    #[test]
    fn test_7_generate_pdf_echoue_aucun_package() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!(),
            write_cartouche,
            |_s, _o, _c, _id, _u, _v| Err(PublishError::PdfGenerationFailed("KO".into())),
            pkg_fn(&works, &k),
        );
        assert!(matches!(res, Err(PublishError::PdfGenerationFailed(_))));
        assert!(!package_dir(&works, &wid, 1).exists());
        assert!(
            no_leftover_temp(&works, &wid),
            "temp non nettoyé après échec"
        );
        cleanup(&base);
    }

    #[test]
    fn test_8_pdf_absent_apres_generation_aucun_package() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));
        // generate_pdf_fn renvoie Ok mais N'écrit PAS le PDF.
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!(),
            write_cartouche,
            |_s, _o, _c, _id, _u, _v| Ok(()),
            pkg_fn(&works, &k),
        );
        assert_eq!(res.err(), Some(PublishError::PdfNotProduced));
        assert!(!package_dir(&works, &wid, 1).exists());
        assert!(no_leftover_temp(&works, &wid));
        cleanup(&base);
    }

    #[test]
    fn test_9_echec_certificat_aucun_pdf_ni_package() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, _h) = write_source_pdf(&base, b"PDF");
        // Aucun certificat -> branche create ; seam renvoie Err.
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || Err(PublishError::Certificate("NoQualifyingNewPeriod".into())),
            panic_cartouche,
            |_s, _o, _c, _id, _u, _v| panic!("pas de PDF si le certificat échoue"),
            pkg_fn(&works, &k),
        );
        assert!(matches!(res, Err(PublishError::Certificate(_))));
        assert!(!package_dir(&works, &wid, 1).exists());
        assert!(no_leftover_temp(&works, &wid));
        cleanup(&base);
    }

    #[test]
    fn test_10_url_publique_acceptee() {
        assert!(is_public_url("https://verify.humanorigin.app/r/x"));
        assert!(is_public_url("http://example.org/p"));
        assert!(!is_public_url(""));
        assert!(!is_public_url("file:///tmp/x"));
        assert!(!is_public_url("/Users/x/doc.pdf"));
        assert!(!is_public_url("ftp://x/y"));
        assert!(!is_public_url("https://x.app/Users/secret"));
    }

    #[test]
    fn test_11_cartouche_appelee_apres_cert_et_hash_check() {
        use std::cell::RefCell;
        use std::rc::Rc;
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"ORDER PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));

        let order: Rc<RefCell<Vec<&'static str>>> = Rc::new(RefCell::new(Vec::new()));
        let o_cart = order.clone();
        let o_pdf = order.clone();
        let expected_hash = h.clone();

        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!("réutilisation"),
            move |cert, out| {
                // La cartouche reçoit le certificat réel, APRÈS le hash check.
                assert_eq!(cert.public_core_evidence.document.hash_current, expected_hash);
                assert!(!cert.certificate_id.is_empty());
                o_cart.borrow_mut().push("cartouche");
                fs::write(out, b"PNG fake").unwrap();
                Ok(())
            },
            move |_s, output, _c, _id, _u, _v| {
                o_pdf.borrow_mut().push("pdf");
                fs::write(output, b"LABELED").unwrap();
                Ok(())
            },
            pkg_fn(&works, &k),
        );
        assert!(res.is_ok());
        // Ordre garanti : cartouche AVANT génération PDF.
        assert_eq!(*order.borrow(), vec!["cartouche", "pdf"]);
        cleanup(&base);
    }

    #[test]
    fn test_12_cartouche_non_appelee_si_mismatch() {
        use std::cell::Cell;
        use std::rc::Rc;
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, _h) = write_source_pdf(&base, b"OTHER PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &"a".repeat(64)));

        let called = Rc::new(Cell::new(false));
        let c = called.clone();
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!("réutilisation"),
            move |_cert, out| {
                c.set(true);
                fs::write(out, b"PNG").unwrap();
                Ok(())
            },
            |_s, _o, _c, _id, _u, _v| panic!("le PDF ne doit PAS être généré"),
            pkg_fn(&works, &k),
        );
        assert_eq!(
            res.err(),
            Some(PublishError::SourcePdfDoesNotMatchCertifiedDocument)
        );
        assert!(!called.get(), "cartouche ne doit PAS être générée sur mismatch");
        assert!(no_leftover_temp(&works, &wid));
        cleanup(&base);
    }

    #[test]
    fn test_13_echec_cartouche_aucun_pdf_ni_package() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!(),
            |_cert, _out| Err(PublishError::CartoucheGenerationFailed("KO".into())),
            |_s, _o, _c, _id, _u, _v| panic!("pas de PDF si la cartouche échoue"),
            pkg_fn(&works, &k),
        );
        assert!(matches!(res, Err(PublishError::CartoucheGenerationFailed(_))));
        assert!(!package_dir(&works, &wid, 1).exists());
        assert!(no_leftover_temp(&works, &wid), "temp non nettoyé après échec cartouche");
        cleanup(&base);
    }

    #[test]
    fn test_14_succes_natif_vraie_cartouche_verify_manifest_ok() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"NATIVE PDF CONTENT");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));

        // cartouche_fn NATIVE : identique au flux production (render réel, sans PDFium).
        let verify_url_owned = URL.to_string();
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!("réutilisation"),
            move |cert, out| {
                let inputs = crate::work_cartouche::WorkCartoucheInputs {
                    certificate_id: cert.certificate_id.clone(),
                    verdict: verdict_label(cert.public_core_evidence.verdict.verdict).to_string(),
                    identity_status: "LOCAL_DEVICE".to_string(),
                    verify_url: verify_url_owned.clone(),
                    signing_key_id: Some(cert.signature_metadata.signing_key_id.clone()),
                    created_at: Some(cert.created_at.clone()),
                };
                crate::work_cartouche::render_work_cartouche_png(&inputs, out)
                    .map_err(PublishError::CartoucheGenerationFailed)
            },
            // generate_pdf factice : vérifie que la cartouche native est un vrai PNG.
            |_s, output, cartouche, _id, _u, _v| {
                let bytes = fs::read(cartouche).unwrap();
                assert!(bytes.len() > 100, "cartouche PNG vide");
                assert_eq!(&bytes[..4], b"\x89PNG", "cartouche native n'est pas un PNG");
                fs::write(output, b"LABELED PDF").unwrap();
                Ok(())
            },
            pkg_fn(&works, &k),
        );
        assert!(res.is_ok(), "flux natif doit produire un package");
        let dir = package_dir(&works, &wid, 1);
        assert!(dir.join("manifest.json").exists());
        assert!(crate::work_package::verify_manifest(&dir).is_ok());
        assert!(no_leftover_temp(&works, &wid));
        cleanup(&base);
    }

    #[test]
    fn test_15_fallback_manuel_toujours_ok() {
        let base = temp_base();
        let works = base.join("Works");
        let wid = WorkId::new();
        let k = key();
        let (src, h) = write_source_pdf(&base, b"MANUAL PDF");
        write_cert(&works, &wid, &build_cert(&k, &wid, 1, &h));
        // cartouche_fn MANUELLE : copie du PNG fourni (comme create_labeled_package_core).
        let cart_src = cartouche_file(&base);
        let res = create_labeled_package_inner(
            &works,
            &wid,
            &src,
            URL,
            || panic!("réutilisation"),
            move |_cert, out| {
                fs::copy(&cart_src, out)
                    .map(|_| ())
                    .map_err(|e| PublishError::Io(e.to_string()))
            },
            |_s, output, _c, _id, _u, _v| {
                fs::write(output, b"LABELED PDF").unwrap();
                Ok(())
            },
            pkg_fn(&works, &k),
        );
        assert!(res.is_ok());
        let dir = package_dir(&works, &wid, 1);
        assert!(crate::work_package::verify_manifest(&dir).is_ok());
        cleanup(&base);
    }
}
