#!/usr/bin/env python3
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

def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

def safe_unlink(path: Path, removed: list[str]):
    if path.exists() and path.is_file():
        path.unlink()
        removed.append(path.name)

export_dir = find_latest_export_dir()
v1_path = export_dir / "CERTIFICAT_FINAL.v1.ho.json"
if not v1_path.exists():
    raise SystemExit(f"Fichier manquant: {v1_path}")

v1 = read_json(v1_path)
payload = v1.get("payload", {})
document = payload.get("document", {})
mime = document.get("mime") or ""
is_pdf = mime == "application/pdf"
is_docx = mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

removed = []

# Toujours supprimer les backups visibles dans le package
for p in export_dir.glob("*.bak"):
    safe_unlink(p, removed)

# Garder un seul bound document cohérent avec la preuve v1
bound_docx = export_dir / "BOUND_DOCUMENT.docx"
bound_pdf = export_dir / "BOUND_DOCUMENT.pdf"

if is_pdf:
    safe_unlink(bound_docx, removed)
elif is_docx:
    safe_unlink(bound_pdf, removed)

# Cas non-PDF : pas de reliquats de publication PDF native
if not is_pdf:
    for name in [
        "HumanOrigin_PUBLICATION_JOB.json",
        "HumanOrigin_PUBLISHED.pdf",
    ]:
        safe_unlink(export_dir / name, removed)

# Cas PDF : pas de reliquats d’un faux bound docx
# (déjà géré plus haut)
# On garde HumanOrigin_PUBLISHED.html comme page de circulation / lecture
# On garde HumanOrigin_PUBLICATION_JOB.json pour traçabilité de publication

print(f"CLEAN OK: {export_dir}")
if removed:
    print("REMOVED:")
    for name in removed:
        print(f"- {name}")
else:
    print("REMOVED: none")
