mod job;
mod pdf_publish;
mod result;

use job::PublicationJob;
use result::PublicationResult;
use std::env;
use std::fs;

fn print_and_exit(result: PublicationResult, code: i32) -> ! {
    println!(
        "{}",
        serde_json::to_string(&result).unwrap_or_else(|_| {
            "{\"ok\":false,\"error_code\":\"SERIALIZE_FAILED\",\"message\":\"Unable to serialize result\"}".to_string()
        })
    );
    std::process::exit(code);
}

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 3 || args[1] != "--job" {
        print_and_exit(
            PublicationResult::err(
                "BAD_ARGS",
                "Usage: humanorigin-publisher --job <path-to-publication-job.json>",
            ),
            1,
        );
    }

    let job_path = &args[2];

    let raw = match fs::read_to_string(job_path) {
        Ok(v) => v,
        Err(e) => {
            print_and_exit(
                PublicationResult::err(
                    "JOB_READ_FAILED",
                    &format!("Unable to read publication job file: {e}"),
                ),
                1,
            );
        }
    };

    let job: PublicationJob = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            print_and_exit(
                PublicationResult::err(
                    "JOB_PARSE_FAILED",
                    &format!("Unable to parse publication job file: {e}"),
                ),
                1,
            );
        }
    };

    if job.job_type != "pdf_publication" {
        print_and_exit(
            PublicationResult::err(
                "JOB_TYPE_UNSUPPORTED",
                &format!("Unsupported job type: {}", job.job_type),
            ),
            1,
        );
    }

    let result = pdf_publish::run_pdf_publication(&job);

    if result.ok {
        print_and_exit(result, 0);
    } else {
        print_and_exit(result, 1);
    }
}
