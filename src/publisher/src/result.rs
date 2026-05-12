use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicationResult {
    pub ok: bool,
    pub output_pdf_path: Option<String>,
    pub pages_marked: u32,
    pub engine: String,
    pub warnings: Vec<String>,
    pub error_code: Option<String>,
    pub message: Option<String>,
}

impl PublicationResult {
    pub fn ok(output_pdf_path: String, pages_marked: u32, engine: &str, warnings: Vec<String>) -> Self {
        Self {
            ok: true,
            output_pdf_path: Some(output_pdf_path),
            pages_marked,
            engine: engine.to_string(),
            warnings,
            error_code: None,
            message: None,
        }
    }

    pub fn err(code: &str, message: &str) -> Self {
        Self {
            ok: false,
            output_pdf_path: None,
            pages_marked: 0,
            engine: "publisher".to_string(),
            warnings: vec![],
            error_code: Some(code.to_string()),
            message: Some(message.to_string()),
        }
    }
}