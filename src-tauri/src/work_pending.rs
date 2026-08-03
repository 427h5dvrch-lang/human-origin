//! work_pending — Frontière de départ crash-safe d'une période (Commit 4).
//!
//! Portée STRICTE : persister ATOMIQUEMENT l'état « début de période » AVANT le
//! lancement réel de l'observation, et gérer sa reprise/interruption après un
//! crash. AUCUN moteur, AUCUN scan, AUCUNE signature de période, AUCUN
//! certificat, AUCUNE commande Tauri, AUCUNE UI, AUCUN accès `Projects/`.
//!
//! Invariants :
//! - un seul `pending.json` actif par Work ;
//! - refus d'écrasement à la création ;
//! - un pending retrouvé au démarrage devient INTERRUPTED (l'observation n'a
//!   pas été clôturée proprement) ;
//! - un pending INTERRUPTED n'est jamais qualifiant pour fabriquer une période
//!   signée ;
//! - le pending n'est supprimé qu'APRÈS l'écriture réussie du `period.json`
//!   immuable.

// Fondation (Commit 4) : API consommée par start/stop_work_period au Commit 5.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use crate::work_period;
use crate::work_store::WorkId;

/// Version de schéma du format pending.
pub const PENDING_SCHEMA_VERSION: u32 = 1;

const PERIODS_DIR: &str = "periods";
const PENDING_FILE: &str = "pending.json";

// --- TYPES --------------------------------------------------------------------

/// État d'un pending. Sérialisé en `"PENDING"` / `"INTERRUPTED"`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum PendingState {
    Pending,
    Interrupted,
}

/// Frontière de départ d'une période, persistée avant l'observation.
/// Ne contient AUCUNE donnée de fin, AUCUN scoring, AUCUNE signature.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PendingPeriod {
    pub schema_version: u32,
    pub period_id: String,
    pub work_id: WorkId,
    pub sequence_number: u64,
    pub previous_period_id: Option<String>,
    pub previous_period_record_sha256: Option<String>,
    pub document_path: String,
    pub hash_start: String,
    pub size_start: u64,
    pub started_at: String,
    pub state: PendingState,
}

impl PendingPeriod {
    /// Un pending ne peut donner lieu à une période signée que s'il est PENDING.
    /// Un pending INTERRUPTED n'est JAMAIS qualifiant.
    pub fn can_start_period(&self) -> bool {
        self.state == PendingState::Pending
    }
}

// --- CHEMINS ------------------------------------------------------------------

fn ensure_valid_work_id(work_id: &WorkId) -> Result<(), String> {
    if !work_id.is_valid() {
        return Err(format!(
            "WorkId invalide (UUID attendu) : {:?}",
            work_id.as_str()
        ));
    }
    Ok(())
}

fn periods_dir(works_root: &Path, work_id: &WorkId) -> PathBuf {
    works_root.join(work_id.as_str()).join(PERIODS_DIR)
}

fn pending_path(works_root: &Path, work_id: &WorkId) -> PathBuf {
    periods_dir(works_root, work_id).join(PENDING_FILE)
}

fn period_file_path(works_root: &Path, work_id: &WorkId, sequence: u64) -> PathBuf {
    periods_dir(works_root, work_id).join(format!("period_{sequence}.json"))
}

// --- I/O ATOMIQUE -------------------------------------------------------------

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

/// Écrit un temporaire complet (create_new + flush + fsync) et renvoie son chemin.
fn write_temp(parent: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".{}.tmp-{}", file_name, uuid::Uuid::new_v4()));
    let res = (|| -> Result<(), String> {
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
    if let Err(e) = res {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(tmp)
}

/// Publication NON destructive (création) : `hard_link` échoue atomiquement si
/// la cible existe déjà. Le lien EST le test d'existence — pas de course.
fn publish_create(tmp: &Path, path: &Path) -> Result<(), String> {
    let link_result = fs::hard_link(tmp, path);
    let _ = fs::remove_file(tmp);
    match link_result {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                sync_dir(parent);
            }
            Ok(())
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err(format!(
            "Pending déjà existant, écrasement refusé : {}",
            path.display()
        )),
        Err(e) => Err(e.to_string()),
    }
}

/// Remplacement atomique (mutation d'état légitime) : `rename` recouvre la cible.
fn publish_replace(tmp: &Path, path: &Path) -> Result<(), String> {
    if let Err(e) = fs::rename(tmp, path) {
        let _ = fs::remove_file(tmp);
        return Err(e.to_string());
    }
    if let Some(parent) = path.parent() {
        sync_dir(parent);
    }
    Ok(())
}

// --- API PUBLIQUE -------------------------------------------------------------

/// Écrit le pending de départ, UNE SEULE FOIS. Refus d'écrasement (un seul
/// pending actif par Work), race-safe.
pub fn write_pending_atomic(works_root: &Path, pending: &PendingPeriod) -> Result<PathBuf, String> {
    ensure_valid_work_id(&pending.work_id)?;
    let path = pending_path(works_root, &pending.work_id);
    let parent = path.parent().ok_or("chemin pending sans parent")?;
    if path.exists() {
        return Err(format!(
            "Pending déjà existant, écrasement refusé : {}",
            path.display()
        ));
    }
    let json = serde_json::to_vec_pretty(pending).map_err(|e| e.to_string())?;
    let tmp = write_temp(parent, PENDING_FILE, &json)?;
    publish_create(&tmp, &path)?;
    Ok(path)
}

/// Lit le pending d'un Work. `Ok(None)` si absent ; `Err` si corrompu.
pub fn read_pending(works_root: &Path, work_id: &WorkId) -> Result<Option<PendingPeriod>, String> {
    ensure_valid_work_id(work_id)?;
    let path = pending_path(works_root, work_id);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("{} : {}", path.display(), e))?;
    let pending: PendingPeriod =
        serde_json::from_str(&raw).map_err(|e| format!("pending corrompu : {}", e))?;
    Ok(Some(pending))
}

/// Marque le pending d'un Work comme INTERRUPTED (mutation atomique, idempotente).
pub fn mark_pending_interrupted(
    works_root: &Path,
    work_id: &WorkId,
) -> Result<PendingPeriod, String> {
    ensure_valid_work_id(work_id)?;
    let mut pending = read_pending(works_root, work_id)?
        .ok_or_else(|| "aucun pending à interrompre".to_string())?;
    if pending.state != PendingState::Interrupted {
        pending.state = PendingState::Interrupted;
        let path = pending_path(works_root, work_id);
        let parent = path.parent().ok_or("chemin pending sans parent")?;
        let json = serde_json::to_vec_pretty(&pending).map_err(|e| e.to_string())?;
        let tmp = write_temp(parent, PENDING_FILE, &json)?;
        publish_replace(&tmp, &path)?;
    }
    Ok(pending)
}

/// Détection PURE : lit et renvoie le pending d'un Work SANS jamais le modifier.
/// `Ok(None)` si absent. N'effectue AUCUNE transition d'état.
pub fn detect_pending_for_work(
    works_root: &Path,
    work_id: &WorkId,
) -> Result<Option<PendingPeriod>, String> {
    read_pending(works_root, work_id)
}

/// Récupération EXPLICITE au démarrage de l'app : un pending retrouvé signifie
/// que l'observation n'a pas été clôturée proprement. SEULE cette opération peut
/// faire passer PENDING -> INTERRUPTED. Idempotente (un INTERRUPTED reste tel).
/// `Ok(None)` si aucun pending.
pub fn recover_orphaned_pending(
    works_root: &Path,
    work_id: &WorkId,
) -> Result<Option<PendingPeriod>, String> {
    ensure_valid_work_id(work_id)?;
    match read_pending(works_root, work_id)? {
        None => Ok(None),
        Some(p) if p.state == PendingState::Pending => {
            Ok(Some(mark_pending_interrupted(works_root, work_id)?))
        }
        Some(p) => Ok(Some(p)),
    }
}

/// Supprime le pending UNIQUEMENT après l'écriture réussie du `period_{seq}.json`
/// immuable ET après vérification cryptographique + cohérence EXACTE de tous les
/// champs de frontière. Si une seule condition échoue, le pending est CONSERVÉ.
/// Idempotent si le pending est déjà absent.
pub fn remove_pending_after_period_success(
    works_root: &Path,
    work_id: &WorkId,
    sequence_number: u64,
) -> Result<(), String> {
    ensure_valid_work_id(work_id)?;

    // La période immuable doit exister ET être cryptographiquement valide.
    let period = work_period::read_period(works_root, work_id, sequence_number)?;

    let pending = match read_pending(works_root, work_id)? {
        Some(p) => p,
        None => return Ok(()), // déjà supprimé (idempotent)
    };

    // Cohérence EXACTE pending <-> période immuable (frontière de départ).
    let coherent = pending.period_id == period.period_id
        && pending.work_id == period.work_id
        && pending.sequence_number == period.sequence_number
        && pending.hash_start == period.hash_start
        && pending.previous_period_id == period.previous_period_id
        && pending.previous_period_record_sha256 == period.previous_period_record_sha256;
    if !coherent {
        return Err(
            "pending et période immuable incohérents — suppression du pending refusée".to_string(),
        );
    }

    let path = pending_path(works_root, work_id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        if let Some(parent) = path.parent() {
            sync_dir(parent);
        }
    }
    Ok(())
}

/// Abandon d'un pending AVANT tout démarrage réel de la capture : le moteur n'a
/// jamais observé. Ce N'EST PAS une observation interrompue — on archive (non
/// destructif) vers `pending_aborted_{period_id}.json` et on libère le slot,
/// sans forcer l'utilisateur à résoudre une fausse période INTERRUPTED.
///
/// Refuse si le pending n'est pas PENDING (un INTERRUPTED représente une vraie
/// observation et relève de `close_interrupted_pending`) ou si le `period_id`
/// ne correspond pas (on n'abandonne que le pending que l'on vient d'écrire).
pub fn abort_pending_before_start(
    works_root: &Path,
    work_id: &WorkId,
    expected_period_id: &str,
) -> Result<PathBuf, String> {
    ensure_valid_work_id(work_id)?;
    let pending = read_pending(works_root, work_id)?
        .ok_or_else(|| "aucun pending à abandonner".to_string())?;
    if pending.state != PendingState::Pending {
        return Err("seul un pending PENDING non démarré peut être abandonné".to_string());
    }
    if pending.period_id != expected_period_id {
        return Err("period_id du pending différent — abandon refusé".to_string());
    }

    let dir = periods_dir(works_root, work_id);
    let mut archive = dir.join(format!("pending_aborted_{}.json", pending.period_id));
    if archive.exists() {
        archive = dir.join(format!(
            "pending_aborted_{}_{}.json",
            pending.period_id,
            uuid::Uuid::new_v4()
        ));
    }
    let src = pending_path(works_root, work_id);
    fs::rename(&src, &archive).map_err(|e| e.to_string())?;
    sync_dir(&dir);
    Ok(archive)
}

/// Clôture EXPLICITE d'un pending INTERRUPTED : le déplace (non destructif) vers
/// `pending_interrupted_{period_id}.json`, libérant le slot `pending.json` pour
/// qu'une NOUVELLE période puisse commencer. Refuse un pending PENDING (il faut
/// d'abord `recover_orphaned_pending`) ou absent. Retourne le chemin d'archive.
pub fn close_interrupted_pending(works_root: &Path, work_id: &WorkId) -> Result<PathBuf, String> {
    ensure_valid_work_id(work_id)?;
    let pending =
        read_pending(works_root, work_id)?.ok_or_else(|| "aucun pending à clôturer".to_string())?;
    if pending.state != PendingState::Interrupted {
        return Err("seul un pending INTERRUPTED peut être clôturé".to_string());
    }

    let dir = periods_dir(works_root, work_id);
    let mut archive = dir.join(format!("pending_interrupted_{}.json", pending.period_id));
    if archive.exists() {
        archive = dir.join(format!(
            "pending_interrupted_{}_{}.json",
            pending.period_id,
            uuid::Uuid::new_v4()
        ));
    }
    let src = pending_path(works_root, work_id);
    fs::rename(&src, &archive).map_err(|e| e.to_string())?;
    sync_dir(&dir);
    Ok(archive)
}

// --- TESTS UNITAIRES ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand_core::OsRng;
    use serde_json::json;
    use uuid::Uuid;

    fn temp_root() -> PathBuf {
        std::env::temp_dir().join(format!("ho_pending_test_{}", Uuid::new_v4()))
    }

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
    }

    fn sample_pending(work_id: &WorkId) -> PendingPeriod {
        PendingPeriod {
            schema_version: PENDING_SCHEMA_VERSION,
            period_id: Uuid::new_v4().to_string(),
            work_id: work_id.clone(),
            sequence_number: 0,
            previous_period_id: None,
            previous_period_record_sha256: None,
            document_path: "/tmp/doc.txt".to_string(),
            hash_start: "a".repeat(64),
            size_start: 100,
            started_at: "2026-07-15T10:00:00Z".to_string(),
            state: PendingState::Pending,
        }
    }

    /// Écrit sur disque une période immuable dont la frontière correspond
    /// (ou non, via `override_period_id`) au pending fourni.
    fn write_matching_period(
        works: &Path,
        pending: &PendingPeriod,
        override_period_id: Option<&str>,
    ) {
        let key = SigningKey::generate(&mut OsRng);
        let inputs = work_period::PeriodInputs {
            period_id: override_period_id
                .unwrap_or(pending.period_id.as_str())
                .to_string(),
            work_id: pending.work_id.clone(),
            sequence_number: pending.sequence_number,
            previous_period_id: pending.previous_period_id.clone(),
            previous_period_record_sha256: pending.previous_period_record_sha256.clone(),
            document_path: pending.document_path.clone(),
            hash_start: pending.hash_start.clone(),
            size_start: pending.size_start,
            hash_end: "b".repeat(64),
            size_end: 120,
            change_observed_during_period: true,
            engine: json!({ "score": 90 }),
        };
        let period = work_period::sign_period_record(inputs, &key).unwrap();
        work_period::write_period_once(works, &period).unwrap();
    }

    #[test]
    fn test_1_ecriture_lecture_pending() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let pending = sample_pending(&wid);
        write_pending_atomic(&works, &pending).unwrap();

        let read = read_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(read, pending);
        assert_eq!(read.state, PendingState::Pending);
        cleanup(&root);
    }

    #[test]
    fn test_2_refus_ecrasement() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        write_pending_atomic(&works, &sample_pending(&wid)).unwrap();
        let second = write_pending_atomic(&works, &sample_pending(&wid));
        assert!(second.is_err(), "écrasement d'un pending refusé");
        cleanup(&root);
    }

    #[test]
    fn test_3_un_seul_pending_actif() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let first = sample_pending(&wid);
        write_pending_atomic(&works, &first).unwrap();

        // Un second pending (autre period_id) est refusé.
        let second = sample_pending(&wid);
        assert!(write_pending_atomic(&works, &second).is_err());
        // Le pending sur disque reste le premier.
        let on_disk = read_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(on_disk.period_id, first.period_id);
        cleanup(&root);
    }

    #[test]
    fn test_4_recuperation_explicite_pending_vers_interrupted() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        write_pending_atomic(&works, &sample_pending(&wid)).unwrap();

        // La récupération EXPLICITE (au démarrage) transforme PENDING -> INTERRUPTED.
        let recovered = recover_orphaned_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(recovered.state, PendingState::Interrupted);
        let read = read_pending(&works, &wid).unwrap().unwrap();
        assert_eq!(read.state, PendingState::Interrupted);
        cleanup(&root);
    }

    #[test]
    fn test_detect_ne_modifie_pas_le_fichier() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let pending = sample_pending(&wid);
        write_pending_atomic(&works, &pending).unwrap();

        let raw_before = fs::read_to_string(pending_path(&works, &wid)).unwrap();
        // Détection répétée : lecture seule, aucun changement d'état ni de contenu.
        for _ in 0..3 {
            let d = detect_pending_for_work(&works, &wid).unwrap().unwrap();
            assert_eq!(d.state, PendingState::Pending);
        }
        let raw_after = fs::read_to_string(pending_path(&works, &wid)).unwrap();
        assert_eq!(
            raw_before, raw_after,
            "detect ne doit pas modifier le fichier"
        );
        cleanup(&root);
    }

    #[test]
    fn test_5_interrupted_jamais_qualifiant() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        write_pending_atomic(&works, &sample_pending(&wid)).unwrap();
        let interrupted = mark_pending_interrupted(&works, &wid).unwrap();
        assert!(
            !interrupted.can_start_period(),
            "INTERRUPTED n'est jamais qualifiant"
        );

        // Un pending PENDING, lui, est qualifiant.
        let wid2 = WorkId::new();
        let p = sample_pending(&wid2);
        assert!(p.can_start_period());
        cleanup(&root);
    }

    #[test]
    fn test_6_suppression_uniquement_apres_periode_valide_correspondante() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let pending = sample_pending(&wid);
        write_pending_atomic(&works, &pending).unwrap();

        // Sans period_0.json immuable -> suppression refusée, pending intact.
        assert!(remove_pending_after_period_success(&works, &wid, 0).is_err());
        assert!(read_pending(&works, &wid).unwrap().is_some());

        // Période immuable valide et correspondant exactement -> suppression OK.
        write_matching_period(&works, &pending, None);
        remove_pending_after_period_success(&works, &wid, 0).unwrap();
        assert!(read_pending(&works, &wid).unwrap().is_none());
        cleanup(&root);
    }

    #[test]
    fn test_faux_period_pending_conserve() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let pending = sample_pending(&wid);
        write_pending_atomic(&works, &pending).unwrap();

        // Un period_0.json invalide (crypto/format) -> read_period échoue -> conservé.
        let dir = periods_dir(&works, &wid);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("period_0.json"), b"{ pas une periode }").unwrap();

        assert!(remove_pending_after_period_success(&works, &wid, 0).is_err());
        assert!(
            read_pending(&works, &wid).unwrap().is_some(),
            "pending conservé si la période est invalide"
        );
        cleanup(&root);
    }

    #[test]
    fn test_period_id_different_pending_conserve() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        let pending = sample_pending(&wid);
        write_pending_atomic(&works, &pending).unwrap();

        // Période valide mais period_id différent -> incohérence -> pending conservé.
        write_matching_period(&works, &pending, Some(&Uuid::new_v4().to_string()));
        assert!(remove_pending_after_period_success(&works, &wid, 0).is_err());
        assert!(
            read_pending(&works, &wid).unwrap().is_some(),
            "pending conservé si period_id diffère"
        );
        cleanup(&root);
    }

    #[test]
    fn test_interrupted_bloque_nouvelle_creation_jusqua_cloture() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        write_pending_atomic(&works, &sample_pending(&wid)).unwrap();
        recover_orphaned_pending(&works, &wid).unwrap(); // -> INTERRUPTED

        // Un INTERRUPTED bloque toute nouvelle création de pending.
        let nouveau = sample_pending(&wid);
        assert!(
            write_pending_atomic(&works, &nouveau).is_err(),
            "INTERRUPTED bloque une nouvelle création"
        );

        // Clôture explicite (non destructive) -> le slot est libéré.
        let archive = close_interrupted_pending(&works, &wid).unwrap();
        assert!(archive.exists(), "l'archive d'interruption est conservée");
        assert!(read_pending(&works, &wid).unwrap().is_none());

        // Désormais une nouvelle période peut commencer.
        write_pending_atomic(&works, &nouveau).unwrap();
        assert_eq!(
            read_pending(&works, &wid).unwrap().unwrap().period_id,
            nouveau.period_id
        );
        cleanup(&root);
    }

    #[test]
    fn test_7_ecriture_concurrente_une_seule_reussit() {
        use std::sync::Arc;
        use std::thread;

        let root = temp_root();
        let works = Arc::new(root.join("Works"));
        let wid = WorkId::new();
        fs::create_dir_all(periods_dir(&works, &wid)).unwrap();
        let pending = Arc::new(sample_pending(&wid));

        let mut handles = Vec::new();
        for _ in 0..8 {
            let works = Arc::clone(&works);
            let pending = Arc::clone(&pending);
            handles.push(thread::spawn(move || {
                write_pending_atomic(&works, &pending).is_ok()
            }));
        }
        let successes = handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .filter(|&ok| ok)
            .count();
        assert_eq!(successes, 1, "exactement une écriture doit réussir");
        cleanup(&root);
    }

    #[test]
    fn test_8_work_id_invalide_rejete() {
        let root = temp_root();
        let works = root.join("Works");
        let bad = WorkId("../evasion".to_string());
        let pending = sample_pending(&bad);
        assert!(write_pending_atomic(&works, &pending).is_err());
        assert!(read_pending(&works, &bad).is_err());
        assert!(detect_pending_for_work(&works, &bad).is_err());
        assert!(mark_pending_interrupted(&works, &bad).is_err());
        assert!(remove_pending_after_period_success(&works, &bad, 0).is_err());
        cleanup(&root);
    }

    #[test]
    fn test_9_aucune_ecriture_dans_projects() {
        let base = temp_root();
        let works = base.join("Works");
        let projects = base.join("Projects");
        fs::create_dir_all(projects.join("Legacy")).unwrap();
        fs::write(projects.join("Legacy").join("project.json"), b"{}").unwrap();

        let wid = WorkId::new();
        write_pending_atomic(&works, &sample_pending(&wid)).unwrap();

        // Projects/ strictement intact ; le pending vit sous Works/.
        assert!(projects.join("Legacy").join("project.json").exists());
        assert!(pending_path(&works, &wid).exists());
        // Aucun dossier créé sous Projects.
        assert!(!projects.join(wid.as_str()).exists());
        cleanup(&base);
    }

    #[test]
    fn test_10_aucun_fichier_temporaire_residuel() {
        let root = temp_root();
        let works = root.join("Works");
        let wid = WorkId::new();
        write_pending_atomic(&works, &sample_pending(&wid)).unwrap();
        mark_pending_interrupted(&works, &wid).unwrap();

        let dir = periods_dir(&works, &wid);
        let residual = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".tmp-"));
        assert!(!residual, "aucun fichier temporaire ne doit rester");
        cleanup(&root);
    }
}
