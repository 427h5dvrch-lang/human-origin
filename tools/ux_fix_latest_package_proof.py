from pathlib import Path
import shutil
import re

PROJECTS = Path.home() / "Documents" / "HumanOrigin" / "Projects"

def latest_package_dir():
    candidates = []
    for p in PROJECTS.glob("*"):
        if p.is_dir() and (p / "1_OPEN_FIRST.html").exists():
            candidates.append(p)
    if not candidates:
        raise SystemExit("STOP: aucun package trouvé.")
    return max(candidates, key=lambda p: p.stat().st_mtime)

def find_proof(pkg):
    patterns = [
        "2_SEND_TO_RECIPIENT/*.ho.json",
        "2_SEND_TO_RECIPIENT/*PROOF*.json",
        "2_SEND_TO_RECIPIENT/*.json",
        "*PROOF*.ho.json",
        "*PROOF*.json",
        "CERTIFICAT_FINAL.v1.ho.json",
        "CERTIFICAT_FINAL.ho.json",
        "3_TECHNICAL_PROOF_ARCHIVE/**/*.ho.json",
        "3_TECHNICAL_PROOF_ARCHIVE/**/*.json",
        "**/*PROOF*.json",
        "**/*.ho.json",
    ]
    for pat in patterns:
        hits = sorted(pkg.glob(pat))
        hits = [h for h in hits if h.is_file()]
        if hits:
            return hits[0]
    return None

pkg = latest_package_dir()
send_dir = pkg / "2_SEND_TO_RECIPIENT"
send_dir.mkdir(exist_ok=True)

proof = find_proof(pkg)

if not proof:
    print("⚠️ Aucun fichier de vérification trouvé dans le package.")
    raise SystemExit(0)

target = send_dir / proof.name

if proof.resolve() != target.resolve():
    shutil.copy2(proof, target)
    print(f"✅ Fichier de vérification copié dans le dossier à envoyer : {target}")
else:
    print(f"✅ Fichier de vérification déjà présent : {target}")

# Corriger les pages déjà générées qui affichent Non trouvé
for name in ["1_OPEN_FIRST.html", "HumanOrigin_OPEN_FIRST.html"]:
    fp = pkg / name
    if not fp.exists():
        continue

    s = fp.read_text()

    s = s.replace(
        "<div class=\"filename\">Non trouvé</div>",
        f"<div class=\"filename\">{target.name}</div>"
    )

    s = s.replace(
        "Fichier de vérification inclus</div>\n          <div class=\"filename\">Non trouvé</div>",
        f"Fichier de vérification inclus</div>\n          <div class=\"filename\">{target.name}</div>"
    )

    # Corriger les noms cassés si un vieux remplacement a abîmé .ho.json
    s = s.replace("PROOF.v1fichier de vérification", "PROOF.v1.ho.json")
    s = s.replace("CERTIFICAT_FINAL.v1fichier de vérification", "CERTIFICAT_FINAL.v1.ho.json")

    fp.write_text(s)
    print(f"✅ Page corrigée : {fp}")

print(f"✅ Package corrigé : {pkg}")
