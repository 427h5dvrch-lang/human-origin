//! ho_docx_scrub — retire d'un paquet DOCX la seule référence au complément Office HumanOrigin.
//!
//! Pourquoi : Word enregistre dans le document le volet ouvert pendant la session. Un destinataire
//! sans le complément voit alors « Erreur relative au complément ». Le document envoyé doit rester
//! l'objet HumanOrigin vérifiable, sans dépendre du complément.
//!
//! Ce module ne touche QU'À HumanOrigin, identifié par l'ID de sa référence de complément. Toute autre
//! extension web du document est conservée : sa partie octet pour octet, son volet, sa relation et
//! son type de contenu. Toutes les autres parties du paquet sont recopiées sans recompression.
//!
//! Une structure inattendue (complément référencé ailleurs que depuis le volet, partie avec ses
//! propres relations…) n'est jamais « réparée » : le paquet est laissé intact.
//!
//! Le remplacement est atomique : paquet temporaire → validation → remplacement. Le fichier
//! d'origine n'est jamais modifié en place.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read, Write},
    path::Path,
};

/// Identifiants du complément HumanOrigin pour Word (manifest de production).
pub const HUMANORIGIN_ADDIN_IDS: &[&str] = &["7b3e1c62-4a58-4d1f-9c05-8e2f6a4b90d3"];

const REL_TASKPANES: &str = "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes";
const REL_WEBEXTENSION: &str = "http://schemas.microsoft.com/office/2011/relationships/webextension";
const CT_WEBEXTENSION: &str = "application/vnd.ms-office.webextension+xml";
const CONTENT_TYPES: &str = "[Content_Types].xml";

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// Aucune référence HumanOrigin : rien n'a été écrit.
    NotPresent,
    /// Le fichier a été remplacé ; liste des parties retirées.
    Scrubbed(Vec<String>),
}

#[derive(Debug, PartialEq)]
pub enum ScrubError {
    /// Le fichier bouge ou une écriture a échoué : on réessaiera au prochain passage.
    Transient(String),
    /// Structure non reconnue avec certitude : le paquet est laissé intact.
    Refused(String),
}

// ---------------------------------------------------------------- lecture XML minimale
struct Tag {
    start: usize,
    end: usize, // exclusif
    qname: String,
    closing: bool,
    self_closing: bool,
    attrs: Vec<(String, String)>,
}

fn local(q: &str) -> &str {
    q.rsplit(':').next().unwrap_or(q)
}

fn decode_entities(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn parse_attrs(s: &str) -> Vec<(String, String)> {
    let b = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let ns = i;
        while i < b.len() && b[i] != b'=' && !b[i].is_ascii_whitespace() {
            i += 1;
        }
        let name = &s[ns..i];
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || b[i] != b'=' {
            break;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || (b[i] != b'"' && b[i] != b'\'') {
            break;
        }
        let q = b[i];
        i += 1;
        let vs = i;
        while i < b.len() && b[i] != q {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        out.push((name.to_string(), decode_entities(&s[vs..i])));
        i += 1;
    }
    out
}

fn tags(xml: &str) -> Vec<Tag> {
    let b = xml.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while let Some(off) = xml[i..].find('<') {
        let s = i + off;
        let rest = &xml[s..];
        let skip = |end: &str, add: usize| rest.find(end).map(|e| s + e + add);
        if rest.starts_with("<?") {
            match skip("?>", 2) { Some(n) => { i = n; continue; } None => break }
        }
        if rest.starts_with("<!--") {
            match skip("-->", 3) { Some(n) => { i = n; continue; } None => break }
        }
        if rest.starts_with("<![CDATA[") {
            match skip("]]>", 3) { Some(n) => { i = n; continue; } None => break }
        }
        if rest.starts_with("<!") {
            match skip(">", 1) { Some(n) => { i = n; continue; } None => break }
        }
        let mut j = s + 1;
        let mut quote: Option<u8> = None;
        while j < b.len() {
            let c = b[j];
            match quote {
                Some(q) => { if c == q { quote = None; } }
                None => {
                    if c == b'"' || c == b'\'' { quote = Some(c); } else if c == b'>' { break; }
                }
            }
            j += 1;
        }
        if j >= b.len() {
            break;
        }
        let inner = &xml[s + 1..j];
        let closing = inner.starts_with('/');
        let self_closing = !closing && inner.ends_with('/');
        let body = inner.trim_start_matches('/');
        let body = if self_closing { &body[..body.len() - 1] } else { body };
        let name_end = body.find(|c: char| c.is_ascii_whitespace()).unwrap_or(body.len());
        out.push(Tag {
            start: s,
            end: j + 1,
            qname: body[..name_end].to_string(),
            closing,
            self_closing,
            attrs: parse_attrs(&body[name_end..]),
        });
        i = j + 1;
    }
    out
}

fn attr<'a>(t: &'a Tag, local_name: &str) -> Option<&'a str> {
    t.attrs.iter().find(|(k, _)| local(k) == local_name).map(|(_, v)| v.as_str())
}

/// Un XML lisible dont la racine est bien refermée.
fn well_formed_enough(xml: &str) -> bool {
    let ts = tags(xml);
    let Some(root) = ts.iter().find(|t| !t.closing) else { return false };
    if root.self_closing {
        return ts.iter().filter(|t| !t.closing).count() == 1;
    }
    let opens = ts.iter().filter(|t| !t.closing && !t.self_closing).count();
    let closes = ts.iter().filter(|t| t.closing).count();
    opens == closes && ts.last().map(|t| t.closing && t.qname == root.qname).unwrap_or(false)
}

fn remove_spans(s: &str, mut spans: Vec<(usize, usize)>) -> String {
    spans.sort();
    let mut out = String::with_capacity(s.len());
    let mut at = 0;
    for (a, b) in spans {
        if a < at {
            continue;
        }
        out.push_str(&s[at..a]);
        at = b;
    }
    out.push_str(&s[at..]);
    out
}

// ---------------------------------------------------------------- chemins OPC
fn rels_part_of(part: &str) -> String {
    match part.rfind('/') {
        Some(i) => format!("{}/_rels/{}.rels", &part[..i], &part[i + 1..]),
        None => format!("_rels/{}.rels", part),
    }
}

/// Dossier source d'une partie de relations : "word/_rels/document.xml.rels" → "word/".
fn source_dir_of_rels(rels: &str) -> String {
    match rels.rfind("_rels/") {
        Some(i) => rels[..i].to_string(),
        None => String::new(),
    }
}

fn resolve(base_dir: &str, target: &str) -> String {
    let joined = match target.strip_prefix('/') {
        Some(abs) => abs.to_string(),
        None => format!("{}{}", base_dir, target),
    };
    let mut segs: Vec<&str> = vec![];
    for s in joined.split('/') {
        match s {
            "" | "." => {}
            ".." => { segs.pop(); }
            other => segs.push(other),
        }
    }
    segs.join("/")
}

fn norm_id(id: &str) -> String {
    id.trim().trim_start_matches('{').trim_end_matches('}').to_ascii_lowercase()
}

// ---------------------------------------------------------------- analyse et reconstruction
struct Plan {
    removed: BTreeSet<String>,
    modified: BTreeMap<String, Vec<u8>>,
}

fn read_text(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Option<String>, ScrubError> {
    let mut f = match zip.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(ScrubError::Refused(format!("lecture {}: {}", name, e))),
    };
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|e| ScrubError::Refused(format!("lecture {}: {}", name, e)))?;
    Ok(Some(s))
}

fn plan(input: &[u8], ids: &[&str]) -> Result<Option<Plan>, ScrubError> {
    let ids: BTreeSet<String> = ids.iter().map(|s| norm_id(s)).collect();
    let mut zip = zip::ZipArchive::new(Cursor::new(input))
        .map_err(|e| ScrubError::Refused(format!("paquet illisible : {}", e)))?;
    let names: Vec<String> = zip.file_names().map(|s| s.to_string()).collect();
    let content_types = read_text(&mut zip, CONTENT_TYPES)?
        .ok_or_else(|| ScrubError::Refused("[Content_Types].xml absent".into()))?;

    // 1. Parties d'extension web : déclarées comme telles, ou nommées comme Word les nomme.
    let mut webext_parts: BTreeSet<String> = BTreeSet::new();
    for t in tags(&content_types) {
        if local(&t.qname) == "Override" && attr(&t, "ContentType") == Some(CT_WEBEXTENSION) {
            if let Some(p) = attr(&t, "PartName") {
                webext_parts.insert(resolve("", p));
            }
        }
    }
    for n in &names {
        let file = n.rsplit('/').next().unwrap_or("");
        if n.contains("webextensions/") && file.starts_with("webextension") && file.ends_with(".xml") {
            webext_parts.insert(n.clone());
        }
    }

    // 2. Celles qui référencent HumanOrigin.
    let mut ho_parts: BTreeSet<String> = BTreeSet::new();
    for p in &webext_parts {
        let Some(xml) = read_text(&mut zip, p)? else { continue };
        let is_ho = tags(&xml).iter().any(|t| {
            !t.closing && local(&t.qname) == "reference"
                && attr(t, "id").map(|v| ids.contains(&norm_id(v))).unwrap_or(false)
        });
        if is_ho {
            ho_parts.insert(p.clone());
        }
    }
    if ho_parts.is_empty() {
        return Ok(None);
    }
    for p in &ho_parts {
        if names.contains(&rels_part_of(p)) {
            return Err(ScrubError::Refused(format!("{} porte ses propres relations", p)));
        }
    }

    // 3. Toutes les relations du paquet : qui pointe vers le volet, qui pointe vers HumanOrigin.
    let rels_names: Vec<String> = names.iter().filter(|n| n.ends_with(".rels")).cloned().collect();
    let mut rels_text: BTreeMap<String, String> = BTreeMap::new();
    for r in &rels_names {
        if let Some(s) = read_text(&mut zip, r)? {
            rels_text.insert(r.clone(), s);
        }
    }
    let mut taskpanes_parts: BTreeSet<String> = BTreeSet::new();
    for (r, s) in &rels_text {
        for t in tags(s) {
            if local(&t.qname) == "Relationship" && attr(&t, "Type") == Some(REL_TASKPANES) {
                if attr(&t, "TargetMode") == Some("External") { continue; }
                if let Some(tg) = attr(&t, "Target") {
                    taskpanes_parts.insert(resolve(&source_dir_of_rels(r), tg));
                }
            }
        }
    }
    if taskpanes_parts.len() > 1 {
        return Err(ScrubError::Refused("plusieurs parties de volets".into()));
    }
    let taskpanes = taskpanes_parts.into_iter().next();
    let taskpanes_rels = taskpanes.as_ref().map(|p| rels_part_of(p));

    let mut removed_rids: BTreeSet<String> = BTreeSet::new();
    for (r, s) in &rels_text {
        for t in tags(s) {
            if local(&t.qname) != "Relationship" || attr(&t, "TargetMode") == Some("External") {
                continue;
            }
            let Some(tg) = attr(&t, "Target") else { continue };
            if !ho_parts.contains(&resolve(&source_dir_of_rels(r), tg)) {
                continue;
            }
            // HumanOrigin n'est accepté que référencé depuis le volet, comme un complément de volet.
            if Some(r) != taskpanes_rels.as_ref() || attr(&t, "Type") != Some(REL_WEBEXTENSION) {
                return Err(ScrubError::Refused(format!("complément référencé depuis {}", r)));
            }
            removed_rids.insert(attr(&t, "Id").unwrap_or_default().to_string());
        }
    }

    let mut removed: BTreeSet<String> = ho_parts.clone();
    let mut modified: BTreeMap<String, Vec<u8>> = BTreeMap::new();

    // 4. Le volet : retirer uniquement les éléments qui désignent HumanOrigin.
    if let (Some(tp), Some(tpr)) = (taskpanes.as_ref(), taskpanes_rels.as_ref()) {
        if !removed_rids.is_empty() {
            let xml = read_text(&mut zip, tp)?
                .ok_or_else(|| ScrubError::Refused("partie de volets absente".into()))?;
            let ts = tags(&xml);
            let mut spans = vec![];
            let mut remaining = 0usize;
            let mut found: BTreeSet<String> = BTreeSet::new();
            let mut k = 0;
            while k < ts.len() {
                let t = &ts[k];
                if t.closing || local(&t.qname) != "taskpane" {
                    k += 1;
                    continue;
                }
                let (end_idx, end_pos) = if t.self_closing {
                    (k, t.end)
                } else {
                    match ts[k + 1..].iter().position(|x| x.closing && x.qname == t.qname) {
                        Some(off) => (k + 1 + off, ts[k + 1 + off].end),
                        None => return Err(ScrubError::Refused("volet mal formé".into())),
                    }
                };
                let rids: Vec<String> = ts[k..=end_idx]
                    .iter()
                    .filter(|x| !x.closing && local(&x.qname) == "webextensionref")
                    .filter_map(|x| attr(x, "id").map(|s| s.to_string()))
                    .collect();
                if rids.iter().any(|r| removed_rids.contains(r)) {
                    if rids.iter().any(|r| !removed_rids.contains(r)) {
                        return Err(ScrubError::Refused("volet partagé avec un autre complément".into()));
                    }
                    found.extend(rids);
                    spans.push((t.start, end_pos));
                } else {
                    remaining += 1;
                }
                k = end_idx + 1;
            }
            if found != removed_rids {
                return Err(ScrubError::Refused("relation de complément sans volet correspondant".into()));
            }

            let rels = rels_text.get(tpr).cloned().unwrap_or_default();
            let rel_spans: Vec<(usize, usize)> = tags(&rels)
                .iter()
                .filter(|t| local(&t.qname) == "Relationship"
                    && attr(t, "Id").map(|i| removed_rids.contains(i)).unwrap_or(false))
                .map(|t| (t.start, t.end))
                .collect();
            let new_rels = remove_spans(&rels, rel_spans);
            let others_in_rels = tags(&new_rels).iter().filter(|t| local(&t.qname) == "Relationship").count();

            if remaining == 0 {
                if others_in_rels > 0 {
                    return Err(ScrubError::Refused("relations de volet orphelines".into()));
                }
                removed.insert(tp.clone());
                removed.insert(tpr.clone());
                // Plus aucun volet : la relation qui y mène disparaît aussi.
                for (r, s) in &rels_text {
                    if r == tpr { continue; }
                    let sp: Vec<(usize, usize)> = tags(s)
                        .iter()
                        .filter(|t| local(&t.qname) == "Relationship"
                            && attr(t, "Type") == Some(REL_TASKPANES)
                            && attr(t, "Target").map(|tg| &resolve(&source_dir_of_rels(r), tg) == tp).unwrap_or(false))
                        .map(|t| (t.start, t.end))
                        .collect();
                    if !sp.is_empty() {
                        modified.insert(r.clone(), remove_spans(s, sp).into_bytes());
                    }
                }
            } else {
                modified.insert(tp.clone(), remove_spans(&xml, spans).into_bytes());
                modified.insert(tpr.clone(), new_rels.into_bytes());
            }
        }
    }

    // 5. Types de contenu : seules les déclarations des parties retirées disparaissent.
    let ct_spans: Vec<(usize, usize)> = tags(&content_types)
        .iter()
        .filter(|t| local(&t.qname) == "Override"
            && attr(t, "PartName").map(|p| removed.contains(&resolve("", p))).unwrap_or(false))
        .map(|t| (t.start, t.end))
        .collect();
    if !ct_spans.is_empty() {
        modified.insert(CONTENT_TYPES.to_string(), remove_spans(&content_types, ct_spans).into_bytes());
    }

    Ok(Some(Plan { removed, modified }))
}

fn rebuild(input: &[u8], p: &Plan) -> Result<Vec<u8>, ScrubError> {
    let err = |e: zip::result::ZipError| ScrubError::Refused(format!("reconstruction : {}", e));
    let mut src = zip::ZipArchive::new(Cursor::new(input)).map_err(err)?;
    let mut w = zip::ZipWriter::new(Cursor::new(Vec::with_capacity(input.len())));
    w.set_raw_comment(src.comment().to_vec());
    for i in 0..src.len() {
        let name = src.by_index_raw(i).map_err(err)?.name().to_string();
        if p.removed.contains(&name) {
            continue;
        }
        if let Some(new) = p.modified.get(&name) {
            let (method, modified, mode) = {
                let f = src.by_index_raw(i).map_err(err)?;
                (f.compression(), f.last_modified(), f.unix_mode())
            };
            let mut opts = zip::write::FileOptions::default()
                .compression_method(method)
                .last_modified_time(modified);
            if let Some(m) = mode {
                opts = opts.unix_permissions(m);
            }
            w.start_file(name, opts).map_err(err)?;
            w.write_all(new).map_err(|e| ScrubError::Refused(format!("reconstruction : {}", e)))?;
        } else {
            let f = src.by_index_raw(i).map_err(err)?;
            w.raw_copy_file(f).map_err(err)?;   // octets compressés recopiés tels quels
        }
    }
    Ok(w.finish().map_err(err)?.into_inner())
}

/// Octets compressés, CRC et méthode d'une partie, sans décompression.
fn raw_entry(z: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<(Vec<u8>, (u32, zip::CompressionMethod)), String> {
    for i in 0..z.len() {
        let mut f = z.by_index_raw(i).map_err(|e| e.to_string())?;
        if f.name() == name {
            let meta = (f.crc32(), f.compression());
            let mut v = vec![];
            f.read_to_end(&mut v).map_err(|e| e.to_string())?;
            return Ok((v, meta));
        }
    }
    Err(format!("{} absent", name))
}

/// Le paquet reconstruit ne diffère de l'original QUE par ce que le plan annonce.
fn validate(original: &[u8], rebuilt: &[u8], p: &Plan, ids: &[&str]) -> Result<(), ScrubError> {
    let bad = |m: String| ScrubError::Refused(format!("validation : {}", m));
    let mut a = zip::ZipArchive::new(Cursor::new(original)).map_err(|e| bad(e.to_string()))?;
    let mut b = zip::ZipArchive::new(Cursor::new(rebuilt)).map_err(|e| bad(e.to_string()))?;
    let expected: Vec<String> = a.file_names().map(|s| s.to_string()).collect::<Vec<_>>();
    let mut expected_order = vec![];
    for i in 0..a.len() {
        let n = a.by_index_raw(i).map_err(|e| bad(e.to_string()))?.name().to_string();
        if !p.removed.contains(&n) {
            expected_order.push(n);
        }
    }
    let mut got_order = vec![];
    for i in 0..b.len() {
        got_order.push(b.by_index_raw(i).map_err(|e| bad(e.to_string()))?.name().to_string());
    }
    if got_order != expected_order {
        return Err(bad("liste des parties inattendue".into()));
    }
    let _ = expected;
    let idset: Vec<String> = ids.iter().map(|s| norm_id(s)).collect();
    for n in &got_order {
        if let Some(new) = p.modified.get(n) {
            let mut s = String::new();
            b.by_name(n).map_err(|e| bad(e.to_string()))?.read_to_string(&mut s).map_err(|e| bad(e.to_string()))?;
            if s.as_bytes() != new.as_slice() || !well_formed_enough(&s) {
                return Err(bad(format!("{} illisible", n)));
            }
            let lower = s.to_ascii_lowercase();
            if idset.iter().any(|id| lower.contains(id.as_str())) {
                return Err(bad(format!("{} référence encore HumanOrigin", n)));
            }
        } else {
            let (ra, ca) = raw_entry(&mut a, n).map_err(bad)?;
            let (rb, cb) = raw_entry(&mut b, n).map_err(bad)?;
            if ra != rb || ca != cb {
                return Err(bad(format!("{} n'est plus identique", n)));
            }
        }
    }
    // Les parties décompressées se relisent intégralement (contrôle CRC par la bibliothèque).
    for i in 0..b.len() {
        let mut f = b.by_index(i).map_err(|e| bad(e.to_string()))?;
        std::io::copy(&mut f, &mut std::io::sink()).map_err(|e| bad(format!("CRC : {}", e)))?;
    }
    Ok(())
}

/// Calcule, sans rien écrire, le paquet sans référence HumanOrigin.
/// `Ok(None)` : aucune référence HumanOrigin.
pub fn scrub_bytes(input: &[u8], ids: &[&str]) -> Result<Option<(Vec<u8>, Vec<String>)>, ScrubError> {
    let Some(p) = plan(input, ids)? else { return Ok(None) };
    let rebuilt = rebuild(input, &p)?;
    validate(input, &rebuilt, &p, ids)?;
    Ok(Some((rebuilt, p.removed.into_iter().collect())))
}

// ---------------------------------------------------------------- remplacement atomique
/// `bytes` et `seen` sont les octets et les métadonnées lus juste avant par l'appelant.
pub fn scrub_file_atomic(path: &Path, bytes: &[u8], seen: &fs::Metadata, ids: &[&str]) -> Result<Outcome, ScrubError> {
    let t = |m: String| ScrubError::Transient(m);
    let Some((rebuilt, removed)) = scrub_bytes(bytes, ids)? else { return Ok(Outcome::NotPresent) };

    let dir = path.parent().ok_or_else(|| t("dossier introuvable".into()))?;
    let stem = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Nom caché, sans extension .docx : jamais pris pour un document par le finalizer.
    let tmp = dir.join(format!(".{}.ho-scrub.{}.{}.tmp", stem, std::process::id(), nonce));
    let cleanup = |e: String| {
        let _ = fs::remove_file(&tmp);
        ScrubError::Transient(e)
    };

    {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)
            .map_err(|e| t(format!("temporaire : {}", e)))?;
        f.write_all(&rebuilt).map_err(|e| cleanup(format!("écriture : {}", e)))?;
        f.sync_all().map_err(|e| cleanup(format!("sync : {}", e)))?;
    }
    let _ = fs::set_permissions(&tmp, seen.permissions());
    match fs::read(&tmp) {
        Ok(back) if back == rebuilt => {}
        _ => return Err(cleanup("relecture du temporaire".into())),
    }
    if scrub_bytes(&rebuilt, ids).map(|r| r.is_none()) != Ok(true) {
        let _ = fs::remove_file(&tmp);
        return Err(ScrubError::Refused("le paquet reconstruit référence encore HumanOrigin".into()));
    }

    // Word a-t-il réécrit le document entre-temps ? Alors on n'écrase rien.
    let now = fs::metadata(path).map_err(|e| cleanup(e.to_string()))?;
    if now.len() != seen.len() || now.modified().ok() != seen.modified().ok() {
        return Err(cleanup("le document a changé pendant le retrait".into()));
    }
    fs::rename(&tmp, path).map_err(|e| cleanup(format!("remplacement : {}", e)))?;
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(Outcome::Scrubbed(removed))
}

// ---------------------------------------------------------------- tests
#[cfg(test)]
mod tests {
    use super::*;

    const HO: &str = "7b3e1c62-4a58-4d1f-9c05-8e2f6a4b90d3";
    const DUMMY: &str = "0f0f0f0f-1111-4222-8333-444455556666";

    fn ct(extra: &str) -> String {
        format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>{}</Types>"#, extra)
    }
    const OV_TP: &str = r#"<Override PartName="/word/webextensions/taskpanes.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/>"#;
    const OV_W1: &str = r#"<Override PartName="/word/webextensions/webextension1.xml" ContentType="application/vnd.ms-office.webextension+xml"/>"#;
    const OV_W2: &str = r#"<Override PartName="/word/webextensions/webextension2.xml" ContentType="application/vnd.ms-office.webextension+xml"/>"#;
    const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes" Target="word/webextensions/taskpanes.xml"/></Relationships>"#;
    const DOC: &str = r#"<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Contenu utilisateur</w:t></w:r></w:p><w:sdt><w:sdtPr><w:tag w:val="humanorigin-record-mark"/></w:sdtPr></w:sdt></w:body></w:document>"#;
    const CUSTOM: &str = r#"<Properties><property name="HOLocator"><vt:lpwstr>ho1.HO-TESTTEST01.AAAA</vt:lpwstr></property><property name="HOFacts"><vt:lpwstr>BBBB</vt:lpwstr></property></Properties>"#;
    const TP_HO: &str = r#"<wetp:taskpane dockstate="right" visibility="1" width="350" row="0"><wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></wetp:taskpane>"#;
    const TP_DUMMY: &str = r#"<wetp:taskpane dockstate="right" visibility="0" width="320" row="1"><wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/></wetp:taskpane>"#;
    const REL_W1: &str = r#"<Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/>"#;
    const REL_W2: &str = r#"<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension2.xml"/>"#;

    fn webext(id: &str, guid: &str) -> String {
        format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11" id="{{{}}}"><we:reference id="{}" version="1.0.0.0" store="developer" storeType="Registry"/><we:alternateReferences/><we:properties><we:property name="HOWorkFolders" value="[&quot;/tmp/a&quot;]"/></we:properties><we:bindings/><we:snapshot xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></we:webextension>"#, guid, id)
    }
    fn taskpanes(inner: &str) -> String {
        format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11">{}</wetp:taskpanes>"#, inner)
    }
    fn rels(inner: &str) -> String {
        format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{}</Relationships>"#, inner)
    }
    fn docx(parts: &[(&str, String)]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (n, c) in parts {
            w.start_file(*n, zip::write::FileOptions::default()).unwrap();
            w.write_all(c.as_bytes()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }
    fn part(bytes: &[u8], name: &str) -> Option<String> {
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut f = z.by_name(name).ok()?;
        let mut s = String::new();
        f.read_to_string(&mut s).unwrap();
        Some(s)
    }
    fn raw(bytes: &[u8], name: &str) -> Vec<u8> {
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        raw_entry(&mut z, name).unwrap().0
    }

    #[test]
    fn humanorigin_removed_unrelated_webextension_preserved() {
        let input = docx(&[
            ("[Content_Types].xml", ct(&format!("{}{}{}", OV_TP, OV_W1, OV_W2))),
            ("_rels/.rels", ROOT_RELS.to_string()),
            ("word/document.xml", DOC.to_string()),
            ("docProps/custom.xml", CUSTOM.to_string()),
            ("word/webextensions/taskpanes.xml", taskpanes(&format!("{}{}", TP_HO, TP_DUMMY))),
            ("word/webextensions/_rels/taskpanes.xml.rels", rels(&format!("{}{}", REL_W1, REL_W2))),
            ("word/webextensions/webextension1.xml", webext(HO, "AAAA-HO")),
            ("word/webextensions/webextension2.xml", webext(DUMMY, "BBBB-DUMMY")),
        ]);
        let (out, removed) = scrub_bytes(&input, HUMANORIGIN_ADDIN_IDS).unwrap().expect("HumanOrigin présent");
        assert_eq!(removed, vec!["word/webextensions/webextension1.xml".to_string()]);

        // HumanOrigin = retiré
        assert!(part(&out, "word/webextensions/webextension1.xml").is_none());
        let tp = part(&out, "word/webextensions/taskpanes.xml").unwrap();
        assert!(!tp.contains(r#"r:id="rId1""#));
        let tr = part(&out, "word/webextensions/_rels/taskpanes.xml.rels").unwrap();
        assert!(!tr.contains("webextension1.xml"));
        assert!(!part(&out, "[Content_Types].xml").unwrap().contains("webextension1.xml"));

        // Extension sans rapport = conservée, octets et déclarations
        assert_eq!(raw(&input, "word/webextensions/webextension2.xml"), raw(&out, "word/webextensions/webextension2.xml"));
        assert_eq!(tp, taskpanes(TP_DUMMY));
        assert_eq!(tr, rels(REL_W2));
        let ct_out = part(&out, "[Content_Types].xml").unwrap();
        assert!(ct_out.contains(OV_W2) && ct_out.contains(OV_TP));
        assert_eq!(part(&out, "_rels/.rels").unwrap(), ROOT_RELS);

        // Locator, faits, mark, contenu : octets identiques
        for n in ["docProps/custom.xml", "word/document.xml", "_rels/.rels"] {
            assert_eq!(raw(&input, n), raw(&out, n), "{}", n);
        }
        // Idempotent : plus rien à retirer
        assert!(scrub_bytes(&out, HUMANORIGIN_ADDIN_IDS).unwrap().is_none());
    }

    #[test]
    fn humanorigin_only_removes_taskpanes_and_root_relationship() {
        let input = docx(&[
            ("[Content_Types].xml", ct(&format!("{}{}", OV_TP, OV_W1))),
            ("_rels/.rels", ROOT_RELS.to_string()),
            ("word/document.xml", DOC.to_string()),
            ("docProps/custom.xml", CUSTOM.to_string()),
            ("word/webextensions/taskpanes.xml", taskpanes(TP_HO)),
            ("word/webextensions/_rels/taskpanes.xml.rels", rels(REL_W1)),
            ("word/webextensions/webextension1.xml", webext(&HO.to_uppercase(), "AAAA-HO")),
        ]);
        let (out, removed) = scrub_bytes(&input, HUMANORIGIN_ADDIN_IDS).unwrap().unwrap();
        assert_eq!(removed.len(), 3);
        let names: Vec<String> = zip::ZipArchive::new(Cursor::new(out.as_slice())).unwrap().file_names().map(|s| s.to_string()).collect();
        assert!(names.iter().all(|n| !n.contains("webextension")));
        let root = part(&out, "_rels/.rels").unwrap();
        assert!(!root.contains("webextensiontaskpanes") && root.contains("officeDocument") && root.contains("custom-properties"));
        let ct_out = part(&out, "[Content_Types].xml").unwrap();
        assert!(!ct_out.contains("webextension") && ct_out.contains("/word/document.xml"));
        assert_eq!(raw(&input, "docProps/custom.xml"), raw(&out, "docProps/custom.xml"));
        assert_eq!(raw(&input, "word/document.xml"), raw(&out, "word/document.xml"));
    }

    #[test]
    fn no_humanorigin_means_nothing_to_do() {
        let input = docx(&[
            ("[Content_Types].xml", ct(&format!("{}{}", OV_TP, OV_W2))),
            ("_rels/.rels", ROOT_RELS.to_string()),
            ("word/document.xml", DOC.to_string()),
            ("word/webextensions/taskpanes.xml", taskpanes(TP_DUMMY)),
            ("word/webextensions/_rels/taskpanes.xml.rels", rels(REL_W2)),
            ("word/webextensions/webextension2.xml", webext(DUMMY, "BBBB-DUMMY")),
        ]);
        assert!(scrub_bytes(&input, HUMANORIGIN_ADDIN_IDS).unwrap().is_none());
    }

    #[test]
    fn humanorigin_referenced_elsewhere_is_refused() {
        let input = docx(&[
            ("[Content_Types].xml", ct(&format!("{}{}", OV_TP, OV_W1))),
            ("_rels/.rels", ROOT_RELS.to_string()),
            ("word/document.xml", DOC.to_string()),
            ("word/_rels/document.xml.rels", rels(r#"<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextensions/webextension1.xml"/>"#)),
            ("word/webextensions/taskpanes.xml", taskpanes(TP_HO)),
            ("word/webextensions/_rels/taskpanes.xml.rels", rels(REL_W1)),
            ("word/webextensions/webextension1.xml", webext(HO, "AAAA-HO")),
        ]);
        assert!(matches!(scrub_bytes(&input, HUMANORIGIN_ADDIN_IDS), Err(ScrubError::Refused(_))));
    }

    /// SHARED WEBEXTENSION -> NO BINDING.
    /// Un volet partagé avec un autre complément fait refuser le retrait ; le paquet reste donc
    /// porteur de la référence HumanOrigin. La finalisation doit s'arrêter là : pas de liaison,
    /// donc pas de Record, pas de succès, pas de renommage. Ce test tient les deux bouts de la
    /// chaîne : le refus du scrub, et la décision du finalizer qui en découle.
    #[test]
    fn shared_webextension_yields_no_binding() {
        let input = docx(&[
            ("[Content_Types].xml", ct(&format!("{}{}", OV_TP, OV_W1))),
            ("_rels/.rels", ROOT_RELS.to_string()),
            ("word/document.xml", DOC.to_string()),
            ("word/_rels/document.xml.rels", rels(r#"<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextensions/webextension1.xml"/>"#)),
            ("word/webextensions/taskpanes.xml", taskpanes(TP_HO)),
            ("word/webextensions/_rels/taskpanes.xml.rels", rels(REL_W1)),
            ("word/webextensions/webextension1.xml", webext(HO, "AAAA-HO")),
        ]);
        let refus = scrub_bytes(&input, HUMANORIGIN_ADDIN_IDS)
            .expect_err("un volet partagé doit faire refuser le retrait");
        assert!(matches!(refus, ScrubError::Refused(_)));
        assert!(
            !crate::ho_finalizer::binding_allowed(&Err::<Outcome, ScrubError>(refus)),
            "un retrait refusé ne doit jamais autoriser la liaison"
        );
        // Les autres états restent inchangés.
        assert!(crate::ho_finalizer::binding_allowed(&Ok::<Outcome, ScrubError>(Outcome::NotPresent)));
        assert!(!crate::ho_finalizer::binding_allowed(&Ok::<Outcome, ScrubError>(Outcome::Scrubbed(vec![]))));
        assert!(!crate::ho_finalizer::binding_allowed(&Err::<Outcome, ScrubError>(
            ScrubError::Transient("x".into())
        )));
    }

    #[test]
    fn atomic_replace_and_change_detection() {
        let input = docx(&[
            ("[Content_Types].xml", ct(&format!("{}{}", OV_TP, OV_W1))),
            ("_rels/.rels", ROOT_RELS.to_string()),
            ("word/document.xml", DOC.to_string()),
            ("docProps/custom.xml", CUSTOM.to_string()),
            ("word/webextensions/taskpanes.xml", taskpanes(TP_HO)),
            ("word/webextensions/_rels/taskpanes.xml.rels", rels(REL_W1)),
            ("word/webextensions/webextension1.xml", webext(HO, "AAAA-HO")),
        ]);
        let dir = std::env::temp_dir().join(format!("ho-scrub-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("doc.docx");
        fs::write(&p, &input).unwrap();

        // Le document change après lecture : rien n'est écrasé, aucun temporaire ne reste.
        let seen = fs::metadata(&p).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&p, [input.as_slice(), b" "].concat()).unwrap();
        assert!(matches!(scrub_file_atomic(&p, &input, &seen, HUMANORIGIN_ADDIN_IDS), Err(ScrubError::Transient(_))));
        assert_eq!(fs::read(&p).unwrap().len(), input.len() + 1);

        fs::write(&p, &input).unwrap();
        let seen = fs::metadata(&p).unwrap();
        let r = scrub_file_atomic(&p, &input, &seen, HUMANORIGIN_ADDIN_IDS).unwrap();
        assert!(matches!(r, Outcome::Scrubbed(_)));
        let after = fs::read(&p).unwrap();
        assert!(scrub_bytes(&after, HUMANORIGIN_ADDIN_IDS).unwrap().is_none());
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "{:?}", leftovers);
        let seen = fs::metadata(&p).unwrap();
        assert_eq!(scrub_file_atomic(&p, &after, &seen, HUMANORIGIN_ADDIN_IDS).unwrap(), Outcome::NotPresent);
        fs::remove_dir_all(&dir).ok();
    }

    /// Documents réels enregistrés par Word : HO_SCRUB_FIXTURES=<fichier.docx>:<fichier.docx>…
    #[test]
    fn real_word_documents_if_provided() {
        let Ok(list) = std::env::var("HO_SCRUB_FIXTURES") else { return };
        for path in list.split(':').filter(|s| !s.is_empty()) {
            let input = fs::read(path).unwrap();
            match scrub_bytes(&input, HUMANORIGIN_ADDIN_IDS).unwrap() {
                None => println!("{} : aucune référence HumanOrigin", path),
                Some((out, removed)) => {
                    for n in ["docProps/custom.xml", "word/document.xml"] {
                        assert_eq!(raw(&input, n), raw(&out, n), "{} {}", path, n);
                    }
                    assert!(scrub_bytes(&out, HUMANORIGIN_ADDIN_IDS).unwrap().is_none());
                    println!("{} : retiré {:?}", path, removed);
                }
            }
        }
    }
}
