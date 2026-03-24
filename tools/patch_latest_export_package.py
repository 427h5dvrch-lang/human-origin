from pathlib import Path
import json

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

def esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )

export_dir = find_latest_export_dir()

v1_path = export_dir / "CERTIFICAT_FINAL.v1.ho.json"
legacy_path = export_dir / "CERTIFICAT_FINAL.ho.json"

if not v1_path.exists():
    raise SystemExit(f"Fichier manquant: {v1_path}")
if not legacy_path.exists():
    raise SystemExit(f"Fichier manquant: {legacy_path}")

v1 = read_json(v1_path)
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
open_first_filename = "HumanOrigin_OPEN_FIRST.html"

is_pdf = document_mime == "application/pdf"
published_output_filename = "HumanOrigin_PUBLISHED.pdf" if is_pdf and (export_dir / "HumanOrigin_PUBLISHED.pdf").exists() else None
bound_extension = Path(document_filename).suffix.lower() or (".pdf" if is_pdf else ".docx")
bound_document_filename = f"BOUND_DOCUMENT{bound_extension}"

if is_pdf:
    publication_status = "visible_published_copy_included"
    recommended_public_workflow = "Use the included published output for public circulation."
    primary_public_file = "HumanOrigin_PUBLISHED.pdf"
    primary_public_label = "Open the published PDF"
else:
    publication_status = "no_native_visible_published_copy_for_this_file_type"
    recommended_public_workflow = "Keep the bound source file as working source, use CERTIFICAT_FINAL.v1.ho.json as preferred portable proof, keep CERTIFICAT_FINAL.ho.json for compatibility, and publish a PDF later when a visibly marked public document is needed."
    primary_public_file = bound_document_filename
    primary_public_label = "Open the bound source document"

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
1. {open_first_filename}
2. {v1_ho_filename}
3. {legacy_ho_filename}
4. HumanOrigin_VERIFY.txt
5. HumanOrigin_READ_ME_FIRST.txt
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
    "bound_document_filename": bound_document_filename,
    "bound_document_mime": document_mime,
    "document_sha256": document_sha256,
    "certificate_id": certificate_id,
    "issued_at": issued_at,
    "verdict": verdict,
    "verification_url": verifier_url,
    "primary_entry_filename": open_first_filename,
    "reference_proof_filename": v1_ho_filename,
    "legacy_compatibility_proof_filename": legacy_ho_filename,
    "proof_format_status": "dual_format_legacy_plus_v1",
    "proof_format_note": "Preferred portable proof = HO-JSON v1. Legacy .ho.json remains included for compatibility.",
    "published_output_filename": published_output_filename,
    "publication_status": publication_status,
    "recommended_public_workflow": recommended_public_workflow,
}

open_first_html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>HumanOrigin — Open First</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f3ed;
      color: #1f2937;
    }}
    .wrap {{
      max-width: 980px;
      margin: 0 auto;
      padding: 40px 24px 60px;
    }}
    .hero {{
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 20px;
      padding: 28px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.05);
      margin-bottom: 22px;
    }}
    h1 {{
      margin: 0 0 10px 0;
      font-size: 30px;
      line-height: 1.1;
    }}
    .sub {{
      color: #6b7280;
      font-size: 15px;
      line-height: 1.5;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 18px;
      margin-top: 22px;
    }}
    .card {{
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 6px 22px rgba(0,0,0,0.04);
    }}
    .label {{
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #9ca3af;
      margin-bottom: 8px;
    }}
    .value {{
      font-size: 15px;
      line-height: 1.5;
      word-break: break-word;
    }}
    .actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 20px;
    }}
    .btn {{
      display: inline-block;
      text-decoration: none;
      border-radius: 12px;
      padding: 12px 16px;
      font-weight: 600;
      border: 1px solid #d1d5db;
      color: #111827;
      background: #fff;
    }}
    .btn.primary {{
      background: #111827;
      color: white;
      border-color: #111827;
    }}
    .note {{
      margin-top: 22px;
      padding: 16px 18px;
      background: #fff8e7;
      border: 1px solid #f4d58d;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.55;
    }}
    .muted {{
      color: #6b7280;
    }}
    code {{
      background: #f3f4f6;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 12px;
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="label">HumanOrigin package</div>
      <h1>Open this file first</h1>
      <div class="sub">
        This package contains the document, the portable proof files, and the verification instructions.
        The preferred proof file is <strong>{esc(v1_ho_filename)}</strong>.
      </div>

      <div class="actions">
        <a class="btn primary" href="{esc(primary_public_file)}">{esc(primary_public_label)}</a>
        <a class="btn" href="{esc(v1_ho_filename)}">Open preferred proof (HO-JSON v1)</a>
        <a class="btn" href="{esc(legacy_ho_filename)}">Open legacy compatibility proof</a>
        <a class="btn" href="{esc(verifier_url)}" target="_blank" rel="noopener">Open public verifier</a>
      </div>

      <div class="note">
        <strong>Source of truth:</strong> <code>{esc(v1_ho_filename)}</code><br>
        <span class="muted">The legacy <code>{esc(legacy_ho_filename)}</code> file remains included for compatibility, but the preferred portable proof is HO-JSON v1.</span>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="label">Project</div>
        <div class="value">{esc(project_title)}</div>
      </div>
      <div class="card">
        <div class="label">Certificate ID</div>
        <div class="value">{esc(certificate_id)}</div>
      </div>
      <div class="card">
        <div class="label">Issued at</div>
        <div class="value">{esc(issued_at)}</div>
      </div>
      <div class="card">
        <div class="label">Verdict</div>
        <div class="value">{esc(verdict)}</div>
      </div>
      <div class="card">
        <div class="label">Bound document</div>
        <div class="value">{esc(document_filename)}</div>
      </div>
      <div class="card">
        <div class="label">Document MIME</div>
        <div class="value">{esc(document_mime)}</div>
      </div>
      <div class="card">
        <div class="label">Document SHA-256</div>
        <div class="value"><code>{esc(document_sha256)}</code></div>
      </div>
      <div class="card">
        <div class="label">Public workflow</div>
        <div class="value">{esc(recommended_public_workflow)}</div>
      </div>
    </div>

    <div class="actions" style="margin-top:24px;">
      <a class="btn" href="HumanOrigin_READ_ME_FIRST.txt">Open Read Me First</a>
      <a class="btn" href="HumanOrigin_VERIFY.txt">Open verification instructions</a>
      <a class="btn" href="HumanOrigin_MANIFEST.json">Open manifest</a>
      <a class="btn" href="HumanOrigin_SHARE_CARD.html">Open share card</a>
    </div>
  </div>
</body>
</html>
"""

write_text_backup(export_dir / "HumanOrigin_READ_ME_FIRST.txt", read_me)
write_text_backup(export_dir / "HumanOrigin_VERIFY.txt", verify_txt)
write_json_backup(export_dir / "HumanOrigin_MANIFEST.json", manifest)
write_text_backup(export_dir / open_first_filename, open_first_html)

print("PATCH OK")
print(f"EXPORT_DIR={export_dir}")
