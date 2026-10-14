//! ho_word_setup — préparation de Microsoft Word, une seule fois, par un geste explicite.
//!
//! Le dossier des compléments de Word se trouve dans le conteneur de Word. macOS protège ce
//! conteneur : chaque processus qui y accède le redemande, même après une autorisation. HumanOrigin
//! n'y accède donc QUE sur un geste de l'utilisateur (« Installer » ou « Réparer l'intégration
//! Word »), jamais au démarrage. L'état de l'intégration est lu dans une sentinelle locale,
//! versionnée par le manifest qu'elle a déposé.
//!
//! Le même module crée le document d'amorçage « Nouveau document HumanOrigin » : un DOCX vide qui
//! référence le complément, pour que Word ouvre le volet. Cette référence est retirée du paquet à la
//! finalisation (voir ho_docx_scrub).

use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

/// Manifest de production du complément HumanOrigin pour Word, embarqué tel quel.
const MANIFEST: &[u8] = include_bytes!("../word/humanorigin-word-manifest.xml");
const MANIFEST_FILE: &str = "humanorigin-prod.xml";
const SENTINEL_FILE: &str = "word_setup.json";
const SENTINEL_SCHEMA: &str = "ho-word-setup/1";
const WORD_BUNDLE: &str = "com.microsoft.Word";

fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{:02x}", x)).collect()
}

fn tag_value(xml: &str, tag: &str) -> String {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    xml.find(&open)
        .and_then(|i| {
            let a = i + open.len();
            xml[a..].find(&close).map(|b| xml[a..a + b].trim().to_string())
        })
        .unwrap_or_default()
}

pub fn manifest_id() -> String {
    tag_value(&String::from_utf8_lossy(MANIFEST), "Id")
}
pub fn manifest_version() -> String {
    tag_value(&String::from_utf8_lossy(MANIFEST), "Version")
}

#[cfg(not(target_os = "windows"))]
fn word_container() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Library/Containers").join(WORD_BUNDLE))
}

/// Windows n'a pas de dossier `wef` auto-chargé : Word y découvre les compléments par un
/// « catalogue de dossier approuvé », déclaré dans la base de registre et pointant un
/// répertoire ordinaire. Ce répertoire reste sous l'espace local de l'application, jamais
/// dans le conteneur d'Office.
#[cfg(target_os = "windows")]
pub fn dossier_catalogue() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("HumanOrigin").join("WordAddin"))
}

/// Identifiant du catalogue HumanOrigin dans la base de registre. Il est FIXE : une
/// réinstallation doit réécrire la même entrée, jamais en empiler une seconde.
#[cfg(target_os = "windows")]
const CATALOGUE_GUID: &str = "{6F3C9A41-2B8E-4D77-A5E1-0C94B7D2F318}";

/// Clé de sideload « Developer » de Word. Le DOCX généré référence le complément par
/// `store="developer" storeType="Registry"` : sur Windows, Word résout donc cette référence
/// ICI, et nulle part ailleurs. Le catalogue approuvé, lui, ne sert qu'à faire apparaître le
/// complément dans « Mes compléments » — il ne résout pas la référence d'un document.
///
/// Mesuré sur machine Windows réelle : avec cette seule entrée, le volet se charge, l'erreur
/// « ce complément n'est plus disponible » disparaît, et le groupe HumanOrigin apparaît dans
/// l'onglet Accueil.
#[cfg(target_os = "windows")]
const CLE_DEVELOPER: &str = r"Software\Microsoft\Office\16.0\WEF\Developer";

/// Cette valeur du registre appartient-elle à HumanOrigin ?
///
/// Fonction PURE, et c'est délibéré : c'est la seule décision de toute la désinstallation qui
/// puisse détruire le bien d'autrui. La clé `WEF\Developer` est partagée avec tous les
/// compléments sideloadés de la machine ; en effacer un qui n'est pas le nôtre serait casser
/// le travail de quelqu'un d'autre sans le savoir. Deux conditions, toutes deux nécessaires :
/// le nom est exactement notre identifiant de manifeste, et la donnée désigne bien notre
/// fichier de manifeste.
pub fn valeur_developer_nous_appartient(nom: &str, donnee: &str, id_manifeste: &str) -> bool {
    if nom != id_manifeste || id_manifeste.is_empty() {
        return false;
    }
    let d = donnee.replace('\\', "/").to_lowercase();
    d.ends_with(&format!("/{}", MANIFEST_FILE.to_lowercase())) || d == MANIFEST_FILE.to_lowercase()
}

/// Déclare le manifeste installé dans la clé « Developer ». Idempotente : le nom de la valeur
/// est l'identifiant du manifeste, donc une réinstallation réécrit la même entrée au lieu d'en
/// empiler une seconde. L'identifiant est LU dans le manifeste embarqué, jamais recopié — s'il
/// change un jour, la registration suit sans qu'on y pense.
#[cfg(target_os = "windows")]
fn declarer_developpeur(manifeste: &Path) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};
    use winreg::RegKey;
    let echec = |e: std::io::Error| format!("Word n'a pas pu etre prepare (cle Developer) : {}", e);
    let (cle, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey_with_flags(CLE_DEVELOPER, KEY_WRITE)
        .map_err(echec)?;
    cle.set_value(manifest_id(), &manifeste.to_string_lossy().to_string())
        .map_err(echec)?;
    Ok(())
}

/// Retire ce que HumanOrigin a écrit dans le registre, et rien d'autre.
///
/// La valeur « Developer » n'est effacée que si `valeur_developer_nous_appartient` le dit. Le
/// catalogue est identifié par notre GUID fixe, donc supprimer sa sous-clé ne touche aucun
/// autre catalogue. Aucune clé parente n'est supprimée : `WEF`, `TrustedCatalogs` et
/// `Developer` appartiennent à Office, pas à nous.
#[cfg(target_os = "windows")]
pub fn retirer_registrations() -> Result<serde_json::Value, String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let id = manifest_id();
    let mut retire_developer = false;

    if let Ok(cle) = hkcu.open_subkey_with_flags(CLE_DEVELOPER, KEY_READ | KEY_WRITE) {
        let donnee: Result<String, _> = cle.get_value(&id);
        if let Ok(d) = donnee {
            if valeur_developer_nous_appartient(&id, &d, &id) {
                cle.delete_value(&id).map_err(|e| e.to_string())?;
                retire_developer = true;
            }
        }
    }

    let chemin_cat = format!(
        r"Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{}",
        CATALOGUE_GUID
    );
    let retire_catalogue = hkcu.delete_subkey_all(&chemin_cat).is_ok();

    Ok(serde_json::json!({
        "developer_retire": retire_developer,
        "catalogue_retire": retire_catalogue,
    }))
}

/// Déclare le dossier comme catalogue approuvé. Sans cette entrée, Word ignore le
/// manifeste même posé au bon endroit.
#[cfg(target_os = "windows")]
fn declarer_catalogue(dossier: &Path) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};
    use winreg::RegKey;
    let chemin = format!(
        r"Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{}",
        CATALOGUE_GUID
    );
    let echec = |e: std::io::Error| format!("Word n'a pas pu etre prepare (registre) : {}", e);
    let (cle, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey_with_flags(&chemin, KEY_WRITE)
        .map_err(echec)?;
    cle.set_value("Id", &CATALOGUE_GUID).map_err(echec)?;
    cle.set_value("Url", &dossier.to_string_lossy().to_string()).map_err(echec)?;
    cle.set_value("Flags", &1u32).map_err(echec)?;
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "dossier"))?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = dir.join(format!(".{}.{}.tmp", name, std::process::id()));
    let res = (|| {
        let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res
}

// ------------------------------------------- état : la sentinelle, corroborée sur Windows
/// Ce que HumanOrigin a réellement posé dans le système, mesuré et non supposé.
///
/// Sur Windows ces trois éléments sont tous nécessaires pour que Word charge le volet : le
/// manifeste déposé, la valeur de sideload « Developer » qui le désigne, et le catalogue
/// approuvé. Tous trois sont dans NOTRE espace (`%LOCALAPPDATA%`, `HKCU`) : les lire ne
/// demande aucune autorisation et ne coûte rien.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct IntegrationReelle {
    pub manifeste_present: bool,
    pub manifeste_conforme: bool,
    pub developer_nous_appartient: bool,
    pub catalogue_conforme: bool,
}

impl IntegrationReelle {
    /// Plus rien de nous : c'est une première installation, pas une réparation.
    pub fn rien_de_nous(&self) -> bool {
        !self.manifeste_present && !self.developer_nous_appartient && !self.catalogue_conforme
    }
    pub fn complete(&self) -> bool {
        self.manifeste_present
            && self.manifeste_conforme
            && self.developer_nous_appartient
            && self.catalogue_conforme
    }
}

/// Deux chemins Windows désignent-ils le même fichier ? Comparaison insensible à la casse et au
/// sens des séparateurs : le registre peut porter une casse différente de la nôtre, et une
/// simple différence de casse ne doit pas envoyer une installation saine vers la réparation.
#[allow(dead_code)]
pub fn meme_chemin(declare: &str, attendu: &Path) -> bool {
    let n = |s: &str| s.replace('/', "\\").trim_matches('"').to_lowercase();
    n(declare) == n(&attendu.to_string_lossy())
}

/// La sentinelle ne suffit JAMAIS à conclure que Word est prêt.
///
/// Mesuré physiquement le 2026-10-12 : `word_setup.json` survivait à la désinstallation. Après
/// réinstallation, l'application la croyait et annonçait « Microsoft Word Prêt » alors que le
/// manifeste, la valeur WEF et le catalogue avaient tous disparu — et Word répondait par une
/// erreur de complément. Un faux état vert est pire qu'un état rouge : il envoie l'utilisateur
/// vers Word au lieu de vers la réparation.
///
/// Fonction PURE, pour que la décision soit éprouvable sans registre ni système de fichiers.
pub fn etat_corrobore(etat_sentinelle: &str, reelle: &IntegrationReelle) -> &'static str {
    if reelle.rien_de_nous() {
        return "not_installed";
    }
    if reelle.complete() && etat_sentinelle == "installed" {
        return "installed";
    }
    // Quelque chose de nous subsiste, mais incomplet ou incohérent : à réparer, pas à poser.
    "outdated"
}

/// Lit l'intégration telle qu'elle est, sans rien écrire.
#[cfg(target_os = "windows")]
fn integration_reelle() -> IntegrationReelle {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;
    let mut r = IntegrationReelle::default();
    let dossier = match dossier_catalogue() {
        Some(d) => d,
        None => return r,
    };
    let manifeste = dossier.join(MANIFEST_FILE);
    if let Ok(octets) = fs::read(&manifeste) {
        r.manifeste_present = true;
        r.manifeste_conforme = octets == MANIFEST;
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let id = manifest_id();
    if let Ok(cle) = hkcu.open_subkey_with_flags(CLE_DEVELOPER, KEY_READ) {
        if let Ok(donnee) = cle.get_value::<String, _>(&id) {
            // Notre identifiant exact ET le manifeste que nous venons de localiser.
            r.developer_nous_appartient = valeur_developer_nous_appartient(&id, &donnee, &id)
                && meme_chemin(&donnee, &manifeste);
        }
    }

    let chemin = format!(
        r"Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{}",
        CATALOGUE_GUID
    );
    if let Ok(cle) = hkcu.open_subkey_with_flags(&chemin, KEY_READ) {
        let bon_id = cle
            .get_value::<String, _>("Id")
            .map(|v| v == CATALOGUE_GUID)
            .unwrap_or(false);
        let bonne_url = cle
            .get_value::<String, _>("Url")
            .map(|u| meme_chemin(&u, &dossier))
            .unwrap_or(false);
        r.catalogue_conforme = bon_id && bonne_url;
    }
    r
}

pub fn status(app_dir: &Path) -> serde_json::Value {
    let embedded = sha256_hex(MANIFEST);
    let sentinel: Option<serde_json::Value> = fs::read_to_string(app_dir.join(SENTINEL_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|v: &serde_json::Value| v["schema"] == SENTINEL_SCHEMA);
    let etat_sentinelle = match &sentinel {
        None => "not_installed",
        Some(v) if v["manifest_sha256"] == embedded.as_str() => "installed",
        Some(_) => "outdated",
    };

    // Sur Windows la sentinelle est CORROBORÉE par ce que le système porte vraiment. Sur macOS
    // elle reste seule, et c'est voulu : vérifier y reviendrait à ouvrir le conteneur de Word,
    // ce qui déclenche la demande d'autorisation du système — précisément ce que cet écran doit
    // éviter. Le défaut mesuré, lui, est propre à la désinstallation Windows.
    #[cfg(target_os = "windows")]
    let (state, reelle) = {
        let r = integration_reelle();
        (etat_corrobore(etat_sentinelle, &r), Some(r))
    };
    #[cfg(not(target_os = "windows"))]
    let (state, reelle): (&str, Option<IntegrationReelle>) = (etat_sentinelle, None);

    serde_json::json!({
        "state": state,
        "manifest_version": manifest_version(),
        "installed_manifest_version": sentinel.as_ref().map(|v| v["manifest_version"].clone()),
        "installed_at": sentinel.as_ref().map(|v| v["installed_at"].clone()),
        "sentinel_state": etat_sentinelle,
        "integration_verifiee": reelle.map(|r| serde_json::json!({
            "manifeste_present": r.manifeste_present,
            "manifeste_conforme": r.manifeste_conforme,
            "developer": r.developer_nous_appartient,
            "catalogue": r.catalogue_conforme,
        })),
    })
}

// ---------------------------------------------------------------- installation / réparation

/// Où déposer le manifeste, et comment nommer un refus du système, selon la plateforme.
/// macOS auto-charge le dossier `wef` du conteneur de Word ; Windows lit un catalogue
/// approuvé que l'on déclare ensuite dans la base de registre.
fn depot_du_manifeste() -> Result<(PathBuf, fn(std::io::Error) -> String), String> {
    #[cfg(target_os = "windows")]
    {
        fn refus(e: std::io::Error) -> String {
            format!("Word n'a pas pu etre prepare : {}", e)
        }
        let dossier = dossier_catalogue().ok_or("Dossier personnel introuvable.")?;
        return Ok((dossier, refus));
    }
    #[cfg(not(target_os = "windows"))]
    {
        fn refus(e: std::io::Error) -> String {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                "macOS n'a pas autorisé HumanOrigin à préparer Word. Utilisez « Réparer \
                 l'intégration Word » et choisissez Autoriser."
                    .to_string()
            } else {
                format!("Word n'a pas pu être préparé : {}", e)
            }
        }
        let container = word_container().ok_or("Dossier personnel introuvable.")?;
        if !container.exists() {
            return Err("Microsoft Word n'est pas installé sur ce Mac, ou n'a jamais été ouvert. \
                        Ouvrez Word une fois, puis réessayez."
                .into());
        }
        return Ok((container.join("Data/Documents/wef"), refus));
    }
}
/// Geste explicite de l'utilisateur. C'est ici, et seulement ici, que macOS peut demander
/// l'autorisation d'accéder aux données de Word.
pub fn install(app_dir: &Path, app_version: &str) -> Result<serde_json::Value, String> {
    let (dossier, denied): (PathBuf, fn(std::io::Error) -> String) = depot_du_manifeste()?;
    fs::create_dir_all(&dossier).map_err(denied)?;
    let target = dossier.join(MANIFEST_FILE);
    write_atomic(&target, MANIFEST).map_err(denied)?;
    let back = fs::read(&target).map_err(denied)?;
    if back != MANIFEST {
        return Err("Le complément déposé ne correspond pas à celui de HumanOrigin. Réessayez.".into());
    }
    // Sur Windows, le fichier bien posé ne suffit pas. Deux déclarations, qui ne font pas la
    // même chose : le catalogue approuvé rend le complément visible dans « Mes compléments » ;
    // la clé Developer, elle, est ce qui permet à Word de RÉSOUDRE la référence que porte le
    // document. Sans la seconde, un DOCX HumanOrigin s'ouvre sur « ce complément n'est plus
    // disponible », ce qui a été constaté sur machine réelle.
    #[cfg(target_os = "windows")]
    {
        declarer_catalogue(&dossier)?;
        declarer_developpeur(&target)?;
    }

    let sentinel = serde_json::json!({
        "schema": SENTINEL_SCHEMA,
        "manifest_id": manifest_id(),
        "manifest_version": manifest_version(),
        "manifest_sha256": sha256_hex(MANIFEST),
        "manifest_file": MANIFEST_FILE,
        "installed_at": chrono::Utc::now().to_rfc3339(),
        "app_version": app_version,
    });
    fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    write_atomic(
        &app_dir.join(SENTINEL_FILE),
        serde_json::to_string_pretty(&sentinel).map_err(|e| e.to_string())?.as_bytes(),
    )
    .map_err(|e| format!("L'état de l'intégration n'a pas pu être enregistré : {}", e))?;
    Ok(status(app_dir))
}

// ------------------------------------------------- mise à niveau automatique de l'intégration

/// Ce qu'il faut faire de l'intégration Word au démarrage.
///
/// Mesuré physiquement le 2026-10-12 : après une mise à jour 0.3.4 → 0.3.5, l'ANCIEN manifeste
/// restait actif tant que l'utilisateur ne cliquait pas « Mettre à jour l'intégration Word ».
/// Or l'ancien manifeste porte le bouton de ruban qui faisait échouer W4 : le correctif était
/// livré mais inopérant, et rien ne le disait. Un correctif qui attend un clic n'est pas livré.
#[derive(Debug, PartialEq, Eq)]
pub enum MiseANiveau {
    /// Rien à faire : l'intégration correspond déjà au manifeste embarqué.
    AJour,
    /// Jamais installée. On ne l'installe PAS en silence : la première pose est un geste
    /// explicite, et l'écran dédié l'accompagne. Seule une mise à niveau est automatique.
    PremiereInstallation,
    /// À mettre à niveau, et Word est fermé : on peut remplacer le manifeste sans risque.
    Maintenant,
    /// À mettre à niveau, mais Word est ouvert. Remplacer le manifeste sous un Word qui l'a
    /// chargé est une mutation risquée : on diffère, et on le dit.
    DifféréeWordOuvert,
}

/// Décision pure, séparée de son effet pour être éprouvable sans Word ni système de fichiers.
pub fn decider_mise_a_niveau(etat: &str, word_ouvert: bool) -> MiseANiveau {
    match etat {
        "installed" => MiseANiveau::AJour,
        "not_installed" => MiseANiveau::PremiereInstallation,
        _ if word_ouvert => MiseANiveau::DifféréeWordOuvert,
        _ => MiseANiveau::Maintenant,
    }
}

/// Word tourne-t-il ?
///
/// On ne lance aucune fenêtre de console pour le savoir : sur Windows on parcourt la liste des
/// processus, sur macOS on interroge `pgrep`. En cas de doute — API en échec, commande
/// introuvable — on répond `true` : différer une mise à niveau est sans conséquence, la faire
/// sous un Word ouvert ne l'est pas.
pub fn word_est_ouvert() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return true;
            }
            let mut e: PROCESSENTRY32W = std::mem::zeroed();
            e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut e) != 0;
            while ok {
                let n = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
                let nom = String::from_utf16_lossy(&e.szExeFile[..n]).to_lowercase();
                if nom == "winword.exe" {
                    CloseHandle(snap);
                    return true;
                }
                ok = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
            false
        }
    }
    #[cfg(target_os = "macos")]
    {
        match std::process::Command::new("/usr/bin/pgrep").arg("-x").arg("Microsoft Word").output() {
            Ok(o) => !o.stdout.is_empty(),
            Err(_) => true,
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        true
    }
}

/// Met l'intégration à niveau si c'est possible et nécessaire, puis rend l'état.
///
/// Le champ `upgraded` dit si quelque chose a été posé à l'instant, et `deferred_word_open`
/// si la mise à niveau attend que Word se ferme. L'interface s'appuie sur ces deux-là ; elle
/// ne redécide rien.
pub fn mise_a_niveau_au_demarrage(app_dir: &Path, app_version: &str) -> serde_json::Value {
    let avant = status(app_dir);
    let etat = avant["state"].as_str().unwrap_or("not_installed").to_string();
    match decider_mise_a_niveau(&etat, word_est_ouvert()) {
        MiseANiveau::Maintenant => match install(app_dir, app_version) {
            Ok(mut apres) => {
                apres["upgraded"] = serde_json::json!(true);
                apres["deferred_word_open"] = serde_json::json!(false);
                apres
            }
            // Un échec de mise à niveau automatique ne doit pas empêcher l'application de
            // démarrer : on rend l'état d'avant, et l'écran d'installation reprend la main.
            Err(e) => {
                let mut v = avant;
                v["upgraded"] = serde_json::json!(false);
                v["deferred_word_open"] = serde_json::json!(false);
                v["upgrade_error"] = serde_json::json!(e);
                v
            }
        },
        MiseANiveau::DifféréeWordOuvert => {
            let mut v = avant;
            v["upgraded"] = serde_json::json!(false);
            v["deferred_word_open"] = serde_json::json!(true);
            v
        }
        _ => {
            let mut v = avant;
            v["upgraded"] = serde_json::json!(false);
            v["deferred_word_open"] = serde_json::json!(false);
            v
        }
    }
}

// ---------------------------------------------------------------- document d'amorçage
fn xml_attr_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

/// DOCX vide qui référence le complément HumanOrigin et demande l'ouverture de son volet.
/// Les dossiers de travail sont transmis au volet dans les réglages du complément : ils vivent dans
/// la partie du complément, retirée du paquet à la finalisation.
/// Identifiant réservé côté serveur, semé dans le document à sa création.
///
/// Le volet Word lit cette propriété au lieu d'en générer une : l'identifiant existe donc
/// déjà, lié à un compte, AVANT d'apparaître dans un document. C'est ce qui interdit la
/// préemption. La capability, elle, n'entre JAMAIS ici — elle vit au Keychain.
pub const RESERVED_ID_PROP: &str = "HOReservedId";

/// Forme acceptée par le registre et par le volet.
pub fn record_id_valide(id: &str) -> bool {
    (6..=64).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn bootstrap_docx(work_folders: &[String], record_id: &str) -> Result<Vec<u8>, String> {
    if !record_id_valide(record_id) {
        return Err("identifiant réservé invalide".into());
    }
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let folders = xml_attr_escape(&serde_json::to_string(work_folders).map_err(|e| e.to_string())?);
    let parts: Vec<(&str, String)> = vec![
        ("[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/word/webextensions/taskpanes.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/><Override PartName="/word/webextensions/webextension1.xml" ContentType="application/vnd.ms-office.webextension+xml"/></Types>"#.to_string()),
        ("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes" Target="word/webextensions/taskpanes.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>"#.to_string()),
        ("word/document.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>"#.to_string()),
        // Sans réglages, Word traite le document comme un document Word 2007 (compatibilityMode 12)
        // et l'ouvre en « Mode de compatibilité ». Le mode 15 est celui d'un document Word actuel.
        ("word/_rels/document.xml.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>"#.to_string()),
        ("word/settings.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="doNotFlipMirrorIndents" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="differentiateMultirowTableHeaders" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat></w:settings>"#.to_string()),
        ("docProps/core.xml", format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified></cp:coreProperties>"#)),
        ("docProps/app.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>HumanOrigin</Application></Properties>"#.to_string()),
        // L'identifiant réservé, et rien d'autre : la capability n'entre jamais dans le document.
        ("docProps/custom.xml", format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{{D5CDD505-2E9C-101B-9397-08002B2CF9AE}}" pid="2" name="{prop}"><vt:lpwstr>{id}</vt:lpwstr></property></Properties>"#,
            prop = RESERVED_ID_PROP, id = xml_attr_escape(record_id))),
        ("word/webextensions/taskpanes.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane dockstate="right" visibility="1" width="350" row="0"><wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></wetp:taskpane></wetp:taskpanes>"#.to_string()),
        ("word/webextensions/_rels/taskpanes.xml.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>"#.to_string()),
        // SAFE CLOSE / G7 — et pourquoi `Office.AutoShowTaskpaneWithDocument` N'EST PAS ici.
        //
        // Cette propriété a été ajoutée le 2026-10-11 : elle rendait `saved` vrai sur macOS, et
        // j'en avais conclu qu'elle corrigeait W4. Le retest physique Windows a montré que non.
        // Elle y produit un SECOND onglet HumanOrigin — `visibility="1"` ouvrait déjà le volet,
        // la propriété en demande un autre — et le document reste modifié. Retirée.
        //
        // Deux mécanismes d'ouverture ne doivent jamais coexister : `visibility="1"` suffit, et
        // c'est lui qui fait passer W1 physiquement sur Windows. Le banc
        // `un_seul_mecanisme_d_ouverture_du_volet` l'empêche de revenir.
        //
        // La cause réelle de W4 est ailleurs : le retest a isolé que le document devient modifié
        // quand le CODE du volet s'exécute — sans add-in, volet caché, ou volet d'erreur avec un
        // faux identifiant, W4 passe. Voir docs/windows/w4_init_du_volet.md.
        ("word/webextensions/webextension1.xml", format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11" id="{{{id}}}"><we:reference id="{id}" version="{version}" store="developer" storeType="Registry"/><we:alternateReferences/><we:properties><we:property name="HOWorkFolders" value="{folders}"/></we:properties><we:bindings/><we:snapshot xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></we:webextension>"#,
            id = manifest_id(), version = manifest_version(), folders = folders)),
    ];
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in parts {
        w.start_file(name, opts).map_err(|e| e.to_string())?;
        w.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(w.finish().map_err(|e| e.to_string())?.into_inner())
}

/// Emplacement proposé au premier document : Documents/HumanOrigin Documents. Calcul du chemin
/// seul, sans aucun accès au disque. Documents/HumanOrigin est écarté : l'ancien produit y range
/// ses projets et sa clé de signature ; il n'est ni proposé, ni touché.
pub const DEFAULT_WORK_FOLDER_NAME: &str = "HumanOrigin Documents";
pub fn default_work_folder() -> Option<String> {
    dirs::document_dir().map(|d| d.join(DEFAULT_WORK_FOLDER_NAME).to_string_lossy().to_string())
}

/// Prépare l'emplacement accepté par l'utilisateur, au moment où il crée son premier document :
/// création du dossier s'il n'existe pas. macOS peut alors demander l'accès (dossier Documents…).
pub fn prepare_work_folder(folder: &str) -> Result<(), String> {
    let p = Path::new(folder);
    if folder.trim().is_empty() || !p.is_absolute() {
        return Err("L’emplacement choisi n’est pas valide.".into());
    }
    fs::create_dir_all(p).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => "macOS n’a pas autorisé HumanOrigin à créer ce dossier. \
            Autorisez l’accès demandé, ou choisissez un autre emplacement."
            .to_string(),
        _ => format!("Le dossier n’a pas pu être créé : {}", e),
    })?;
    if !p.is_dir() {
        return Err("L’emplacement choisi n’est pas un dossier accessible.".into());
    }
    Ok(())
}

/// Crée « Nouveau document HumanOrigin.docx » (ou « … 2 », « … 3 ») dans le premier dossier de
/// travail, sans jamais écraser un fichier, puis l'ouvre dans Word.
/// Écrit un document neuf dans `dir`, sans jamais écraser un fichier existant.
/// Extrait de `new_document` pour que le Versioning emprunte EXACTEMENT le même chemin
/// d'écriture : nommage, `create_new`, `sync_all`, retrait en cas d'échec.
pub fn ecrire_nouveau_document(dir: &Path, bytes: &[u8]) -> Result<serde_json::Value, String> {
    if !dir.is_dir() {
        return Err(format!("Le dossier de travail est introuvable : {}", dir.display()));
    }
    for n in 1..1000 {
        let name = if n == 1 {
            "Nouveau document HumanOrigin.docx".to_string()
        } else {
            format!("Nouveau document HumanOrigin {}.docx", n)
        };
        let path = dir.join(&name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(bytes).and_then(|_| f.sync_all()).map_err(|e| {
                    let _ = fs::remove_file(&path);
                    format!("Le document n'a pas pu être créé : {}", e)
                })?;
                return Ok(serde_json::json!({
                    "path": path.to_string_lossy(),
                    "name": name,
                    "folder": dir.to_string_lossy()
                }));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Le document n'a pas pu être créé : {}", e)),
        }
    }
    Err("Trop de documents portent déjà ce nom.".into())
}

/// Ouvre un document dans Word. Un échec n'invalide rien : le fichier existe et la preuve
/// suivra quand l'utilisateur l'ouvrira.
/// Ouverture demandée depuis un écran du produit, avec ses refus explicites.
///
/// La logique vit ICI, et non dans la commande Tauri, pour deux raisons : le reste du module
/// suit déjà ce partage, et une commande n'est pas appelable depuis un test. Les refus sont
/// RENDUS, jamais avalés — un écran qui n'ouvre rien et ne dit rien est un cul-de-sac.
pub fn ouvrir_document_demande(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err("Le document est introuvable à cet emplacement.".into());
    }
    // Cette porte ouvre des documents, pas n'importe quoi : elle ne doit pas devenir un
    // « ouvre ce chemin » générique exposé à la couche interface.
    let docx = p.extension().map(|e| e.eq_ignore_ascii_case("docx")).unwrap_or(false);
    if !docx {
        return Err("Ce fichier n'est pas un document Word.".into());
    }
    if ouvrir_dans_word(path) {
        Ok(())
    } else {
        // Le recours nomme le gestionnaire de fichiers du système : W2 fait désormais passer
        // cette même porte sur Windows, où « Finder » ne veut rien dire.
        #[cfg(target_os = "windows")]
        let ailleurs = "l'Explorateur";
        #[cfg(not(target_os = "windows"))]
        let ailleurs = "le Finder";
        Err(format!("Word n'a pas pu ouvrir ce document. Ouvrez-le depuis {ailleurs}."))
    }
}

/// Révèle un DOSSIER dans le gestionnaire de fichiers du système.
///
/// Porte distincte de celle des documents, et volontairement étroite : elle n'accepte qu'un
/// répertoire existant, et l'appelant ne lui donne jamais un chemin venu de l'interface — il
/// le résout depuis un identifiant de Record.
pub fn ouvrir_dossier(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("Ce dossier est introuvable.".into());
    }
    #[cfg(target_os = "windows")]
    let ok = std::process::Command::new("explorer.exe").arg(path).spawn().is_ok();
    #[cfg(target_os = "macos")]
    let ok = std::process::Command::new("/usr/bin/open").arg(path).spawn().is_ok();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let ok = false;
    if ok {
        Ok(())
    } else {
        Err("Le dossier n'a pas pu être ouvert.".into())
    }
}

/// Écrit un texte dans le presse-papiers, par l'utilitaire du système.
///
/// Pourquoi pas l'API Tauri : activer sa feature `clipboard` tire **28 caisses**, dont les
/// piles Wayland et X11, sur un produit qui ne vise que macOS et Windows. Mesuré. C'est
/// disproportionné pour un bouton, et sur un produit dont la valeur est la confiance, une
/// surface de dépendances qu'on n'a pas lue se paie cher.
///
/// `pbcopy` et `clip` sont présents de base, et cette base lance déjà des processus du système
/// pour ouvrir un document ou un dossier : on reste dans sa pratique. Le texte passe par
/// l'entrée standard — il n'apparaît donc dans aucune ligne de commande, qu'un autre processus
/// pourrait lire dans la table des processus.
pub fn copier_dans_le_presse_papiers(texte: &str) -> Result<(), String> {
    use std::io::Write as _;
    use std::process::{Command, Stdio};
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("clip");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("/usr/bin/pbcopy");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return Err("Le presse-papiers n'est pas disponible sur ce système.".into());

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let mut enfant = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "Le presse-papiers n'a pas pu être utilisé.".to_string())?;
        enfant
            .stdin
            .as_mut()
            .ok_or("Le presse-papiers n'a pas pu être utilisé.")?
            .write_all(texte.as_bytes())
            .map_err(|_| "Le presse-papiers n'a pas pu être utilisé.".to_string())?;
        let fin = enfant
            .wait()
            .map_err(|_| "Le presse-papiers n'a pas pu être utilisé.".to_string())?;
        if fin.success() {
            Ok(())
        } else {
            Err("Le presse-papiers n'a pas pu être utilisé.".into())
        }
    }
}

pub fn ouvrir_dans_word(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    ouvrir_document(Path::new(path))
}

/// Combien de temps attendre la preuve que Word a VRAIMENT ouvert le document.
///
/// Word pose un fichier verrou à côté du document dès qu'il le tient ouvert. C'est le seul
/// signal multiplateforme dont nous disposons, et le finalizer s'en sert déjà pour savoir si
/// un document est ouvert — on ne crée donc aucun mécanisme, on réutilise le sien.
///
/// Pourquoi cette attente existe : le code de retour d'un lancement n'atteste que
/// l'ACCEPTATION de la demande par le système, jamais l'ouverture. Mesuré physiquement le
/// 2026-10-13 — l'application annonçait « Document créé et ouvert dans Word » alors que Word
/// n'affichait rien, parce qu'il avait cessé d'ouvrir quoi que ce soit. Un utilisateur qui
/// arrive sans accompagnement lisait donc une phrase fausse comme première information.
const ATTENTE_OUVERTURE_MS: u64 = 4000;
const PAS_OUVERTURE_MS: u64 = 250;

/// Le nom du fichier verrou que Word pose à côté d'un document.
///
/// Règle d'Office, et elle est particulière : `~$` suivi du nom PRIVÉ DE SES DEUX PREMIERS
/// caractères. Elle vivait en double dans le finalizer ; elle vit ici une fois.
pub fn nom_verrou(nom_document: &str) -> Option<String> {
    if nom_document.chars().count() < 2 {
        return None;
    }
    Some(format!("~${}", nom_document.chars().skip(2).collect::<String>()))
}

/// Word tient-il ce document ouvert, à cet instant ?
///
/// LIMITE de la règle d'Office, constatée en écrivant le banc : deux documents dont les noms
/// ne diffèrent que par leurs DEUX PREMIERS caractères partagent le même nom de verrou —
/// « D6.docx » et « D7.docx » donnent tous deux « ~$.docx ». L'un ouvert, l'autre se dira donc
/// ouvert aussi. Ce défaut est celui de la convention Office, il préexiste à ce cycle
/// (`documents_versionnables` s'en servait déjà), et on ne le corrige pas en inventant une
/// autre règle : on ne saurait plus lire les verrous que Word pose réellement. La conséquence
/// est bornée — un document peut se dire ouvert à tort, jamais fermé à tort — donc elle ne
/// peut pas produire un « ouvert dans Word » là où rien n'est ouvert du tout.
pub fn word_tient_le_document(path: &Path) -> bool {
    let (Some(dir), Some(nom)) = (path.parent(), path.file_name()) else { return false };
    match nom_verrou(&nom.to_string_lossy()) {
        Some(v) => dir.join(v).exists(),
        None => false,
    }
}

/// Demande l'ouverture, puis ATTEND la confirmation. Rend `true` seulement si Word tient
/// réellement le document. Faute de confirmation, l'appelant ne doit pas dire qu'il est ouvert.
pub fn ouvrir_et_confirmer(path: &Path) -> bool {
    if !ouvrir_document(path) {
        return false;
    }
    let mut attendu = 0;
    while attendu < ATTENTE_OUVERTURE_MS {
        if word_tient_le_document(path) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(PAS_OUVERTURE_MS));
        attendu += PAS_OUVERTURE_MS;
    }
    // Une dernière lecture : le verrou peut apparaître juste à la fin de l'attente.
    word_tient_le_document(path)
}

/// Confie le document au système pour qu'il l'ouvre dans Word. macOS vise le bundle de
/// Word explicitement ; Windows passe par le gestionnaire par défaut du type `.docx`,
/// qui est Word dès lors qu'il est installé.
fn ouvrir_document(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        // `cmd /C start` a été retiré. Trois défauts, constatés ou structurels :
        //   · il affiche une fenêtre de console qui apparaît et se referme — visible à l'écran ;
        //   · il dépend de `cmd.exe` dans le PATH de l'application, pas de celui de l'utilisateur ;
        //   · le code de sortie de `start` ne dit rien de l'ouverture réelle, alors que c'est lui
        //     qui alimentait « Document créé et ouvert dans Word ».
        // Sur machine réelle, le document était bien écrit mais Word ne se lançait jamais, et le
        // double-clic dans l'Explorateur fonctionnait. `ShellExecuteW` est précisément ce que fait
        // ce double-clic : même résolution du gestionnaire par défaut, aucun processus
        // intermédiaire, et une valeur de retour qui a un sens.
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        fn large(s: &str) -> Vec<u16> {
            std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        }
        let operation = large("open");
        let fichier = large(&path.to_string_lossy());
        // Contrat documenté de ShellExecuteW : une valeur STRICTEMENT supérieure à 32 signale le
        // succès ; tout le reste est un code d'erreur. C'est la seule lecture correcte.
        let r = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                fichier.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        (r as isize) > 32
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("/usr/bin/open")
            .args(["-b", WORD_BUNDLE])
            .arg(path)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

pub fn new_document(work_folders: &[String], record_id: &str) -> Result<serde_json::Value, String> {
    let folder = work_folders.first().ok_or("Choisissez d'abord votre dossier de travail HumanOrigin.")?;
    let dir = PathBuf::from(folder);
    if !dir.is_dir() {
        return Err(format!("Le dossier de travail est introuvable : {}", folder));
    }
    let bytes = bootstrap_docx(work_folders, record_id)?;
    for n in 1..1000 {
        let name = if n == 1 {
            "Nouveau document HumanOrigin.docx".to_string()
        } else {
            format!("Nouveau document HumanOrigin {}.docx", n)
        };
        let path = dir.join(&name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(&bytes).and_then(|_| f.sync_all()).map_err(|e| {
                    let _ = fs::remove_file(&path);
                    format!("Le document n'a pas pu être créé : {}", e)
                })?;
                // On ne dit « ouvert dans Word » que si Word le tient vraiment.
                let opened = ouvrir_et_confirmer(&path);
                return Ok(serde_json::json!({
                    "path": path.to_string_lossy(), "name": name, "folder": folder, "opened_in_word": opened
                }));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Le document n'a pas pu être créé : {}", e)),
        }
    }
    Err("Trop de nouveaux documents portent déjà ce nom dans le dossier de travail.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_manifest_is_production() {
        assert_eq!(manifest_id(), "7b3e1c62-4a58-4d1f-9c05-8e2f6a4b90d3");
        assert_eq!(manifest_version(), "1.0.0.0");
        assert!(String::from_utf8_lossy(MANIFEST).contains("https://create.humanorigin.io/word/taskpane.html"));
    }

    // La clé WEF\Developer est PARTAGÉE avec tous les compléments sideloadés de la machine.
    // En effacer un qui n'est pas le nôtre casserait le travail de quelqu'un d'autre sans
    // qu'on le sache. Ces cas-là sont donc la vraie matière du test.
    #[test]
    fn une_valeur_developer_nous_appartient_quand_le_nom_et_le_fichier_concordent() {
        let id = manifest_id();
        assert!(valeur_developer_nous_appartient(
            &id, r"C:\Users\pcall\AppData\Local\HumanOrigin\WordAddin\humanorigin-prod.xml", &id));
        // Chemin POSIX, et casse indifférente : le registre n'impose ni l'un ni l'autre.
        assert!(valeur_developer_nous_appartient(
            &id, "/Users/x/HumanOrigin/WordAddin/HumanOrigin-Prod.XML", &id));
    }

    #[test]
    fn le_complement_d_un_autre_editeur_n_est_jamais_a_nous() {
        let id = manifest_id();
        // Même dossier, autre complément : le nom ne correspond pas.
        assert!(!valeur_developer_nous_appartient(
            "00000000-1111-2222-3333-444444444444",
            r"C:\Autre\Editeur\manifest.xml", &id));
        // Nom emprunté, mais la donnée ne désigne pas notre manifeste : on ne touche pas.
        assert!(!valeur_developer_nous_appartient(
            &id, r"C:\Autre\Editeur\manifest.xml", &id));
        // Un fichier homonyme en préfixe ne suffit pas : la comparaison porte sur le nom entier.
        assert!(!valeur_developer_nous_appartient(
            &id, r"C:\x\pas-humanorigin-prod.xml.bak", &id));
    }

    #[test]
    fn un_identifiant_vide_n_autorise_aucune_suppression() {
        // Si le manifeste devenait illisible, `manifest_id()` rendrait une chaîne vide. Sans
        // cette garde, toute valeur nommée « » serait réputée nôtre.
        assert!(!valeur_developer_nous_appartient("", "humanorigin-prod.xml", ""));
    }

    // Le nom de la valeur écrite dans le registre DOIT venir du manifeste embarqué. Recopié en
    // dur, il se désynchroniserait le jour où le manifeste change d'identifiant, et Word ne
    // résoudrait plus la référence que portent les documents.
    #[test]
    fn le_nom_de_la_valeur_developer_est_celui_du_manifeste() {
        let id = manifest_id();
        assert_eq!(id, tag_value(&String::from_utf8_lossy(MANIFEST), "Id"));
        assert!(valeur_developer_nous_appartient(&id, MANIFEST_FILE, &id));
    }

    // Le document référence le complément par son identifiant : si les deux divergeaient, aucun
    // magasin ne résoudrait la référence. C'est le lien que W1 répare.
    #[test]
    fn le_docx_reference_exactement_l_identifiant_du_manifeste() {
        let docx = bootstrap_docx(&["/tmp".to_string()], "HO-TestW1abc").unwrap();
        let mut zip = zip::ZipArchive::new(Cursor::new(docx)).unwrap();
        let mut xml = String::new();
        {
            use std::io::Read;
            zip.by_name("word/webextensions/webextension1.xml").unwrap().read_to_string(&mut xml).unwrap();
        }
        assert!(xml.contains(&format!("id=\"{}\"", manifest_id())));
        assert!(xml.contains("store=\"developer\""), "le magasin attendu par Windows est la cle Developer");
        assert!(xml.contains("storeType=\"Registry\""));
    }

    #[test]
    fn status_reads_only_the_sentinel() {
        let dir = std::env::temp_dir().join(format!("ho-word-setup-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(status(&dir)["state"], "not_installed");
        fs::write(dir.join(SENTINEL_FILE), serde_json::json!({
            "schema": SENTINEL_SCHEMA, "manifest_version": "0.9.0.0", "manifest_sha256": "ancien"
        }).to_string()).unwrap();
        assert_eq!(status(&dir)["state"], "outdated");
        fs::write(dir.join(SENTINEL_FILE), serde_json::json!({
            "schema": SENTINEL_SCHEMA, "manifest_version": manifest_version(), "manifest_sha256": sha256_hex(MANIFEST)
        }).to_string()).unwrap();
        assert_eq!(status(&dir)["state"], "installed");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn work_folder_is_proposed_then_prepared() {
        let proposed = default_work_folder().unwrap();
        // Le séparateur de chemin n'est pas le même partout : comparer la FIN d'une chaîne
        // avec des barres obliques n'a de sens que sur Unix. On compare donc les deux
        // derniers segments, ce que la plateforme nomme elle-même correctement.
        let chemin = PathBuf::from(&proposed);
        let mut fin = chemin.iter().rev();
        assert_eq!(fin.next().map(|s| s.to_string_lossy().to_string()).as_deref(),
            Some(DEFAULT_WORK_FOLDER_NAME), "{}", proposed);
        assert_eq!(fin.next().map(|s| s.to_string_lossy().to_string()).as_deref(),
            Some("Documents"), "{}", proposed);
        let base = std::env::temp_dir().join(format!("ho-work-folder-{}", std::process::id()));
        let target = base.join("Documents").join(DEFAULT_WORK_FOLDER_NAME);
        assert!(!target.exists());
        prepare_work_folder(target.to_str().unwrap()).unwrap();
        assert!(target.is_dir());
        fs::write(target.join("existant.docx"), b"x").unwrap();
        prepare_work_folder(target.to_str().unwrap()).unwrap();          // dossier existant : rien n'est touché
        assert_eq!(fs::read(target.join("existant.docx")).unwrap(), b"x");
        assert!(prepare_work_folder("relatif/HumanOrigin").is_err());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn le_document_porte_l_identifiant_reserve() {
        let folders = vec!["/tmp/x".to_string()];
        let bytes = super::bootstrap_docx(&folders, "HO-RESERVE123456").unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut xml = String::new();
        {
            use std::io::Read as _;
            z.by_name("docProps/custom.xml").unwrap().read_to_string(&mut xml).unwrap();
        }
        assert!(xml.contains("HOReservedId"), "la propriété est présente");
        assert!(xml.contains("<vt:lpwstr>HO-RESERVE123456</vt:lpwstr>"),
            "l'identifiant semé est celui réservé");
    }

    #[test]
    fn la_partie_custom_est_declaree_dans_le_paquet() {
        let bytes = super::bootstrap_docx(&vec!["/tmp/x".to_string()], "HO-RESERVE123456").unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let lire = |z: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>, n: &str| {
            use std::io::Read as _;
            let mut s = String::new();
            z.by_name(n).unwrap().read_to_string(&mut s).unwrap();
            s
        };
        assert!(lire(&mut z, "[Content_Types].xml").contains("/docProps/custom.xml"),
            "la partie est déclarée : sans cela Word ignore la propriété");
        assert!(lire(&mut z, "_rels/.rels").contains("custom-properties"),
            "la relation racine existe");
    }

    #[test]
    fn un_identifiant_invalide_ne_produit_aucun_document() {
        let f = vec!["/tmp/x".to_string()];
        for mauvais in ["", "court", "HO-avec espace", &"a".repeat(65), "HO-点"] {
            assert!(super::bootstrap_docx(&f, mauvais).is_err(),
                "refusé : {:?}", mauvais);
        }
    }

    #[test]
    fn la_capability_n_entre_jamais_dans_le_document() {
        // Une capability plausible, jamais transmise à bootstrap_docx : elle ne peut donc
        // pas s'y trouver. Le contrôle porte sur les OCTETS du paquet, pas sur une partie.
        let cap = "eyJ2ZXJzaW9uIjoxLCJyZWNvcmRfaWQiOiJITy1SRVNFUlZFMTIzNDU2In0";
        let bytes = super::bootstrap_docx(&vec!["/tmp/x".to_string()], "HO-RESERVE123456").unwrap();
        let brut = String::from_utf8_lossy(&bytes).to_string();
        assert!(!brut.contains(cap), "aucune trace compressée");
        // Et dans chaque partie décompressée.
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        for i in 0..z.len() {
            use std::io::Read as _;
            let mut f = z.by_index(i).unwrap();
            let nom = f.name().to_string();
            let mut s = String::new();
            let _ = f.read_to_string(&mut s);
            assert!(!s.contains(cap), "aucune trace dans {}", nom);
            assert!(!s.contains("capability"), "aucune mention de capability dans {}", nom);
        }
    }

    /// La mise à niveau de l'intégration ne demande plus de clic — mais ne s'improvise pas.
    ///
    /// La décision est pure, donc éprouvable sans Word ni système de fichiers. Quatre cas, et
    /// chacun compte : une intégration à jour ne se retouche pas ; une première installation
    /// reste un geste explicite, accompagné de son écran ; une mise à niveau se fait tout de
    /// suite si Word est fermé ; et si Word est ouvert elle est DIFFÉRÉE, parce que remplacer
    /// le manifeste sous un Word qui l'a chargé est une mutation risquée.
    #[test]
    fn la_mise_a_niveau_se_decide_sans_rien_toucher() {
        use super::MiseANiveau::*;
        assert_eq!(super::decider_mise_a_niveau("installed", false), AJour);
        assert_eq!(super::decider_mise_a_niveau("installed", true), AJour);
        assert_eq!(super::decider_mise_a_niveau("not_installed", false), PremiereInstallation);
        assert_eq!(super::decider_mise_a_niveau("not_installed", true), PremiereInstallation);
        assert_eq!(super::decider_mise_a_niveau("outdated", false), Maintenant);
        assert_eq!(super::decider_mise_a_niveau("outdated", true), DifféréeWordOuvert);
        // Un état inconnu est traité comme une mise à niveau : mieux vaut reposer un manifeste
        // correct que laisser vivre un état qu'on ne sait pas nommer.
        assert_eq!(super::decider_mise_a_niveau("???", false), Maintenant);
    }

    /// Une mise à niveau différée n'écrit RIEN. C'est tout l'intérêt de différer.
    #[test]
    fn differer_n_ecrit_rien() {
        let dir = std::env::temp_dir().join(format!("ho-upg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Une sentinelle d'une version antérieure : le manifeste embarqué a changé depuis.
        std::fs::write(dir.join(super::SENTINEL_FILE), serde_json::to_vec(&serde_json::json!({
            "schema": super::SENTINEL_SCHEMA, "manifest_sha256": "ancienne-empreinte",
            "manifest_version": "0.0.0.0", "app_version": "0.3.4",
        })).unwrap()).unwrap();
        let avant = std::fs::read(dir.join(super::SENTINEL_FILE)).unwrap();

        assert_eq!(super::status(&dir)["state"], "outdated");
        assert_eq!(super::decider_mise_a_niveau("outdated", true), super::MiseANiveau::DifféréeWordOuvert);

        // On ne peut pas forcer `word_est_ouvert()` ici, mais la décision ci-dessus est celle
        // que `mise_a_niveau_au_demarrage` applique, et la branche différée ne touche à rien :
        // la sentinelle doit être intacte après une simple lecture d'état.
        let _ = super::status(&dir);
        assert_eq!(std::fs::read(dir.join(super::SENTINEL_FILE)).unwrap(), avant,
            "lire l'état ne doit jamais réécrire la sentinelle");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Notre copie du gabarit NSIS ne dérive pas de celle de Tauri 1.6.3.
    ///
    /// Le gabarit de l'installeur est forké pour une seule raison : Tauri 1.6.3 n'offre aucun
    /// point d'extension dans sa section de désinstallation, et il faut y retirer ce que
    /// HumanOrigin a écrit dans le registre de Word. Un fork de 767 lignes dérive en silence
    /// dès que l'amont change, ou dès qu'on le retouche ailleurs que dans nos ajouts.
    ///
    /// Nos ajouts sont donc ENCADRÉS par des marqueurs, et ce banc les retire : ce qui reste
    /// doit rendre, à l'octet, l'empreinte du gabarit 1.6.3 de référence. C'est aussi ce qui
    /// rend le diff lisible à l'œil.
    #[test]
    fn le_gabarit_nsis_ne_derive_pas() {
        const REFERENCE_1_6_3: &str =
            "cb1f407c21ec29ea83ddb4de405c6b8c3a641f929ac842664be10745092587db";
        const DEBUT: &str = "; >>> HumanOrigin";
        const FIN: &str = "; <<< HumanOrigin\n";
        let n = include_str!("../windows/installer.nsi");

        // Retirer chaque bloc marqué, avec l'indentation qui le précède sur sa ligne.
        let mut reste = String::new();
        let mut cur = n;
        let mut blocs = 0;
        while let Some(d) = cur.find(DEBUT) {
            let ligne = cur[..d].rfind('\n').map(|k| k + 1).unwrap_or(0);
            let f = cur[d..].find(FIN).expect("bloc HumanOrigin non fermé") + d + FIN.len();
            reste.push_str(&cur[..ligne]);
            cur = &cur[f..];
            blocs += 1;
        }
        reste.push_str(cur);
        assert_eq!(blocs, 2, "il doit y avoir exactement deux ajouts marqués, pas {}", blocs);
        assert_eq!(sha256_hex(reste.as_bytes()), REFERENCE_1_6_3,
            "notre copie n'est plus « le gabarit 1.6.3 plus nos deux blocs » : soit l'amont a \
             changé, soit la copie a été touchée ailleurs que dans les blocs marqués");
    }

    /// Le nettoyage de désinstallation ne retire que ce qui appartient à HumanOrigin.
    ///
    /// Ces clés de registre sont PARTAGÉES avec tous les compléments sideloadés de la machine :
    /// supprimer une clé parente casserait le travail de quelqu'un d'autre sans le savoir. Ce
    /// banc lit le gabarit et exige la prudence, là où elle ne se voit pas à l'exécution.
    #[test]
    fn la_desinstallation_ne_touche_que_ce_qui_est_a_nous() {
        let n = include_str!("../windows/installer.nsi");
        let i = n.find("Section Uninstall").expect("section de désinstallation absente");
        let bloc = &n[i..n[i..].find("SectionEnd").unwrap() + i];
        let dev = r"Software\Microsoft\Office\16.0\WEF\Developer";
        let cat = "{6F3C9A41-2B8E-4D77-A5E1-0C94B7D2F318}";

        // 1. La valeur Developer part par son NOM. La clé, jamais.
        assert!(bloc.contains(&format!(r#"DeleteRegValue HKCU "{dev}" "7b3e1c62-4a58-4d1f-9c05-8e2f6a4b90d3""#)),
            "la valeur Developer doit être retirée par son nom exact");
        assert!(!bloc.contains(&format!(r#"DeleteRegKey HKCU "{dev}""#)),
            "la clé Developer est partagée : la supprimer casserait les autres compléments");
        assert!(!bloc.contains(r#"DeleteRegKey HKCU "Software\Microsoft\Office\16.0\WEF""#),
            "la clé WEF appartient à Office");
        assert!(!bloc.contains(r#"DeleteRegKey HKCU "Software\Microsoft\Office\16.0\WEF\TrustedCatalogs""#),
            "la clé TrustedCatalogs est partagée : seule notre sous-clé peut partir");

        // 2. Le catalogue n'est retiré qu'après vérification de son identifiant.
        assert!(bloc.contains(&format!(r#""Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{cat}" "Id""#)),
            "l'identifiant du catalogue doit être lu avant toute suppression");
        assert!(bloc.contains(&format!(r#"$0 == "{cat}""#)),
            "la suppression du catalogue doit être conditionnée à son identifiant exact");

        // 3. Le protocole ne part que s'il désigne CETTE installation.
        assert!(bloc.contains(r#""Software\Classes\humanorigin\shell\open\command""#),
            "la commande du protocole doit être lue avant de décider");
        assert!(bloc.contains(r#"${UnStrStr} $1 "$0" "$INSTDIR""#),
            "la commande doit être comparée au dossier de CETTE installation");
        let k = bloc.find(r#"DeleteRegKey HKCU "Software\Classes\humanorigin""#)
            .expect("le protocole doit pouvoir être retiré");
        assert!(bloc[..k].contains(r#"${UnStrStr} $1 "$0" "$INSTDIR""#),
            "la vérification doit PRÉCÉDER la suppression du protocole");

        // 4. Ce qui appartient à l'utilisateur n'est jamais approché.
        for interdit in ["HumanOrigin Documents", "RMDir /r", ".docx", "MyDocuments", "$DOCUMENTS"] {
            assert!(!bloc.contains(interdit),
                "le nettoyage ne doit jamais approcher « {} » : une désinstallation retire une \
                 intégration, elle ne détruit pas un travail", interdit);
        }
        assert!(bloc.contains(r#"RMDir "$LOCALAPPDATA\HumanOrigin""#),
            "nos dossiers partent, mais vides seulement");

        // Les contrôles suivants portent sur NOTRE bloc seulement : le reste de la section
        // appartient à Tauri, qui a sa propre case « supprimer les données » et son RmDir /r.
        let notre = {
            let d = bloc.find("; >>> HumanOrigin").expect("bloc HumanOrigin absent");
            let f = bloc.find("; <<< HumanOrigin").expect("fin du bloc absente");
            &bloc[d..f]
        };

        // 5. La sentinelle d'état part AVEC l'intégration, et rien d'autre du dossier.
        assert!(notre.contains(r#"Delete "$APPDATA\${BUNDLEID}\word_setup.json""#),
            "sans ce retrait, la réinstallation suivante croit une sentinelle périmée et \
             annonce « Word prêt » alors que plus rien n'est posé");
        // Ce qui suit porte sur les INSTRUCTIONS, commentaires retirés : un commentaire doit
        // pouvoir nommer ce qu'il protège, une instruction ne doit pas y toucher.
        let instructions: String = notre
            .lines()
            .map(|l| l.split(';').next().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!instructions.to_lowercase().contains("rmdir /r"),
            "notre nettoyage ne récurse jamais : des fichiers nommés et des dossiers vides");
        assert!(!instructions.contains("finalizer_config.json"),
            "la configuration du finaliseur appartient à l'utilisateur, pas à l'intégration");

        // 6. Le chemin d'installation sous le nom du fabricant, et seulement s'il est à nous.
        assert!(notre.contains(r#"ReadRegStr $0 HKCU "${MANUPRODUCTKEY}" """#),
            "le chemin déclaré doit être LU avant d'être retiré");
        let m = notre.find(r#"DeleteRegKey HKCU "${MANUPRODUCTKEY}""#)
            .expect("le chemin mort doit pouvoir être retiré");
        assert!(notre[..m].contains(r#"${If} $0 == "$INSTDIR""#),
            "la vérification d'appartenance doit PRÉCÉDER la suppression");
        assert!(notre.contains(r#"DeleteRegKey /ifempty HKCU "Software\${MANUFACTURER}""#),
            "la clé du fabricant ne part que vide : un autre produit DAZEAS CORP la garde");
        assert!(!notre.contains(r#"DeleteRegKey HKCU "Software\${MANUFACTURER}""#),
            "sans /ifempty, un autre produit DAZEAS CORP serait emporté");
    }

    /// Une sentinelle seule ne suffit JAMAIS à annoncer « Microsoft Word prêt ».
    ///
    /// Le cas est mesuré, pas imaginé : `word_setup.json` survivait à la désinstallation, et
    /// après réinstallation l'application annonçait « Prêt » sans manifeste, sans valeur WEF et
    /// sans catalogue — Word répondait alors par une erreur de complément. Un faux vert envoie
    /// l'utilisateur vers Word ; un rouge l'envoie vers la réparation. Le rouge est le bon.
    #[test]
    fn une_sentinelle_sans_integration_ne_donne_jamais_pret() {
        let rien = IntegrationReelle::default();
        assert_eq!(etat_corrobore("installed", &rien), "not_installed",
            "sentinelle périmée seule : l'intégration est absente, et c'est une première pose");
        assert_eq!(etat_corrobore("outdated", &rien), "not_installed");
        assert_eq!(etat_corrobore("not_installed", &rien), "not_installed");

        // Partiellement supprimée, ou partiellement posée : à réparer, jamais « prêt ».
        let partiels = [
            ("manifeste seul", IntegrationReelle {
                manifeste_present: true, manifeste_conforme: true, ..Default::default() }),
            ("sans la valeur WEF", IntegrationReelle {
                manifeste_present: true, manifeste_conforme: true,
                developer_nous_appartient: false, catalogue_conforme: true }),
            ("sans le catalogue", IntegrationReelle {
                manifeste_present: true, manifeste_conforme: true,
                developer_nous_appartient: true, catalogue_conforme: false }),
            ("manifeste d'une autre version", IntegrationReelle {
                manifeste_present: true, manifeste_conforme: false,
                developer_nous_appartient: true, catalogue_conforme: true }),
        ];
        for (quoi, r) in partiels {
            assert_eq!(etat_corrobore("installed", &r), "outdated",
                "« {} » : la sentinelle dit installé, le système dit non — on répare", quoi);
            assert_ne!(etat_corrobore("installed", &r), "installed");
        }
    }

    /// Et l'inverse : une intégration réellement complète DOIT donner « prêt ».
    ///
    /// Sans ce contrôle, la garde précédente pourrait être satisfaite par un état rouge
    /// permanent — ce qui casserait le produit tout en passant les tests.
    #[test]
    fn une_integration_complete_et_coherente_donne_pret() {
        let complete = IntegrationReelle {
            manifeste_present: true,
            manifeste_conforme: true,
            developer_nous_appartient: true,
            catalogue_conforme: true,
        };
        assert_eq!(etat_corrobore("installed", &complete), "installed");
        // Intégration complète mais sentinelle d'une version antérieure : mise à niveau.
        assert_eq!(etat_corrobore("outdated", &complete), "outdated");
        // Intégration complète et AUCUNE sentinelle : incohérent, donc à réparer — la
        // réparation réécrit la sentinelle, sans rien demander à l'utilisateur.
        assert_eq!(etat_corrobore("not_installed", &complete), "outdated");

        // Et le chaînage réel : « outdated » + Word fermé se répare tout seul.
        assert_eq!(decider_mise_a_niveau(etat_corrobore("installed", &IntegrationReelle {
            manifeste_present: true, manifeste_conforme: true, ..Default::default() }), false),
            MiseANiveau::Maintenant,
            "une intégration à demi supprimée se répare au démarrage, sans clic");
    }

    /// Une simple différence de casse dans le registre ne doit pas condamner une installation
    /// saine à la réparation : Word et l'installeur n'écrivent pas la même casse que nous.
    #[test]
    fn la_comparaison_de_chemin_tolere_la_casse_et_les_separateurs() {
        let attendu = Path::new(r"C:\Users\P\AppData\Local\HumanOrigin\WordAddin\humanorigin-prod.xml");
        assert!(meme_chemin(r"c:\users\p\appdata\local\humanorigin\wordaddin\humanorigin-prod.xml", attendu));
        assert!(meme_chemin(r"C:/Users/P/AppData/Local/HumanOrigin/WordAddin/humanorigin-prod.xml", attendu));
        assert!(!meme_chemin(r"C:\Users\P\AppData\Local\AutreAddin\humanorigin-prod.xml", attendu),
            "un manifeste homonyme ailleurs n'est pas le nôtre");
    }

    /// Un seul mécanisme d'ouverture du volet, jamais deux.
    ///
    /// `visibility="1"` dans `taskpanes.xml` ouvre le volet — mesuré physiquement sur Windows,
    /// c'est lui qui fait passer W1. `Office.AutoShowTaskpaneWithDocument` en demande un
    /// second : sur Windows, deux onglets HumanOrigin apparaissaient. Les deux ensemble sont
    /// donc interdits, et la propriété ne doit pas revenir seule non plus — elle n'apporte
    /// rien que `visibility` ne fasse déjà.
    #[test]
    fn un_seul_mecanisme_d_ouverture_du_volet() {
        let folders = vec!["/Users/x/Documents/HumanOrigin Documents".to_string()];
        let bytes = bootstrap_docx(&folders, "HO-TESTRESERVED1").unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();

        let mut tp = String::new();
        std::io::Read::read_to_string(
            &mut z.by_name("word/webextensions/taskpanes.xml").unwrap(), &mut tp).unwrap();
        assert!(tp.contains(r#"visibility="1""#),
            "visibility=\"1\" est le mécanisme retenu : c'est lui qui ouvre le volet (W1)");
        assert_eq!(tp.matches("<wetp:taskpane ").count(), 1,
            "un seul volet déclaré : deux entrées produisent deux onglets");

        let mut we = String::new();
        std::io::Read::read_to_string(
            &mut z.by_name("word/webextensions/webextension1.xml").unwrap(), &mut we).unwrap();
        assert!(!we.contains("AutoShowTaskpaneWithDocument"),
            "second mécanisme d'ouverture : sur Windows il produit un deuxième onglet \
             HumanOrigin, et il ne corrige pas W4");
        assert_eq!(we.matches("<we:reference ").count(), 1,
            "une seule référence de complément par document");
    }

    /// SAFE CLOSE / G7 : ouvrir le document ne doit pas le rendre modifié.
    ///
    /// Mesuré le 2026-10-11, sur Windows puis sur macOS via la propriété `saved` de Word :
    /// un document qui demande l'ouverture de son volet (`visibility="1"`) SANS déclarer
    /// `Office.AutoShowTaskpaneWithDocument` est marqué modifié par le seul fait de s'ouvrir,
    /// et Word réclame un enregistrement alors que rien n'a été tapé. Avec la propriété,
    /// `saved` vaut true — vérifié quatre fois en alternance avec le témoin.
    ///
    /// Ce banc tient les deux moitiés ensemble : la propriété DOIT être là, et
    /// `visibility="1"` doit rester, parce que c'est lui qui ouvre le volet (W1). Corriger
    /// l'un en cassant l'autre ferait tomber ce test.
    /// Écrit le paquet réel sur disque pour qu'il puisse être ouvert dans Word, et mesuré.
    /// Ignoré par défaut : il produit un artefact, il ne vérifie rien tout seul.
    ///   cargo test --bin human-origin ecrire_paquet_pour_mesure -- --ignored --nocapture
    #[test]
    #[ignore]
    fn ecrire_paquet_pour_mesure() {
        let folders = vec![format!("{}/Documents/HumanOrigin Documents",
            std::env::var("HOME").unwrap_or_default())];
        let bytes = bootstrap_docx(&folders, "HO-MESUREW40001").unwrap();
        let out = std::path::Path::new("/tmp/w4/produit_par_le_code.docx");
        std::fs::create_dir_all(out.parent().unwrap()).unwrap();
        std::fs::write(out, &bytes).unwrap();
        println!("écrit : {} ({} octets)", out.display(), bytes.len());
    }

    /// Le volet déclaré dans le document est bien celui que le manifeste sait ouvrir.
    ///
    /// Ce banc ne garde PAS W4. Le retest physique du 2026-10-11 a établi que le document
    /// devient modifié quand le CODE du volet s'exécute : sans complément, volet caché, ou
    /// volet d'erreur avec un faux identifiant, W4 passe. Ce que le paquet déclare n'est donc
    /// pas la cause, et nommer ce banc d'après W4 lui ferait promettre ce qu'il ne tient pas.
    ///
    /// Ce qu'il garde est plus modeste et reste utile : la déclaration du volet demeure
    /// cohérente avec le manifeste, sans quoi aucun volet ne s'ouvrirait du tout.
    #[test]
    fn le_volet_declare_correspond_au_manifeste() {
        let folders = vec!["/Users/x/Documents/HumanOrigin Documents".to_string()];
        let bytes = bootstrap_docx(&folders, "HO-TESTRESERVED1").unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();

        let mut tp = String::new();
        std::io::Read::read_to_string(
            &mut z.by_name("word/webextensions/taskpanes.xml").unwrap(), &mut tp).unwrap();
        assert!(tp.contains(r#"visibility="1""#),
            "le volet doit toujours s'ouvrir de lui-même : c'est W1, et le corriger par \
             visibility=\"0\" échangerait un défaut contre un autre");

        // Le manifeste n'offre PLUS de surface de ruban. Validé physiquement sur Windows le
        // 2026-10-04 (W1 et W4 passent, un seul volet, aucun bouton fantôme) : c'est le bouton
        // du ruban — son `ExtensionPoint`, son action `ShowTaskpane` et son `FunctionFile` —
        // qui rendait le document modifié à l'ouverture et faisait apparaître un second volet.
        //
        // Le volet s'ouvre par `visibility="1"` du document, et le `Runtimes`/`SharedRuntime`
        // du manifeste le garde en vie. Rien d'autre n'est nécessaire.
        let manifeste = String::from_utf8_lossy(MANIFEST);
        for interdit in ["PrimaryCommandSurface", "ShowTaskpane", "FunctionFile",
                         "HOGroup.Label", "HOOpen.Label", "HOOpen.Tip",
                         "Icon.16", "Icon.32", "Icon.80"] {
            assert!(!manifeste.contains(interdit),
                "le manifeste ne doit plus porter « {} » : c'est la surface de ruban qui \
                 cassait W4", interdit);
        }
        // Et ce qui doit rester, sans quoi aucun volet ne vivrait.
        for requis in ["SharedRuntime", r#"<Runtime resid="Taskpane.Url" lifetime="long"/>"#,
                       "<GetStarted>", r#"id="Taskpane.Url""#, "<IconUrl",
                       "<HighResolutionIconUrl", "<AppDomains>"] {
            assert!(manifeste.contains(requis), "le manifeste doit garder « {} »", requis);
        }
    }

    #[test]
    fn bootstrap_references_humanorigin_and_is_scrubbable() {
        let folders = vec!["/Users/x/Desktop/human origin test ".to_string(), "/Users/x/Dossier é \"q\" & <b>".to_string()];
        let bytes = bootstrap_docx(&folders, "HO-TESTRESERVED1").unwrap();
        let mut z = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
        let mut s = String::new();
        std::io::Read::read_to_string(&mut z.by_name("word/webextensions/webextension1.xml").unwrap(), &mut s).unwrap();
        assert!(s.contains(r#"reference id="7b3e1c62-4a58-4d1f-9c05-8e2f6a4b90d3""#));
        let mut st = String::new();
        std::io::Read::read_to_string(&mut z.by_name("word/settings.xml").unwrap(), &mut st).unwrap();
        assert!(st.contains(r#"w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15""#));
        let mut ct = String::new();
        std::io::Read::read_to_string(&mut z.by_name("[Content_Types].xml").unwrap(), &mut ct).unwrap();
        assert!(ct.contains(r#"PartName="/word/settings.xml""#));
        assert!(s.contains("&quot;/Users/x/Dossier é \\&quot;q\\&quot; &amp; &lt;b&gt;&quot;"));
        let (out, removed) = crate::ho_docx_scrub::scrub_bytes(&bytes, crate::ho_docx_scrub::HUMANORIGIN_ADDIN_IDS)
            .unwrap().unwrap();
        assert_eq!(removed.len(), 3);
        let mut z = zip::ZipArchive::new(Cursor::new(out.as_slice())).unwrap();
        for i in 0..z.len() {
            let mut t = String::new();
            std::io::Read::read_to_string(&mut z.by_index(i).unwrap(), &mut t).unwrap();
            assert!(!t.contains("HOWorkFolders") && !t.contains("7b3e1c62"));
        }
    }
}
