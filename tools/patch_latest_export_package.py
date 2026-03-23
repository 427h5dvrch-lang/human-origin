from pathlib import Path
import json
import sys

ROOT = Path.home() / "Documents" / "HumanOrigin" / "Projects"

def find_latest_export_dir():
    candidates = list(ROOT.glob("*/CERTIFICAT_FINAL.v1.ho.json"))
    if not candidates:
        raise SystemExit("Aucun CERTIFICAT_FINAL.v1.ho.json trouvé.")
    latest = max(candidates, key=lambda p: p.stat().st_mtime)
    return latest.parent

def read_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))

def write_text_backup(path: Path, content: str):
    if path.exists():
        bak = path.with_name(path.name + ".bak")
        bak.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    path.write_text(content, encoding="utf-8")

def write_json_backup(path: Path, data):
    if path.exists():
        bak = path.with_name(path.name + ".bak")
        bak.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

export_dir = find_latest_export_dir()

v1_path = export_dir / "CERTIFICAT_FINAL.v1.ho.json"
legacy_path = export_dir / "CERTIFICAT_FINAL.ho.json"

if not v1_path.exists():
    raise SystemExit(f"Fichier manquant: {v1_path}")
if not legacy_path.exists():
    raise SystemExit(f"Fichier manquant: {legacy_path}")

v1 = read_json(v1_path)
legacy = read_json(legacy_path)

payload = v1.get("payload", {})
project = payload.get("project", {})
document = payload.get("document", {})
process_summary = payload.get("process_summary", {})
verification = payload.get("verification", {})

project_title = project.get("name", "Untitled Project")
document_filename = document.get("filename") or "—"
document_mime = document.get("mime") or "—"
document_sha256 = document.get("sha256") or "—"
certificate_id = payload.get("certificate_id") or "—"
issued_at = payload.get("issued_at") or "—"
verdict = process_summary.get("verdict") or "—"
verifier_url = verification.get("verify_url") or "—"

legacy_ho_filename = "CERTIFICAT_FINAL.ho.json"
v1_ho_filename = "CERTIFICAT_FINAL.v1.ho.json"

is_pdf = document_mime == "application/pdf"
published_output_filename = "HumanOrigin_PUBLISHED.pdf" if is_pdf and (export_dir / "HumanOrigin_PUBLISHED.pdf").exists() else None

if is_pdf:
    publication_status = "visible_published_copy_included"
    recommended_public_workflow = "Use the included published output for public circulation."
else:
    publication_status = "no_native_visible_published_copy_for_this_file_type"
    recommended_public_workflow = "Keep the bound source file as working source, use CERTIFICAT_FINAL.v1.ho.json as preferred portable proof, keep CERTIFICAT_FINAL.ho.json for compatibility, and publish a PDF later when a visibly marked public document is needed."

read_me = f"""HumanOrigin — Read Me First

Project:
- {project_title}

Bound document:
- {document_filename}
- MIME: {document_mime}

Certificate:
- ID: {certificate_id}
- Issued at: {issued_at}
- Verdict: {verdict}

Reference proof files:
- {v1_ho_filename} = portable standardized proof format (HumanOrigin HO-JSON v1)
- {legacy_ho_filename} = legacy compatibility proof format

Important:
- The preferred portable proof is {v1_ho_filename}
- {legacy_ho_filename} remains included for compatibility with legacy tooling
- Visible assets and circulation files are not the reference proof
- The bound document is linked through its SHA-256 hash

Document SHA-256:
- {document_sha256}

Verification:
- Use the public verifier: {verifier_url}
- Preferred portable proof: load {v1_ho_filename}
- Legacy compatibility proof: load {legacy_ho_filename}
- The verifier accepts both formats
- Optionally load the bound source document to check document hash match

Suggested opening order:
1. HumanOrigin_READ_ME_FIRST.txt
2. {v1_ho_filename}
3. {legacy_ho_filename}
4. HumanOrigin_VERIFY.txt
"""

verify_txt = f"""HumanOrigin Verification Instructions

Certificate ID:
- {certificate_id}

Project:
- {project_title}

Issued at:
- {issued_at}

Verdict:
- {verdict}

Bound document SHA-256:
- {document_sha256}

Verification steps:
1. Open the public verifier: {verifier_url}
2. Load {v1_ho_filename} (preferred portable standardized format)
3. Or load {legacy_ho_filename} (legacy compatibility format)
4. Optionally load the bound source document
5. Confirm signature validity
6. Confirm document SHA-256 match

Proof format status:
- {v1_ho_filename} = HumanOrigin HO-JSON v1 portable proof
- {legacy_ho_filename} = legacy compatibility proof
- The verifier accepts both formats
"""

manifest = {
    "manifest_version": "1.0",
    "project_title": project_title,
    "document_filename": document_filename,
    "bound_document_mime": document_mime,
    "document_sha256": document_sha256,
    "certificate_id": certificate_id,
    "issued_at": issued_at,
    "verdict": verdict,
    "verification_url": verifier_url,
    "reference_proof_filename": v1_ho_filename,
    "legacy_compatibility_proof_filename": legacy_ho_filename,
    "proof_format_status": "dual_format_legacy_plus_v1",
    "proof_format_note": "Preferred portable proof = HO-JSON v1. Legacy .ho.json remains included for compatibility.",
    "published_output_filename": published_output_filename,
    "publication_status": publication_status,
    "recommended_public_workflow": recommended_public_workflow,
}

write_text_backup(export_dir / "HumanOrigin_READ_ME_FIRST.txt", read_me)
write_text_backup(export_dir / "HumanOrigin_VERIFY.txt", verify_txt)
write_json_backup(export_dir / "HumanOrigin_MANIFEST.json", manifest)

print("PATCH OK")
print(f"EXPORT_DIR={export_dir}")
