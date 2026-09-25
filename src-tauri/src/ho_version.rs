//! ho_version — Versioning V1.
//!
//! Une nouvelle version est un AUTRE document : autre fichier, autre `record_id`, autre
//! capability, autre preuve. V1 n'est jamais relue, jamais réécrite, jamais republiée.
//!
//! Ce module fait deux choses, et rien d'autre :
//!   - transformer les octets du document source en ceux de V2 (`transformer`) ;
//!   - conserver ce qui a été mesuré à cet instant, jusqu'à la finalisation (le sidecar).
//!
//! Le sidecar ne contient AUCUN secret : ni capability, ni jeton, ni clé de déchiffrement.
//! Rien de ce qu'il porte ne permet de lire un Record.

use base64::{engine::general_purpose, Engine as _};
use sha2::{Digest, Sha256};
use std::{fs, io::{Cursor, Read, Write}, path::{Path, PathBuf}};

pub const SCHEMA: &str = "ho-version-lineage/1";
pub const TRANSFORMATION_ID: &str = "ho.versioning.copyAndReseed";
pub const TRANSFORMATION_VERSION: u64 = 1;
pub const COMMIT_ALGORITHM: &str = "sha256-over-base64-bytes";

const CUSTOM_PART: &str = "docProps/custom.xml";
const DOCUMENT_PART: &str = "word/document.xml";
const RELS_PART: &str = "word/_rels/document.xml.rels";
const MARK_TAG: &str = "humanorigin-record-mark";
/// Propriétés qui rattachent un document à SON Record. Une V2 ne doit en porter aucune :
/// les garder ferait republier V2 sous l'identité de V1.
const PROPS_RETIREES: [&str; 3] = ["HOLocator", "HOFacts", "HOReservedId"];

// ---------------------------------------------------------------- engagement
/// MÊME primitive que `final_state_commit` du finalizer : sha256 du base64 des octets.
/// Toute divergence ici rendrait les deux valeurs incomparables, donc le lineage inutile.
pub fn commit_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(general_purpose::STANDARD.encode(bytes).as_bytes());
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

// ---------------------------------------------------------------- XML, au plus près
fn echappe(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
        .replace('"', "&quot;").replace('\'', "&apos;")
}

/// Retire l'élément `<w:sdt>` qui porte `<w:tag w:val="humanorigin-record-mark"/>`, en
/// suivant l'imbrication réelle. Un simple `find`/`rfind` couperait au mauvais endroit dès
/// qu'un autre contrôle de contenu entoure le badge.
fn retirer_badge(doc: &str) -> (String, bool) {
    let Some(pos_tag) = doc.find(&format!("w:val=\"{}\"", MARK_TAG)) else {
        return (doc.to_string(), false);
    };
    let Some(debut) = doc[..pos_tag].rfind("<w:sdt>") else { return (doc.to_string(), false) };
    // Parcours sur les OCTETS. Un document réel contient des caractères accentués : avancer
    // d'un octet puis découper la chaîne tomberait au milieu d'un caractère et paniquerait.
    let o = doc.as_bytes();
    const OUVRE: &[u8] = b"<w:sdt>";
    const FERME: &[u8] = b"</w:sdt>";
    let mut profondeur = 0usize;
    let mut i = debut;
    while i < o.len() {
        if o[i..].starts_with(OUVRE) {
            profondeur += 1;
            i += OUVRE.len();
        } else if o[i..].starts_with(FERME) {
            i += FERME.len();
            profondeur = match profondeur.checked_sub(1) {
                Some(p) => p,
                None => return (doc.to_string(), false), // structure inattendue : on s'abstient
            };
            if profondeur == 0 {
                let mut out = String::with_capacity(doc.len());
                out.push_str(&doc[..debut]);
                out.push_str(&doc[i..]);
                return (out, true);
            }
        } else {
            i += 1;
        }
    }
    (doc.to_string(), false) // ouverture sans fermeture : on ne touche à rien
}

/// Reconstruit `docProps/custom.xml` sans AUCUNE propriété HumanOrigin, puis y sème le seul
/// `HOReservedId` neuf. Les propriétés de l'utilisateur sont conservées et renumérotées :
/// un `pid` en double rend le paquet invalide aux yeux de Word.
fn reconstruire_custom(xml: &str, nouveau_record_id: &str) -> String {
    let mut gardees: Vec<String> = Vec::new();
    let mut reste = xml;
    while let Some(d) = reste.find("<property ") {
        let apres = &reste[d..];
        let Some(f) = apres.find("</property>").map(|x| x + "</property>".len())
            .or_else(|| apres.find("/>").map(|x| x + 2)) else { break };
        let bloc = &apres[..f];
        let humanorigin = PROPS_RETIREES.iter()
            .any(|p| bloc.contains(&format!("name=\"{}\"", p)));
        if !humanorigin {
            gardees.push(bloc.to_string());
        }
        reste = &apres[f..];
    }
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
         <Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/custom-properties\" \
         xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">");
    let mut pid = 2usize;
    for g in gardees {
        // Renumérotation : le pid d'origine est remplacé, le reste du bloc est intact.
        let renumerote = match (g.find("pid=\""), g.find("pid=\"").and_then(|s| g[s + 5..].find('"').map(|e| s + 5 + e))) {
            (Some(s), Some(e)) => format!("{}pid=\"{}\"{}", &g[..s], pid, &g[e + 1..]),
            _ => g.clone(),
        };
        out.push_str(&renumerote);
        pid += 1;
    }
    out.push_str(&format!(
        "<property fmtid=\"{{D5CDD505-2E9C-101B-9397-08002B2CF9AE}}\" pid=\"{}\" name=\"HOReservedId\">\
         <vt:lpwstr>{}</vt:lpwstr></property>",
        pid, echappe(nouveau_record_id)));
    out.push_str("</Properties>");
    out
}

/// Retire les relations devenues orphelines après le retrait du badge : une relation
/// d'hyperlien ou d'image que plus rien ne référence dans `document.xml`.
///
/// L'incident du 2026-09-22 a montré qu'une relation d'hyperlien survivant au retrait de son
/// contrôle se fait réutiliser par le badge suivant, qui pointe alors vers un autre Record.
fn nettoyer_relations(rels: &str, document: &str) -> String {
    let mut out = String::with_capacity(rels.len());
    let mut reste = rels;
    while let Some(d) = reste.find("<Relationship ") {
        out.push_str(&reste[..d]);
        let apres = &reste[d..];
        let Some(f) = apres.find("/>").map(|x| x + 2) else { out.push_str(apres); return out };
        let bloc = &apres[..f];
        let id = bloc.find("Id=\"").and_then(|s| {
            bloc[s + 4..].find('"').map(|e| bloc[s + 4..s + 4 + e].to_string())
        });
        let externe = bloc.contains("TargetMode=\"External\"");
        let image = bloc.contains("/image");
        let orpheline = match &id {
            Some(i) => !document.contains(&format!("r:id=\"{}\"", i))
                && !document.contains(&format!("r:embed=\"{}\"", i)),
            None => false,
        };
        // Prudence : on ne retire QUE ce qui est devenu orphelin ET de nature à avoir été
        // posé par le badge. Une relation inconnue n'est jamais supprimée.
        if !(orpheline && (externe || image)) {
            out.push_str(bloc);
        }
        reste = &apres[f..];
    }
    out.push_str(reste);
    out
}

// ---------------------------------------------------------------- transformation
/// `ho.versioning.copyAndReseed` v1. Rend les octets de V2 à partir de ceux de la source.
pub fn transformer(source: &[u8], nouveau_record_id: &str) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(source)).map_err(|e| e.to_string())?;
    let noms: Vec<String> = (0..zip.len())
        .map(|i| zip.by_index(i).map(|f| f.name().to_string()).map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;

    let lire = |z: &mut zip::ZipArchive<Cursor<&[u8]>>, n: &str| -> Result<Vec<u8>, String> {
        let mut v = Vec::new();
        z.by_name(n).map_err(|e| e.to_string())?.read_to_end(&mut v).map_err(|e| e.to_string())?;
        Ok(v)
    };

    if !noms.iter().any(|n| n == DOCUMENT_PART) {
        return Err("document.xml absent : ce n'est pas un document Word".into());
    }

    // document.xml d'abord : le nettoyage des relations dépend de ce qu'il reste.
    let doc_src = String::from_utf8(lire(&mut zip, DOCUMENT_PART)?)
        .map_err(|_| "document.xml n'est pas de l'UTF-8".to_string())?;
    let (doc_neuf, _badge_retire) = retirer_badge(&doc_src);

    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for n in &noms {
        let contenu: Vec<u8> = if n == DOCUMENT_PART {
            doc_neuf.as_bytes().to_vec()
        } else if n == CUSTOM_PART {
            let x = String::from_utf8(lire(&mut zip, n)?)
                .map_err(|_| "custom.xml n'est pas de l'UTF-8".to_string())?;
            reconstruire_custom(&x, nouveau_record_id).into_bytes()
        } else if n == RELS_PART {
            let x = String::from_utf8(lire(&mut zip, n)?)
                .map_err(|_| "document.xml.rels n'est pas de l'UTF-8".to_string())?;
            nettoyer_relations(&x, &doc_neuf).into_bytes()
        } else {
            lire(&mut zip, n)?
        };
        w.start_file(n.as_str(), opts).map_err(|e| e.to_string())?;
        w.write_all(&contenu).map_err(|e| e.to_string())?;
    }

    // Aucune partie custom.xml dans la source : on en crée une, sinon V2 n'aurait pas
    // d'identifiant réservé et serait un document muet.
    if !noms.iter().any(|n| n == CUSTOM_PART) {
        return Err("custom.xml absent : le document source ne porte aucune propriété HumanOrigin".into());
    }

    let octets = w.finish().map_err(|e| e.to_string())?.into_inner();
    verifier(&octets, nouveau_record_id)?;
    Ok(octets)
}

/// Contrôle de sortie. Un paquet qui ne satisfait pas ces conditions n'est jamais écrit.
fn verifier(octets: &[u8], nouveau_record_id: &str) -> Result<(), String> {
    let mut z = zip::ZipArchive::new(Cursor::new(octets)).map_err(|e| e.to_string())?;
    let mut custom = String::new();
    z.by_name(CUSTOM_PART).map_err(|e| e.to_string())?
        .read_to_string(&mut custom).map_err(|e| e.to_string())?;
    if custom.contains("HOLocator") || custom.contains("HOFacts") {
        return Err("V2 porte encore un marqueur de la version précédente".into());
    }
    if !custom.contains(&echappe(nouveau_record_id)) {
        return Err("V2 ne porte pas son identifiant réservé".into());
    }
    let mut doc = String::new();
    z.by_name(DOCUMENT_PART).map_err(|e| e.to_string())?
        .read_to_string(&mut doc).map_err(|e| e.to_string())?;
    if doc.contains(MARK_TAG) {
        return Err("V2 porte encore la marque de la version précédente".into());
    }
    // Relecture intégrale : le CRC de chaque partie est contrôlé par la bibliothèque.
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut std::io::sink()).map_err(|e| format!("CRC : {}", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------- sidecar
fn dossier(base: &Path) -> PathBuf { base.join("versions") }
fn chemin(base: &Path, record_id: &str) -> PathBuf {
    dossier(base).join(format!("{}.json", record_id))
}

/// Écriture atomique : fichier temporaire puis renommage. Un sidecar à moitié écrit
/// produirait un `version_lineage` tronqué dans une preuve définitive.
pub fn ecrire(base: &Path, record_id: &str, lineage: &serde_json::Value) -> Result<(), String> {
    let d = dossier(base);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let tmp = d.join(format!(".{}.tmp", record_id));
    let txt = serde_json::to_vec_pretty(lineage).map_err(|e| e.to_string())?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(&txt).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, chemin(base, record_id)).map_err(|e| e.to_string())
}

pub fn lire_sidecar(base: &Path, record_id: &str) -> Option<serde_json::Value> {
    let v: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(chemin(base, record_id)).ok()?).ok()?;
    // Un sidecar d'un autre schéma n'est pas interprété : mieux vaut aucune relation
    // qu'une relation mal lue dans une preuve définitive.
    if v.get("schema").and_then(|s| s.as_str()) != Some(SCHEMA) {
        return None;
    }
    Some(v)
}

pub fn oublier_sidecar(base: &Path, record_id: &str) {
    let _ = fs::remove_file(chemin(base, record_id));
}

/// Construit l'objet `version_lineage`. Aucune valeur n'est inventée : `correspondance`
/// vaut `None` quand la comparaison n'a pas pu être faite, et n'est JAMAIS rendue `false`.
#[allow(clippy::too_many_arguments)]
pub fn lineage(
    predecessor_record_id: &str,
    source_commit: &str,
    source_measured_at: &str,
    initial_commit: &str,
    initial_measured_at: &str,
    correspondance: Option<bool>,
) -> serde_json::Value {
    serde_json::json!({
        "schema": SCHEMA,
        "predecessor_record_id": predecessor_record_id,
        "source_state": {
            "commit": source_commit,
            "commit_algorithm": COMMIT_ALGORITHM,
            "measured_at": source_measured_at
        },
        "transformation": { "id": TRANSFORMATION_ID, "version": TRANSFORMATION_VERSION },
        "initial_state": {
            "commit": initial_commit,
            "commit_algorithm": COMMIT_ALGORITHM,
            "measured_at": initial_measured_at
        },
        "source_matches_predecessor_final_state": correspondance,
        "match_determined_by": correspondance.map(|_| "local_finalizer_state"),
        "baseline": {
            "observed": false,
            "fact_id": "process.blindSpot.inheritedBaselineNotObserved"
        }
    })
}

// ---------------------------------------------------------------- bancs
#[cfg(test)]
mod tests {
    use super::*;

    const ANCIEN: &str = "HO-PREDECESSEUR1";
    const NOUVEAU: &str = "HO-NOUVELLEVER1";

    /// Un paquet Word synthétique portant tout ce qu'une V1 finalisée porte : les trois
    /// propriétés, le badge dans un contrôle de contenu, ses deux hyperliens, une image,
    /// et — pour éprouver la prudence du nettoyage — une propriété de l'utilisateur et une
    /// relation externe qui, elle, reste référencée.
    fn docx_v1() -> Vec<u8> {
        let custom = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="HOReservedId"><vt:lpwstr>HO-PREDECESSEUR1</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="HOLocator"><vt:lpwstr>ho1.HO-PREDECESSEUR1.Q0xF</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="4" name="HOFacts"><vt:lpwstr>ZmFpdHM</vt:lpwstr></property><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="5" name="Dossier client"><vt:lpwstr>Martin</vt:lpwstr></property></Properties>"#;
        let document = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Texte hérité</w:t></w:r></w:p><w:p><w:hyperlink r:id="rId9"><w:r><w:t>lien conservé</w:t></w:r></w:hyperlink></w:p><w:sdt><w:sdtPr><w:tag w:val="humanorigin-record-mark"/></w:sdtPr><w:sdtContent><w:p><w:hyperlink r:id="rId5" w:anchor="k=ABC"><w:r><w:drawing><a:blip xmlns:a="x" r:embed="rId6"/></w:drawing></w:r></w:hyperlink><w:hyperlink r:id="rId7" w:anchor="k=ABC"><w:r><w:t>badge</w:t></w:r></w:hyperlink></w:p></w:sdtContent></w:sdt><w:sectPr/></w:body></w:document>"#;
        let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://verify.humanorigin.io/?record=HO-PREDECESSEUR1" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://verify.humanorigin.io/?record=HO-PREDECESSEUR1" TargetMode="External"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://exemple.test/page" TargetMode="External"/></Relationships>"#;
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (n, c) in [(CUSTOM_PART, custom), (DOCUMENT_PART, document), (RELS_PART, rels),
                       ("word/settings.xml", "<x/>"), ("word/media/image1.png", "PNGPNGPNG")] {
            w.start_file(n, o).unwrap();
            w.write_all(c.as_bytes()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn partie(octets: &[u8], nom: &str) -> String {
        let mut z = zip::ZipArchive::new(Cursor::new(octets)).unwrap();
        let mut s = String::new();
        z.by_name(nom).unwrap().read_to_string(&mut s).unwrap();
        s
    }

    #[test]
    fn la_v2_ne_porte_plus_rien_de_la_v1() {
        let v2 = transformer(&docx_v1(), NOUVEAU).expect("transformation");
        let custom = partie(&v2, CUSTOM_PART);
        assert!(!custom.contains("HOLocator"), "HOLocator survit");
        assert!(!custom.contains("HOFacts"), "HOFacts survit");
        assert!(!custom.contains(ANCIEN), "l'identifiant de V1 survit");
        assert!(custom.contains(NOUVEAU), "l'identifiant de V2 est absent");
        assert!(!partie(&v2, DOCUMENT_PART).contains(MARK_TAG), "le badge survit");
    }

    /// CONTRÔLE NÉGATIF. Le nettoyage doit retirer les relations devenues orphelines, et
    /// UNIQUEMENT celles-là. Une relation externe encore référencée par le corps reste.
    #[test]
    fn seules_les_relations_orphelines_disparaissent() {
        let v2 = transformer(&docx_v1(), NOUVEAU).unwrap();
        let rels = partie(&v2, RELS_PART);
        for orpheline in ["rId5", "rId6", "rId7"] {
            assert!(!rels.contains(&format!("Id=\"{}\"", orpheline)),
                "relation orpheline {} conservée :\n{}", orpheline, rels);
        }
        assert!(rels.contains("Id=\"rId9\""), "une relation encore référencée a été retirée");
        assert!(rels.contains("Id=\"rId1\""), "une relation interne a été retirée");
        assert!(!rels.contains("verify.humanorigin.io"),
            "un lien de vérification de V1 subsiste");
    }

    /// CONTRÔLE NÉGATIF. Les propriétés de l'utilisateur ne sont pas des propriétés
    /// HumanOrigin : les perdre serait détruire son document.
    #[test]
    fn les_proprietes_de_l_utilisateur_survivent_et_les_pid_restent_uniques() {
        let v2 = transformer(&docx_v1(), NOUVEAU).unwrap();
        let custom = partie(&v2, CUSTOM_PART);
        assert!(custom.contains("Dossier client") && custom.contains("Martin"),
            "propriété utilisateur perdue :\n{}", custom);
        let pids: Vec<&str> = custom.match_indices("pid=\"").map(|(i, _)| {
            let r = &custom[i + 5..];
            &r[..r.find('"').unwrap()]
        }).collect();
        let mut tries = pids.clone();
        tries.sort_unstable();
        tries.dedup();
        assert_eq!(pids.len(), tries.len(), "pid en double : {:?}", pids);
        assert!(pids.iter().all(|p| p.parse::<u32>().map(|n| n >= 2).unwrap_or(false)),
            "un pid inférieur à 2 : {:?}", pids);
    }

    #[test]
    fn le_contenu_herite_et_les_autres_parties_sont_intacts() {
        let source = docx_v1();
        let v2 = transformer(&source, NOUVEAU).unwrap();
        assert!(partie(&v2, DOCUMENT_PART).contains("Texte hérité"), "le contenu a été altéré");
        assert_eq!(partie(&v2, "word/settings.xml"), partie(&source, "word/settings.xml"));
    }

    /// L'engagement du versioning et celui du finalizer doivent être LA MÊME primitive.
    /// S'ils divergeaient, `source_state.commit` ne serait comparable à aucun
    /// `final_state_commit`, et toute la relation V1→V2 deviendrait invérifiable.
    #[test]
    fn l_engagement_est_celui_du_finalizer() {
        let octets = b"des octets quelconques";
        assert_eq!(commit_bytes(octets), crate::ho_finalizer::commit_bytes_pour_test(octets));
    }

    #[test]
    fn un_paquet_qui_n_est_pas_un_docx_est_refuse() {
        assert!(transformer(b"ceci n'est pas un zip", NOUVEAU).is_err());
    }

    #[test]
    fn un_docx_sans_marqueur_humanorigin_est_refuse() {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = zip::write::FileOptions::default();
        w.start_file(DOCUMENT_PART, o).unwrap();
        w.write_all(b"<w:document/>").unwrap();
        let brut = w.finish().unwrap().into_inner();
        assert!(transformer(&brut, NOUVEAU).is_err(), "un document sans custom.xml a été accepté");
    }

    // ---------------------------------------------------------------- sidecar
    /// Un répertoire propre PAR BANC : les bancs s'exécutent en parallèle, et un répertoire
    /// partagé faisait qu'un test effaçait le sidecar d'un autre.
    fn temp(nom: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ho-version-test-{}-{}", std::process::id(), nom));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn le_sidecar_fait_l_aller_retour_puis_disparait() {
        let d = temp("aller-retour");
        let l = lineage(ANCIEN, "aa", "2026-09-25T10:00:00.000Z", "bb", "2026-09-25T10:00:01.000Z", Some(true));
        ecrire(&d, NOUVEAU, &l).unwrap();
        let relu = lire_sidecar(&d, NOUVEAU).expect("relecture");
        assert_eq!(relu["predecessor_record_id"], ANCIEN);
        assert_eq!(relu["source_matches_predecessor_final_state"], serde_json::json!(true));
        assert_eq!(relu["match_determined_by"], "local_finalizer_state");
        oublier_sidecar(&d, NOUVEAU);
        assert!(lire_sidecar(&d, NOUVEAU).is_none(), "le sidecar survit à son retrait");
        let _ = fs::remove_dir_all(&d);
    }

    /// CONTRÔLE NÉGATIF. Un sidecar d'un autre schéma ne doit pas être interprété : une
    /// relation mal lue entrerait dans une preuve définitive.
    #[test]
    fn un_sidecar_d_un_autre_schema_est_ignore() {
        let d = temp("autre-schema");
        let mut l = lineage(ANCIEN, "aa", "t", "bb", "t", None);
        l["schema"] = serde_json::json!("ho-version-lineage/2");
        ecrire(&d, NOUVEAU, &l).unwrap();
        assert!(lire_sidecar(&d, NOUVEAU).is_none(), "un schéma inconnu a été interprété");
        let _ = fs::remove_dir_all(&d);
    }

    /// `null` n'est jamais `false`. Une correspondance indéterminée ne doit produire
    /// aucune affirmation, et surtout pas celle d'une divergence.
    #[test]
    fn indetermine_n_est_pas_divergent() {
        let l = lineage(ANCIEN, "aa", "t", "bb", "t", None);
        assert_eq!(l["source_matches_predecessor_final_state"], serde_json::Value::Null);
        assert_eq!(l["match_determined_by"], serde_json::Value::Null);
        let f = lineage(ANCIEN, "aa", "t", "bb", "t", Some(false));
        assert_eq!(f["source_matches_predecessor_final_state"], serde_json::json!(false));
        assert_eq!(f["match_determined_by"], "local_finalizer_state");
    }

    #[test]
    fn le_sidecar_ne_porte_aucun_secret() {
        let l = lineage(ANCIEN, "aa", "t", "bb", "t", Some(true));
        let brut = serde_json::to_string(&l).unwrap().to_lowercase();
        for interdit in ["capability", "jwt", "token", "jeton", "key", "clé", "secret", "bearer"] {
            assert!(!brut.contains(interdit), "le sidecar porte « {} »", interdit);
        }
        assert_eq!(l["baseline"]["observed"], serde_json::json!(false));
    }

    /// Deux V2 depuis la même V1 : chacune a son sidecar, aucune n'écrase l'autre.
    #[test]
    fn deux_versions_depuis_la_meme_source_coexistent() {
        let d = temp("deux-versions");
        ecrire(&d, "HO-VERSIONDEUXA", &lineage(ANCIEN, "aa", "t", "b1", "t", Some(true))).unwrap();
        ecrire(&d, "HO-VERSIONDEUXB", &lineage(ANCIEN, "aa", "t", "b2", "t", Some(true))).unwrap();
        let a = lire_sidecar(&d, "HO-VERSIONDEUXA").unwrap();
        let b = lire_sidecar(&d, "HO-VERSIONDEUXB").unwrap();
        assert_eq!(a["predecessor_record_id"], b["predecessor_record_id"]);
        assert_ne!(a["initial_state"]["commit"], b["initial_state"]["commit"]);
        let _ = fs::remove_dir_all(&d);
    }
}

/// Banc sur un document Word RÉEL, hors `cargo test` ordinaire. Un paquet synthétique ne
/// reproduit pas tout ce que Word écrit : contrôles imbriqués, relations, médias, parties
/// annexes. Ce banc éprouve la transformation là où elle sera réellement employée.
///
///   HO_DOCX_REEL=/chemin/document.docx cargo test transformation_sur_un_docx_reel -- --ignored
#[cfg(test)]
mod reel {
    use super::*;

    #[test]
    #[ignore]
    fn transformation_sur_un_docx_reel() {
        let chemin = std::env::var("HO_DOCX_REEL").expect("HO_DOCX_REEL");
        let source = fs::read(&chemin).expect("lecture du document");
        let avant = String::from_utf8_lossy(
            &{ let mut v = Vec::new();
               zip::ZipArchive::new(Cursor::new(&source[..])).unwrap()
                   .by_name(CUSTOM_PART).unwrap().read_to_end(&mut v).unwrap(); v }).to_string();
        assert!(avant.contains("HOLocator"), "ce document n'est pas finalisé");

        let v2 = transformer(&source, "HO-REELNOUVELLE").expect("transformation");

        let lire = |o: &[u8], n: &str| -> String {
            let mut z = zip::ZipArchive::new(Cursor::new(o.to_vec())).unwrap();
            let mut s = String::new();
            z.by_name(n).unwrap().read_to_string(&mut s).unwrap();
            s
        };
        let custom = lire(&v2, CUSTOM_PART);
        assert!(!custom.contains("HOLocator") && !custom.contains("HOFacts"));
        assert!(custom.contains("HO-REELNOUVELLE"));
        let doc = lire(&v2, DOCUMENT_PART);
        assert!(!doc.contains(MARK_TAG), "le badge survit dans un vrai document");
        let rels = lire(&v2, RELS_PART);
        assert!(!rels.contains("verify.humanorigin.io"),
            "un lien de vérification de la version précédente subsiste :\n{}", rels);

        // Le contenu rédigé doit survivre INTÉGRALEMENT. Compter les passages de texte ne
        // dirait rien : le badge en porte lui-même plusieurs, et les perdre est voulu.
        // Le volet pose le badge en FIN de document — il refuse tout autre placement. Donc
        // tout texte situé avant lui appartient à l'utilisateur et doit se retrouver.
        let avant_doc = lire(&source, DOCUMENT_PART);
        let pos_badge = avant_doc.find(MARK_TAG).expect("badge absent de la source");
        let debut_badge = avant_doc[..pos_badge].rfind("<w:sdt>").expect("ouverture du badge");
        let textes: Vec<String> = avant_doc[..debut_badge]
            .match_indices("<w:t")
            .filter_map(|(i, _)| {
                let r = &avant_doc[i..];
                let a = r.find('>')? + 1;
                let b = r.find("</w:t>")?;
                if b <= a { return None; }
                let t = r[a..b].trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            })
            .collect();
        assert!(!textes.is_empty(), "la source ne contient aucun texte utilisateur");
        for t in &textes {
            assert!(doc.contains(t.as_str()), "texte utilisateur perdu : « {} »", t);
        }
        println!("  {} passages de texte utilisateur conservés", textes.len());

        // L'engagement de l'état initial est celui des octets réellement produits.
        assert_eq!(commit_bytes(&v2).len(), 64);
        println!("  source {} octets -> V2 {} octets", source.len(), v2.len());
    }
}
