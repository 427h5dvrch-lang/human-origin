//! evidence_kernel.rs — Vocabulaire V2 media-agnostic (READ-ONLY, NON câblé au runtime).
//!
//! Objectif (V2-M2) : figer des *types de vocabulaire* pour un futur noyau de preuve
//! généralisable (PDF, image, vidéo, audio, code) SANS toucher au moteur V1.
//!
//! Garanties de ce module :
//! - Il ne modifie AUCUNE structure signée existante (WorkCertificate, PublicCoreEvidence,
//!   ObservationPeriod, PackageManifest ne sont pas importés ni touchés).
//! - Il n'est appelé par AUCUNE commande Tauri, AUCUNE UI, AUCUN chemin de publication.
//! - Le simple `mod evidence_kernel;` ne fait que compiler ce fichier : aucun code ne
//!   s'exécute tant qu'aucun appelant ne l'invoque → comportement runtime inchangé.
//! - `serde` n'est dérivé QUE sur ces nouveaux types non branchés.
//! - Les `Option` respectent déjà la règle HO-JSON V2 : `skip_serializing_if = "Option::is_none"`
//!   (voir docs/v2/V2_HO_JSON_V2_COMPATIBILITY_SPEC.md).
//!
//! Ce module est volontairement inerte : ses types sont du vocabulaire, pas du comportement.

#![allow(dead_code)] // Types de vocabulaire V2 : aucun appelant runtime en V2-M2 (attendu).

use serde::{Deserialize, Serialize};

/// Numéro de schéma du futur HO-JSON V2 (distinct de `CertificateVersion::V2`, qui est un
/// marqueur de chaînage). Ici purement documentaire ; non écrit dans aucun certificat.
pub const HO_JSON_V2_SCHEMA_VERSION: u32 = 2;

/// Claim canonique autorisé (rappel de vocabulaire, non affiché par ce module).
pub const OBSERVED_WORK_CLAIM_FR: &str = "Travail observé — preuve locale signée";
pub const OBSERVED_WORK_CLAIM_EN: &str = "Observed work — locally signed proof";

/// Type de média d'un objet observé.
///
/// Le PDF actuel correspond à `MediaKind::Pdf`. Les autres variantes préparent la roadmap
/// multimodale (image → vidéo → audio → code) sans qu'aucune ne soit encore implémentée.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Pdf,
    Document,
    Image,
    Video,
    Audio,
    Code,
    /// Échappatoire pour un média non encore modélisé. La valeur est normalisée par `label()`.
    Other(String),
}

impl MediaKind {
    /// Étiquette stable, minuscule, sûre à afficher/loguer (jamais de contenu média).
    pub fn label(&self) -> String {
        match self {
            MediaKind::Pdf => "pdf".to_string(),
            MediaKind::Document => "document".to_string(),
            MediaKind::Image => "image".to_string(),
            MediaKind::Video => "video".to_string(),
            MediaKind::Audio => "audio".to_string(),
            MediaKind::Code => "code".to_string(),
            MediaKind::Other(raw) => {
                let cleaned = raw.trim().to_lowercase();
                if cleaned.is_empty() {
                    "other".to_string()
                } else {
                    cleaned
                }
            }
        }
    }
}

/// Référence stable d'un objet observé (media-agnostic).
///
/// Ne contient JAMAIS de chemin local ni de contenu : seulement un identifiant, le type de
/// média, un nom d'affichage local optionnel et un drapeau de confidentialité.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObservedObjectRef {
    /// Identifiant stable de l'objet (opaque ; jamais un chemin de fichier).
    pub object_id: String,
    /// Type de média.
    pub media_type: MediaKind,
    /// Nom d'affichage local optionnel (non probant). Absent de la sérialisation si `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_display_name: Option<String>,
    /// Confidentialité du contenu. Par défaut `true` (le contenu ne sort jamais).
    pub content_private: bool,
}

impl ObservedObjectRef {
    /// Constructeur sûr : `content_private = true` par défaut, aucun nom local exposé.
    pub fn new(object_id: impl Into<String>, media_type: MediaKind) -> Self {
        Self {
            object_id: object_id.into(),
            media_type,
            local_display_name: None,
            content_private: true,
        }
    }
}

/// Référence d'une version d'objet (empreinte + métadonnées minimales).
///
/// Aucun chemin local. `fingerprint_sha256` est l'empreinte du contenu ; les métadonnées
/// optionnelles suivent la règle HO-JSON V2 (absentes si `None`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectVersionRef {
    /// Empreinte SHA256 hex du contenu de cette version.
    pub fingerprint_sha256: String,
    /// Taille en octets, optionnelle. Absente de la sérialisation si `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// Type MIME, optionnel. Absent de la sérialisation si `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Placeholder de métadonnées propres à un média (namespace `media_specific`).
///
/// Volontairement inutilisé en V2-M2 : les métadonnées perceptuelles (image/audio),
/// de séquence (vidéo), etc. seront modélisées ici lors d'un ticket ultérieur (V2-M5+).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaSpecificMetadata {
    /// Aucune métadonnée spécifique (cas par défaut, y compris PDF actuel).
    Unspecified,
}

impl Default for MediaSpecificMetadata {
    fn default() -> Self {
        MediaSpecificMetadata::Unspecified
    }
}

// ---------------------------------------------------------------------------
// V2-M3B : interface cible DocumentAdapter (READ-ONLY, NON câblée au runtime).
//
// Ces types formalisent la frontière déjà présente sous forme de closures dans
// `work_publish.rs::create_labeled_package_inner` :
//   - `cartouche_fn`      (FnOnce(&WorkCertificate, &Path))         → marquage
//   - `generate_pdf_fn`   (FnOnce(&Path, &Path, &Path, …))          → rendu labellisé
//   - `make_package_fn`   (FnOnce(&Path, &Path) -> PackageManifest) → reflété PARTIELLEMENT
//     (le nom d'artefact `default_artifact_filename` correspond à `LABELED_PDF_FILENAME`).
//
// IMPORTANT :
//   - Ce trait n'est PAS câblé en V2-M3B : aucune closure de production n'est
//     modifiée, `work_publish.rs` reste intact, le comportement PDF est inchangé.
//   - Le trait exprime l'INTERFACE cible ; il n'implémente aucun rendu.
//   - Il ne dépend NI de `publication_core.rs`, NI de PDFium, NI de `work_publish.rs`,
//     NI d'aucun chemin runtime (la requête est media-agnostic, sans `Path`).
//   - Le rebranchement réel (remplacer les closures par une impl de ce trait) sera
//     V2-M3C, avec cold test publication PDF complet (multipage, paysage, contenu
//     conservé, cartouche B4 inchangée, manifest inchangé).
// ---------------------------------------------------------------------------

/// Type de l'artefact *rendu/labellisé* produit en SORTIE par un `DocumentAdapter`.
///
/// À distinguer de [`MediaKind`], qui décrit le média de l'objet observé en ENTRÉE.
/// Aujourd'hui, le seul rendu réel est `Pdf` (via `publish_pdf_core`) ; les autres
/// variantes préparent la roadmap sans qu'aucune ne soit implémentée.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentArtifactKind {
    Pdf,
    Image,
    Video,
    Audio,
    Code,
    /// Échappatoire pour un artefact non encore modélisé (normalisé par `label()`).
    Other(String),
}

impl DocumentArtifactKind {
    /// Étiquette stable, minuscule, sûre à afficher/loguer.
    pub fn label(&self) -> String {
        match self {
            DocumentArtifactKind::Pdf => "pdf".to_string(),
            DocumentArtifactKind::Image => "image".to_string(),
            DocumentArtifactKind::Video => "video".to_string(),
            DocumentArtifactKind::Audio => "audio".to_string(),
            DocumentArtifactKind::Code => "code".to_string(),
            DocumentArtifactKind::Other(raw) => {
                let cleaned = raw.trim().to_lowercase();
                if cleaned.is_empty() {
                    "other".to_string()
                } else {
                    cleaned
                }
            }
        }
    }
}

/// Référence d'un artefact labellisé produit par un adaptateur (media-agnostic).
///
/// Ne contient JAMAIS de chemin local : seulement un nom d'artefact relatif, son
/// type, et des empreintes/métadonnées optionnelles (règle HO-JSON V2 : absentes
/// si `None`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderedArtifactRef {
    /// Nom relatif de l'artefact (ex. `labeled_document.pdf`). Jamais un chemin absolu.
    pub artifact_name: String,
    /// Type de l'artefact rendu.
    pub media_type: DocumentArtifactKind,
    /// Empreinte SHA256 hex de l'artefact, optionnelle. Absente si `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint_sha256: Option<String>,
    /// Taille en octets, optionnelle. Absente si `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// Type MIME, optionnel. Absent si `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

/// Requête conceptuelle de rendu d'un artefact labellisé (placeholder V2-M3B).
///
/// Reflète, de façon media-agnostic et SANS aucun `Path`, les paramètres que
/// `generate_pdf_fn` reçoit aujourd'hui (source, id de certificat, URL de
/// vérification, libellé de verdict). Volontairement dépourvue de tout type
/// PDFium ou chemin runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LabeledArtifactRequest {
    /// Objet observé source.
    pub source_object: ObservedObjectRef,
    /// Version source à labelliser.
    pub source_version: ObjectVersionRef,
    /// Identifiant du certificat lié.
    pub certificate_id: String,
    /// URL publique de vérification (encodée dans le marquage/QR).
    pub verify_url: String,
    /// Libellé de verdict (ex. `OBSERVED_WORK_CONSISTENT`).
    pub verdict_label: String,
}

/// Interface cible d'un adaptateur de rendu document/média (NON câblée en V2-M3B).
///
/// Une future implémentation `PdfDocumentAdapter` regroupera les closures
/// `cartouche_fn` + `generate_pdf_fn` de `work_publish.rs` ; le nom d'artefact
/// (`default_artifact_filename`) correspondra à `LABELED_PDF_FILENAME`. Aucune
/// implémentation de production n'existe ni n'est appelée à ce stade.
pub trait DocumentAdapter {
    /// Nom court de l'adaptateur (diagnostic).
    fn adapter_name(&self) -> &'static str;

    /// Type d'artefact produit par cet adaptateur.
    fn artifact_kind(&self) -> DocumentArtifactKind;

    /// Nom de fichier par défaut de l'artefact labellisé (ex. `labeled_document.pdf`).
    fn default_artifact_filename(&self) -> &'static str;

    /// Produit l'artefact labellisé (reflète `cartouche_fn` + `generate_pdf_fn`).
    ///
    /// Signature placeholder : aucune implémentation de rendu n'est fournie ici.
    /// Le rebranchement réel viendra en V2-M3C.
    fn render_labeled_artifact(
        &self,
        request: &LabeledArtifactRequest,
    ) -> Result<RenderedArtifactRef, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_kind_labels() {
        assert_eq!(MediaKind::Pdf.label(), "pdf");
        assert_eq!(MediaKind::Document.label(), "document");
        assert_eq!(MediaKind::Image.label(), "image");
        assert_eq!(MediaKind::Video.label(), "video");
        assert_eq!(MediaKind::Audio.label(), "audio");
        assert_eq!(MediaKind::Code.label(), "code");
        // Other est normalisé (trim + lowercase) et retombe sur "other" si vide.
        assert_eq!(MediaKind::Other("Markdown".into()).label(), "markdown");
        assert_eq!(MediaKind::Other("   ".into()).label(), "other");
    }

    #[test]
    fn media_kind_serde_roundtrip() {
        let s = serde_json::to_string(&MediaKind::Pdf).unwrap();
        assert_eq!(s, "\"pdf\"");
        let back: MediaKind = serde_json::from_str(&s).unwrap();
        assert_eq!(back, MediaKind::Pdf);
    }

    #[test]
    fn observed_object_defaults_to_private() {
        let o = ObservedObjectRef::new("obj-1", MediaKind::Pdf);
        assert!(o.content_private, "content_private doit défaut à true");
        assert_eq!(o.media_type, MediaKind::Pdf);
        assert!(o.local_display_name.is_none());
    }

    #[test]
    fn none_options_are_not_serialized_as_null() {
        // Règle dure HO-JSON V2 : Option::None ne doit produire NI le champ NI "null".
        let o = ObservedObjectRef::new("obj-1", MediaKind::Pdf);
        let json = serde_json::to_string(&o).unwrap();
        assert!(!json.contains("local_display_name"), "None ne doit pas être sérialisé");
        assert!(!json.contains("null"), "aucun null ne doit apparaître");

        let v = ObjectVersionRef {
            fingerprint_sha256: "a".repeat(64),
            size_bytes: None,
            mime_type: None,
        };
        let vj = serde_json::to_string(&v).unwrap();
        assert!(!vj.contains("size_bytes"));
        assert!(!vj.contains("mime_type"));
        assert!(!vj.contains("null"));
    }

    #[test]
    fn represents_pdf_now_and_image_future_without_local_path() {
        // Cas PDF actuel.
        let pdf = ObservedObjectRef::new("work-123", MediaKind::Pdf);
        let pdf_v = ObjectVersionRef {
            fingerprint_sha256: "b".repeat(64),
            size_bytes: Some(1024),
            mime_type: Some("application/pdf".into()),
        };
        // Cas image future.
        let img = ObservedObjectRef::new("obj-img-9", MediaKind::Image);
        let img_v = ObjectVersionRef {
            fingerprint_sha256: "c".repeat(64),
            size_bytes: Some(4096),
            mime_type: Some("image/png".into()),
        };

        // Aucun chemin local ne doit apparaître dans une quelconque sérialisation.
        for json in [
            serde_json::to_string(&pdf).unwrap(),
            serde_json::to_string(&img).unwrap(),
            serde_json::to_string(&pdf_v).unwrap(),
            serde_json::to_string(&img_v).unwrap(),
        ] {
            assert!(!json.contains("path"), "aucun chemin local ne doit être exposé");
            assert!(!json.contains("/Users/"), "aucun chemin absolu ne doit fuiter");
        }

        assert_eq!(pdf.media_type.label(), "pdf");
        assert_eq!(img.media_type.label(), "image");
    }

    #[test]
    fn media_specific_metadata_default_is_unspecified() {
        assert_eq!(MediaSpecificMetadata::default(), MediaSpecificMetadata::Unspecified);
    }

    // --- V2-M3B : DocumentAdapter (trait non câblé, vérifié uniquement en test) ---

    /// Adaptateur factice PDF, présent UNIQUEMENT en test : prouve que le trait
    /// compile et se comporte, sans toucher au vrai package ni à PDFium.
    struct FakePdfAdapter;
    impl DocumentAdapter for FakePdfAdapter {
        fn adapter_name(&self) -> &'static str {
            "fake-pdf"
        }
        fn artifact_kind(&self) -> DocumentArtifactKind {
            DocumentArtifactKind::Pdf
        }
        fn default_artifact_filename(&self) -> &'static str {
            "labeled_document.pdf"
        }
        fn render_labeled_artifact(
            &self,
            _request: &LabeledArtifactRequest,
        ) -> Result<RenderedArtifactRef, String> {
            Ok(RenderedArtifactRef {
                artifact_name: self.default_artifact_filename().to_string(),
                media_type: self.artifact_kind(),
                fingerprint_sha256: Some("d".repeat(64)),
                size_bytes: Some(2048),
                mime_type: Some("application/pdf".to_string()),
            })
        }
    }

    /// Adaptateur factice image FUTUR : prouve qu'un autre média est représentable
    /// sans aucun chemin local.
    struct FakeImageAdapter;
    impl DocumentAdapter for FakeImageAdapter {
        fn adapter_name(&self) -> &'static str {
            "fake-image"
        }
        fn artifact_kind(&self) -> DocumentArtifactKind {
            DocumentArtifactKind::Image
        }
        fn default_artifact_filename(&self) -> &'static str {
            "labeled_image.png"
        }
        fn render_labeled_artifact(
            &self,
            _request: &LabeledArtifactRequest,
        ) -> Result<RenderedArtifactRef, String> {
            Ok(RenderedArtifactRef {
                artifact_name: self.default_artifact_filename().to_string(),
                media_type: self.artifact_kind(),
                fingerprint_sha256: None,
                size_bytes: None,
                mime_type: None,
            })
        }
    }

    fn sample_request(object_id: &str, media: MediaKind, mime: &str) -> LabeledArtifactRequest {
        LabeledArtifactRequest {
            source_object: ObservedObjectRef::new(object_id, media),
            source_version: ObjectVersionRef {
                fingerprint_sha256: "e".repeat(64),
                size_bytes: Some(10),
                mime_type: Some(mime.to_string()),
            },
            certificate_id: "cert-1".to_string(),
            verify_url: "https://verify.humanorigin.app/r/x".to_string(),
            verdict_label: "OBSERVED_WORK_CONSISTENT".to_string(),
        }
    }

    #[test]
    fn document_artifact_kind_labels() {
        assert_eq!(DocumentArtifactKind::Pdf.label(), "pdf");
        assert_eq!(DocumentArtifactKind::Image.label(), "image");
        assert_eq!(DocumentArtifactKind::Video.label(), "video");
        assert_eq!(DocumentArtifactKind::Audio.label(), "audio");
        assert_eq!(DocumentArtifactKind::Code.label(), "code");
        assert_eq!(DocumentArtifactKind::Other("ZIP".into()).label(), "zip");
        assert_eq!(DocumentArtifactKind::Other("  ".into()).label(), "other");
    }

    #[test]
    fn rendered_artifact_ref_skips_none_options() {
        let r = RenderedArtifactRef {
            artifact_name: "labeled_document.pdf".to_string(),
            media_type: DocumentArtifactKind::Pdf,
            fingerprint_sha256: None,
            size_bytes: None,
            mime_type: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("fingerprint_sha256"));
        assert!(!json.contains("size_bytes"));
        assert!(!json.contains("mime_type"));
        assert!(!json.contains("null"));
    }

    #[test]
    fn fake_pdf_adapter_returns_labeled_document_pdf() {
        let a = FakePdfAdapter;
        assert_eq!(a.adapter_name(), "fake-pdf");
        assert_eq!(a.artifact_kind(), DocumentArtifactKind::Pdf);
        assert_eq!(a.default_artifact_filename(), "labeled_document.pdf");

        let req = sample_request("work-1", MediaKind::Pdf, "application/pdf");
        let out = a.render_labeled_artifact(&req).unwrap();
        // Le fake renvoie bien le nom d'artefact PDF, sans toucher au vrai package.
        assert_eq!(out.artifact_name, "labeled_document.pdf");
        assert_eq!(out.media_type, DocumentArtifactKind::Pdf);
    }

    #[test]
    fn future_image_adapter_representable_without_local_path() {
        let a = FakeImageAdapter;
        assert_eq!(a.artifact_kind().label(), "image");

        let req = sample_request("obj-img-9", MediaKind::Image, "image/png");
        let out = a.render_labeled_artifact(&req).unwrap();

        // Sérialisations : aucun chemin local, aucun null pour les Option None.
        let out_json = serde_json::to_string(&out).unwrap();
        let req_json = serde_json::to_string(&req).unwrap();
        for json in [out_json, req_json] {
            assert!(!json.contains("path"), "aucun chemin local ne doit être exposé");
            assert!(!json.contains("/Users/"), "aucun chemin absolu ne doit fuiter");
        }
        // fingerprint/size/mime None -> non sérialisés.
        let out_only = serde_json::to_string(&out).unwrap();
        assert!(!out_only.contains("null"));
        assert_eq!(out.artifact_name, "labeled_image.png");
    }
}
