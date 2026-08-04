//! work_cartouche — Générateur de cartouche Work native (Commit 6E-1).
//!
//! Portée STRICTE : construire un SVG de cartouche Work (wording conservateur,
//! path-free) et le rasteriser en PNG via resvg (déjà dépendance). QR généré en
//! Rust (`qrcode`). AUCUNE commande Tauri, AUCUNE UI, AUCUN PDF, AUCUN package.
//! Ne touche NI `publication_core.rs`, NI la cartouche legacy (`tools/`), NI
//! `render_svg_to_png` (on ne fait que réemployer la même API resvg ici).
//!
//! Wording autorisé UNIQUEMENT : HumanOrigin · Travail observé ·
//! OBSERVED_WORK_CONSISTENT / OBSERVED_WORK_WITH_GAPS · Certificat local signé ·
//! Identité : LOCAL_DEVICE · ID · Vérifier. Aucun claim (INCOMPLETE,
//! Biological Origin Record, HUMAN PROCESS PROOF, NO_AI, HUMAN_PROVEN,
//! AUTHENTIC, GUARANTEED, AUTHORSHIP, ORIGINAL, « 100% human », « absence d'IA »).

// Fondation (6E-1) : générateur consommé par l'orchestration package au 6E-2.
#![allow(dead_code)]

use qrcode::{Color, QrCode};
use resvg::render;
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{Options, Tree};
use std::fs;
use std::path::Path;

// Dimensions du viewBox : 780×240 unités = ~78×24 mm (10 u/mm).
const VIEW_W: u32 = 780;
const VIEW_H: u32 = 240;
/// Facteur de rendu PNG (crispness). PNG = 1560×480.
const PNG_SCALE: u32 = 2;

const NAVY: &str = "#14233a";
const CREAM: &str = "#f8f4ec";
const WHITE: &str = "#ffffff";

const VERDICT_CONSISTENT: &str = "OBSERVED_WORK_CONSISTENT";
const VERDICT_WITH_GAPS: &str = "OBSERVED_WORK_WITH_GAPS";
const LOCAL_DEVICE: &str = "LOCAL_DEVICE";

/// Entrées path-free de la cartouche Work.
pub(crate) struct WorkCartoucheInputs {
    pub certificate_id: String,
    /// Doit valoir `OBSERVED_WORK_CONSISTENT` ou `OBSERVED_WORK_WITH_GAPS`.
    pub verdict: String,
    /// Doit valoir `LOCAL_DEVICE`.
    pub identity_status: String,
    /// URL publique http(s) encodée dans le QR.
    pub verify_url: String,
    pub signing_key_id: Option<String>,
    pub created_at: Option<String>,
}

/// URL strictement publique (http/https, jamais un chemin local).
fn is_public_url(url: &str) -> bool {
    if url.is_empty() || url.starts_with("file://") || url.contains("/Users/") {
        return false;
    }
    url.starts_with("http://") || url.starts_with("https://")
}

/// 8 premiers caractères alphanumériques du certificate_id, en majuscules.
fn id_short(certificate_id: &str) -> String {
    certificate_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_uppercase()
}

fn verdict_color(verdict: &str) -> &'static str {
    if verdict == VERDICT_WITH_GAPS {
        "#b45309" // ambre
    } else {
        "#0f7a52" // vert
    }
}

/// QR (encodant `verify_url`) rendu en `<rect>` SVG. Renvoie (fond_blanc, modules).
fn build_qr_rects(verify_url: &str, x: f64, y: f64, size: f64) -> Result<String, String> {
    let code = QrCode::new(verify_url.as_bytes()).map_err(|e| format!("QR: {e}"))?;
    let n = code.width();
    if n == 0 {
        return Err("QR vide".to_string());
    }
    let colors = code.to_colors();
    let module = size / n as f64;
    // Fond blanc du QR (lisibilité + zone de silence visuelle).
    let mut svg = format!(
        r#"<rect x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" fill="{}"/>"#,
        x - 6.0,
        y - 6.0,
        size + 12.0,
        size + 12.0,
        WHITE
    );
    for row in 0..n {
        for col in 0..n {
            if matches!(colors[row * n + col], Color::Dark) {
                let rx = x + col as f64 * module;
                let ry = y + row as f64 * module;
                svg.push_str(&format!(
                    r#"<rect class="qrmod" x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" fill="{}"/>"#,
                    rx,
                    ry,
                    module.ceil(),
                    module.ceil(),
                    NAVY
                ));
            }
        }
    }
    Ok(svg)
}

/// Construit le SVG de la cartouche Work (validation stricte des entrées).
pub(crate) fn build_work_cartouche_svg(inputs: &WorkCartoucheInputs) -> Result<String, String> {
    if inputs.identity_status != LOCAL_DEVICE {
        return Err("identity_status doit être LOCAL_DEVICE".to_string());
    }
    if inputs.verdict != VERDICT_CONSISTENT && inputs.verdict != VERDICT_WITH_GAPS {
        return Err("verdict non autorisé".to_string());
    }
    if !is_public_url(&inputs.verify_url) {
        return Err("verify_url doit être une URL publique http(s)".to_string());
    }

    let ids = id_short(&inputs.certificate_id);
    let vcolor = verdict_color(&inputs.verdict);

    // QR à gauche.
    let qr_size = 176.0;
    let qr_x = 32.0;
    let qr_y = 28.0;
    let qr = build_qr_rects(&inputs.verify_url, qr_x, qr_y, qr_size)?;
    let qr_center = qr_x + qr_size / 2.0;

    // Colonne texte à droite.
    let tx = 250.0;

    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <style>
    .brand{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-weight:800;fill:{NAVY};font-size:30px;}}
    .line{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-weight:600;fill:{NAVY};font-size:15px;}}
    .status{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-weight:800;font-size:14px;letter-spacing:0.03em;}}
    .idmono{{font-family:Menlo,Consolas,monospace;font-weight:700;fill:{NAVY};font-size:14px;letter-spacing:0.06em;}}
    .verify{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-weight:700;fill:{NAVY};font-size:12px;letter-spacing:0.14em;}}
  </style>
  <rect x="3" y="3" width="{WB}" height="{HB}" rx="16" fill="{CREAM}" stroke="{NAVY}" stroke-width="2"/>
  {QR}
  <text x="{QC:.1}" y="{QY:.1}" text-anchor="middle" class="verify">Vérifier</text>
  <text x="{TX}" y="66" class="brand">HumanOrigin</text>
  <text x="{TX}" y="98" class="line">Travail observé</text>
  <text x="{TX}" y="128" class="status" fill="{VC}">{VERDICT}</text>
  <text x="{TX}" y="158" class="line">Certificat local signé</text>
  <text x="{TX}" y="186" class="line">Identité : {LOCAL}</text>
  <text x="{TX}" y="214" class="idmono">ID {IDS}</text>
</svg>"##,
        W = VIEW_W,
        H = VIEW_H,
        WB = VIEW_W - 6,
        HB = VIEW_H - 6,
        NAVY = NAVY,
        CREAM = CREAM,
        QR = qr,
        QC = qr_center,
        QY = qr_y + qr_size + 22.0,
        TX = tx,
        VC = vcolor,
        VERDICT = inputs.verdict,
        LOCAL = LOCAL_DEVICE,
        IDS = ids,
    );
    Ok(svg)
}

/// Rasterise la cartouche Work en PNG (resvg / tiny_skia). Écrit `out_path`.
pub(crate) fn render_work_cartouche_png(
    inputs: &WorkCartoucheInputs,
    out_path: &Path,
) -> Result<(), String> {
    let svg = build_work_cartouche_svg(inputs)?;

    let mut opt = Options::default();
    opt.fontdb_mut().load_system_fonts();
    let tree = Tree::from_str(&svg, &opt).map_err(|e| format!("SVG parse error: {e}"))?;

    let target_w = VIEW_W * PNG_SCALE;
    let target_h = VIEW_H * PNG_SCALE;
    let mut pixmap =
        Pixmap::new(target_w, target_h).ok_or_else(|| "Failed to create pixmap".to_string())?;
    let transform = Transform::from_scale(PNG_SCALE as f32, PNG_SCALE as f32);
    render(&tree, transform, &mut pixmap.as_mut());

    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Create dir error: {e}"))?;
    }
    pixmap
        .save_png(out_path)
        .map_err(|e| format!("Save PNG error: {e}"))?;

    let meta = fs::metadata(out_path).map_err(|e| e.to_string())?;
    if meta.len() == 0 {
        return Err("PNG vide".to_string());
    }
    Ok(())
}

// --- TESTS UNITAIRES ----------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use uuid::Uuid;

    const URL: &str = "https://verify.humanorigin.app/r/abc123";

    fn inputs(verdict: &str, identity: &str, url: &str) -> WorkCartoucheInputs {
        WorkCartoucheInputs {
            certificate_id: "1405deef-d819-42e2-856b-8c7bd21d3a0e".to_string(),
            verdict: verdict.to_string(),
            identity_status: identity.to_string(),
            verify_url: url.to_string(),
            signing_key_id: Some("abcd1234".to_string()),
            created_at: Some("2026-08-04T10:00:00Z".to_string()),
        }
    }

    fn ok_svg() -> String {
        build_work_cartouche_svg(&inputs(VERDICT_CONSISTENT, "LOCAL_DEVICE", URL)).unwrap()
    }

    #[test]
    fn test_1_svg_contient_wording_autorise() {
        let s = ok_svg();
        assert!(s.contains("HumanOrigin"));
        assert!(s.contains("Travail observé"));
        assert!(s.contains("Certificat local signé"));
        assert!(s.contains("Identité : LOCAL_DEVICE"));
        assert!(s.contains("Vérifier"));
        assert!(s.contains("ID 1405DEEF"), "ID court attendu");
    }

    #[test]
    fn test_2_verdict_consistent() {
        assert!(ok_svg().contains(VERDICT_CONSISTENT));
    }

    #[test]
    fn test_3_verdict_gaps() {
        let s = build_work_cartouche_svg(&inputs(VERDICT_WITH_GAPS, "LOCAL_DEVICE", URL)).unwrap();
        assert!(s.contains(VERDICT_WITH_GAPS));
    }

    #[test]
    fn test_4_aucun_token_interdit() {
        let s = ok_svg();
        for tok in [
            "INCOMPLETE",
            "Biological Origin Record",
            "HUMAN PROCESS PROOF",
            "NO_AI",
            "HUMAN_PROVEN",
            "AUTHENTIC",
            "GUARANTEED",
            "AUTHORSHIP",
            "ORIGINAL",
            "100% human",
            "absence d'IA",
        ] {
            assert!(!s.contains(tok), "token interdit présent : {tok}");
        }
    }

    #[test]
    fn test_5_pas_de_users() {
        assert!(!ok_svg().contains("/Users/"));
    }

    #[test]
    fn test_6_pas_de_document_path() {
        assert!(!ok_svg().contains("document_path"));
    }

    #[test]
    fn test_7_pas_de_engine() {
        assert!(!ok_svg().contains("engine"));
    }

    #[test]
    fn test_8_verify_url_non_public_err() {
        assert!(build_work_cartouche_svg(&inputs(
            VERDICT_CONSISTENT,
            "LOCAL_DEVICE",
            "pas-une-url"
        ))
        .is_err());
        assert!(build_work_cartouche_svg(&inputs(VERDICT_CONSISTENT, "LOCAL_DEVICE", "")).is_err());
        assert!(
            build_work_cartouche_svg(&inputs(VERDICT_CONSISTENT, "LOCAL_DEVICE", "ftp://x/y"))
                .is_err()
        );
    }

    #[test]
    fn test_9_file_url_err() {
        assert!(build_work_cartouche_svg(&inputs(
            VERDICT_CONSISTENT,
            "LOCAL_DEVICE",
            "file:///tmp/x"
        ))
        .is_err());
    }

    #[test]
    fn test_10_users_dans_verify_url_err() {
        assert!(build_work_cartouche_svg(&inputs(
            VERDICT_CONSISTENT,
            "LOCAL_DEVICE",
            "https://x.app/Users/secret"
        ))
        .is_err());
    }

    #[test]
    fn test_11_identity_non_local_device_err() {
        assert!(build_work_cartouche_svg(&inputs(VERDICT_CONSISTENT, "REMOTE", URL)).is_err());
    }

    #[test]
    fn test_12_verdict_hors_liste_err() {
        assert!(build_work_cartouche_svg(&inputs("SUSPECT", "LOCAL_DEVICE", URL)).is_err());
        assert!(
            build_work_cartouche_svg(&inputs("HUMAN PROCESS PROOF", "LOCAL_DEVICE", URL)).is_err()
        );
    }

    #[test]
    fn test_13_qr_rects_non_vides() {
        let s = ok_svg();
        let n = s.matches("class=\"qrmod\"").count();
        assert!(n > 30, "QR doit produire de nombreux modules, trouvé {n}");
    }

    #[test]
    fn test_14_render_png_existe_non_vide() {
        let out = std::env::temp_dir().join(format!("ho_cartouche_{}.png", Uuid::new_v4()));
        render_work_cartouche_png(&inputs(VERDICT_CONSISTENT, "LOCAL_DEVICE", URL), &out).unwrap();
        let meta = fs::metadata(&out).unwrap();
        assert!(meta.len() > 0, "PNG non vide");
        let _ = fs::remove_file(&out);
    }

    #[test]
    fn test_15_dimensions_viewbox() {
        // SVG : viewBox attendu.
        assert!(ok_svg().contains("viewBox=\"0 0 780 240\""));
        // PNG : dimensions attendues (1560×480).
        let out: PathBuf =
            std::env::temp_dir().join(format!("ho_cartouche_dim_{}.png", Uuid::new_v4()));
        render_work_cartouche_png(&inputs(VERDICT_CONSISTENT, "LOCAL_DEVICE", URL), &out).unwrap();
        let (w, h) = image::image_dimensions(&out).unwrap();
        assert_eq!((w, h), (780 * 2, 240 * 2));
        let _ = fs::remove_file(&out);
    }
}
