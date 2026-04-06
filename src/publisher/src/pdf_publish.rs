use crate::job::PublicationJob;
use crate::result::PublicationResult;
use image::GenericImageView;
use image::ImageReader;
use pdfium_auto::bind_pdfium_silent;
use pdfium_render::prelude::*;

fn clamp_f32(v: f32, min_v: f32, max_v: f32) -> f32 {
    if v < min_v {
        min_v
    } else if v > max_v {
        max_v
    } else {
        v
    }
}

fn mm_to_pt(mm: f32) -> f32 {
    mm * 72.0 / 25.4
}

#[derive(Debug, Clone, Copy)]
struct CartouchePlacement {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

fn add_clickable_link_on_page(
    page: &mut PdfPage,
    url: &str,
    placement: CartouchePlacement,
) -> Result<(), String> {
    let bindings = page.bindings();
    let page_handle = bindings.get_handle_from_page(page);

    let annot = bindings.FPDFPage_CreateAnnot(page_handle, 2); // FPDF_ANNOT_LINK
    if annot.is_null() {
        return Err("FPDFPage_CreateAnnot returned null".to_string());
    }

    let rect = FS_RECTF {
        left: placement.x,
        bottom: placement.y,
        right: placement.x + placement.w,
        top: placement.y + placement.h,
    };

    let rect_ok = bindings.FPDFAnnot_SetRect(annot, &rect);
    if !bindings.is_true(rect_ok) {
        return Err("FPDFAnnot_SetRect failed".to_string());
    }

    let uri_ok = bindings.FPDFAnnot_SetURI(annot, url);
    if !bindings.is_true(uri_ok) {
        return Err("FPDFAnnot_SetURI failed".to_string());
    }

    Ok(())
}

fn render_cartouche_on_page(
    page: &mut PdfPage,
    cartouche: &image::DynamicImage,
    scale: f32,
    margin_pt: f32,
    is_first_page: bool,
) -> Result<CartouchePlacement, PdfiumError> {
    let page_w = page.width().value;

    let (img_w, img_h) = cartouche.dimensions();
    let image_ratio = img_h as f32 / img_w as f32;

    let (base_w_mm, base_h_mm) = if is_first_page {
        (78.0_f32, 24.0_f32)
    } else {
        (58.0_f32, 20.0_f32)
    };

    let margin = if margin_pt > 0.0 {
        margin_pt
    } else {
        mm_to_pt(12.0)
    };

    let scale = clamp_f32(scale, 0.72, 1.55);
    let box_w = mm_to_pt(base_w_mm) * scale;
    let box_h = mm_to_pt(base_h_mm) * scale;

    let box_ratio = box_h / box_w;
    let (target_w, target_h) = if image_ratio > box_ratio {
        let h = box_h;
        let w = h / image_ratio;
        (w, h)
    } else {
        let w = box_w;
        let h = w * image_ratio;
        (w, h)
    };

    let x = (page_w - margin - target_w).max(0.0);
    let y = (margin).max(0.0);

    page.objects_mut().create_image_object(
        PdfPoints::new(x),
        PdfPoints::new(y),
        cartouche,
        Some(PdfPoints::new(target_w)),
        Some(PdfPoints::new(target_h)),
    )?;

    page.regenerate_content()?;

    Ok(CartouchePlacement {
        x,
        y,
        w: target_w,
        h: target_h,
    })
}

pub fn run_pdf_publication(job: &PublicationJob) -> PublicationResult {
    let pdfium = match bind_pdfium_silent() {
        Ok(v) => v,
        Err(e) => {
            return PublicationResult::err(
                "PDFIUM_BIND_FAILED",
                &format!("Unable to bind PDFium: {e}"),
            );
        }
    };

    let mut document = match pdfium.load_pdf_from_file(&job.source_pdf_path, None) {
        Ok(v) => v,
        Err(e) => {
            return PublicationResult::err(
                "PDF_OPEN_FAILED",
                &format!("Unable to open source PDF: {e}"),
            );
        }
    };

    let page_count = document.pages().len();

    if page_count == 0 {
        return PublicationResult::err("EMPTY_PDF", "Source PDF contains no pages");
    }

    let cartouche = match ImageReader::open(&job.cartouche_png_path) {
        Ok(r) => match r.decode() {
            Ok(img) => img,
            Err(e) => {
                return PublicationResult::err(
                    "CARTOUCHE_DECODE_FAILED",
                    &format!("Unable to decode cartouche PNG: {e}"),
                );
            }
        },
        Err(e) => {
            return PublicationResult::err(
                "CARTOUCHE_OPEN_FAILED",
                &format!("Unable to open cartouche PNG: {e}"),
            );
        }
    };

    let margin_pt = if job.render.margin_pt > 0.0 {
        job.render.margin_pt
    } else {
        mm_to_pt(12.0)
    };

    let mut warnings = vec![];

    for index in 0..page_count {
        let page_res = document.pages_mut().get(index);

        let mut page = match page_res {
            Ok(p) => p,
            Err(e) => {
                return PublicationResult::err(
                    "PAGE_ACCESS_FAILED",
                    &format!("Unable to access page {}: {e}", index + 1),
                );
            }
        };

        let raw_scale = if index == 0 {
            job.render.first_page_scale
        } else {
            job.render.other_pages_scale
        };

        let scale = clamp_f32(raw_scale, 0.72, 1.55);

        let placement = match render_cartouche_on_page(
            &mut page,
            &cartouche,
            scale,
            margin_pt,
            index == 0,
        ) {
            Ok(v) => v,
            Err(e) => {
                return PublicationResult::err(
                    "PAGE_RENDER_FAILED",
                    &format!("Unable to mark page {}: {e}", index + 1),
                );
            }
        };

        if let Err(e) = add_clickable_link_on_page(&mut page, &job.verify_url, placement) {
            warnings.push(format!("Page {} link annotation failed: {}", index + 1, e));
        }
    }

    if let Err(e) = document.save_to_file(&job.output_pdf_path) {
        return PublicationResult::err(
            "PDF_SAVE_FAILED",
            &format!("Unable to save published PDF: {e}"),
        );
    }

    PublicationResult::ok(
        job.output_pdf_path.clone(),
        page_count as u32,
        "pdfium-auto",
        warnings,
    )
}
