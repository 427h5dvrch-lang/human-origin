use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderOptions {
    pub mode: String,
    pub pages: String,
    pub first_page_scale: f32,
    pub other_pages_scale: f32,
    pub anchor: String,
    pub margin_pt: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicationJob {
    pub job_version: String,
    pub job_type: String,

    pub source_pdf_path: String,
    pub output_pdf_path: String,
    pub cartouche_png_path: String,

    pub certificate_json_path: Option<String>,
    pub verify_txt_path: Option<String>,

    pub certificate_id: String,
    pub verify_url: String,
    pub verdict: String,

    pub render: RenderOptions,
}