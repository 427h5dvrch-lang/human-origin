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

use serde::{Deserialize, Serialize};

use std::path::Path;

use crate::work_period::{self, ObservationPeriod};
use crate::work_store::{self, WorkId};

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
fn period_is_qualifying(p: &ObservationPeriod) -> bool {
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

/// SHA256 canonique (HO-CANON-V1) de la CoreEvidence. Source unique via
/// `work_period::canonical_sha256`. Nécessaire au chaînage V2.
pub(crate) fn compute_core_evidence_sha256(ev: &CoreEvidence) -> Result<String, String> {
    work_period::canonical_sha256(ev)
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
}
