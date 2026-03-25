#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from typing import Any


PREFERRED_PROOF = "CERTIFICAT_FINAL.v1.ho.json"
LEGACY_PROOF = "CERTIFICAT_FINAL.ho.json"
VERIFY_TXT = "HumanOrigin_VERIFY.txt"
MANIFEST = "HumanOrigin_MANIFEST.json"


def first_existing(base: Path, names: list[str]) -> str | None:
    for name in names:
        if (base / name).exists():
            return name
    return None


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def recursive_find(obj: Any, wanted: set[str]) -> Any:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in wanted and v not in (None, "", [], {}):
                return v
        for v in obj.values():
            found = recursive_find(v, wanted)
            if found not in (None, "", [], {}):
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = recursive_find(item, wanted)
            if found not in (None, "", [], {}):
                return found
    return None


def extract_url(path: Path) -> str | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r'https?://[^\s<>"\']+', text)
    return m.group(0) if m else None


def normalize_verdict(raw: Any, preferred_exists: bool) -> tuple[str, str]:
    text = str(raw or "").strip()
    low = text.lower()

    if any(k in low for k in ["more proof", "insufficient", "incomplete", "prélim", "prelim", "non certifié", "not yet"]):
        if "not yet" in low or "non certifié" in low:
            return ("Not yet certified", "Non encore certifié")
        return ("More proof still needed", "Preuve encore insuffisante")

    if any(k in low for k in ["certified", "certifié", "validated", "validé", "verified"]):
        return ("Certified", "Certifié")

    if preferred_exists:
        return ("Certified", "Certifié")

    return ("Not yet certified", "Non encore certifié")


def normalize_confidence(raw: Any, preferred_exists: bool, verifier_url: str | None, public_file: str | None) -> tuple[str, str]:
    text = str(raw or "").strip()
    low = text.lower()

    if any(k in low for k in ["high", "élev", "fort"]):
        return ("High", "Élevé")
    if any(k in low for k in ["moderate", "modér", "medium", "moyen"]):
        return ("Moderate", "Modéré")
    if any(k in low for k in ["prelim", "prélim", "low", "faible"]):
        return ("Preliminary", "Préliminaire")

    if preferred_exists and verifier_url and public_file:
        return ("High", "Élevé")
    if preferred_exists:
        return ("Moderate", "Modéré")
    return ("Preliminary", "Préliminaire")


def find_latest_export_dir() -> Path:
    if len(sys.argv) > 1:
        p = Path(sys.argv[1]).expanduser().resolve()
        if not p.exists():
            raise SystemExit(f"Target directory does not exist: {p}")
        return p

    roots = [
        Path.home() / "Documents" / "HumanOrigin" / "Projects",
        Path.home() / "Documents" / "HumanOrigin",
    ]

    candidates: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for manifest in root.rglob(MANIFEST):
            candidates.append(manifest.parent)

    if not candidates:
        raise SystemExit("No export directory with HumanOrigin_MANIFEST.json found.")

    def score(p: Path) -> float:
        vals = []
        for name in [MANIFEST, "HumanOrigin_OPEN_FIRST.html", VERIFY_TXT]:
            fp = p / name
            if fp.exists():
                vals.append(fp.stat().st_mtime)
        return max(vals) if vals else p.stat().st_mtime

    return max(candidates, key=score)


def build_card(
    *,
    eyebrow_en: str,
    eyebrow_fr: str,
    title_en: str,
    title_fr: str,
    body_en: str,
    body_fr: str,
    button_en: str,
    button_fr: str,
    href: str | None,
    filename: str | None = None,
    tone: str = "default",
) -> str:
    safe_href = html.escape(href or "#", quote=True)
    safe_filename = html.escape(filename or "")
    disabled = "" if href else " disabled"
    button_class = "button primary" if tone == "primary" else "button"
    return f"""
      <article class="card {tone}{disabled}">
        <div class="eyebrow" data-en="{html.escape(eyebrow_en, quote=True)}" data-fr="{html.escape(eyebrow_fr, quote=True)}"></div>
        <h3 data-en="{html.escape(title_en, quote=True)}" data-fr="{html.escape(title_fr, quote=True)}"></h3>
        <p data-en="{html.escape(body_en, quote=True)}" data-fr="{html.escape(body_fr, quote=True)}"></p>
        {"<div class='file-pill'><code>" + safe_filename + "</code></div>" if filename else ""}
        <a class="{button_class}" href="{safe_href}" {"target='_blank' rel='noreferrer'" if href and href.startswith("http") else ""}>
          <span data-en="{html.escape(button_en, quote=True)}" data-fr="{html.escape(button_fr, quote=True)}"></span>
        </a>
      </article>
    """


def main() -> None:
    export_dir = find_latest_export_dir()

    manifest = load_json(export_dir / MANIFEST)

    preferred_proof = PREFERRED_PROOF if (export_dir / PREFERRED_PROOF).exists() else None
    legacy_proof = LEGACY_PROOF if (export_dir / LEGACY_PROOF).exists() else None

    published_pdf = first_existing(export_dir, ["HumanOrigin_PUBLISHED.pdf"])
    bound_document = first_existing(
        export_dir,
        [
            "BOUND_DOCUMENT.pdf",
            "BOUND_DOCUMENT.docx",
            "BOUND_DOCUMENT.doc",
            "BOUND_DOCUMENT.pages",
            "BOUND_DOCUMENT.rtf",
            "BOUND_DOCUMENT.txt",
        ],
    )

    if published_pdf:
        public_file = published_pdf
        public_kind_en = "Published public file"
        public_kind_fr = "Fichier public publié"
    elif bound_document:
        public_file = bound_document
        public_kind_en = "Readable/source file"
        public_kind_fr = "Fichier lisible / source"
    else:
        public_file = first_existing(export_dir, ["HumanOrigin_SHARE_CARD.html", "CERTIFICAT_FINAL.html"])
        public_kind_en = "Readable package file"
        public_kind_fr = "Fichier lisible du dossier"

    verify_url = extract_url(export_dir / VERIFY_TXT)
    verify_href = verify_url or VERIFY_TXT

    project_name = (
        recursive_find(manifest, {"project_name", "project", "name"})
        or export_dir.name
    )
    cert_id = recursive_find(manifest, {"certificate_id", "cert_id", "certificateid"}) or "Included in proof file"
    verdict_en, verdict_fr = normalize_verdict(
        recursive_find(manifest, {"verdict", "final_verdict", "humanorigin_verdict"}),
        preferred_exists=preferred_proof is not None,
    )
    confidence_en, confidence_fr = normalize_confidence(
        recursive_find(manifest, {"confidence", "confidence_level", "trust_level"}),
        preferred_exists=preferred_proof is not None,
        verifier_url=verify_url,
        public_file=public_file,
    )

    publication_status = str(
        recursive_find(manifest, {"publication_status"}) or ""
    ).strip().lower()

    if published_pdf or "visible_published_copy_included" in publication_status:
        next_step_en = "Use the included published PDF for public circulation. Keep the v1 proof alongside it for verification."
        next_step_fr = "Utilisez le PDF publié inclus pour la circulation publique. Conservez la preuve v1 à côté pour la vérification."
    elif bound_document and bound_document.lower().endswith(".docx"):
        next_step_en = "Keep the source working file, keep the v1 proof as the reference proof, and publish a PDF later if a public version is needed."
        next_step_fr = "Conservez le document source de travail, gardez la preuve v1 comme preuve de référence, puis publiez un PDF plus tard si une version publique est nécessaire."
    elif bound_document and bound_document.lower().endswith(".pdf"):
        next_step_en = "Use the bound PDF for reading or sharing, and keep the v1 proof alongside it for verification."
        next_step_fr = "Utilisez le PDF lié pour la lecture ou le partage, et gardez la preuve v1 à côté pour la vérification."
    else:
        next_step_en = "Use the readable file for circulation and keep the preferred proof alongside it for verification."
        next_step_fr = "Utilisez le fichier lisible pour la circulation et conservez la preuve préférée à côté pour la vérification."

    files_html = []

    if public_file:
        files_html.append(
            f"""<li><span data-en="Public file" data-fr="Fichier public"></span><code>{html.escape(public_file)}</code></li>"""
        )
    if preferred_proof:
        files_html.append(
            f"""<li><span data-en="Preferred proof" data-fr="Preuve préférée"></span><code>{html.escape(preferred_proof)}</code></li>"""
        )
    if legacy_proof:
        files_html.append(
            f"""<li><span data-en="Compatibility proof" data-fr="Preuve de compatibilité"></span><code>{html.escape(legacy_proof)}</code></li>"""
        )
    if (export_dir / VERIFY_TXT).exists():
        files_html.append(
            f"""<li><span data-en="Verification instructions" data-fr="Instructions de vérification"></span><code>{VERIFY_TXT}</code></li>"""
        )
    if bound_document:
        files_html.append(
            f"""<li><span data-en="Bound document" data-fr="Document lié"></span><code>{html.escape(bound_document)}</code></li>"""
        )
    if published_pdf:
        files_html.append(
            f"""<li><span data-en="Published output" data-fr="Sortie publiée"></span><code>{html.escape(published_pdf)}</code></li>"""
        )

    public_card = build_card(
        eyebrow_en="Send this",
        eyebrow_fr="À envoyer",
        title_en="Send this public file",
        title_fr="Envoyer ce fichier public",
        body_en="Use this file for normal reading, sharing, or public/editorial circulation.",
        body_fr="Utilisez ce fichier pour la lecture, le partage, ou la circulation publique / éditoriale.",
        button_en="Open public file",
        button_fr="Ouvrir le fichier public",
        href=public_file,
        filename=public_file,
        tone="primary",
    )

    reference_card = build_card(
        eyebrow_en="Reference proof",
        eyebrow_fr="Preuve de référence",
        title_en="Verify with this portable proof",
        title_fr="Vérifier avec cette preuve portable",
        body_en="This is the preferred reference proof. It is portable, structured, and intended for verification.",
        body_fr="C’est la preuve de référence préférée. Elle est portable, structurée, et conçue pour la vérification.",
        button_en="Open reference proof",
        button_fr="Ouvrir la preuve de référence",
        href=preferred_proof,
        filename=preferred_proof,
        tone="trust",
    )

    verify_card = build_card(
        eyebrow_en="Verify with this",
        eyebrow_fr="Vérifier avec ceci",
        title_en="Use the public verifier",
        title_fr="Utiliser le vérificateur public",
        body_en="Use the public verification path to check the preferred proof file.",
        body_fr="Utilisez le parcours de vérification public pour contrôler le fichier de preuve préféré.",
        button_en="Open online verifier",
        button_fr="Ouvrir la vérification en ligne",
        href=verify_href,
        filename=verify_url or VERIFY_TXT,
        tone="trust",
    )

    compatibility_card = build_card(
        eyebrow_en="Compatibility only",
        eyebrow_fr="Compatibilité seulement",
        title_en="Open the legacy compatibility proof",
        title_fr="Ouvrir la preuve legacy de compatibilité",
        body_en="This file is included for legacy compatibility only. Use the v1 proof when possible.",
        body_fr="Ce fichier est inclus uniquement pour la compatibilité legacy. Utilisez la preuve v1 quand c’est possible.",
        button_en="Open compatibility proof",
        button_fr="Ouvrir la preuve de compatibilité",
        href=legacy_proof,
        filename=legacy_proof,
        tone="muted",
    )

    html_doc = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HumanOrigin — Open First</title>
  <style>
    :root {{
      --bg: #f5f0e6;
      --paper: rgba(255,255,255,0.72);
      --paper-strong: rgba(255,255,255,0.88);
      --ink: #18212b;
      --muted: #5f6873;
      --line: rgba(24,33,43,0.10);
      --line-strong: rgba(24,33,43,0.16);
      --accent: #142b47;
      --accent-2: #0f5a7a;
      --gold: #a1783f;
      --soft: #eef3f6;
      --success: #1f7a57;
      --warning: #9a6a1d;
      --shadow: 0 24px 60px rgba(20, 28, 37, 0.10);
      --radius-xl: 28px;
      --radius-lg: 20px;
      --radius-md: 14px;
      --maxw: 1180px;
    }}

    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(20,43,71,0.06), transparent 32%),
        radial-gradient(circle at top right, rgba(161,120,63,0.08), transparent 28%),
        linear-gradient(180deg, #f7f3ea 0%, #f1ebdf 100%);
      min-height: 100vh;
      padding: 36px 20px 64px;
    }}

    .wrap {{
      width: min(var(--maxw), 100%);
      margin: 0 auto;
    }}

    .topbar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 18px;
    }}

    .brand {{
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 14px;
      letter-spacing: 0.02em;
    }}

    .brand-badge {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 999px;
      background: linear-gradient(135deg, var(--accent), #223d61);
      color: white;
      font-weight: 700;
      box-shadow: var(--shadow);
    }}

    .lang-switch {{
      display: inline-flex;
      gap: 8px;
      padding: 6px;
      border-radius: 999px;
      background: rgba(255,255,255,0.65);
      border: 1px solid var(--line);
      backdrop-filter: blur(10px);
    }}

    .lang-switch button {{
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 8px 14px;
      border-radius: 999px;
      font-weight: 600;
      cursor: pointer;
    }}

    .lang-switch button.active {{
      background: var(--accent);
      color: white;
    }}

    .hero {{
      background: linear-gradient(180deg, rgba(255,255,255,0.84), rgba(255,255,255,0.68));
      border: 1px solid rgba(255,255,255,0.75);
      box-shadow: var(--shadow);
      border-radius: 36px;
      padding: 34px 30px 28px;
      backdrop-filter: blur(16px);
      margin-bottom: 24px;
    }}

    .hero-kicker {{
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--gold);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-size: 12px;
      margin-bottom: 14px;
    }}

    h1 {{
      margin: 0;
      font-size: clamp(32px, 5vw, 56px);
      line-height: 1.02;
      letter-spacing: -0.03em;
      max-width: 900px;
    }}

    .subtitle {{
      margin-top: 14px;
      color: var(--muted);
      font-size: clamp(16px, 2vw, 19px);
      line-height: 1.55;
      max-width: 840px;
    }}

    .hero-meta {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }}

    .meta-pill {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(20,43,71,0.06);
      border: 1px solid rgba(20,43,71,0.10);
      color: var(--accent);
      font-size: 13px;
      font-weight: 700;
    }}

    .hero-grid {{
      margin-top: 24px;
      display: grid;
      grid-template-columns: 1.35fr 0.65fr;
      gap: 18px;
    }}

    .hero-panel, .hero-side {{
      border-radius: 24px;
      border: 1px solid var(--line);
      background: var(--paper);
      padding: 22px 20px;
    }}

    .panel-label {{
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }}

    .hero-side .id {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      color: var(--accent);
      word-break: break-all;
      display: block;
      margin-top: 8px;
    }}

    .section {{
      margin-top: 24px;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 26px 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }}

    .section h2 {{
      margin: 0 0 8px;
      font-size: 24px;
      letter-spacing: -0.02em;
    }}

    .section-intro {{
      color: var(--muted);
      line-height: 1.6;
      margin-bottom: 18px;
      max-width: 860px;
    }}

    .cards {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }}

    .card {{
      border-radius: 22px;
      border: 1px solid var(--line);
      background: var(--paper-strong);
      padding: 22px 20px 18px;
      display: flex;
      flex-direction: column;
      min-height: 250px;
    }}

    .card.primary {{
      background: linear-gradient(180deg, rgba(20,43,71,0.98), rgba(27,49,77,0.96));
      color: white;
      border-color: rgba(20,43,71,0.18);
    }}

    .card.primary p,
    .card.primary .eyebrow,
    .card.primary code {{
      color: rgba(255,255,255,0.88);
    }}

    .card.trust {{
      background: linear-gradient(180deg, rgba(238,243,246,0.95), rgba(255,255,255,0.88));
      border-color: rgba(15,90,122,0.14);
    }}

    .card.muted {{
      background: rgba(245,240,230,0.74);
      border-style: dashed;
      opacity: 0.92;
    }}

    .card.disabled {{
      opacity: 0.65;
    }}

    .eyebrow {{
      display: inline-flex;
      width: fit-content;
      align-items: center;
      padding: 7px 10px;
      border-radius: 999px;
      background: rgba(20,43,71,0.08);
      color: var(--accent);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }}

    .card.primary .eyebrow {{
      background: rgba(255,255,255,0.14);
      color: white;
    }}

    .card h3 {{
      margin: 0 0 10px;
      font-size: 24px;
      line-height: 1.1;
      letter-spacing: -0.02em;
      min-height: 54px;
    }}

    .card p {{
      margin: 0 0 16px;
      color: var(--muted);
      line-height: 1.6;
      flex: 1;
    }}

    .file-pill {{
      display: inline-flex;
      width: fit-content;
      align-items: center;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(255,255,255,0.70);
      border: 1px solid var(--line);
      margin-bottom: 14px;
    }}

    code {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--accent);
    }}

    .button {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      min-height: 46px;
      padding: 0 16px;
      border-radius: 14px;
      border: 1px solid var(--line-strong);
      color: var(--ink);
      text-decoration: none;
      font-weight: 700;
      background: white;
    }}

    .button.primary {{
      background: white;
      color: var(--accent);
      border-color: rgba(255,255,255,0.20);
    }}

    .card:not(.primary) .button {{
      background: var(--accent);
      color: white;
      border-color: transparent;
    }}

    .metrics {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 12px;
    }}

    .metric {{
      padding: 16px;
      border-radius: 18px;
      border: 1px solid var(--line);
      background: var(--paper-strong);
    }}

    .metric .label {{
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 6px;
    }}

    .metric .value {{
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.03em;
    }}

    .authority {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }}

    .authority .box,
    .next-step,
    .files {{
      border-radius: 20px;
      border: 1px solid var(--line);
      background: var(--paper-strong);
      padding: 18px;
    }}

    .box h3, .next-step h3, .files h3 {{
      margin: 0 0 10px;
      font-size: 18px;
      letter-spacing: -0.02em;
    }}

    .box ul, .files ul {{
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      line-height: 1.75;
    }}

    .box li, .files li {{
      margin-bottom: 6px;
    }}

    .files li code {{
      margin-left: 10px;
    }}

    .footer-note {{
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.65;
    }}

    @media (max-width: 920px) {{
      .hero-grid,
      .cards,
      .authority {{
        grid-template-columns: 1fr;
      }}

      .metrics {{
        grid-template-columns: 1fr;
      }}
    }}

    @media (max-width: 640px) {{
      body {{
        padding: 18px 14px 48px;
      }}
      .hero,
      .section {{
        padding: 22px 18px;
        border-radius: 24px;
      }}
      .topbar {{
        align-items: flex-start;
        flex-direction: column;
      }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <span class="brand-badge">HO</span>
        <span data-en="HumanOrigin verification package" data-fr="Dossier de vérification HumanOrigin"></span>
      </div>
      <div class="lang-switch" aria-label="Language switch">
        <button type="button" class="active" data-lang-btn="en">EN</button>
        <button type="button" data-lang-btn="fr">FR</button>
      </div>
    </div>

    <section class="hero">
      <div class="hero-kicker" data-en="Open this first" data-fr="Ouvrir en premier"></div>
      <h1 data-en="HumanOrigin Verification Package" data-fr="Dossier de vérification HumanOrigin"></h1>
      <div class="subtitle"
           data-en="This package contains a public-facing file, a portable verification proof, and compatibility files. Its structure is designed so a third party can understand what to open, what to trust, and how to verify it."
           data-fr="Ce dossier contient un fichier public à consulter, une preuve portable vérifiable, et des fichiers de compatibilité. Sa structure est conçue pour qu’un tiers comprenne immédiatement quoi ouvrir, à quoi se fier, et comment vérifier."></div>

      <div class="hero-meta">
        <div class="meta-pill" data-en="Open this first" data-fr="Ouvrir en premier"></div>
        <div class="meta-pill" data-en="Portable proof included" data-fr="Preuve portable incluse"></div>
        <div class="meta-pill" data-en="Online verification available" data-fr="Vérification en ligne disponible"></div>
      </div>

      <div class="hero-grid">
        <div class="hero-panel">
          <div class="panel-label" data-en="Package focus" data-fr="Objet du dossier"></div>
          <div data-en="Read this. Trust the preferred proof. Verify with the public verifier. Use the legacy file only when compatibility is required."
               data-fr="Ouvrez ceci. Fiez-vous à la preuve préférée. Vérifiez avec le vérificateur public. N’utilisez le fichier legacy que si une compatibilité est nécessaire."></div>
        </div>
        <div class="hero-side">
          <div class="panel-label" data-en="Package identity" data-fr="Identité du dossier"></div>
          <div><strong data-en="Project" data-fr="Projet"></strong> — {html.escape(str(project_name))}</div>
          <div style="margin-top:8px;"><strong data-en="Reference ID" data-fr="ID de référence"></strong></div>
          <span class="id">{html.escape(str(cert_id))}</span>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 data-en="What to do now" data-fr="Que faire maintenant"></h2>
      <div class="section-intro"
           data-en="Use the package in this order: send the public file, keep the preferred proof as the authoritative portable proof, use the public verification path to check it, and treat the legacy file as compatibility only."
           data-fr="Utilisez le dossier dans cet ordre : envoyez le fichier public, gardez la preuve préférée comme preuve portable de référence, utilisez le parcours de vérification public pour la contrôler, et considérez le fichier legacy comme une compatibilité seulement."></div>

      <div class="cards">
        {public_card}
        {reference_card}
        {verify_card}
        {compatibility_card}
      </div>
    </section>

    <section class="section">
      <h2 data-en="Verdict & confidence" data-fr="Verdict & niveau de confiance"></h2>
      <div class="section-intro"
           data-en="This section clarifies the current status without overclaiming. The package is meant to be readable by a third party before they open technical files."
           data-fr="Cette section clarifie l’état actuel sans sur-promesse. Le dossier est conçu pour être lisible par un tiers avant même l’ouverture des fichiers techniques."></div>

      <div class="metrics">
        <div class="metric">
          <div class="label" data-en="Verdict status" data-fr="Statut du verdict"></div>
          <div class="value">{html.escape(verdict_en)}</div>
          <div style="margin-top:6px;color:var(--muted)">{html.escape(verdict_fr)}</div>
        </div>
        <div class="metric">
          <div class="label" data-en="Confidence level" data-fr="Niveau de confiance"></div>
          <div class="value">{html.escape(confidence_en)}</div>
          <div style="margin-top:6px;color:var(--muted)">{html.escape(confidence_fr)}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 data-en="Reference logic" data-fr="Logique de référence"></h2>
      <div class="authority">
        <div class="box">
          <h3 data-en="Which file is authoritative?" data-fr="Quel fichier fait foi ?"></h3>
          <ul>
            <li><span data-en="Authoritative portable proof" data-fr="Preuve portable de référence"></span><code>{html.escape(preferred_proof or "Not included")}</code></li>
            <li><span data-en="Legacy compatibility proof" data-fr="Preuve legacy de compatibilité"></span><code>{html.escape(legacy_proof or "Not included")}</code></li>
            <li><span data-en="Public-facing file" data-fr="Fichier public"></span><code>{html.escape(public_file or "Not included")}</code></li>
            <li><span data-en="Online verification path" data-fr="Parcours de vérification en ligne"></span><code>{html.escape(verify_url or VERIFY_TXT)}</code></li>
          </ul>
        </div>
        <div class="next-step">
          <h3 data-en="Recommended next step" data-fr="Étape recommandée"></h3>
          <div data-en="{html.escape(next_step_en, quote=True)}" data-fr="{html.escape(next_step_fr, quote=True)}"></div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 data-en="Included files" data-fr="Fichiers inclus"></h2>
      <div class="files">
        <h3 data-en="Package contents" data-fr="Contenu du dossier"></h3>
        <ul>
          {''.join(files_html)}
        </ul>
      </div>
      <div class="footer-note"
           data-en="Preferred proof: CERTIFICAT_FINAL.v1.ho.json. Legacy proof remains included only for compatibility. For normal circulation, use the public-facing file and keep the preferred proof alongside it."
           data-fr="Preuve préférée : CERTIFICAT_FINAL.v1.ho.json. La preuve legacy reste incluse uniquement pour compatibilité. Pour la circulation normale, utilisez le fichier public et gardez la preuve préférée à côté."></div>
    </section>
  </div>

  <script>
    (function () {{
      const buttons = document.querySelectorAll("[data-lang-btn]");
      const nodes = document.querySelectorAll("[data-en][data-fr]");

      function applyLang(lang) {{
        document.documentElement.lang = lang;
        nodes.forEach((node) => {{
          const value = node.getAttribute("data-" + lang);
          if (value !== null) node.textContent = value;
        }});
        buttons.forEach((btn) => {{
          btn.classList.toggle("active", btn.getAttribute("data-lang-btn") === lang);
        }});
        try {{
          localStorage.setItem("ho_open_first_lang", lang);
        }} catch (_) {{}}
      }}

      buttons.forEach((btn) => {{
        btn.addEventListener("click", () => applyLang(btn.getAttribute("data-lang-btn")));
      }});

      let lang = "en";
      try {{
        const saved = localStorage.getItem("ho_open_first_lang");
        if (saved === "fr" || saved === "en") lang = saved;
      }} catch (_) {{}}
      applyLang(lang);
    }})();
  </script>
</body>
</html>
"""

    out = export_dir / "HumanOrigin_OPEN_FIRST.html"
    out.write_text(html_doc, encoding="utf-8")

    print(f"OK rewritten: {out}")


if __name__ == "__main__":
    main()
