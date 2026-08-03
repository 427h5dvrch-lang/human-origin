//! work_engine — Démarrage réel d'une période Work (Commit 5A, interne).
//!
//! Portée STRICTE : orchestrer le DÉMARRAGE d'une période — écrire le pending
//! crash-safe PUIS lancer le moteur avec un propriétaire explicite
//! `WORK(work_id, period_id)`. AUCUNE commande Tauri exposée en 5A (start et
//! stop seront exposés ensemble en 5B : aucune API publique ne doit démarrer une
//! capture sans pouvoir l'arrêter). AUCUNE signature, AUCUNE période, AUCUN
//! `finalize_capture`, AUCUNE UI, AUCUN accès `Projects/`.
//!
//! Invariants clés :
//! - un Work ARCHIVED ne peut pas démarrer de période ;
//! - tout pending existant (PENDING ou INTERRUPTED) bloque le démarrage ;
//! - le pending est écrit AVANT le moteur ;
//! - après publication du pending, la tête de chaîne est re-vérifiée (anti
//!   séquence obsolète en cas de concurrence) ;
//! - si le moteur ne démarre pas, le pending est ABANDONNÉ (ABORTED_BEFORE_START,
//!   non qualifiant), jamais présenté comme une observation INTERRUPTED.

// Fondation (Commit 5A) : cœur consommé par la commande exposée au Commit 5B.
#![allow(dead_code)]

use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::work_period::{self, ObservationPeriod};
use crate::work_store::{WorkId, WorkLifecycle};
use crate::{
    begin_capture, capture_owner, end_capture, ensure_signing_key, finalize_capture,
    is_capture_active, work_commands, work_pending, ActiveCaptureOwner, AppState, PasteStats,
};

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Résultat d'un démarrage de période réussi.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct StartOutcome {
    pub work_id: WorkId,
    pub period_id: String,
    pub sequence_number: u64,
}

/// Clé d'identité de la tête de chaîne (pour détecter un changement concurrent).
fn head_key(head: &Option<ObservationPeriod>) -> Option<(String, String)> {
    head.as_ref()
        .map(|p| (p.period_id.clone(), p.period_record_sha256.clone()))
}

/// Cœur de `start_work_period`, testable. Voir les invariants du module.
///
/// `start_fn` = démarrage effectif du moteur (en prod : `begin_capture`).
/// `after_pending` = point d'injection de test appelé juste après l'écriture du
/// pending (no-op en prod), pour simuler une concurrence sur la chaîne.
fn start_work_period_inner<S, H>(
    works_root: &Path,
    state: &AppState,
    work_id: WorkId,
    start_fn: S,
    after_pending: H,
) -> Result<StartOutcome, String>
where
    S: FnOnce(&AppState, ActiveCaptureOwner, String) -> Result<u64, String>,
    H: FnOnce(),
{
    // 1) Charger le Work (valide l'existence + le WorkId).
    let loaded = work_commands::load_work_core(works_root, &work_id)?;

    // 1b) Un Work ARCHIVED ne peut pas démarrer de période.
    if loaded.lifecycle != WorkLifecycle::Active {
        return Err("Work archivé — démarrage de période impossible".to_string());
    }

    // 2) Aucun pending (PENDING ou INTERRUPTED) ne doit exister (clôture explicite requise).
    if work_pending::detect_pending_for_work(works_root, &work_id)?.is_some() {
        return Err(
            "un pending existe déjà pour ce Work — le résoudre/clôturer d'abord".to_string(),
        );
    }

    // 3) Le moteur doit être libre (pré-check avant toute écriture de pending).
    if is_capture_active(state) {
        return Err("moteur d'observation déjà occupé".to_string());
    }

    // 4) Lire la tête de chaîne (autorité disque) -> séquence + liens.
    let head0 = work_period::find_last_period(works_root, &work_id)?;
    let (sequence_number, previous_period_id, previous_period_record_sha256) = match &head0 {
        None => (0u64, None, None),
        Some(p) => (
            p.sequence_number + 1,
            Some(p.period_id.clone()),
            Some(p.period_record_sha256.clone()),
        ),
    };

    // 5) Recalcul de la frontière de départ depuis le document réel.
    let (document_path, hash_start, size_start) =
        work_commands::capture_start_boundary(&loaded.document.document_path)?;

    // 6) Identité stable de la période.
    let period_id = uuid::Uuid::new_v4().to_string();

    // 7) Écrire le pending atomiquement (refus d'écrasement, race-safe).
    let pending = work_pending::PendingPeriod {
        schema_version: work_pending::PENDING_SCHEMA_VERSION,
        period_id: period_id.clone(),
        work_id: work_id.clone(),
        sequence_number,
        previous_period_id,
        previous_period_record_sha256,
        document_path,
        hash_start,
        size_start,
        started_at: now_utc(),
        state: work_pending::PendingState::Pending,
    };
    work_pending::write_pending_atomic(works_root, &pending)?;

    // Point d'injection de test (no-op en prod).
    after_pending();

    // 8) Re-vérifier la tête de chaîne : si elle a changé depuis (4), notre
    //    séquence est obsolète -> abandonner le pending et demander un réessai.
    let head1 = work_period::find_last_period(works_root, &work_id)?;
    if head_key(&head0) != head_key(&head1) {
        let _ = work_pending::abort_pending_before_start(works_root, &work_id, &period_id);
        return Err("chaîne modifiée pendant le démarrage — réessayer".to_string());
    }

    // 9) Démarrer le moteur avec owner WORK. Si échec : ABANDON (pas INTERRUPTED).
    let owner = ActiveCaptureOwner::Work {
        work_id: work_id.as_str().to_string(),
        period_id: period_id.clone(),
    };
    if let Err(e) = start_fn(state, owner, period_id.clone()) {
        let _ = work_pending::abort_pending_before_start(works_root, &work_id, &period_id);
        return Err(e);
    }

    Ok(StartOutcome {
        work_id,
        period_id,
        sequence_number,
    })
}

/// Démarre réellement une période pour un Work. Écrit le pending puis lance le
/// moteur (`begin_capture`).
pub(crate) fn start_work_period_core(
    works_root: &Path,
    state: &AppState,
    work_id: WorkId,
) -> Result<StartOutcome, String> {
    start_work_period_inner(
        works_root,
        state,
        work_id,
        |st, owner, sid| begin_capture(st, owner, sid),
        || {},
    )
}

/// Résultat d'un arrêt de période réussi.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub(crate) struct StopOutcome {
    pub work_id: WorkId,
    pub period_id: String,
    pub sequence_number: u64,
    pub score: i32,
    pub net_document_change: bool,
    /// Vrai si la période est écrite mais la suppression du pending a échoué
    /// (Décision 5B #1) : la preuve existe, le nettoyage est différé.
    pub pending_cleanup_deferred: bool,
}

/// Cœur de `stop_work_period`, testable via seams `sign_fn`/`write_fn`.
///
/// Règles d'échec figées :
/// - avant l'arrêt moteur (owner/pending incohérents) : refus, moteur intact ;
/// - après l'arrêt moteur, avant une période valide (hash_end/signature/écriture) :
///   pending marqué INTERRUPTED (Décision 5B #2), aucune période ;
/// - échec du cleanup APRÈS période valide : succès + `pending_cleanup_deferred`
///   (Décision 5B #1), la période n'est jamais touchée.
fn stop_work_period_inner<SG, WR>(
    works_root: &Path,
    state: &AppState,
    requested_work_id: WorkId,
    paste: PasteStats,
    sign_fn: SG,
    write_fn: WR,
) -> Result<StopOutcome, String>
where
    SG: FnOnce(work_period::PeriodInputs) -> Result<ObservationPeriod, String>,
    WR: FnOnce(&Path, &ObservationPeriod) -> Result<PathBuf, String>,
{
    // 1) Capture active + owner WORK.
    if !is_capture_active(state) {
        return Err("aucune capture active".to_string());
    }
    let (owner_work_id, owner_period_id) = match capture_owner(state) {
        ActiveCaptureOwner::Work { work_id, period_id } => (work_id, period_id),
        _ => return Err("la capture active n'est pas une période Work".to_string()),
    };
    // 2) work_id demandé == owner.work_id.
    if owner_work_id.as_str() != requested_work_id.as_str() {
        return Err("work_id ne correspond pas à la capture active".to_string());
    }
    // 3) Lire le pending.
    let pending = work_pending::read_pending(works_root, &requested_work_id)?
        .ok_or_else(|| "pending absent".to_string())?;
    // 4) Pending PENDING (INTERRUPTED/ABORTED refusés).
    if !pending.can_start_period() {
        return Err("pending non PENDING (INTERRUPTED/ABORTED) — arrêt refusé".to_string());
    }
    // 5) pending.period_id == owner.period_id.
    if pending.period_id != owner_period_id {
        return Err("period_id du pending ne correspond pas à la capture active".to_string());
    }

    // 6) Arrêter réellement le moteur (owner -> Idle).
    let snap = end_capture(state);

    // 7) Scoring.
    let end_ms = chrono::Utc::now().timestamp_millis();
    let out = finalize_capture(
        snap.start_ms,
        end_ms,
        &snap.keys,
        &snap.backs,
        &snap.clicks,
        &paste,
    );
    let score = out.score;

    // 8) hash_end/size_end. Échec après arrêt -> INTERRUPTED (Décision 5B #2).
    let (_p, hash_end, size_end) =
        match work_commands::capture_start_boundary(&pending.document_path) {
            Ok(t) => t,
            Err(e) => {
                let _ = work_pending::mark_pending_interrupted(works_root, &requested_work_id);
                return Err(e);
            }
        };

    // 9) Construire l'ObservationPeriod (frontière depuis le pending).
    let inputs = work_period::PeriodInputs {
        period_id: pending.period_id.clone(),
        work_id: pending.work_id.clone(),
        sequence_number: pending.sequence_number,
        previous_period_id: pending.previous_period_id.clone(),
        previous_period_record_sha256: pending.previous_period_record_sha256.clone(),
        document_path: pending.document_path.clone(),
        hash_start: pending.hash_start.clone(),
        size_start: pending.size_start,
        hash_end,
        size_end,
        // 5B : aucun watcher documentaire backend -> jamais dérivé du clavier/souris.
        change_observed_during_period: false,
        engine: out.engine,
    };

    // 10) Signer.
    let period = match sign_fn(inputs) {
        Ok(p) => p,
        Err(e) => {
            let _ = work_pending::mark_pending_interrupted(works_root, &requested_work_id);
            return Err(e);
        }
    };

    // 11) Écrire la période immuable.
    if let Err(e) = write_fn(works_root, &period) {
        let _ = work_pending::mark_pending_interrupted(works_root, &requested_work_id);
        return Err(e);
    }

    // La période valide existe désormais et ne sera JAMAIS touchée.
    // 12) Cleanup non fatal (Décision 5B #1).
    let pending_cleanup_deferred = work_pending::remove_pending_after_period_success(
        works_root,
        &requested_work_id,
        period.sequence_number,
    )
    .is_err();

    Ok(StopOutcome {
        work_id: requested_work_id,
        period_id: period.period_id,
        sequence_number: period.sequence_number,
        score,
        net_document_change: period.net_document_change,
        pending_cleanup_deferred,
    })
}

/// Arrête une période Work et scelle une `ObservationPeriod` signée immuable.
pub(crate) fn stop_work_period_core(
    works_root: &Path,
    state: &AppState,
    work_id: WorkId,
    paste: PasteStats,
) -> Result<StopOutcome, String> {
    stop_work_period_inner(
        works_root,
        state,
        work_id,
        paste,
        |inputs| {
            let key = ensure_signing_key()?;
            work_period::sign_period_record(inputs, &key)
        },
        |root, period| work_period::write_period_once(root, period),
    )
}

// --- TESTS UNITAIRES ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_pending::PendingState;
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn temp_base() -> PathBuf {
        std::env::temp_dir().join(format!("ho_engine_test_{}", Uuid::new_v4()))
    }

    fn cleanup(p: &Path) {
        let _ = fs::remove_dir_all(p);
    }

    /// Crée un vrai document + un Work, renvoie (works_root, work_id, doc_path).
    fn make_work(base: &Path, content: &[u8]) -> (PathBuf, WorkId, PathBuf) {
        let works = base.join("Works");
        let docs = base.join("docs");
        fs::create_dir_all(&docs).unwrap();
        let doc = docs.join("sujet.txt");
        fs::write(&doc, content).unwrap();
        let outcome =
            work_commands::create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();
        let work_id = match outcome {
            work_commands::CreateWorkOutcome::Created { work_id } => work_id,
            other => panic!("attendu Created, reçu {:?}", other),
        };
        (works, work_id, doc)
    }

    /// Écrit sur disque une période immuable signée (pour amorcer la chaîne).
    fn seed_period(
        works: &Path,
        work_id: &WorkId,
        sequence_number: u64,
        previous: Option<&ObservationPeriod>,
    ) -> ObservationPeriod {
        let key = SigningKey::generate(&mut OsRng);
        let inputs = work_period::PeriodInputs {
            period_id: Uuid::new_v4().to_string(),
            work_id: work_id.clone(),
            sequence_number,
            previous_period_id: previous.map(|p| p.period_id.clone()),
            previous_period_record_sha256: previous.map(|p| p.period_record_sha256.clone()),
            document_path: "/tmp/sujet.txt".to_string(),
            hash_start: "a".repeat(64),
            size_start: 10,
            hash_end: "b".repeat(64),
            size_end: 12,
            change_observed_during_period: false,
            engine: json!({ "score": 80 }),
        };
        let period = work_period::sign_period_record(inputs, &key).unwrap();
        work_period::write_period_once(works, &period).unwrap();
        period
    }

    #[test]
    fn test_1_demarrage_nominal_pending_puis_moteur() {
        let base = temp_base();
        let (works, wid, doc) = make_work(&base, b"contenu");
        let state = AppState::new_detached();

        let outcome = start_work_period_core(&works, &state, wid.clone()).unwrap();
        assert_eq!(outcome.sequence_number, 0);

        // Pending écrit, PENDING, même period_id.
        let pending = work_pending::read_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(pending.state, PendingState::Pending);
        assert_eq!(pending.period_id, outcome.period_id);
        assert_eq!(pending.sequence_number, 0);

        // Moteur actif avec owner WORK.
        assert!(is_capture_active(&state));
        assert_eq!(
            capture_owner(&state),
            ActiveCaptureOwner::Work {
                work_id: wid.as_str().to_string(),
                period_id: outcome.period_id.clone(),
            }
        );

        // Frontière de départ = hash/taille réels du document.
        let mut hasher = Sha256::new();
        hasher.update(b"contenu");
        assert_eq!(pending.hash_start, format!("{:x}", hasher.finalize()));
        assert_eq!(pending.size_start, fs::metadata(&doc).unwrap().len());
        cleanup(&base);
    }

    #[test]
    fn test_2_work_archived_refuse() {
        let base = temp_base();
        let (works, wid, _doc) = make_work(&base, b"x");
        work_commands::archive_work_core(&works, &wid).unwrap();
        let state = AppState::new_detached();

        assert!(start_work_period_core(&works, &state, wid.clone()).is_err());
        assert!(work_pending::read_pending(&works, &wid).unwrap().is_none());
        assert!(!is_capture_active(&state));
        cleanup(&base);
    }

    #[test]
    fn test_3_pending_pending_bloque() {
        let base = temp_base();
        let (works, wid, _doc) = make_work(&base, b"x");
        let state = AppState::new_detached();

        // Premier démarrage OK (crée pending + moteur actif).
        start_work_period_core(&works, &state, wid.clone()).unwrap();
        // Second démarrage refusé (pending existant).
        let state2 = AppState::new_detached();
        assert!(start_work_period_core(&works, &state2, wid.clone()).is_err());
        cleanup(&base);
    }

    #[test]
    fn test_4_pending_interrupted_bloque() {
        let base = temp_base();
        let (works, wid, _doc) = make_work(&base, b"x");
        let state = AppState::new_detached();
        start_work_period_core(&works, &state, wid.clone()).unwrap();
        // Simule un crash-orphan : récupération -> INTERRUPTED.
        work_pending::recover_orphaned_pending(&works, &wid).unwrap();

        let state2 = AppState::new_detached();
        assert!(
            start_work_period_core(&works, &state2, wid.clone()).is_err(),
            "un INTERRUPTED bloque le démarrage"
        );
        cleanup(&base);
    }

    #[test]
    fn test_5_moteur_occupe_refuse_sans_pending() {
        let base = temp_base();
        let (works, wid, _doc) = make_work(&base, b"x");
        let state = AppState::new_detached();
        // Occupe le moteur (capture legacy).
        begin_capture(&state, ActiveCaptureOwner::LegacyProject, "sid".to_string()).unwrap();

        assert!(start_work_period_core(&works, &state, wid.clone()).is_err());
        // Aucun pending ne doit avoir été créé.
        assert!(work_pending::read_pending(&works, &wid).unwrap().is_none());
        cleanup(&base);
    }

    #[test]
    fn test_6_echec_moteur_abandonne_pas_interrupted() {
        let base = temp_base();
        let (works, wid, _doc) = make_work(&base, b"x");
        let state = AppState::new_detached();

        // start_fn force un échec du moteur.
        let res = start_work_period_inner(
            &works,
            &state,
            wid.clone(),
            |_st, _owner, _sid| Err("moteur KO".to_string()),
            || {},
        );
        assert!(res.is_err());

        // Le slot pending est libéré (abandon), PAS présenté comme INTERRUPTED.
        assert!(
            work_pending::read_pending(&works, &wid).unwrap().is_none(),
            "pending abandonné, slot libéré"
        );
        // Une archive d'abandon existe.
        let dir = works.join(wid.as_str()).join("periods");
        let has_aborted = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).any(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("pending_aborted_")
        });
        assert!(has_aborted, "archive ABORTED_BEFORE_START présente");
        assert!(!is_capture_active(&state));
        cleanup(&base);
    }

    #[test]
    fn test_7_chaine_modifiee_abandonne() {
        let base = temp_base();
        let (works, wid, _doc) = make_work(&base, b"x");
        let state = AppState::new_detached();
        let wid_hook = wid.clone();
        let works_hook = works.clone();

        // after_pending : une période genèse apparaît (concurrence) -> tête change.
        let res = start_work_period_inner(
            &works,
            &state,
            wid.clone(),
            |st, owner, sid| begin_capture(st, owner, sid),
            move || {
                seed_period(&works_hook, &wid_hook, 0, None);
            },
        );
        assert!(res.is_err(), "séquence obsolète -> refus");
        // Pending abandonné, moteur non démarré.
        assert!(work_pending::read_pending(&works, &wid).unwrap().is_none());
        assert!(!is_capture_active(&state));
        cleanup(&base);
    }

    #[test]
    fn test_8_chainage_sequence_et_liens() {
        let base = temp_base();
        let (works, wid, _doc) = make_work(&base, b"x");
        // Amorce une genèse sur disque.
        let genesis = seed_period(&works, &wid, 0, None);
        let state = AppState::new_detached();

        let outcome = start_work_period_core(&works, &state, wid.clone()).unwrap();
        assert_eq!(outcome.sequence_number, 1);
        let pending = work_pending::read_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(pending.sequence_number, 1);
        assert_eq!(
            pending.previous_period_id.as_deref(),
            Some(genesis.period_id.as_str())
        );
        assert_eq!(
            pending.previous_period_record_sha256.as_deref(),
            Some(genesis.period_record_sha256.as_str())
        );
        cleanup(&base);
    }

    #[test]
    fn test_9_aucune_ecriture_dans_projects() {
        let base = temp_base();
        let projects = base.join("Projects");
        fs::create_dir_all(projects.join("Legacy")).unwrap();
        fs::write(projects.join("Legacy").join("project.json"), b"{}").unwrap();

        let (works, wid, _doc) = make_work(&base, b"x");
        let state = AppState::new_detached();
        start_work_period_core(&works, &state, wid.clone()).unwrap();

        assert!(projects.join("Legacy").join("project.json").exists());
        assert!(!projects.join(wid.as_str()).exists());
        cleanup(&base);
    }

    // --- COMMIT 5B : arrêt de période ----------------------------------------

    fn eph_sign(inputs: work_period::PeriodInputs) -> Result<ObservationPeriod, String> {
        let key = SigningKey::generate(&mut OsRng);
        work_period::sign_period_record(inputs, &key)
    }

    fn write_real(root: &Path, period: &ObservationPeriod) -> Result<PathBuf, String> {
        work_period::write_period_once(root, period)
    }

    /// Démarre une période et renvoie (works, wid, state, doc).
    fn start(base: &Path, content: &[u8]) -> (PathBuf, WorkId, AppState, PathBuf) {
        let (works, wid, doc) = make_work(base, content);
        let state = AppState::new_detached();
        start_work_period_core(&works, &state, wid.clone()).unwrap();
        (works, wid, state, doc)
    }

    fn pending_file(works: &Path, wid: &WorkId) -> PathBuf {
        works
            .join(wid.as_str())
            .join("periods")
            .join("pending.json")
    }

    #[test]
    fn test_5b_1_mauvais_work_id_refuse() {
        let base = temp_base();
        let (works, wid, state, _doc) = start(&base, b"x");
        let wrong = WorkId::new();
        let res = stop_work_period_inner(
            &works,
            &state,
            wrong,
            PasteStats::default(),
            eph_sign,
            write_real,
        );
        assert!(res.is_err());
        assert!(is_capture_active(&state), "capture toujours active");
        assert!(work_pending::read_pending(&works, &wid).unwrap().is_some());
        cleanup(&base);
    }

    #[test]
    fn test_5b_2_mauvais_period_id_refuse() {
        let base = temp_base();
        let (works, wid, state, _doc) = start(&base, b"x");
        // Falsifie le period_id du pending sur disque (reste PENDING).
        let mut p = work_pending::read_pending(&works, &wid).unwrap().unwrap();
        p.period_id = Uuid::new_v4().to_string();
        fs::write(
            pending_file(&works, &wid),
            serde_json::to_vec_pretty(&p).unwrap(),
        )
        .unwrap();

        let res = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            write_real,
        );
        assert!(res.is_err(), "period_id ≠ owner -> refus");
        assert!(is_capture_active(&state));
        cleanup(&base);
    }

    #[test]
    fn test_5b_3_pending_absent_refuse() {
        let base = temp_base();
        let (works, wid, state, _doc) = start(&base, b"x");
        fs::remove_file(pending_file(&works, &wid)).unwrap();
        let res = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            write_real,
        );
        assert!(res.is_err());
        assert!(is_capture_active(&state));
        cleanup(&base);
    }

    #[test]
    fn test_5b_4_pending_interrupted_refuse() {
        let base = temp_base();
        let (works, wid, state, _doc) = start(&base, b"x");
        work_pending::recover_orphaned_pending(&works, &wid).unwrap(); // -> INTERRUPTED
        let res = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            write_real,
        );
        assert!(res.is_err(), "pending INTERRUPTED -> arrêt refusé");
        cleanup(&base);
    }

    #[test]
    fn test_5b_5_succes_periode_signee_et_pending_supprime() {
        let base = temp_base();
        let (works, wid, state, _doc) = start(&base, b"contenu");
        let outcome = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            write_real,
        )
        .unwrap();

        assert!(!outcome.pending_cleanup_deferred);
        // Période présente, chaîne vérifiée.
        let last = work_period::find_last_period(&works, &wid)
            .unwrap()
            .unwrap();
        assert_eq!(last.period_id, outcome.period_id);
        assert!(work_period::verify_period_record(&last).is_ok());
        // Pending supprimé.
        assert!(work_pending::read_pending(&works, &wid).unwrap().is_none());
        // Owner remis Idle, capture arrêtée.
        assert_eq!(capture_owner(&state), ActiveCaptureOwner::Idle);
        assert!(!is_capture_active(&state));
        cleanup(&base);
    }

    #[test]
    fn test_5b_6_echec_signature_pending_interrupted() {
        let base = temp_base();
        let (works, wid, state, _doc) = start(&base, b"x");
        let res = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            |_inputs| Err("signature KO".to_string()),
            write_real,
        );
        assert!(res.is_err());
        // Aucune période, pending marqué INTERRUPTED (Décision 5B #2).
        assert!(work_period::find_last_period(&works, &wid)
            .unwrap()
            .is_none());
        let p = work_pending::read_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(p.state, PendingState::Interrupted);
        assert!(!is_capture_active(&state));
        cleanup(&base);
    }

    #[test]
    fn test_5b_6b_echec_write_pending_interrupted() {
        let base = temp_base();
        let (works, wid, state, _doc) = start(&base, b"x");
        let res = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            |_root, _period| Err("write KO".to_string()),
        );
        assert!(res.is_err());
        assert!(work_period::find_last_period(&works, &wid)
            .unwrap()
            .is_none());
        let p = work_pending::read_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(p.state, PendingState::Interrupted);
        cleanup(&base);
    }

    #[test]
    fn test_5b_7_hash_inchange_net_document_change_false() {
        let base = temp_base();
        // Document non modifié entre start et stop -> hash_start == hash_end.
        let (works, wid, state, _doc) = start(&base, b"stable");
        let outcome = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            write_real,
        )
        .unwrap();
        assert!(
            !outcome.net_document_change,
            "document inchangé -> net=false"
        );
        let last = work_period::find_last_period(&works, &wid)
            .unwrap()
            .unwrap();
        assert!(!last.net_document_change);
        assert_eq!(last.hash_start, last.hash_end);
        cleanup(&base);
    }

    #[test]
    fn test_5b_8_document_modifie_net_document_change_true() {
        let base = temp_base();
        let (works, wid, state, doc) = start(&base, b"avant");
        // Modifie le document pendant l'observation.
        fs::write(&doc, b"apres modifie").unwrap();
        let outcome = stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            write_real,
        )
        .unwrap();
        assert!(outcome.net_document_change, "document modifié -> net=true");
        cleanup(&base);
    }

    #[test]
    fn test_5b_9_finalize_capture_bloc_paste() {
        // Exerce le bloc paste déplacé : collage dominant force gate=false + flag.
        let paste = PasteStats {
            paste_events: 1,
            pasted_chars: 300,
            max_paste_chars: 300,
        };
        let keys: Vec<i64> = (0..10).collect(); // typed=10 < 300*0.35
        let empty: Vec<i64> = Vec::new();
        let out = finalize_capture(0, 60_000, &keys, &empty, &empty, &paste);
        assert!(!out.analysis.gate_passed);
        assert_eq!(out.analysis.score, 0);
        assert!(out.analysis.flags.iter().any(|f| f == "PASTE_DOMINANT"));
        // engine sérialisé contient les 4 sous-blocs.
        let eng = &out.engine;
        for k in [
            "analysis",
            "keyboard_dynamics",
            "mouse_dynamics",
            "paste_stats",
        ] {
            assert!(eng.get(k).is_some(), "engine doit contenir {k}");
        }
    }

    #[test]
    fn test_5b_10_aucune_ecriture_projects_flux_stop() {
        let base = temp_base();
        let projects = base.join("Projects");
        fs::create_dir_all(projects.join("Legacy")).unwrap();
        fs::write(projects.join("Legacy").join("project.json"), b"{}").unwrap();

        let (works, wid, state, _doc) = start(&base, b"x");
        stop_work_period_inner(
            &works,
            &state,
            wid.clone(),
            PasteStats::default(),
            eph_sign,
            write_real,
        )
        .unwrap();

        assert!(projects.join("Legacy").join("project.json").exists());
        assert!(!projects.join(wid.as_str()).exists());
        cleanup(&base);
    }
}
