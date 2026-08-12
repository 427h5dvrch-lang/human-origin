//! compat_v1.rs — Golden fixtures V1 (TEST-ONLY) pour la compatibilité de
//! signature HO-JSON.
//!
//! Ce module est compilé UNIQUEMENT en test (`#[cfg(test)] mod compat_v1;`) :
//! aucun code de production, aucun runtime, aucune commande Tauri.
//!
//! But : figer des certificats/manifests V1 SYNTHÉTIQUES (clé de test
//! déterministe, aucune donnée réelle, aucun chemin local) et prouver qu'ils
//! restent vérifiables. Si un futur ticket HO-JSON V2 ajoute naïvement un champ
//! à une structure signée (sérialisé en `null` faute de `skip_serializing_if`),
//! les octets canoniques changent et ces tests ÉCHOUENT — c'est le garde-fou.
//!
//! Les fixtures sont FIGÉES (const &str). Elles ne sont pas régénérées à chaque
//! test : c'est ce qui les rend protectrices contre les régressions futures.

#![allow(dead_code)]

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

use crate::work_certificate::{
    verify_certificate, CertificateSignatureMetadata, CertificateVersion, Continuity,
    ContinuityKind, IncludedPeriod, ProofVerdict, PublicCoreEvidence, PublicDocumentRef,
    VerdictEngineSummary, WorkCertificate, CERTIFICATE_SCHEMA_VERSION,
    CORE_EVIDENCE_SCHEMA_VERSION,
};
use crate::work_package::{
    FileRef, ManifestFiles, ManifestSignatureMetadata, PackageManifest,
    PACKAGE_MANIFEST_SCHEMA_VERSION,
};
use crate::work_period::canonical_bytes_excluding;
use crate::work_store::WorkId;

// Clé de test DÉTERMINISTE (32 octets fixes) — jamais une clé réelle.
const TEST_SEED: [u8; 32] = [42u8; 32];

fn test_key() -> SigningKey {
    SigningKey::from_bytes(&TEST_SEED)
}

fn b64(bytes: &[u8]) -> String {
    general_purpose::STANDARD.encode(bytes)
}

fn sha256_hex(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

fn decode32(s: &str) -> [u8; 32] {
    general_purpose::STANDARD
        .decode(s)
        .unwrap()
        .try_into()
        .unwrap()
}

fn decode64(s: &str) -> [u8; 64] {
    general_purpose::STANDARD
        .decode(s)
        .unwrap()
        .try_into()
        .unwrap()
}

// ---------------------------------------------------------------------------
// Constructeurs synthétiques (utilisés une seule fois pour FRAPPER les fixtures,
// puis les fixtures figées ci-dessous deviennent la source de vérité).
// ---------------------------------------------------------------------------

fn build_public_core_evidence() -> PublicCoreEvidence {
    PublicCoreEvidence {
        schema_version: CORE_EVIDENCE_SCHEMA_VERSION,
        work_id: WorkId("00000000-0000-4000-8000-000000000001".to_string()),
        certificate_version: CertificateVersion::V1,
        document: PublicDocumentRef {
            hash_current: "a".repeat(64),
            size_current: 1234,
        },
        included_period_summaries: vec![IncludedPeriod {
            period_id: "period-0001".to_string(),
            sequence_number: 0,
            hash_start: "b".repeat(64),
            hash_end: "c".repeat(64),
            size_start: 1000,
            size_end: 1234,
            net_document_change: true,
            gate_passed: true,
            qualifying: true,
            period_record_sha256: "d".repeat(64),
        }],
        new_period_ids: vec!["period-0001".to_string()],
        qualifying_new_period_count: 1,
        continuity: Continuity {
            kind: ContinuityKind::Full,
            gaps: vec![],
        },
        verdict: VerdictEngineSummary {
            total_periods: 1,
            qualifying_periods: 1,
            total_active_seconds: 120,
            continuity: ContinuityKind::Full,
            verdict: ProofVerdict::ObservedWorkConsistent,
        },
        previous_certificate_id: None,
        previous_core_evidence_sha256: None,
    }
}

fn mint_certificate_json() -> String {
    let sk = test_key();
    let pk = b64(&sk.verifying_key().to_bytes());
    let key_id = sha256_hex(&pk);
    let pce = build_public_core_evidence();
    let core_sha =
        crate::work_certificate::compute_public_core_evidence_sha256(&pce).unwrap();

    let mut cert = WorkCertificate {
        schema_version: CERTIFICATE_SCHEMA_VERSION,
        certificate_id: "cert-0001".to_string(),
        certificate_sequence: 1,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        work_id: WorkId("00000000-0000-4000-8000-000000000001".to_string()),
        certificate_version: CertificateVersion::V1,
        public_core_evidence: pce,
        core_evidence_sha256: core_sha,
        previous_certificate_id: None,
        previous_core_evidence_sha256: None,
        signature_metadata: CertificateSignatureMetadata {
            signature_algorithm: "ed25519".to_string(),
            public_key: pk,
            signing_key_id: key_id,
            identity_status: "LOCAL_DEVICE".to_string(),
            schema_version: CERTIFICATE_SCHEMA_VERSION,
        },
        signature: String::new(),
    };
    let body = canonical_bytes_excluding(&cert, &["signature"]).unwrap();
    let digest = Sha256::digest(&body);
    cert.signature = b64(&sk.sign(digest.as_slice()).to_bytes());
    serde_json::to_string(&cert).unwrap()
}

fn mint_manifest_json() -> String {
    let sk = test_key();
    let pk = b64(&sk.verifying_key().to_bytes());
    let key_id = sha256_hex(&pk);

    let mut man = PackageManifest {
        schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
        package_id: "package-0001".to_string(),
        work_id: WorkId("00000000-0000-4000-8000-000000000001".to_string()),
        certificate_id: "cert-0001".to_string(),
        certificate_sequence: 1,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        certificate_version: CertificateVersion::V1,
        verdict: ProofVerdict::ObservedWorkConsistent,
        files: ManifestFiles {
            certificate: FileRef {
                filename: "certificate.json".to_string(),
                sha256: "e".repeat(64),
            },
            labeled_pdf: FileRef {
                filename: "labeled_document.pdf".to_string(),
                sha256: "f".repeat(64),
            },
        },
        signature_metadata: ManifestSignatureMetadata {
            signature_algorithm: "ed25519".to_string(),
            public_key: pk,
            signing_key_id: key_id,
            identity_status: "LOCAL_DEVICE".to_string(),
            schema_version: PACKAGE_MANIFEST_SCHEMA_VERSION,
        },
        signature: String::new(),
    };
    let body = canonical_bytes_excluding(&man, &["signature"]).unwrap();
    let digest = Sha256::digest(&body);
    man.signature = b64(&sk.sign(digest.as_slice()).to_bytes());
    serde_json::to_string(&man).unwrap()
}

/// Générateur one-shot : imprime les fixtures à figer. Marqué #[ignore] pour ne
/// PAS tourner en CI (les fixtures FIGÉES ci-dessous sont la source de vérité).
/// Lancer manuellement : `cargo test compat_v1::mint_fixtures -- --ignored --nocapture`
#[test]
#[ignore]
fn mint_fixtures() {
    println!("=====CERT_V1_JSON_BEGIN=====");
    println!("{}", mint_certificate_json());
    println!("=====CERT_V1_JSON_END=====");
    println!("=====MANIFEST_V1_JSON_BEGIN=====");
    println!("{}", mint_manifest_json());
    println!("=====MANIFEST_V1_JSON_END=====");
}

// ===========================================================================
// FIXTURES FIGÉES V1 — source de vérité du garde-fou.
// Générées une seule fois par `mint_fixtures` (clé de test déterministe, aucune
// donnée réelle, aucun chemin local). NE PAS régénérer : leur immutabilité est
// ce qui protège contre une régression de canonicalisation en V2.
// ===========================================================================

const CERT_V1_JSON: &str = r#"{"schema_version":1,"certificate_id":"cert-0001","certificate_sequence":1,"created_at":"2026-01-01T00:00:00Z","work_id":"00000000-0000-4000-8000-000000000001","certificate_version":"V1","public_core_evidence":{"schema_version":1,"work_id":"00000000-0000-4000-8000-000000000001","certificate_version":"V1","document":{"hash_current":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size_current":1234},"included_period_summaries":[{"period_id":"period-0001","sequence_number":0,"hash_start":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","hash_end":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","size_start":1000,"size_end":1234,"net_document_change":true,"gate_passed":true,"qualifying":true,"period_record_sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}],"new_period_ids":["period-0001"],"qualifying_new_period_count":1,"continuity":{"kind":"FULL","gaps":[]},"verdict":{"total_periods":1,"qualifying_periods":1,"total_active_seconds":120,"continuity":"FULL","verdict":"OBSERVED_WORK_CONSISTENT"},"previous_certificate_id":null,"previous_core_evidence_sha256":null},"core_evidence_sha256":"08d442447bcab04523647084232faa2d4232deed4fa83f2da6aaf8d415210f65","previous_certificate_id":null,"previous_core_evidence_sha256":null,"signature_metadata":{"signature_algorithm":"ed25519","public_key":"GX9rI+FshTLGq8g4+s1ep4m+DHaykgM0A5v6iz02jWE=","signing_key_id":"201713b33c99236b2b5799a8b1ee5149b67265539960f6f9096a8c4af77b3c39","identity_status":"LOCAL_DEVICE","schema_version":1},"signature":"MYoSbnb+hjagA75FW1/Mv5C030NA4rvNfC2vgVCK2GSNqUYUHmwaevTzjCJJHMuxebMOLRU4pnfgAtcPfJK5Ag=="}"#;

const MANIFEST_V1_JSON: &str = r#"{"schema_version":1,"package_id":"package-0001","work_id":"00000000-0000-4000-8000-000000000001","certificate_id":"cert-0001","certificate_sequence":1,"created_at":"2026-01-01T00:00:00Z","certificate_version":"V1","verdict":"OBSERVED_WORK_CONSISTENT","files":{"certificate":{"filename":"certificate.json","sha256":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},"labeled_pdf":{"filename":"labeled_document.pdf","sha256":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}},"signature_metadata":{"signature_algorithm":"ed25519","public_key":"GX9rI+FshTLGq8g4+s1ep4m+DHaykgM0A5v6iz02jWE=","signing_key_id":"201713b33c99236b2b5799a8b1ee5149b67265539960f6f9096a8c4af77b3c39","identity_status":"LOCAL_DEVICE","schema_version":1},"signature":"dhCLuMUruw+AUOQDe9Vw8gBbm8EpVkRXW6QYDUzL4fJvpyCcfmONemou3JMYwaR0zoeNvf3BQq+l/1eM5xr0Aw=="}"#;

// ---------------------------------------------------------------------------
// GARDE-FOUS : n'utilisent QUE les fixtures FIGÉES (jamais une régénération).
// ---------------------------------------------------------------------------

#[test]
fn v1_certificate_fixture_deserializes() {
    let cert: WorkCertificate = serde_json::from_str(CERT_V1_JSON)
        .expect("le certificat V1 figé doit toujours se désérialiser");
    assert_eq!(cert.certificate_version, CertificateVersion::V1);
    assert_eq!(cert.schema_version, CERTIFICATE_SCHEMA_VERSION);
    assert!(cert.previous_certificate_id.is_none());
}

#[test]
fn v1_certificate_fixture_verifies() {
    // verify_certificate contrôle : algo, identité, signing_key_id, cohérence de
    // core_evidence_sha256, ET signature Ed25519 sur le corps canonique.
    let cert: WorkCertificate = serde_json::from_str(CERT_V1_JSON).unwrap();
    verify_certificate(&cert).expect("le certificat V1 figé doit rester vérifiable");
}

#[test]
fn v1_certificate_core_evidence_sha_consistent() {
    let cert: WorkCertificate = serde_json::from_str(CERT_V1_JSON).unwrap();
    let recomputed =
        crate::work_certificate::compute_public_core_evidence_sha256(&cert.public_core_evidence)
            .unwrap();
    assert_eq!(cert.core_evidence_sha256, recomputed);
}

#[test]
fn v1_certificate_tamper_breaks_verification() {
    // (a) champ signé de premier niveau
    let mut c1: WorkCertificate = serde_json::from_str(CERT_V1_JSON).unwrap();
    c1.certificate_id = "falsifie".to_string();
    assert!(verify_certificate(&c1).is_err());
    // (b) champ dans public_core_evidence -> core_evidence_sha256 ne correspond plus
    let mut c2: WorkCertificate = serde_json::from_str(CERT_V1_JSON).unwrap();
    c2.public_core_evidence.qualifying_new_period_count += 1;
    assert!(verify_certificate(&c2).is_err());
    // (c) signature corrompue
    let mut c3: WorkCertificate = serde_json::from_str(CERT_V1_JSON).unwrap();
    c3.signature = b64(&[0u8; 64]);
    assert!(verify_certificate(&c3).is_err());
}

#[test]
fn v1_manifest_fixture_deserializes_and_signature_verifies() {
    let man: PackageManifest = serde_json::from_str(MANIFEST_V1_JSON)
        .expect("le manifest V1 figé doit toujours se désérialiser");
    assert_eq!(man.certificate_version, CertificateVersion::V1);
    assert_eq!(man.schema_version, PACKAGE_MANIFEST_SCHEMA_VERSION);

    // Vérification DIRECTE de la signature (sans `verify_manifest`, qui exige des
    // fichiers sur disque). La couverture disque complète de `verify_manifest`
    // relève d'un ticket séparé (nécessiterait d'écrire certificate.json +
    // labeled_document.pdf + manifest.json cohérents en fixture).
    let body = canonical_bytes_excluding(&man, &["signature"]).unwrap();
    let digest = Sha256::digest(&body);
    let vk = VerifyingKey::from_bytes(&decode32(&man.signature_metadata.public_key)).unwrap();
    let sig = Signature::from_bytes(&decode64(&man.signature));
    vk.verify_strict(digest.as_slice(), &sig)
        .expect("la signature du manifest V1 figé doit rester valide");
    assert_eq!(
        man.signature_metadata.signing_key_id,
        sha256_hex(&man.signature_metadata.public_key)
    );
}

#[test]
fn v1_manifest_tamper_breaks_signature() {
    let mut m: PackageManifest = serde_json::from_str(MANIFEST_V1_JSON).unwrap();
    m.certificate_id = "falsifie".to_string();
    let body = canonical_bytes_excluding(&m, &["signature"]).unwrap();
    let digest = Sha256::digest(&body);
    let vk = VerifyingKey::from_bytes(&decode32(&m.signature_metadata.public_key)).unwrap();
    let sig = Signature::from_bytes(&decode64(&m.signature));
    assert!(vk.verify_strict(digest.as_slice(), &sig).is_err());
}

// ---------------------------------------------------------------------------
// RÈGLE HO-JSON V2 (skip-none) démontrée mécaniquement sur des structs LOCALES,
// via la VRAIE fonction de canonicalisation `canonical_bytes_excluding`.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct WithoutSkip {
    a: u32,
    opt: Option<u32>,
}

#[derive(serde::Serialize)]
struct WithSkip {
    a: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    opt: Option<u32>,
}

#[derive(serde::Serialize)]
struct NoField {
    a: u32,
}

#[test]
fn ho_json_v2_skip_none_rule_is_enforced() {
    // Sans skip_serializing_if : Option::None est sérialisé en `null` (présent).
    let j1 = serde_json::to_string(&WithoutSkip { a: 1, opt: None }).unwrap();
    assert!(j1.contains("\"opt\":null"), "sans skip -> null attendu");

    // Avec #[serde(default, skip_serializing_if = "Option::is_none")] : champ omis.
    let j2 = serde_json::to_string(&WithSkip { a: 1, opt: None }).unwrap();
    assert!(!j2.contains("opt"), "avec skip -> champ absent");
    assert!(!j2.contains("null"));

    // Au niveau des OCTETS canoniques HO-CANON-V1 :
    //   WithSkip{None}  ==  struct sans le champ  -> signature V1 préservée.
    let b_nofield = canonical_bytes_excluding(&NoField { a: 1 }, &[]).unwrap();
    let b_skip = canonical_bytes_excluding(&WithSkip { a: 1, opt: None }, &[]).unwrap();
    assert_eq!(
        b_nofield, b_skip,
        "skip-none DOIT préserver les octets canoniques (compat V1)"
    );

    //   WithoutSkip{None}  !=  struct sans le champ -> casserait une signature V1.
    let b_noskip = canonical_bytes_excluding(&WithoutSkip { a: 1, opt: None }, &[]).unwrap();
    assert_ne!(
        b_nofield, b_noskip,
        "ajouter un champ SANS skip change les octets -> casse V1"
    );
}
