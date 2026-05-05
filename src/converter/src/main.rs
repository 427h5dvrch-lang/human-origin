use std::env;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn print_json_ok(engine: &str, intermediate_pdf_path: &Path, warnings: &[String]) {
    let warnings_json = warnings
        .iter()
        .map(|w| format!("\"{}\"", json_escape(w)))
        .collect::<Vec<_>>()
        .join(",");

    println!(
        "{{\"ok\":true,\"engine\":\"{}\",\"intermediate_pdf_path\":\"{}\",\"warnings\":[{}]}}",
        json_escape(engine),
        json_escape(&intermediate_pdf_path.to_string_lossy()),
        warnings_json
    );
}

fn print_json_error(code: &str, message: &str) {
    println!(
        "{{\"ok\":false,\"engine\":\"libreoffice-headless\",\"intermediate_pdf_path\":null,\"warnings\":[],\"error_code\":\"{}\",\"message\":\"{}\"}}",
        json_escape(code),
        json_escape(message)
    );
}

fn usage() {
    print_json_error(
        "BAD_ARGS",
        "Usage: humanorigin-converter --input <document.docx> --output-dir <folder>",
    );
}

fn arg_value(args: &[String], key: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == key)
        .map(|pair| pair[1].clone())
}

fn find_soffice() -> Option<PathBuf> {
    if let Ok(custom) = env::var("HUMANORIGIN_SOFFICE") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Some(p);
        }
    }

    let candidates = [
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/usr/local/bin/soffice",
        "/opt/homebrew/bin/soffice",
        "/usr/bin/soffice",
        "/usr/local/bin/libreoffice",
        "/opt/homebrew/bin/libreoffice",
    ];

    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }

    None
}

fn main() {
    let args: Vec<String> = env::args().collect();

    let Some(input_raw) = arg_value(&args, "--input") else {
        usage();
        std::process::exit(2);
    };

    let Some(output_dir_raw) = arg_value(&args, "--output-dir") else {
        usage();
        std::process::exit(2);
    };

    let input = PathBuf::from(input_raw);
    let output_dir = PathBuf::from(output_dir_raw);

    if !input.exists() {
        print_json_error("INPUT_NOT_FOUND", "Input DOCX file not found.");
        std::process::exit(3);
    }

    let ext = input
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_lowercase();

    if ext != "docx" {
        print_json_error("UNSUPPORTED_INPUT", "Only .docx input is supported in this converter prototype.");
        std::process::exit(4);
    }

    if let Err(err) = fs::create_dir_all(&output_dir) {
        print_json_error("OUTPUT_DIR_ERROR", &format!("Cannot create output directory: {}", err));
        std::process::exit(5);
    }

    let Some(soffice) = find_soffice() else {
        print_json_error(
            "CONVERTER_ENGINE_NOT_FOUND",
            "LibreOffice soffice was not found. Final product should embed or provide a signed local converter pack.",
        );
        std::process::exit(6);
    };

    let output = Command::new(&soffice)
        .arg("--headless")
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(&output_dir)
        .arg(&input)
        .output();

    match output {
        Ok(out) if out.status.success() => {}
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);

            print_json_error(
                "CONVERSION_FAILED",
                &format!(
                    "LibreOffice conversion failed with status: {}. stdout: {} stderr: {}",
                    out.status,
                    stdout.trim(),
                    stderr.trim()
                ),
            );
            std::process::exit(7);
        }
        Err(err) => {
            print_json_error(
                "CONVERTER_LAUNCH_FAILED",
                &format!("Failed to launch converter engine: {}", err),
            );
            std::process::exit(8);
        }
    }

    let stem = input
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("document");

    let expected_pdf = output_dir.join(format!("{}.pdf", stem));

    if expected_pdf.exists() {
        print_json_ok("libreoffice-headless", &expected_pdf, &[]);
        return;
    }

    let pdfs: Vec<PathBuf> = match fs::read_dir(&output_dir) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.extension()
                    .and_then(OsStr::to_str)
                    .map(|e| e.eq_ignore_ascii_case("pdf"))
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => vec![],
    };

    if let Some(first_pdf) = pdfs.first() {
        print_json_ok(
            "libreoffice-headless",
            first_pdf,
            &[String::from("PDF filename differed from expected DOCX stem.")],
        );
        return;
    }

    print_json_error(
        "PDF_NOT_CREATED",
        "Conversion finished but no PDF was found in the output directory.",
    );
    std::process::exit(9);
}
