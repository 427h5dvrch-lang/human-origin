//! work_store — Fondation de persistance Work (Commit 1).
//!
//! Portée stricte de ce module :
//!   - résolution du dossier `Works/`
//!   - types locaux de base (aucune donnée signée)
//!   - I/O atomiques (fichier temporaire + rename)
//!   - reconstruction du cache `index.json` depuis le disque
//!
//! Règles verrouillées :
//!   - `index.json` est un CACHE, jamais une preuve ni une autorité de chaînage.
//!   - Aucune signature, aucune période, aucun certificat ici.
//!   - Aucun accès à `Projects/` (legacy) : ce module ne touche que `Works/`.
//!   - Aucune suppression de dossier existant ; refus d'écraser un Work existant.

// Fondation (Commit 1) : cette API publique est consommée par les commandes
// Tauri au Commit 2. Autorisation temporaire du code encore non appelé.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Version de schéma du cache et des métadonnées Work.
pub const WORK_SCHEMA_VERSION: u32 = 1;

const WORKS_DIR_NAME: &str = "Works";
const WORK_METADATA_FILE: &str = "work.json";
const WORK_PERIODS_DIR: &str = "periods";
const WORK_INDEX_FILE: &str = "index.json";

// --- TYPES DE BASE -----------------------------------------------------------

/// Identifiant local d'un Work (UUID v4, sérialisé de façon transparente).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct WorkId(pub String);

impl WorkId {
    pub fn new() -> Self {
        WorkId(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Valide que l'identifiant est un UUID canonique. Un UUID ne contient que
    /// des hex et des tirets : ni `/`, ni `..`, ni chemin absolu — donc aucun
    /// WorkId valide ne peut sortir de `Works/`.
    pub fn is_valid(&self) -> bool {
        Uuid::parse_str(&self.0).is_ok()
    }
}

/// Garde de sécurité chemin : refuse tout WorkId non-UUID avant de composer
/// un chemin. Empêche `../`, chemins absolus et toute évasion de `Works/`.
fn ensure_valid_work_id(work_id: &WorkId) -> Result<(), String> {
    if !work_id.is_valid() {
        return Err(format!(
            "WorkId invalide (UUID attendu) : {:?}",
            work_id.as_str()
        ));
    }
    Ok(())
}

impl Default for WorkId {
    fn default() -> Self {
        WorkId::new()
    }
}

/// Cycle de vie d'un Work. Sérialisé en `"ACTIVE"` / `"ARCHIVED"`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum WorkLifecycle {
    Active,
    Archived,
}

impl Default for WorkLifecycle {
    fn default() -> Self {
        WorkLifecycle::Active
    }
}

/// Empreinte documentaire initiale capturée à la création du Work.
///
/// NOTE : ce commit ne peuple aucun de ces champs (pas de scan, pas de hash) ;
/// il ne fait que définir la forme. La capture réelle viendra avec `create_work`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct WorkDocumentMetadata {
    /// Chemin normalisé « courant » du document (dernier chemin vu).
    pub document_path: String,
    /// Tous les chemins normalisés sous lesquels ce document a été vu
    /// (renommages / déplacements). `document_path` en fait toujours partie.
    #[serde(default)]
    pub known_paths: Vec<String>,
    /// SHA256 hex du document au moment de la création (capture ultérieure).
    pub hash_initial: Option<String>,
    pub size_initial: Option<u64>,
    pub mime: Option<String>,
    /// Signaux d'identité de fichier pour la résolution de reprise (ultérieur).
    pub inode: Option<u64>,
    pub device_id: Option<u64>,
}

/// Métadonnées locales éditables et NON signées (nom affiché, tags, notes).
///
/// Isolées du reste pour ne jamais invalider une preuve future en renommant.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct WorkLocalMetadata {
    pub display_name: Option<String>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
}

/// Enregistrement complet d'un Work, persisté dans `Works/{id}/work.json`.
///
/// Tout est ici non signé (métadonnées). Aucune période, aucun certificat.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkRecord {
    pub schema_version: u32,
    pub work_id: WorkId,
    pub lifecycle: WorkLifecycle,
    pub created_at_utc: String,
    pub last_activity_utc: String,
    pub document: WorkDocumentMetadata,
    pub local_metadata: WorkLocalMetadata,
}

impl WorkRecord {
    /// Construit un enregistrement neuf (aucune écriture disque).
    pub fn new(work_id: WorkId, now_utc: String, document: WorkDocumentMetadata) -> Self {
        WorkRecord {
            schema_version: WORK_SCHEMA_VERSION,
            work_id,
            lifecycle: WorkLifecycle::Active,
            created_at_utc: now_utc.clone(),
            last_activity_utc: now_utc,
            document,
            local_metadata: WorkLocalMetadata::default(),
        }
    }
}

/// Entrée du cache d'index (vue résumée d'un Work, reconstructible).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkIndexEntry {
    pub work_id: WorkId,
    pub lifecycle: WorkLifecycle,
    pub display_name: Option<String>,
    pub document_path: String,
    pub created_at_utc: String,
    pub last_activity_utc: String,
}

impl From<&WorkRecord> for WorkIndexEntry {
    fn from(r: &WorkRecord) -> Self {
        WorkIndexEntry {
            work_id: r.work_id.clone(),
            lifecycle: r.lifecycle,
            display_name: r.local_metadata.display_name.clone(),
            document_path: r.document.document_path.clone(),
            created_at_utc: r.created_at_utc.clone(),
            last_activity_utc: r.last_activity_utc.clone(),
        }
    }
}

/// Cache d'index (`Works/index.json`). JAMAIS une preuve : purement reconstructible.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkIndexCache {
    pub schema_version: u32,
    pub entries: Vec<WorkIndexEntry>,
}

impl WorkIndexCache {
    pub fn empty() -> Self {
        WorkIndexCache {
            schema_version: WORK_SCHEMA_VERSION,
            entries: Vec::new(),
        }
    }
}

// --- RÉSOLUTION DE CHEMIN -----------------------------------------------------

/// Racine par défaut `.../HumanOrigin/Works`.
///
/// Réplique la logique de `humanorigin_root_dir()` de `main.rs` (privée), afin
/// de garder ce module autonome sans élargir la surface publique du core.
pub fn works_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let base = dirs::data_local_dir().ok_or("Err LocalAppData")?;

    #[cfg(not(target_os = "windows"))]
    let base = dirs::document_dir().ok_or("Err Documents")?;

    Ok(base.join("HumanOrigin").join(WORKS_DIR_NAME))
}

fn work_dir(works_root: &Path, work_id: &WorkId) -> PathBuf {
    works_root.join(work_id.as_str())
}

fn work_metadata_path(works_root: &Path, work_id: &WorkId) -> PathBuf {
    work_dir(works_root, work_id).join(WORK_METADATA_FILE)
}

// --- I/O ATOMIQUE -------------------------------------------------------------

/// Écriture atomique : fichier temporaire unique + fsync + rename.
/// Ne laisse jamais de fichier temporaire résiduel en cas de succès.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Chemin sans parent : {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nom de fichier invalide")?;
    let tmp = parent.join(format!(".{}.tmp-{}", file_name, Uuid::new_v4()));

    let write_result = (|| -> Result<(), String> {
        // create_new(true) : le temp doit être neuf, jamais un fichier réutilisé.
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

    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }

    // Persiste l'entrée de répertoire (le rename) sur disque. Best-effort :
    // non supporté partout (ex. Windows), l'échec ne compromet pas les données.
    sync_dir(parent);
    Ok(())
}

/// fsync best-effort du répertoire (persiste les renames). No-op sur Windows.
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

/// Crée l'arborescence d'un Work : `Works/{id}/` + `Works/{id}/periods/`.
/// Refuse si le dossier du Work existe déjà (jamais d'écrasement).
pub fn create_work_directories(works_root: &Path, work_id: &WorkId) -> Result<PathBuf, String> {
    ensure_valid_work_id(work_id)?;
    let dir = work_dir(works_root, work_id);
    if dir.exists() {
        return Err(format!(
            "Work déjà existant, écrasement refusé : {}",
            dir.display()
        ));
    }
    fs::create_dir_all(dir.join(WORK_PERIODS_DIR)).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Lit et désérialise `Works/{id}/work.json`.
pub fn read_work_metadata(works_root: &Path, work_id: &WorkId) -> Result<WorkRecord, String> {
    ensure_valid_work_id(work_id)?;
    let path = work_metadata_path(works_root, work_id);
    let raw = fs::read_to_string(&path).map_err(|e| format!("{} : {}", path.display(), e))?;
    serde_json::from_str(&raw).map_err(|e| format!("work.json invalide : {}", e))
}

/// Écrit `Works/{id}/work.json` de façon atomique.
/// Le dossier du Work doit exister (créé via `create_work_directories`).
pub fn write_work_metadata_atomic(works_root: &Path, record: &WorkRecord) -> Result<(), String> {
    ensure_valid_work_id(&record.work_id)?;
    let dir = work_dir(works_root, &record.work_id);
    if !dir.exists() {
        return Err(format!(
            "Dossier Work absent, appeler create_work_directories d'abord : {}",
            dir.display()
        ));
    }
    let path = work_metadata_path(works_root, &record.work_id);
    let json = serde_json::to_vec_pretty(record).map_err(|e| e.to_string())?;
    write_atomic(&path, &json)
}

/// Lit le cache d'index. Erreur si absent ou corrompu (le caller reconstruit).
pub fn read_index_cache(works_root: &Path) -> Result<WorkIndexCache, String> {
    let path = works_root.join(WORK_INDEX_FILE);
    let raw = fs::read_to_string(&path).map_err(|e| format!("{} : {}", path.display(), e))?;
    serde_json::from_str(&raw).map_err(|e| format!("index.json corrompu : {}", e))
}

/// Écrit le cache d'index de façon atomique.
pub fn write_index_cache_atomic(works_root: &Path, cache: &WorkIndexCache) -> Result<(), String> {
    fs::create_dir_all(works_root).map_err(|e| e.to_string())?;
    let path = works_root.join(WORK_INDEX_FILE);
    let json = serde_json::to_vec_pretty(cache).map_err(|e| e.to_string())?;
    write_atomic(&path, &json)
}

/// Scanne `Works/` et retourne tous les `WorkRecord` valides (autorité disque).
/// Ne lit QUE `Works/` : les dossiers au nom non-UUID ou sans `work.json`
/// valide sont ignorés. Résultat trié par date de création.
pub fn read_all_work_records(works_root: &Path) -> Result<Vec<WorkRecord>, String> {
    let mut records: Vec<WorkRecord> = Vec::new();

    if works_root.exists() {
        let dir_iter = fs::read_dir(works_root).map_err(|e| e.to_string())?;
        for entry in dir_iter {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_dir() {
                continue; // ignore index.json et autres fichiers
            }
            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let work_id = WorkId(file_name);
            if !work_id.is_valid() {
                continue; // dossier au nom non-UUID -> ignoré
            }
            match read_work_metadata(works_root, &work_id) {
                Ok(record) => records.push(record),
                Err(_) => continue, // dossier sans work.json valide -> ignoré
            }
        }
    }

    records.sort_by(|a, b| a.created_at_utc.cmp(&b.created_at_utc));
    Ok(records)
}

/// Reconstruit le cache d'index en scannant `Works/` sur disque, puis le persiste.
/// Source de vérité = les dossiers Work présents ; l'ancien `index.json` est ignoré.
pub fn rebuild_index_from_disk(works_root: &Path) -> Result<WorkIndexCache, String> {
    let entries: Vec<WorkIndexEntry> = read_all_work_records(works_root)?
        .iter()
        .map(WorkIndexEntry::from)
        .collect();

    let cache = WorkIndexCache {
        schema_version: WORK_SCHEMA_VERSION,
        entries,
    };
    write_index_cache_atomic(works_root, &cache)?;
    Ok(cache)
}

// --- TESTS UNITAIRES ---------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Racine de test isolée sous le dossier temporaire du système.
    fn temp_works_root() -> PathBuf {
        std::env::temp_dir().join(format!("ho_works_test_{}", Uuid::new_v4()))
    }

    fn cleanup(root: &Path) {
        let _ = fs::remove_dir_all(root);
    }

    fn sample_record(id: &WorkId, path: &str, created: &str) -> WorkRecord {
        let mut doc = WorkDocumentMetadata::default();
        doc.document_path = path.to_string();
        WorkRecord::new(id.clone(), created.to_string(), doc)
    }

    #[test]
    fn test_1_creation_arborescence_work() {
        let root = temp_works_root();
        let id = WorkId::new();
        let dir = create_work_directories(&root, &id).unwrap();
        assert!(dir.exists(), "le dossier du Work doit exister");
        assert!(
            dir.join(WORK_PERIODS_DIR).exists(),
            "le sous-dossier periods/ doit exister"
        );
        cleanup(&root);
    }

    #[test]
    fn test_2_ecriture_puis_lecture_metadata() {
        let root = temp_works_root();
        let id = WorkId::new();
        create_work_directories(&root, &id).unwrap();

        let record = sample_record(&id, "/tmp/doc.docx", "2026-07-13T10:00:00Z");
        write_work_metadata_atomic(&root, &record).unwrap();

        let read_back = read_work_metadata(&root, &id).unwrap();
        assert_eq!(read_back, record, "round-trip metadata identique");
        assert_eq!(read_back.schema_version, WORK_SCHEMA_VERSION);
        assert_eq!(read_back.lifecycle, WorkLifecycle::Active);
        cleanup(&root);
    }

    #[test]
    fn test_3_refus_ecrasement() {
        let root = temp_works_root();
        let id = WorkId::new();
        create_work_directories(&root, &id).unwrap();
        let second = create_work_directories(&root, &id);
        assert!(second.is_err(), "la 2e création doit être refusée");
        cleanup(&root);
    }

    #[test]
    fn test_4_index_absent_reconstruction() {
        let root = temp_works_root();
        let id_a = WorkId::new();
        let id_b = WorkId::new();
        for (id, created) in [
            (&id_a, "2026-07-13T09:00:00Z"),
            (&id_b, "2026-07-13T10:00:00Z"),
        ] {
            create_work_directories(&root, id).unwrap();
            write_work_metadata_atomic(&root, &sample_record(id, "/tmp/x", created)).unwrap();
        }
        // Aucun index.json présent au départ.
        assert!(read_index_cache(&root).is_err());

        let cache = rebuild_index_from_disk(&root).unwrap();
        assert_eq!(
            cache.entries.len(),
            2,
            "les deux Works doivent être indexés"
        );
        assert!(
            root.join(WORK_INDEX_FILE).exists(),
            "index.json doit être reconstruit sur disque"
        );
        cleanup(&root);
    }

    #[test]
    fn test_5_index_corrompu_reconstruction() {
        let root = temp_works_root();
        let id = WorkId::new();
        create_work_directories(&root, &id).unwrap();
        write_work_metadata_atomic(&root, &sample_record(&id, "/tmp/y", "2026-07-13T11:00:00Z"))
            .unwrap();

        // Écrit un index.json volontairement corrompu.
        fs::write(root.join(WORK_INDEX_FILE), b"{ ceci n'est pas du JSON").unwrap();
        assert!(
            read_index_cache(&root).is_err(),
            "le cache corrompu doit échouer"
        );

        let cache = rebuild_index_from_disk(&root).unwrap();
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.entries[0].work_id, id);
        // Après reconstruction, le cache est de nouveau lisible.
        assert!(read_index_cache(&root).is_ok());
        cleanup(&root);
    }

    #[test]
    fn test_6_ecriture_atomique_sans_temp_residuel() {
        let root = temp_works_root();
        let id = WorkId::new();
        create_work_directories(&root, &id).unwrap();
        write_work_metadata_atomic(&root, &sample_record(&id, "/tmp/z", "2026-07-13T12:00:00Z"))
            .unwrap();

        let dir = work_dir(&root, &id);
        let residual = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".tmp-"));
        assert!(!residual, "aucun fichier temporaire ne doit rester");
        cleanup(&root);
    }

    #[test]
    fn test_7_works_vide_liste_vide() {
        let root = temp_works_root();
        fs::create_dir_all(&root).unwrap();
        let cache = rebuild_index_from_disk(&root).unwrap();
        assert!(
            cache.entries.is_empty(),
            "un Works/ vide donne une liste vide"
        );
        assert_eq!(cache, WorkIndexCache::empty(), "cache vide canonique");
        cleanup(&root);
    }

    #[test]
    fn test_8_aucun_acces_a_projects() {
        // Racine HumanOrigin factice avec Works/ et Projects/ côte à côte.
        let base = temp_works_root();
        let works = base.join("Works");
        let projects = base.join("Projects");
        fs::create_dir_all(projects.join("MonProjetLegacy")).unwrap();
        fs::write(
            projects.join("MonProjetLegacy").join("project.json"),
            b"{\"project_name\":\"legacy\"}",
        )
        .unwrap();

        let id = WorkId::new();
        create_work_directories(&works, &id).unwrap();
        write_work_metadata_atomic(
            &works,
            &sample_record(&id, "/tmp/w", "2026-07-13T13:00:00Z"),
        )
        .unwrap();

        let cache = rebuild_index_from_disk(&works).unwrap();
        // Le Projet legacy n'apparaît jamais dans l'index Work.
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.entries[0].work_id, id);
        // Projects/ reste strictement intact.
        assert!(projects
            .join("MonProjetLegacy")
            .join("project.json")
            .exists());
        // Le chemin racine par défaut cible bien Works/, pas Projects/.
        let default_root = works_root().unwrap();
        assert!(default_root.ends_with("Works"));
        assert!(!default_root.to_string_lossy().contains("Projects"));
        cleanup(&base);
    }

    #[test]
    fn test_9_metadata_mutable_distincte_de_creation() {
        // Création une seule fois, puis mises à jour atomiques répétées de work.json.
        let root = temp_works_root();
        let id = WorkId::new();
        create_work_directories(&root, &id).unwrap();

        let mut record = sample_record(&id, "/tmp/v1", "2026-07-13T14:00:00Z");
        write_work_metadata_atomic(&root, &record).unwrap();

        // Update : nouveau contenu + passage ARCHIVED, sans recréer le dossier.
        record.local_metadata.display_name = Some("Renommé".into());
        record.lifecycle = WorkLifecycle::Archived;
        record.last_activity_utc = "2026-07-13T15:00:00Z".into();
        write_work_metadata_atomic(&root, &record).unwrap();

        let read_back = read_work_metadata(&root, &id).unwrap();
        assert_eq!(read_back.lifecycle, WorkLifecycle::Archived);
        assert_eq!(
            read_back.local_metadata.display_name.as_deref(),
            Some("Renommé")
        );

        // La création reste refusée même si work.json est mutable.
        assert!(create_work_directories(&root, &id).is_err());
        cleanup(&root);
    }

    #[test]
    fn test_10_work_id_non_uuid_rejete() {
        let root = temp_works_root();
        fs::create_dir_all(&root).unwrap();

        // Tentatives de traversal / chemin absolu / non-UUID : toutes rejetées.
        for evil in ["../evasion", "..", "/etc/passwd", "a/b", "pas-un-uuid", ""] {
            let bad = WorkId(evil.to_string());
            assert!(
                !bad.is_valid(),
                "{:?} ne doit pas être un UUID valide",
                evil
            );
            assert!(
                create_work_directories(&root, &bad).is_err(),
                "create doit refuser {:?}",
                evil
            );
            assert!(
                read_work_metadata(&root, &bad).is_err(),
                "read doit refuser {:?}",
                evil
            );
            let rec = sample_record(&bad, "/tmp/x", "2026-07-13T16:00:00Z");
            assert!(
                write_work_metadata_atomic(&root, &rec).is_err(),
                "write doit refuser {:?}",
                evil
            );
        }
        // Un vrai UUID passe la validation.
        assert!(WorkId::new().is_valid());
        cleanup(&root);
    }
}
