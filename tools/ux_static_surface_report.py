from pathlib import Path
from datetime import datetime

ROOT = Path(".")
PROJECTS = Path.home() / "Documents" / "HumanOrigin" / "Projects"

WATCH_TERMS = [
    "session",
    "Session",
    "certificat",
    "Certificat",
    "Certificat Final",
    "hash",
    "Hash",
    "SHA-256",
    ".ho.json",
    "JSON",
    "archive",
    "Archive",
    "INCOMPLETE",
    "TEMP",
    "Certifiée locale",
    "Démarrer l’enregistrement",
    "Arrêter l’enregistrement",
    "Preuve (Hash)",
    "Clé publique",
    "clé publique",
]

GOOD_TERMS = [
    "Lancer HumanOrigin",
    "Terminer ce moment de travail",
    "Valider ce moment de travail",
    "Créer le package final",
    "Travail enregistré",
    "dossier à envoyer",
    "fichier de vérification",
    "Détails avancés",
    "Votre package est prêt",
]

FILES = [
    ROOT / "src/main.js",
    ROOT / "index.html",
    ROOT / "tools/ux_finalize_latest_package.py",
    ROOT / "tools/ux_create_send_zip_latest.py",
    ROOT / "tools/ux_add_recipient_guide_latest.py",
    ROOT / "tools/post_export_latest.sh",
]

latest_pkg = None
if PROJECTS.exists():
    pkgs = [p for p in PROJECTS.glob("*") if p.is_dir()]
    if pkgs:
        latest_pkg = max(pkgs, key=lambda p: p.stat().st_mtime)
        FILES += [
            latest_pkg / "1_OPEN_FIRST.html",
            latest_pkg / "HumanOrigin_OPEN_FIRST.html",
            latest_pkg / "README_START_HERE.txt",
            latest_pkg / "2_SEND_TO_RECIPIENT/0_OUVRIR_EN_PREMIER.html",
            latest_pkg / "2_SEND_TO_RECIPIENT/0_LIRE_AVANT.txt",
        ]

report = []
report.append("# HumanOrigin — UX surface checkpoint")
report.append("")
report.append(f"Date : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
report.append("")
report.append("## Objectif")
report.append("")
report.append("Transformer le parcours visible de HumanOrigin en expérience simple : choisir → associer → lancer → travailler → terminer → valider → envoyer.")
report.append("")
report.append("## Ce qui a été fait")
report.append("")
report.append("- wording app principale plus humain ;")
report.append("- bouton principal rendu plus visible par écran ;")
report.append("- Open First clarifié ;")
report.append("- message d’accompagnement amélioré ;")
report.append("- dossier destinataire conservé comme voie principale ;")
report.append("- ZIP ajouté comme option email secondaire ;")
report.append("- guide destinataire ajouté dans `2_SEND_TO_RECIPIENT` ;")
report.append("- verifier public simplifié en surface ;")
report.append("- détails techniques déplacés autant que possible vers niveau avancé.")
report.append("")
report.append("## Ce qui reste à valider visuellement")
report.append("")
report.append("- écran projet ;")
report.append("- écran document ;")
report.append("- écran HumanOrigin actif ;")
report.append("- écran après arrêt ;")
report.append("- historique / package final ;")
report.append("- Open First ;")
report.append("- guide destinataire ;")
report.append("- verifier public.")
report.append("")
report.append("## Mots techniques restants à surveiller")
report.append("")

for fp in FILES:
    if not fp.exists():
        continue
    try:
        s = fp.read_text()
    except Exception:
        continue

    hits = []
    for term in WATCH_TERMS:
        count = s.count(term)
        if count:
            hits.append((term, count))

    if hits:
        report.append(f"### {fp}")
        for term, count in hits:
            report.append(f"- `{term}` : {count}")
        report.append("")

report.append("## Bons libellés détectés")
report.append("")

for fp in FILES:
    if not fp.exists():
        continue
    try:
        s = fp.read_text()
    except Exception:
        continue

    hits = []
    for term in GOOD_TERMS:
        count = s.count(term)
        if count:
            hits.append((term, count))

    if hits:
        report.append(f"### {fp}")
        for term, count in hits:
            report.append(f"- `{term}` : {count}")
        report.append("")

report.append("## Règle pour la suite")
report.append("")
report.append("Ne plus ajouter de patch lourd sans test visuel. Corriger uniquement les éléments qui gênent réellement le parcours utilisateur.")
report.append("")
report.append("## Ne pas toucher")
report.append("")
report.append("- core scan ;")
report.append("- login ;")
report.append("- signature ;")
report.append("- HO-JSON ;")
report.append("- verifier logique ;")
report.append("- cartouche PDF ;")
report.append("- publisher DOCX/PDF ;")
report.append("- binding document/preuve.")
report.append("")

out = ROOT / f"docs/HUMANORIGIN_UX_CHECKPOINT_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
out.write_text("\n".join(report))
print(f"✅ Rapport UX créé : {out}")
if latest_pkg:
    print(f"✅ Dernier package détecté : {latest_pkg}")
