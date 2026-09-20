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

// ---------------------------------------------------------------- orchestration
/// Enchaîne le stockage de la capability et la création du document, dans cet ordre.
///
/// Les trois opérations sont INJECTÉES : c'est la seule raison d'être de cette fonction.
/// Le chemin de production lui passe `stocker`, la création réelle, et `oublier` — donc
/// le trousseau du système. Les tests lui passent des doublures et peuvent enfin observer
/// ce qui est appelé, et dans quel ordre.
///
/// Invariants, couverts par les tests de ce module :
///   trousseau en échec        -> la création n'est JAMAIS tentée, rien n'est retiré
///   création en échec         -> l'entrée de CETTE tentative est retirée, une seule fois
///   les deux réussissent      -> rien n'est retiré
///
/// Aucune valeur de capability ne transite par un message d'erreur.
pub fn creer_document_avec_capability<S, B, D>(
    record_id: &str,
    capability: &str,
    stocker_cap: S,
    creer_document: B,
    oublier_cap: D,
) -> Result<serde_json::Value, String>
where
    S: FnOnce(&str, &str) -> Result<(), String>,
    B: FnOnce(&str) -> Result<serde_json::Value, String>,
    D: FnOnce(&str),
{
    // Trousseau d'abord : un document portant un identifiant dont la capability n'a pas pu
    // être conservée serait impubliable, et il le serait en silence.
    stocker_cap(record_id, capability)?;
    match creer_document(record_id) {
        Ok(v) => Ok(v),
        Err(e) => {
            oublier_cap(record_id);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    /// Journal des appels. Aucune valeur de capability n'y entre : on n'observe que les
    /// gestes, jamais le secret.
    #[derive(Default)]
    struct Journal {
        stocke: RefCell<u32>,
        cree: RefCell<u32>,
        oublie: RefCell<u32>,
        ordre: RefCell<Vec<&'static str>>,
    }

    const ID: &str = "HO-TESTORCHESTR1";
    const CAP: &str = "Y2FwYWJpbGl0eS1kZS10ZXN0LXNhbnMtdmFsZXVy";

    #[test]
    fn trousseau_en_echec_aucun_document_cree() {
        let j = Journal::default();
        let r = super::creer_document_avec_capability(
            ID, CAP,
            |_, _| { *j.stocke.borrow_mut() += 1; j.ordre.borrow_mut().push("stocke");
                     Err("trousseau indisponible".into()) },
            |_| { *j.cree.borrow_mut() += 1; j.ordre.borrow_mut().push("cree");
                  Ok(serde_json::json!({})) },
            |_| { *j.oublie.borrow_mut() += 1; j.ordre.borrow_mut().push("oublie"); },
        );
        assert!(r.is_err(), "l'échec remonte");
        assert_eq!(*j.cree.borrow(), 0, "la création n'est JAMAIS tentée");
        assert_eq!(*j.oublie.borrow(), 0, "rien à retirer : rien n'a été écrit");
        assert_eq!(*j.ordre.borrow(), vec!["stocke"]);
    }

    #[test]
    fn creation_en_echec_la_capability_est_retiree_une_fois() {
        let j = Journal::default();
        let r = super::creer_document_avec_capability(
            ID, CAP,
            |_, _| { *j.stocke.borrow_mut() += 1; j.ordre.borrow_mut().push("stocke"); Ok(()) },
            |_| { *j.cree.borrow_mut() += 1; j.ordre.borrow_mut().push("cree");
                  Err("le document n'a pas pu être créé".into()) },
            |_| { *j.oublie.borrow_mut() += 1; j.ordre.borrow_mut().push("oublie"); },
        );
        assert!(r.is_err());
        assert_eq!(*j.oublie.borrow(), 1, "retirée exactement une fois");
        assert_eq!(*j.ordre.borrow(), vec!["stocke", "cree", "oublie"], "ordre respecté");
    }

    #[test]
    fn succes_la_capability_est_conservee() {
        let j = Journal::default();
        let r = super::creer_document_avec_capability(
            ID, CAP,
            |_, _| { *j.stocke.borrow_mut() += 1; Ok(()) },
            |_| { *j.cree.borrow_mut() += 1; Ok(serde_json::json!({ "name": "x.docx" })) },
            |_| { *j.oublie.borrow_mut() += 1; },
        );
        assert!(r.is_ok());
        assert_eq!(*j.oublie.borrow(), 0, "rien n'est retiré quand tout réussit");
        assert_eq!((*j.stocke.borrow(), *j.cree.borrow()), (1, 1));
    }

    #[test]
    fn l_identifiant_transmis_est_celui_reserve() {
        let vu = RefCell::new(String::new());
        let _ = super::creer_document_avec_capability(
            ID, CAP,
            |_, _| Ok(()),
            |id| { *vu.borrow_mut() = id.to_string(); Ok(serde_json::json!({})) },
            |_| {},
        );
        assert_eq!(*vu.borrow(), ID, "la création reçoit l'identifiant réservé");
    }

    #[test]
    fn aucune_capability_dans_un_message_d_erreur() {
        let r = super::creer_document_avec_capability(
            ID, CAP,
            |_, _| Ok(()),
            |_| Err("le document n'a pas pu être créé : disque plein".into()),
            |_| {},
        );
        let msg = r.unwrap_err();
        assert!(!msg.contains(CAP), "la capability n'entre dans aucun message");
    }

    #[test]
    fn les_formes_sont_controlees_avant_tout_acces() {
        assert!(super::record_id_valide("HO-ABCDEFGHIJKL"));
        assert!(!super::record_id_valide("court"));
        assert!(!super::record_id_valide("HO-avec espace"));
        assert!(!super::record_id_valide(&"a".repeat(65)));
        assert!(super::capability_plausible(CAP));
        assert!(!super::capability_plausible("court"));
        assert!(!super::capability_plausible("avec.des.points"));
        assert!(!super::capability_plausible(&"a".repeat(8193)));
    }
}
