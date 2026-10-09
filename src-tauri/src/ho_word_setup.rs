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

// ---------------------------------------------------------------- état : sentinelle locale seule
/// N'ouvre, ne liste ni ne vérifie JAMAIS le conteneur de Word : seule la sentinelle est lue.
pub fn status(app_dir: &Path) -> serde_json::Value {
    let embedded = sha256_hex(MANIFEST);
    let sentinel: Option<serde_json::Value> = fs::read_to_string(app_dir.join(SENTINEL_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|v: &serde_json::Value| v["schema"] == SENTINEL_SCHEMA);
    let state = match &sentinel {
        None => "not_installed",
        Some(v) if v["manifest_sha256"] == embedded.as_str() => "installed",
        Some(_) => "outdated",
    };
    serde_json::json!({
        "state": state,
        "manifest_version": manifest_version(),
        "installed_manifest_version": sentinel.as_ref().map(|v| v["manifest_version"].clone()),
        "installed_at": sentinel.as_ref().map(|v| v["installed_at"].clone()),
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
pub fn ouvrir_dans_word(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    ouvrir_document(Path::new(path))
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
                let opened = ouvrir_document(&path);
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
