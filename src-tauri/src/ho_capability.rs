//! Capability d'écriture au registre : stockage local, et rien d'autre.
//!
//! La capability est le seul justificatif qui autorise la publication d'un Record. Elle
//! ne doit JAMAIS apparaître dans le document, dans HOLocator, dans HOFacts, dans le
//! Record, dans un journal, dans un message d'erreur ni dans une télémétrie.
//!
//! Elle vit uniquement dans le trousseau du système, sous un service dédié. Le jeton de
//! session Supabase, lui, ne descend jamais jusqu'ici : seul le couple
//! { record_id, capability } traverse la frontière native.
//!
//! Service et compte : `humanorigin.registry-write.v1` / `<record_id>`. Service distinct
//! de celui des brouillons (`humanorigin` / `ho_draft_key_v1`) : une entrée par Record,
//! aucun mélange avec le matériel existant.

use keyring::Entry;

const SERVICE: &str = "humanorigin.registry-write.v1";

/// Forme acceptée : celle du registre. Contrôlée avant tout accès au trousseau.
pub fn record_id_valide(id: &str) -> bool {
    (6..=64).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Forme acceptée du transport compact. On ne déchiffre pas la capability ici : le
/// registre seul la vérifie. On refuse seulement ce qui ne peut pas en être une.
pub fn capability_plausible(cap: &str) -> bool {
    (16..=8192).contains(&cap.len())
        && cap.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn entree(record_id: &str) -> Result<Entry, String> {
    // Message volontairement sans détail : il peut remonter à l'interface.
    Entry::new(SERVICE, record_id).map_err(|_| "trousseau indisponible".to_string())
}

/// Écrit la capability. Aucun journal, aucun retour de la valeur.
pub fn stocker(record_id: &str, capability: &str) -> Result<(), String> {
    if !record_id_valide(record_id) {
        return Err("identifiant réservé invalide".into());
    }
    if !capability_plausible(capability) {
        return Err("capability invalide".into());
    }
    entree(record_id)?
        .set_password(capability)
        .map_err(|_| "la capability n'a pas pu être enregistrée".to_string())
}

/// Relit la capability. `None` si elle est absente : au finalizer de décider.
pub fn lire(record_id: &str) -> Option<String> {
    if !record_id_valide(record_id) {
        return None;
    }
    let c = entree(record_id).ok()?.get_password().ok()?;
    if capability_plausible(&c) { Some(c) } else { None }
}

/// Retire l'entrée. Au mieux : l'absence n'est pas une erreur.
pub fn oublier(record_id: &str) {
    if !record_id_valide(record_id) {
        return;
    }
    if let Ok(e) = entree(record_id) {
        let _ = e.delete_password();
    }
}
