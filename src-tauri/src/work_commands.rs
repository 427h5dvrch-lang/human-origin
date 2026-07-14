//! work_commands — Commandes Work document-first (Commit 2).
//!
//! Portée : créer / retrouver / lister / charger / archiver un Work à partir
//! d'un document réel. Aucune période, aucun scan, aucune signature, aucun
//! certificat, aucune UI. Ne lit jamais `Projects/`.
//!
//! Chaque commande Tauri est une fine enveloppe autour d'une fonction cœur
//! `*_core(works_root, ...)` prenant la racine en paramètre — pour être testée
//! sur des dossiers temporaires isolés (jamais le vrai `~/.../Works`).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::work_store::{
    self, WorkDocumentMetadata, WorkId, WorkIndexCache, WorkLifecycle, WorkRecord,
};

// --- TYPES DE RÉSULTAT --------------------------------------------------------

/// Force du rapprochement entre un document et un Work existant.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MatchKind {
    ExactMatch,
    PossibleMatch,
    NoMatch,
}

/// Résultat de résolution : la force du match et l'éventuel Work candidat.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ResolveResult {
    pub kind: MatchKind,
    pub work_id: Option<WorkId>,
}

/// Issue d'une tentative de création de Work.
/// - `Created` : nouveau Work créé.
/// - `ExactExists` : document déjà suivi à l'identique → création refusée.
/// - `DecisionRequired` : rapprochement possible → décision explicite requise.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CreateWorkOutcome {
    Created { work_id: WorkId },
    ExactExists { work_id: WorkId },
    DecisionRequired { work_id: WorkId },
}

/// Vue de chargement d'un Work (métadonnées + résumé, sans données signées).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct LoadedWork {
    pub work_id: WorkId,
    pub lifecycle: WorkLifecycle,
    pub document: WorkDocumentMetadata,
    pub local_metadata: work_store::WorkLocalMetadata,
    pub created_at_utc: String,
    pub last_activity_utc: String,
    pub period_count: u32,
    pub certificate_count: u32,
}

// --- HELPERS DOCUMENTAIRES ----------------------------------------------------

fn now_utc() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// SHA256 hex d'un fichier, lu en flux (buffers de 64 Kio).
fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// MIME déduit de l'extension (best-effort ; `octet-stream` par défaut).
fn mime_from_extension(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = match ext.as_str() {
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc" => "application/msword",
        "odt" => "application/vnd.oasis.opendocument.text",
        "rtf" => "application/rtf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        _ => "application/octet-stream",
    };
    Some(mime.to_string())
}

/// Identité de fichier (inode, device) si la plateforme l'expose.
#[cfg(unix)]
fn file_identity(meta: &fs::Metadata) -> (Option<u64>, Option<u64>) {
    use std::os::unix::fs::MetadataExt;
    (Some(meta.ino()), Some(meta.dev()))
}

#[cfg(not(unix))]
fn file_identity(_meta: &fs::Metadata) -> (Option<u64>, Option<u64>) {
    (None, None)
}

/// Capture l'empreinte documentaire d'un fichier réel.
/// Refuse un dossier ou un chemin non-fichier ou inexistant.
fn capture_document(path: &Path) -> Result<WorkDocumentMetadata, String> {
    let meta = fs::metadata(path)
        .map_err(|e| format!("Document introuvable : {} ({})", path.display(), e))?;
    if meta.is_dir() {
        return Err(format!(
            "Un dossier ne peut pas être certifié : {}",
            path.display()
        ));
    }
    if !meta.is_file() {
        return Err(format!(
            "Le chemin n'est pas un fichier régulier : {}",
            path.display()
        ));
    }

    let (inode, device_id) = file_identity(&meta);
    let normalized = normalize_path(path);
    Ok(WorkDocumentMetadata {
        document_path: normalized.clone(),
        known_paths: vec![normalized],
        hash_initial: Some(sha256_file(path)?),
        size_initial: Some(meta.len()),
        mime: mime_from_extension(path),
        inode,
        device_id,
    })
}

/// Normalise un chemin : canonique si le fichier existe (résout `.`, `..`,
/// liens symboliques), sinon rendu absolu au mieux. Évite les doublons dus à
/// deux représentations du même chemin.
fn normalize_path(path: &Path) -> String {
    if let Ok(canon) = fs::canonicalize(path) {
        return canon.to_string_lossy().to_string();
    }
    if path.is_absolute() {
        return path.to_string_lossy().to_string();
    }
    if let Ok(cwd) = std::env::current_dir() {
        return cwd.join(path).to_string_lossy().to_string();
    }
    path.to_string_lossy().to_string()
}

// --- RÉSOLUTION ---------------------------------------------------------------

/// Vrai si le chemin normalisé courant est déjà connu du document (principal
/// ou dans `known_paths`).
fn path_is_known(d: &WorkDocumentMetadata, cur_path: &str) -> bool {
    d.document_path == cur_path || d.known_paths.iter().any(|p| p == cur_path)
}

/// Rapproche un document capturé (`cur`, chemin déjà normalisé) des Works.
///
/// Règles :
/// - EXACT_MATCH : identité système (inode ET device) identique ET **unique**
///   parmi les Works — l'égalité du chemin n'est PAS requise (fichier renommé
///   ou déplacé reste le même Work).
/// - POSSIBLE_MATCH : chemin connu seul, ou hash connu seul.
/// - NO_MATCH : aucun signal.
fn resolve_against_records(records: &[WorkRecord], cur: &WorkDocumentMetadata) -> ResolveResult {
    // 1) Identité système unique -> EXACT (indépendant du chemin).
    if let (Some(ci), Some(cd)) = (cur.inode, cur.device_id) {
        let id_hits: Vec<&WorkRecord> = records
            .iter()
            .filter(|r| r.document.inode == Some(ci) && r.document.device_id == Some(cd))
            .collect();
        if id_hits.len() == 1 {
            return ResolveResult {
                kind: MatchKind::ExactMatch,
                work_id: Some(id_hits[0].work_id.clone()),
            };
        }
        // len >= 2 : identité ambiguë -> pas d'EXACT, on évalue POSSIBLE ci-dessous.
    }

    // 2) Signaux plus faibles -> POSSIBLE (chemin connu, ou hash connu).
    let cur_path = &cur.document_path;
    let mut possible: Option<WorkId> = None;
    for r in records {
        let d = &r.document;
        if path_is_known(d, cur_path) {
            possible.get_or_insert_with(|| r.work_id.clone());
            continue;
        }
        if let (Some(h_stored), Some(h_cur)) = (&d.hash_initial, &cur.hash_initial) {
            if h_stored == h_cur {
                possible.get_or_insert_with(|| r.work_id.clone());
            }
        }
    }

    match possible {
        Some(work_id) => ResolveResult {
            kind: MatchKind::PossibleMatch,
            work_id: Some(work_id),
        },
        None => ResolveResult {
            kind: MatchKind::NoMatch,
            work_id: None,
        },
    }
}

pub fn resolve_work_for_document_core(
    works_root: &Path,
    document_path: &str,
) -> Result<ResolveResult, String> {
    let cur = capture_document(Path::new(document_path))?;
    let records = work_store::read_all_work_records(works_root)?;
    Ok(resolve_against_records(&records, &cur))
}

/// Enregistre un chemin normalisé nouvellement observé pour un Work existant
/// (renommage/déplacement) : l'ajoute à `known_paths` et le promeut comme
/// `document_path` courant. Idempotent, atomique. C'est le mécanisme de mise à
/// jour des chemins connus après un EXACT_MATCH sur un fichier déplacé.
fn remember_document_path(
    works_root: &Path,
    work_id: &WorkId,
    normalized_path: &str,
) -> Result<(), String> {
    let mut record = work_store::read_work_metadata(works_root, work_id)?;
    let path_changed = record.document.document_path != normalized_path;
    let already_listed = record
        .document
        .known_paths
        .iter()
        .any(|p| p == normalized_path);

    if !path_changed && already_listed {
        return Ok(()); // rien de nouveau
    }

    // Conserve l'ancien chemin principal dans l'historique avant bascule.
    if path_changed {
        let old = record.document.document_path.clone();
        if !record.document.known_paths.iter().any(|p| *p == old) {
            record.document.known_paths.push(old);
        }
        record.document.document_path = normalized_path.to_string();
        record.last_activity_utc = now_utc();
    }
    if !already_listed {
        record
            .document
            .known_paths
            .push(normalized_path.to_string());
    }

    work_store::write_work_metadata_atomic(works_root, &record)?;
    work_store::rebuild_index_from_disk(works_root)?;
    Ok(())
}

// --- CRÉATION -----------------------------------------------------------------

/// Crée un Work à partir d'un document réel, en refusant tout doublon silencieux.
/// `force_new = Some(true)` autorise la création malgré un POSSIBLE_MATCH.
/// Un EXACT_MATCH est toujours refusé.
pub fn create_work_core(
    works_root: &Path,
    document_path: &str,
    display_name: Option<String>,
    force_new: Option<bool>,
) -> Result<CreateWorkOutcome, String> {
    let cur = capture_document(Path::new(document_path))?;
    let records = work_store::read_all_work_records(works_root)?;
    let resolved = resolve_against_records(&records, &cur);

    match resolved.kind {
        MatchKind::ExactMatch => {
            let work_id = resolved
                .work_id
                .expect("EXACT_MATCH porte toujours un work_id");
            // Fichier déjà suivi (éventuellement renommé/déplacé) : on met à jour
            // ses chemins connus, jamais on ne duplique. force_new ne s'applique pas.
            remember_document_path(works_root, &work_id, &cur.document_path)?;
            return Ok(CreateWorkOutcome::ExactExists { work_id });
        }
        MatchKind::PossibleMatch if force_new != Some(true) => {
            return Ok(CreateWorkOutcome::DecisionRequired {
                work_id: resolved
                    .work_id
                    .expect("POSSIBLE_MATCH porte toujours un work_id"),
            });
        }
        _ => {}
    }

    let id = WorkId::new();
    work_store::create_work_directories(works_root, &id)?;

    let mut record = WorkRecord::new(id.clone(), now_utc(), cur);
    record.local_metadata.display_name = display_name;
    work_store::write_work_metadata_atomic(works_root, &record)?;

    // Mise à jour atomique du cache (index.json reste un cache reconstructible).
    work_store::rebuild_index_from_disk(works_root)?;

    Ok(CreateWorkOutcome::Created { work_id: id })
}

// --- LISTE / CHARGEMENT / ARCHIVAGE ------------------------------------------

/// Liste les Works : lit et valide `index.json`, sinon reconstruit depuis disque.
pub fn list_works_core(works_root: &Path) -> Result<WorkIndexCache, String> {
    match work_store::read_index_cache(works_root) {
        Ok(cache) if cache.schema_version == work_store::WORK_SCHEMA_VERSION => Ok(cache),
        _ => work_store::rebuild_index_from_disk(works_root),
    }
}

/// Compte les fichiers de période signés présents (`period_*.json`).
/// Les états temporaires (`pending_*`) ne sont pas comptés. 0 à ce stade.
fn count_period_files(works_root: &Path, work_id: &WorkId) -> u32 {
    let periods_dir = works_root.join(work_id.as_str()).join("periods");
    let read = match fs::read_dir(&periods_dir) {
        Ok(r) => r,
        Err(_) => return 0,
    };
    read.filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with("period_") && n.ends_with(".json"))
                .unwrap_or(false)
        })
        .count() as u32
}

/// Charge un Work : métadonnées locales, lifecycle, infos documentaires et
/// résumé des périodes/certificats (listes vides possibles).
pub fn load_work_core(works_root: &Path, work_id: &WorkId) -> Result<LoadedWork, String> {
    let record = work_store::read_work_metadata(works_root, work_id)?;
    Ok(LoadedWork {
        work_id: record.work_id.clone(),
        lifecycle: record.lifecycle,
        document: record.document.clone(),
        local_metadata: record.local_metadata.clone(),
        created_at_utc: record.created_at_utc.clone(),
        last_activity_utc: record.last_activity_utc.clone(),
        period_count: count_period_files(works_root, work_id),
        certificate_count: 0,
    })
}

/// Archive un Work : ACTIVE → ARCHIVED, sans aucune suppression de fichier.
pub fn archive_work_core(works_root: &Path, work_id: &WorkId) -> Result<(), String> {
    let mut record = work_store::read_work_metadata(works_root, work_id)?;
    record.lifecycle = WorkLifecycle::Archived;
    record.last_activity_utc = now_utc();
    work_store::write_work_metadata_atomic(works_root, &record)?;
    work_store::rebuild_index_from_disk(works_root)?;
    Ok(())
}

// --- COMMANDES TAURI (fines enveloppes) --------------------------------------

#[tauri::command]
pub fn resolve_work_for_document(document_path: String) -> Result<ResolveResult, String> {
    let root = work_store::works_root()?;
    resolve_work_for_document_core(&root, &document_path)
}

#[tauri::command]
pub fn create_work(
    document_path: String,
    display_name: Option<String>,
    force_new: Option<bool>,
) -> Result<CreateWorkOutcome, String> {
    let root = work_store::works_root()?;
    create_work_core(&root, &document_path, display_name, force_new)
}

#[tauri::command]
pub fn list_works() -> Result<WorkIndexCache, String> {
    let root = work_store::works_root()?;
    list_works_core(&root)
}

#[tauri::command]
pub fn load_work(work_id: String) -> Result<LoadedWork, String> {
    let root = work_store::works_root()?;
    load_work_core(&root, &WorkId(work_id))
}

#[tauri::command]
pub fn archive_work(work_id: String) -> Result<(), String> {
    let root = work_store::works_root()?;
    archive_work_core(&root, &WorkId(work_id))
}

// --- TESTS UNITAIRES ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("ho_wc_test_{}", Uuid::new_v4()))
    }

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
    }

    /// Écrit un fichier réel et renvoie son chemin.
    fn write_file(dir: &Path, name: &str, content: &[u8]) -> std::path::PathBuf {
        fs::create_dir_all(dir).unwrap();
        let p = dir.join(name);
        fs::write(&p, content).unwrap();
        p
    }

    /// Insère un Work sur disque avec un WorkRecord fabriqué (document donné).
    fn seed_work(works_root: &Path, doc: WorkDocumentMetadata) -> WorkId {
        let id = WorkId::new();
        work_store::create_work_directories(works_root, &id).unwrap();
        let record = WorkRecord::new(id.clone(), "2026-07-14T10:00:00Z".into(), doc);
        work_store::write_work_metadata_atomic(works_root, &record).unwrap();
        id
    }

    #[test]
    fn test_1_fichier_inconnu_no_match() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "inconnu.txt", b"contenu unique");
        let res = resolve_work_for_document_core(&works, doc.to_str().unwrap()).unwrap();
        assert_eq!(res.kind, MatchKind::NoMatch);
        assert!(res.work_id.is_none());
        cleanup(&root);
    }

    #[test]
    fn test_2_meme_inode_device_exact_match() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "a.txt", b"exact");
        // On sème un Work avec la capture RÉELLE du fichier (inode/device/chemin).
        let captured = capture_document(&doc).unwrap();
        let id = seed_work(&works, captured);

        let res = resolve_work_for_document_core(&works, doc.to_str().unwrap()).unwrap();
        assert_eq!(res.kind, MatchKind::ExactMatch);
        assert_eq!(res.work_id, Some(id));
        cleanup(&root);
    }

    #[test]
    fn test_3_chemin_connu_inode_different_possible() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "b.txt", b"contenu b");
        // Même chemin, mais inode/device volontairement faux + hash différent.
        let mut captured = capture_document(&doc).unwrap();
        captured.inode = Some(u64::MAX);
        captured.device_id = Some(u64::MAX);
        captured.hash_initial = Some("0".repeat(64));
        let id = seed_work(&works, captured);

        let res = resolve_work_for_document_core(&works, doc.to_str().unwrap()).unwrap();
        assert_eq!(res.kind, MatchKind::PossibleMatch);
        assert_eq!(res.work_id, Some(id));
        cleanup(&root);
    }

    #[test]
    fn test_4_hash_identique_chemin_different_possible() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "c.txt", b"meme contenu");
        // Work stocké avec le MÊME hash mais un chemin différent + inode faux.
        // known_paths vidé pour garantir que le match ne passe QUE par le hash.
        let mut captured = capture_document(&doc).unwrap();
        captured.document_path = "/un/autre/chemin/c.txt".to_string();
        captured.known_paths = vec!["/un/autre/chemin/c.txt".to_string()];
        captured.inode = Some(u64::MAX);
        captured.device_id = Some(u64::MAX);
        let id = seed_work(&works, captured);

        let res = resolve_work_for_document_core(&works, doc.to_str().unwrap()).unwrap();
        assert_eq!(res.kind, MatchKind::PossibleMatch);
        assert_eq!(res.work_id, Some(id));
        cleanup(&root);
    }

    #[test]
    fn test_5_create_work_refuse_exact_match() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "d.txt", b"exact create");
        let id = seed_work(&works, capture_document(&doc).unwrap());

        let outcome = create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();
        assert_eq!(outcome, CreateWorkOutcome::ExactExists { work_id: id });
        // Aucun nouveau Work créé : toujours 1 sur disque.
        assert_eq!(work_store::read_all_work_records(&works).unwrap().len(), 1);
        cleanup(&root);
    }

    #[test]
    fn test_6_create_work_ne_duplique_jamais_silencieusement() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "e.txt", b"possible dup");
        // POSSIBLE_MATCH : même chemin, inode faux.
        let mut captured = capture_document(&doc).unwrap();
        captured.inode = Some(u64::MAX);
        captured.device_id = Some(u64::MAX);
        captured.hash_initial = Some("f".repeat(64));
        seed_work(&works, captured);

        // Sans décision explicite → DECISION_REQUIRED, aucune création.
        let outcome = create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();
        assert!(matches!(
            outcome,
            CreateWorkOutcome::DecisionRequired { .. }
        ));
        assert_eq!(work_store::read_all_work_records(&works).unwrap().len(), 1);

        // Avec force_new = true → création explicite d'un second Work.
        let forced = create_work_core(&works, doc.to_str().unwrap(), None, Some(true)).unwrap();
        assert!(matches!(forced, CreateWorkOutcome::Created { .. }));
        assert_eq!(work_store::read_all_work_records(&works).unwrap().len(), 2);
        cleanup(&root);
    }

    #[test]
    fn test_7_capture_sha256_taille_mime() {
        let root = temp_root();
        let content = b"HumanOrigin capture test";
        let doc = write_file(&root.join("docs"), "f.txt", content);

        let captured = capture_document(&doc).unwrap();
        // SHA256 attendu du contenu.
        let mut hasher = Sha256::new();
        hasher.update(content);
        let expected = format!("{:x}", hasher.finalize());
        assert_eq!(captured.hash_initial.as_deref(), Some(expected.as_str()));
        assert_eq!(captured.size_initial, Some(content.len() as u64));
        assert_eq!(captured.mime.as_deref(), Some("text/plain"));
        cleanup(&root);
    }

    #[test]
    fn test_7b_create_work_refuse_dossier() {
        let root = temp_root();
        let works = root.join("Works");
        let a_dir = root.join("un_dossier");
        fs::create_dir_all(&a_dir).unwrap();
        let res = create_work_core(&works, a_dir.to_str().unwrap(), None, None);
        assert!(res.is_err(), "un dossier doit être refusé");
        cleanup(&root);
    }

    #[test]
    fn test_8_index_absent_reconstruction() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "g.txt", b"list absent");
        create_work_core(&works, doc.to_str().unwrap(), Some("G".into()), None).unwrap();
        // Supprime l'index -> list_works doit reconstruire.
        let _ = fs::remove_file(works.join("index.json"));
        let cache = list_works_core(&works).unwrap();
        assert_eq!(cache.entries.len(), 1);
        assert!(works.join("index.json").exists());
        cleanup(&root);
    }

    #[test]
    fn test_9_index_corrompu_reconstruction() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "h.txt", b"list corrompu");
        create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();
        fs::write(works.join("index.json"), b"{ corrompu").unwrap();
        let cache = list_works_core(&works).unwrap();
        assert_eq!(cache.entries.len(), 1);
        cleanup(&root);
    }

    #[test]
    fn test_10_archive_ne_supprime_aucun_fichier() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "i.txt", b"archive me");
        let created = create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();
        let id = match created {
            CreateWorkOutcome::Created { work_id } => work_id,
            other => panic!("attendu Created, reçu {:?}", other),
        };
        let work_json = works.join(id.as_str()).join("work.json");
        assert!(work_json.exists());

        archive_work_core(&works, &id).unwrap();

        // Le fichier existe toujours, lifecycle = ARCHIVED.
        assert!(work_json.exists(), "archive ne supprime rien");
        let loaded = load_work_core(&works, &id).unwrap();
        assert_eq!(loaded.lifecycle, WorkLifecycle::Archived);
        // L'index reflète l'état archivé.
        let cache = list_works_core(&works).unwrap();
        assert_eq!(cache.entries[0].lifecycle, WorkLifecycle::Archived);
        cleanup(&root);
    }

    #[test]
    fn test_11_work_id_invalide_rejete() {
        let root = temp_root();
        let works = root.join("Works");
        fs::create_dir_all(&works).unwrap();
        let bad = WorkId("../evasion".to_string());
        assert!(load_work_core(&works, &bad).is_err());
        assert!(archive_work_core(&works, &bad).is_err());
        cleanup(&root);
    }

    #[test]
    fn test_12_aucun_acces_a_projects() {
        let base = temp_root();
        let works = base.join("Works");
        let projects = base.join("Projects");
        fs::create_dir_all(projects.join("Legacy")).unwrap();
        fs::write(projects.join("Legacy").join("project.json"), b"{}").unwrap();

        let doc = write_file(&base.join("docs"), "j.txt", b"no projects access");
        create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();

        let cache = list_works_core(&works).unwrap();
        assert_eq!(
            cache.entries.len(),
            1,
            "le legacy Project n'est jamais listé"
        );
        // Projects/ intact.
        assert!(projects.join("Legacy").join("project.json").exists());
        cleanup(&base);
    }

    // --- AUDIT COMMIT 2 : tests supplémentaires ------------------------------

    #[test]
    fn test_13_fichier_renomme_reste_exact_match() {
        let root = temp_root();
        let works = root.join("Works");
        let docs = root.join("docs");
        let p1 = write_file(&docs, "avant.txt", b"contenu stable");
        let created = create_work_core(&works, p1.to_str().unwrap(), None, None).unwrap();
        let id = match created {
            CreateWorkOutcome::Created { work_id } => work_id,
            other => panic!("attendu Created, reçu {:?}", other),
        };

        // Renommage sur le même volume : l'inode est préservé.
        let p2 = docs.join("apres.txt");
        fs::rename(&p1, &p2).unwrap();

        // Résolution du fichier renommé -> EXACT_MATCH sur le même Work.
        let res = resolve_work_for_document_core(&works, p2.to_str().unwrap()).unwrap();
        assert_eq!(res.kind, MatchKind::ExactMatch);
        assert_eq!(res.work_id, Some(id.clone()));

        // create_work sur le fichier renommé : pas de doublon, met à jour known_paths.
        let outcome = create_work_core(&works, p2.to_str().unwrap(), None, None).unwrap();
        assert_eq!(
            outcome,
            CreateWorkOutcome::ExactExists {
                work_id: id.clone()
            }
        );
        assert_eq!(work_store::read_all_work_records(&works).unwrap().len(), 1);

        let loaded = load_work_core(&works, &id).unwrap();
        let np2 = normalize_path(&p2);
        assert!(
            loaded.document.known_paths.iter().any(|p| p == &np2),
            "le nouveau chemin doit être mémorisé"
        );
        assert!(
            loaded.document.known_paths.len() >= 2,
            "l'ancien et le nouveau chemin doivent coexister"
        );
        assert_eq!(
            loaded.document.document_path, np2,
            "chemin courant mis à jour"
        );
        cleanup(&root);
    }

    #[test]
    fn test_14_fichier_remplace_meme_chemin_pas_exact() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "k.txt", b"version 1");
        // On sème un Work avec l'identité système RÉELLE, puis on simule un
        // remplacement en changeant l'inode/device stockés (fichier réécrit).
        let mut captured = capture_document(&doc).unwrap();
        captured.inode = captured.inode.map(|i| i.wrapping_add(1)).or(Some(1));
        captured.device_id = captured.device_id.or(Some(1));
        let id = seed_work(&works, captured);

        let res = resolve_work_for_document_core(&works, doc.to_str().unwrap()).unwrap();
        assert_ne!(
            res.kind,
            MatchKind::ExactMatch,
            "jamais EXACT si inode différent"
        );
        assert_eq!(res.kind, MatchKind::PossibleMatch);
        assert_eq!(res.work_id, Some(id));
        cleanup(&root);
    }

    #[test]
    fn test_15_chemin_normalise_different_meme_work() {
        let root = temp_root();
        let works = root.join("Works");
        let docs = root.join("docs");
        let p = write_file(&docs, "a.txt", b"normalise moi");
        let created = create_work_core(&works, p.to_str().unwrap(), None, None).unwrap();
        let id = match created {
            CreateWorkOutcome::Created { work_id } => work_id,
            other => panic!("attendu Created, reçu {:?}", other),
        };

        // Représentation différente du même fichier : docs/./a.txt
        let alt = docs.join(".").join("a.txt");
        let res = resolve_work_for_document_core(&works, alt.to_str().unwrap()).unwrap();
        assert_eq!(res.kind, MatchKind::ExactMatch);
        assert_eq!(res.work_id, Some(id.clone()));

        // create_work via la représentation alternative ne duplique pas.
        let outcome = create_work_core(&works, alt.to_str().unwrap(), None, None).unwrap();
        assert_eq!(outcome, CreateWorkOutcome::ExactExists { work_id: id });
        assert_eq!(work_store::read_all_work_records(&works).unwrap().len(), 1);
        cleanup(&root);
    }

    #[test]
    fn test_16_force_new_ne_contourne_pas_exact() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "l.txt", b"force exact");
        let id = seed_work(&works, capture_document(&doc).unwrap());

        // force_new=true ne doit JAMAIS contourner un EXACT_MATCH.
        let outcome = create_work_core(&works, doc.to_str().unwrap(), None, Some(true)).unwrap();
        assert_eq!(outcome, CreateWorkOutcome::ExactExists { work_id: id });
        assert_eq!(work_store::read_all_work_records(&works).unwrap().len(), 1);
        cleanup(&root);
    }

    #[test]
    fn test_17_cache_absent_apres_creation_reconstruction_et_pas_de_doublon() {
        let root = temp_root();
        let works = root.join("Works");
        let doc = write_file(&root.join("docs"), "m.txt", b"resilience");
        let created = create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();
        assert!(matches!(created, CreateWorkOutcome::Created { .. }));

        // Simule une perte de cache post-création (le rebuild aurait échoué).
        fs::remove_file(works.join("index.json")).unwrap();

        // list_works reconstruit fidèlement depuis le dossier Work survivant.
        let cache = list_works_core(&works).unwrap();
        assert_eq!(
            cache.entries.len(),
            1,
            "reconstruction fidèle depuis disque"
        );

        // Une nouvelle tentative ne crée PAS de doublon silencieux.
        let retry = create_work_core(&works, doc.to_str().unwrap(), None, None).unwrap();
        assert!(matches!(retry, CreateWorkOutcome::ExactExists { .. }));
        assert_eq!(work_store::read_all_work_records(&works).unwrap().len(), 1);
        cleanup(&root);
    }
}
