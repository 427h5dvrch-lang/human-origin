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

fn word_container() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join("Library/Containers").join(WORD_BUNDLE))
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
/// Geste explicite de l'utilisateur. C'est ici, et seulement ici, que macOS peut demander
/// l'autorisation d'accéder aux données de Word.
pub fn install(app_dir: &Path, app_version: &str) -> Result<serde_json::Value, String> {
    let container = word_container().ok_or("Dossier personnel introuvable.")?;
    if !container.exists() {
        return Err("Microsoft Word n'est pas installé sur ce Mac, ou n'a jamais été ouvert. \
                    Ouvrez Word une fois, puis réessayez."
            .into());
    }
    let wef = container.join("Data/Documents/wef");
    let denied = |e: std::io::Error| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "macOS n'a pas autorisé HumanOrigin à préparer Word. Utilisez « Réparer l'intégration \
             Word » et choisissez Autoriser."
                .to_string()
        } else {
            format!("Word n'a pas pu être préparé : {}", e)
        }
    };
    fs::create_dir_all(&wef).map_err(denied)?;
    let target = wef.join(MANIFEST_FILE);
    write_atomic(&target, MANIFEST).map_err(denied)?;
    let back = fs::read(&target).map_err(denied)?;
    if back != MANIFEST {
        return Err("Le complément déposé ne correspond pas à celui de HumanOrigin. Réessayez.".into());
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
pub fn bootstrap_docx(work_folders: &[String]) -> Result<Vec<u8>, String> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let folders = xml_attr_escape(&serde_json::to_string(work_folders).map_err(|e| e.to_string())?);
    let parts: Vec<(&str, String)> = vec![
        ("[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/word/webextensions/taskpanes.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/><Override PartName="/word/webextensions/webextension1.xml" ContentType="application/vnd.ms-office.webextension+xml"/></Types>"#.to_string()),
        ("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes" Target="word/webextensions/taskpanes.xml"/></Relationships>"#.to_string()),
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

/// Emplacement proposé au premier document : Documents/HumanOrigin. Calcul du chemin seul, sans
/// aucun accès au disque.
pub fn default_work_folder() -> Option<String> {
    dirs::document_dir().map(|d| d.join("HumanOrigin").to_string_lossy().to_string())
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
pub fn new_document(work_folders: &[String]) -> Result<serde_json::Value, String> {
    let folder = work_folders.first().ok_or("Choisissez d'abord votre dossier de travail HumanOrigin.")?;
    let dir = PathBuf::from(folder);
    if !dir.is_dir() {
        return Err(format!("Le dossier de travail est introuvable : {}", folder));
    }
    let bytes = bootstrap_docx(work_folders)?;
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
                let opened = std::process::Command::new("/usr/bin/open")
                    .args(["-b", WORD_BUNDLE])
                    .arg(&path)
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
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
        assert!(default_work_folder().unwrap().ends_with("/Documents/HumanOrigin"));
        let base = std::env::temp_dir().join(format!("ho-work-folder-{}", std::process::id()));
        let target = base.join("Documents").join("HumanOrigin");
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
    fn bootstrap_references_humanorigin_and_is_scrubbable() {
        let folders = vec!["/Users/x/Desktop/human origin test ".to_string(), "/Users/x/Dossier é \"q\" & <b>".to_string()];
        let bytes = bootstrap_docx(&folders).unwrap();
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
