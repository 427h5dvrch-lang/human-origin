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
    primary_public_label = "Open the public version"
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
    :root {{
      --bg: #f5f1e8;
      --panel: rgba(255,255,255,0.88);
      --line: rgba(17,24,39,0.10);
      --text: #111827;
      --muted: #6b7280;
      --soft: #f3f4f6;
      --accent: #111827;
      --accent-2: #d6a34f;
      --ok: #166534;
      --warn: #92400e;
      --shadow: 0 18px 60px rgba(17,24,39,0.08);
      --radius: 22px;
    }}
    * {{
      box-sizing: border-box;
    }}
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(214,163,79,0.10), transparent 30%),
        radial-gradient(circle at top right, rgba(17,24,39,0.05), transparent 28%),
        var(--bg);
    }}
    .wrap {{
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 22px 70px;
    }}
    .hero {{
      background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.82));
      border: 1px solid var(--line);
      border-radius: 30px;
      padding: 34px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }}
    .topline {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }}
    .brand {{
      font-size: 12px;
      letter-spacing: .16em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }}
    .badge {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
      color: var(--text);
    }}
    h1 {{
      margin: 0;
      font-size: clamp(32px, 4vw, 54px);
      line-height: 0.98;
      letter-spacing: -0.04em;
      max-width: 820px;
    }}
    .lede {{
      margin-top: 16px;
      max-width: 820px;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.65;
    }}
    .hero-grid {{
      display: grid;
      grid-template-columns: 1.35fr 0.9fr;
      gap: 22px;
      margin-top: 26px;
    }}
    .hero-card, .card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: 0 10px 28px rgba(17,24,39,0.04);
    }}
    .hero-card {{
      padding: 22px;
    }}
    .eyebrow {{
      font-size: 12px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
      font-weight: 700;
    }}
    .hero-main-title {{
      font-size: 22px;
      line-height: 1.2;
      font-weight: 800;
      margin-bottom: 8px;
    }}
    .hero-main-copy {{
      color: var(--muted);
      line-height: 1.6;
      font-size: 15px;
    }}
    .actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      text-decoration: none;
      border-radius: 14px;
      padding: 13px 16px;
      min-height: 48px;
      font-weight: 700;
      border: 1px solid var(--line);
      color: var(--text);
      background: white;
    }}
    .btn.primary {{
      background: var(--accent);
      color: white;
      border-color: var(--accent);
      box-shadow: 0 12px 28px rgba(17,24,39,0.18);
    }}
    .btn.secondary {{
      background: rgba(255,255,255,0.72);
    }}
    .btn.ghost {{
      background: transparent;
    }}
    .proof-note {{
      margin-top: 16px;
      padding: 16px 18px;
      border-radius: 18px;
      border: 1px solid rgba(214,163,79,0.35);
      background: linear-gradient(180deg, rgba(255,250,235,0.92), rgba(255,247,220,0.82));
      line-height: 1.55;
      font-size: 14px;
    }}
    .proof-note strong {{
      color: var(--text);
    }}
    .mini-list {{
      display: grid;
      gap: 12px;
    }}
    .mini-item {{
      padding: 15px 16px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.72);
    }}
    .mini-title {{
      font-size: 12px;
      letter-spacing: .10em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 6px;
      font-weight: 700;
    }}
    .mini-value {{
      font-size: 15px;
      line-height: 1.45;
      word-break: break-word;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 18px;
      margin-top: 22px;
    }}
    .card {{
      padding: 22px;
    }}
    .card h3 {{
      margin: 0 0 10px 0;
      font-size: 18px;
      line-height: 1.2;
    }}
    .card p {{
      margin: 0;
      color: var(--muted);
      line-height: 1.65;
      font-size: 14px;
    }}
    .meta {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      margin-top: 22px;
    }}
    .meta-card {{
      padding: 20px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: 0 10px 28px rgba(17,24,39,0.04);
    }}
    .meta-label {{
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
      font-weight: 700;
    }}
    .meta-value {{
      font-size: 16px;
      line-height: 1.55;
      word-break: break-word;
    }}
    .footer-actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }}
    code {{
      display: inline-block;
      background: var(--soft);
      border: 1px solid rgba(17,24,39,0.07);
      border-radius: 8px;
      padding: 2px 7px;
      font-size: 12px;
      word-break: break-all;
    }}
    @media (max-width: 900px) {{
      .hero-grid, .grid, .meta {{
        grid-template-columns: 1fr;
      }}
      .hero {{
        padding: 24px;
      }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="topline">
        <div class="brand">HumanOrigin package</div>
        <div class="badge">Preferred proof: {esc(v1_ho_filename)}</div>
      </div>

      <h1>Open this package first.</h1>
      <div class="lede">
        This package is designed to be readable and verifiable by a third party without prior context.
        It brings together the public-facing document, the preferred portable proof, the compatibility proof,
        and the verification path.
      </div>

      <div class="hero-grid">
        <div class="hero-card">
          <div class="eyebrow">Primary file</div>
          <div class="hero-main-title">{esc(primary_public_label)}</div>
          <div class="hero-main-copy">
            This is the main file to open first for normal public circulation.
          </div>

          <div class="actions">
            <a class="btn primary" href="{esc(primary_public_file)}">{esc(primary_public_label)}</a>
            <a class="btn secondary" href="{esc(v1_ho_filename)}">Open reference proof</a>
            <a class="btn ghost" href="{esc(verifier_url)}" target="_blank" rel="noopener">Verify online</a>
          </div>

          <div class="proof-note">
            <strong>Reference proof:</strong> <code>{esc(v1_ho_filename)}</code><br>
            The legacy file <code>{esc(legacy_ho_filename)}</code> remains included for compatibility,
            while the preferred portable proof format is HO-JSON v1.
          </div>
        </div>

        <div class="hero-card">
          <div class="eyebrow">At a glance</div>
          <div class="mini-list">
            <div class="mini-item">
              <div class="mini-title">Project</div>
              <div class="mini-value">{esc(project_title)}</div>
            </div>
            <div class="mini-item">
              <div class="mini-title">Certificate ID</div>
              <div class="mini-value">{esc(certificate_id)}</div>
            </div>
            <div class="mini-item">
              <div class="mini-title">Issued at</div>
              <div class="mini-value">{esc(issued_at)}</div>
            </div>
            <div class="mini-item">
              <div class="mini-title">Verdict</div>
              <div class="mini-value">{esc(verdict)}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="eyebrow">1 — Public file</div>
          <h3>What to open or send</h3>
          <p>
            Open <strong>{esc(primary_public_file)}</strong> as the main public-facing file in this package.
            {'This is the visibly published PDF prepared for circulation.' if is_pdf else 'This is the bound working document linked to the proof package.'}
          </p>
        </div>
        <div class="card">
          <div class="eyebrow">2 — Reference proof</div>
          <h3>What anchors the document</h3>
          <p>
            The preferred portable proof file is <strong>{esc(v1_ho_filename)}</strong>.
            It anchors the document through its SHA-256 and is the recommended proof file to verify.
          </p>
        </div>
        <div class="card">
          <div class="eyebrow">3 — Verification path</div>
          <h3>How to verify the package</h3>
          <p>
            Open the public verifier, load <strong>{esc(v1_ho_filename)}</strong>, then optionally load the bound document to confirm the SHA-256 match.
          </p>
        </div>
      </div>

      <div class="meta">
        <div class="meta-card">
          <div class="meta-label">Bound document</div>
          <div class="meta-value">{esc(document_filename)}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Document MIME</div>
          <div class="meta-value">{esc(document_mime)}</div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Document SHA-256</div>
          <div class="meta-value"><code>{esc(document_sha256)}</code></div>
        </div>
        <div class="meta-card">
          <div class="meta-label">Recommended public workflow</div>
          <div class="meta-value">{esc(recommended_public_workflow)}</div>
        </div>
      </div>

      <div class="footer-actions">
        <a class="btn secondary" href="HumanOrigin_READ_ME_FIRST.txt">Read package notes</a>
        <a class="btn secondary" href="HumanOrigin_VERIFY.txt">Open verification guide</a>
        <a class="btn secondary" href="HumanOrigin_MANIFEST.json">Open manifest</a>
        <a class="btn secondary" href="HumanOrigin_SHARE_CARD.html">Open sharing card</a>
        <a class="btn secondary" href="{esc(legacy_ho_filename)}">Open compatibility proof</a>
      </div>
    </section>
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
