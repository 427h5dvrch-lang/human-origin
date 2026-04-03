#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from html import escape
from pathlib import Path

DEFAULT_VERIFIER_URL = "https://427h5dvrch-lang.github.io/humanorigin-verifier/"


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_text(path: Path, text: str) -> None:
    path.write_text(text.rstrip() + "\n", encoding="utf-8")


def first_existing(bundle: Path, names: list[str]) -> Path | None:
    for name in names:
        p = bundle / name
        if p.exists():
            return p
    return None


def detect_bound_document(bundle: Path) -> Path | None:
    candidates = sorted(bundle.glob("BOUND_DOCUMENT.*"))
    return candidates[0] if candidates else None


def file_label(path: Path | None, fallback: str = "Not included") -> str:
    return escape(path.name) if path else fallback


def button(path: Path | None, label: str, variant: str = "secondary") -> str:
    cls = "btn btn-primary" if variant == "primary" else "btn btn-secondary"
    if not path:
        return f'<span class="ghost">{escape(label)} unavailable</span>'
    return f'<a class="{cls}" href="{escape(path.name)}">{escape(label)}</a>'


def source_title(bound_doc: Path | None, public_exists: bool) -> str:
    if not bound_doc:
        return "Source document"
    ext = bound_doc.suffix.lower()
    if ext == ".docx":
        return "Source working document"
    if ext == ".pdf" and public_exists:
        return "Source PDF"
    if ext == ".pdf":
        return "Linked source PDF"
    return "Source document"


def source_description(bound_doc: Path | None, public_exists: bool) -> str:
    if not bound_doc:
        return "No source document is included in this package."
    ext = bound_doc.suffix.lower()
    if ext == ".docx" and public_exists:
        return "This is the editable working source. It remains useful for production and archive continuity, but it is no longer the main circulation file."
    if ext == ".docx":
        return "This is the editable working source linked to the proof."
    if ext == ".pdf" and public_exists:
        return "This is the bound source PDF linked to the proof. The published PDF remains the main public file."
    if ext == ".pdf":
        return "This is the bound source PDF linked to the proof."
    return "This is the source document linked to the HumanOrigin proof."




def build_open_first(
    public_doc: Path | None,
    bound_doc: Path | None,
    reference_proof: Path | None,
    legacy_proof: Path | None,
    verifier_url: str,
) -> str:
    public_exists = public_doc is not None
    primary_doc = public_doc or bound_doc

    if public_exists:
        primary_title_en = "Public document"
        primary_title_fr = "Document public"
        primary_desc_en = "This is the main readable file. Open it first, send it first, and attach it first."
        primary_desc_fr = "C’est le fichier principal lisible. Ouvrez-le d’abord, envoyez-le d’abord et joignez-le d’abord."
        primary_btn_en = "Open public document"
        primary_btn_fr = "Ouvrir le document public"
    elif bound_doc and bound_doc.suffix.lower() == ".docx":
        primary_title_en = "Source working document"
        primary_title_fr = "Document source de travail"
        primary_desc_en = "No public PDF is included yet. Use the source working document as the main readable file and keep the reference proof with it."
        primary_desc_fr = "Aucun PDF public n’est encore inclus. Utilisez le document source de travail comme fichier principal lisible et gardez la preuve de référence avec lui."
        primary_btn_en = "Open source document"
        primary_btn_fr = "Ouvrir le document source"
    elif bound_doc:
        primary_title_en = "Source document"
        primary_title_fr = "Document source"
        primary_desc_en = "No separate public file is included yet. Use the source document as the main readable file and keep the reference proof with it."
        primary_desc_fr = "Aucun fichier public séparé n’est encore inclus. Utilisez le document source comme fichier principal lisible et gardez la preuve de référence avec lui."
        primary_btn_en = "Open source document"
        primary_btn_fr = "Ouvrir le document source"
    else:
        primary_title_en = "No main readable document included"
        primary_title_fr = "Aucun document principal lisible inclus"
        primary_desc_en = "This package does not currently include a readable main document."
        primary_desc_fr = "Ce package n’inclut pas actuellement de document principal lisible."
        primary_btn_en = "Open main document"
        primary_btn_fr = "Ouvrir le document principal"

    proof_desc_en = (
        "This is the technical verification file. Keep it with the readable document when you send, archive, or verify the package. It is not meant to be read like a normal document."
        if reference_proof
        else "No verification file is included in this package."
    )
    proof_desc_fr = (
        "C’est le fichier technique de vérification. Gardez-le avec le document lisible lorsque vous envoyez, archivez ou vérifiez le package. Il n’est pas destiné à être lu comme un document normal."
        if reference_proof
        else "Aucun fichier de vérification n’est inclus dans ce package."
    )

    if public_exists and reference_proof:
        share_line_en = "Simple rule: send the readable document and keep the .ho.json verification file with it."
        share_line_fr = "Règle simple : envoyez le document lisible et gardez le fichier .ho.json de vérification avec."
    elif primary_doc and reference_proof:
        share_line_en = "Normal sending rule: send these two files together."
        share_line_fr = "Règle simple : envoyez ces deux fichiers ensemble."
    else:
        share_line_en = "Keep the reference proof alongside the document whenever circulation or verification matters."
        share_line_fr = "Gardez la preuve de référence avec le document dès que la circulation ou la vérification compte."

    if not bound_doc:
        source_title_en = "Source document"
        source_title_fr = "Document source"
        source_desc_en = "No source document is included in this package."
        source_desc_fr = "Aucun document source n’est inclus dans ce package."
    elif bound_doc.suffix.lower() == ".docx" and public_exists:
        source_title_en = "Source working document"
        source_title_fr = "Document source de travail"
        source_desc_en = "This is the editable working source. It remains useful for production and archive continuity, but it is no longer the main circulation file."
        source_desc_fr = "C’est la source de travail modifiable. Elle reste utile pour la production et la continuité d’archive, mais ce n’est plus le fichier principal de circulation."
    elif bound_doc.suffix.lower() == ".docx":
        source_title_en = "Source working document"
        source_title_fr = "Document source de travail"
        source_desc_en = "This is the editable working source linked to the proof."
        source_desc_fr = "C’est la source de travail modifiable liée à la preuve."
    elif bound_doc.suffix.lower() == ".pdf" and public_exists:
        source_title_en = "Source PDF"
        source_title_fr = "PDF source"
        source_desc_en = "This is the bound source PDF linked to the proof. The published PDF remains the main public file."
        source_desc_fr = "C’est le PDF source lié à la preuve. Le PDF publié reste le fichier public principal."
    elif bound_doc.suffix.lower() == ".pdf":
        source_title_en = "Linked source PDF"
        source_title_fr = "PDF source lié"
        source_desc_en = "This is the bound source PDF linked to the proof."
        source_desc_fr = "C’est le PDF source lié à la preuve."
    else:
        source_title_en = "Source document"
        source_title_fr = "Document source"
        source_desc_en = "This is the source document linked to the HumanOrigin proof."
        source_desc_fr = "C’est le document source lié à la preuve HumanOrigin."

    def dual(en: str, fr: str) -> str:
        return f'<span data-lang="en">{escape(en)}</span><span data-lang="fr">{escape(fr)}</span>'

    def action(path: Path | None, en: str, fr: str, variant: str = "secondary") -> str:
        cls = "btn btn-primary" if variant == "primary" else "btn btn-secondary"
        if not path:
            return f'<span class="ghost">{dual(en + " unavailable", fr + " indisponible")}</span>'
        return f'<a class="{cls}" href="{escape(path.name)}">{dual(en, fr)}</a>'

    def chip_value(path: Path | None, en_fallback: str, fr_fallback: str) -> str:
        return escape(path.name) if path else dual(en_fallback, fr_fallback)

    return f"""<!doctype html>
<html lang="en" data-current-lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HumanOrigin — Open First</title>
  <style>
    :root {{
      --paper: #f6f1e8;
      --card: rgba(255,255,255,0.84);
      --line: rgba(17,24,39,0.08);
      --text: #111827;
      --muted: #5f6773;
      --soft: rgba(17,24,39,0.04);
      --shadow: 0 18px 48px rgba(15,23,42,0.07);
      --radius: 26px;
      --radius-sm: 18px;
      --accent: #0f172a;
    }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(255,255,255,0.96), transparent 32%),
        linear-gradient(180deg, #faf6ef 0%, var(--paper) 100%);
      line-height: 1.5;
    }}
    [data-lang] {{ display: none; }}
    html[data-current-lang="en"] [data-lang="en"] {{ display: inline; }}
    html[data-current-lang="fr"] [data-lang="fr"] {{ display: inline; }}

    .wrap {{
      max-width: 1120px;
      margin: 0 auto;
      padding: 40px 24px 72px;
    }}
    .surface {{
      background: var(--card);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
    }}
    .hero {{
      border-radius: 32px;
      padding: 30px;
    }}
    .hero-top {{
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }}
    .lang-switch {{
      display: inline-flex;
      gap: 8px;
      background: rgba(17,24,39,0.04);
      border: 1px solid rgba(17,24,39,0.08);
      border-radius: 999px;
      padding: 6px;
      flex-shrink: 0;
    }}
    .lang-btn {{
      border: 0;
      background: transparent;
      color: var(--text);
      font-weight: 800;
      padding: 8px 12px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 13px;
    }}
    .lang-btn.is-active {{
      background: var(--accent);
      color: #fff;
    }}
    .eyebrow {{
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 14px;
      font-weight: 800;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(36px, 6vw, 64px);
      line-height: 0.98;
      letter-spacing: -0.055em;
      max-width: 820px;
    }}
    .lead {{
      margin: 18px 0 0;
      max-width: 860px;
      font-size: 19px;
      color: var(--muted);
    }}
    .pill-row {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }}
    .pill {{
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 0 14px;
      border-radius: 999px;
      background: rgba(17,24,39,0.045);
      border: 1px solid rgba(17,24,39,0.07);
      color: var(--text);
      font-size: 13px;
      font-weight: 760;
    }}
    .pill.strong {{
      background: var(--accent);
      color: #fff;
      border-color: transparent;
    }}
    .share-line {{
      margin-top: 18px;
      padding: 14px 16px;
      border-radius: 18px;
      background: var(--soft);
      border: 1px solid rgba(17,24,39,0.07);
      color: var(--muted);
      font-size: 14px;
    }}
    .pair-box {{
      margin-top: 18px;
      padding: 18px;
      border-radius: 22px;
      background: rgba(17,24,39,0.03);
      border: 1px solid rgba(17,24,39,0.07);
    }}
    .pair-title {{
      margin: 0 0 12px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 800;
    }}
    .pair-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }}
    .pair-card {{
      border-radius: 18px;
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(17,24,39,0.07);
      padding: 16px;
    }}
    .pair-label {{
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 800;
      margin-bottom: 10px;
    }}
    .pair-name {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text);
      word-break: break-word;
    }}
    .decision-grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      margin-top: 22px;
    }}
    .decision {{
      border-radius: 28px;
      padding: 26px;
    }}
    .label {{
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 12px;
      font-weight: 800;
    }}
    h2 {{
      margin: 0;
      font-size: clamp(28px, 4vw, 40px);
      line-height: 1.02;
      letter-spacing: -0.04em;
    }}
    .sub {{
      margin-top: 14px;
      font-size: 16px;
      color: var(--muted);
      max-width: 560px;
    }}
    .file-chip {{
      display: inline-flex;
      align-items: center;
      margin-top: 16px;
      padding: 7px 11px;
      border-radius: 999px;
      background: rgba(17,24,39,0.045);
      border: 1px solid rgba(17,24,39,0.06);
      color: var(--muted);
      font-size: 13px;
      word-break: break-word;
      max-width: 100%;
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
      min-height: 46px;
      padding: 0 16px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 700;
      transition: transform 120ms ease, opacity 120ms ease;
    }}
    .btn:hover {{
      transform: translateY(-1px);
      opacity: 0.97;
    }}
    .btn-primary {{
      background: var(--accent);
      color: #fff;
    }}
    .btn-secondary {{
      color: var(--text);
      background: rgba(17,24,39,0.05);
      border: 1px solid rgba(17,24,39,0.08);
    }}
    .ghost {{
      display: inline-flex;
      align-items: center;
      min-height: 46px;
      padding: 0 16px;
      border-radius: 999px;
      font-size: 14px;
      color: var(--muted);
      background: rgba(17,24,39,0.03);
      border: 1px dashed rgba(17,24,39,0.10);
    }}
    .section {{
      margin-top: 22px;
      border-radius: 28px;
      padding: 24px;
    }}
    .section-head {{
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }}
    .section-head h3 {{
      margin: 0;
      font-size: 20px;
      letter-spacing: -0.03em;
    }}
    .section-head p {{
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }}
    .secondary-grid {{
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
    }}
    .mini {{
      border-radius: 20px;
      background: rgba(17,24,39,0.03);
      border: 1px solid rgba(17,24,39,0.07);
      padding: 18px;
      min-height: 220px;
    }}
    .mini h4 {{
      margin: 0;
      font-size: 22px;
      line-height: 1.05;
      letter-spacing: -0.03em;
    }}
    .mini p {{
      margin: 12px 0 0;
      color: var(--muted);
      font-size: 15px;
    }}
    .mini .actions {{
      margin-top: 14px;
    }}
    .foot-note {{
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: var(--radius-sm);
      background: var(--soft);
      border: 1px solid rgba(17,24,39,0.07);
      color: var(--muted);
      font-size: 14px;
    }}
    @media (max-width: 980px) {{
      .pair-grid, .decision-grid, .secondary-grid {{
        grid-template-columns: 1fr;
      }}
      h1 {{
        max-width: none;
      }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="surface hero">
      <div class="hero-top">
        <div>
          <div class="eyebrow">{dual("HumanOrigin · What to send", "HumanOrigin · Quoi envoyer")}</div>
          <h1>{dual("Send the readable document. Keep the verification file with it.", "Envoyez le document lisible. Gardez le fichier de vérification avec.")}</h1>
        </div>

        <div class="lang-switch">
          <button class="lang-btn is-active" data-lang-switch="en">EN</button>
          <button class="lang-btn" data-lang-switch="fr">FR</button>
        </div>
      </div>

      <p class="lead">
        {dual(
            "The readable document is the file a person reads and sends. The .ho.json file is a technical verification file. Keep it with the document, but do not treat it as a normal reading file.",
            "Le document lisible est le fichier qu’une personne lit et envoie. Le fichier .ho.json est un fichier technique de vérification. Gardez-le avec le document, mais ne le traitez pas comme un fichier de lecture normal."
        )}
      </p>

      <div class="pill-row">
        <div class="pill strong">{dual("Readable file to send", "Fichier lisible à envoyer")}</div>
        <div class="pill">{dual("Technical verification file to keep with it", "Fichier technique de vérification à garder avec")}</div>
        <div class="pill">{dual("Open the proof file only if needed", "Ouvrez le fichier de preuve seulement si nécessaire")}</div>
      </div>

      <div class="pair-box">
        <div class="pair-title">{dual("Normal sending", "Envoi normal")}</div>
        <div class="pair-grid">
          <div class="pair-card">
            <div class="pair-label">{dual("1. Readable file", "1. Fichier lisible")}</div>
            <div class="pair-name">{chip_value(primary_doc, "No main document included", "Aucun document principal inclus")}</div>
          </div>
          <div class="pair-card">
            <div class="pair-label">{dual("2. Verification file to keep with it", "2. Fichier de vérification à garder avec")}</div>
            <div class="pair-name">{chip_value(reference_proof, "No reference proof included", "Aucune preuve de référence incluse")}</div>
          </div>
        </div>
      </div>

      <div class="share-line">{dual(share_line_en, share_line_fr)}</div>
    </section>

    <section class="decision-grid">
      <article class="surface decision">
        <div class="label">{dual("Readable file", "Fichier lisible")}</div>
        <h2>{dual(primary_title_en, primary_title_fr)}</h2>
        <p class="sub">{dual(primary_desc_en, primary_desc_fr)}</p>
        <div class="file-chip">{chip_value(primary_doc, "No main document included", "Aucun document principal inclus")}</div>
        <div class="actions">
          {action(primary_doc, primary_btn_en, primary_btn_fr, "primary")}
        </div>
      </article>

      <article class="surface decision">
        <div class="label">{dual("Verification file", "Fichier de vérification")}</div>
        <h2>{dual("Verification file", "Fichier de vérification")}</h2>
        <p class="sub">{dual(proof_desc_en, proof_desc_fr)}</p>
        <div class="file-chip">{chip_value(reference_proof, "No reference proof included", "Aucune preuve de référence incluse")}</div>
        <div class="actions">
          {action(reference_proof, "Open verification file (technical)", "Ouvrir le fichier de vérification (technique)")}
        </div>
      </article>
    </section>

    <section class="surface section">
      <div class="section-head">
        <h3>{dual("Only if needed", "Seulement si nécessaire")}</h3>
        <p>{dual("Verifier, source files, and older compatibility files.", "Vérificateur, fichiers source et anciens fichiers de compatibilité.")}</p>
      </div>

      <div class="secondary-grid">
        <article class="mini">
          <div class="label">{dual("Underlying material", "Matériel sous-jacent")}</div>
          <h4>{dual(source_title_en, source_title_fr)}</h4>
          <div class="file-chip">{chip_value(bound_doc, "Not included", "Non inclus")}</div>
          <p>{dual(source_desc_en, source_desc_fr)}</p>
          <div class="actions">
            {action(bound_doc, "Open source document", "Ouvrir le document source")}
          </div>
        </article>

        <article class="mini">
          <div class="label">{dual("Compatibility", "Compatibilité")}</div>
          <h4>{dual("Older compatibility file", "Ancien fichier de compatibilité")}</h4>
          <div class="file-chip">{chip_value(legacy_proof, "Not included", "Non incluse")}</div>
          <p>
            {dual(
                "This file remains in the bundle for older tooling or older exchange flows. It is no longer the preferred proof when the v1 proof is present.",
                "Ce fichier reste dans le bundle pour les anciens outils ou anciens flux d’échange. Ce n’est plus la preuve privilégiée lorsque la preuve v1 est présente."
            )}
          </p>
          <div class="actions">
            {action(legacy_proof, "Open legacy file", "Ouvrir le fichier legacy")}
          </div>
        </article>

        <article class="mini">
          <div class="label">{dual("Verify only if needed", "Vérifiez seulement si nécessaire")}</div>
          <h4>{dual("Independent check", "Contrôle indépendant")}</h4>
          <p>
            {dual(
                "Most recipients do not need to verify immediately. Use the verifier for an external proof check or a document-hash confirmation.",
                "La plupart des destinataires n’ont pas besoin de vérifier immédiatement. Utilisez le vérificateur pour un contrôle externe de la preuve ou une confirmation du hash du document."
            )}
          </p>
          <div class="actions">
            <a class="btn btn-secondary" href="{escape(verifier_url)}">{dual("Open verifier", "Ouvrir le vérificateur")}</a>
          </div>
        </article>

        <article class="mini">
          <div class="label">{dual("What HumanOrigin means", "Ce que HumanOrigin signifie")}</div>
          <h4>{dual("Measured human process", "Processus humain mesuré")}</h4>
          <p>
            {dual(
                "HumanOrigin certifies that a measured human process was linked to a specific document. It does not certify that the document is true, accurate, lawful, ethical, or institutionally endorsed.",
                "HumanOrigin certifie qu’un processus humain mesuré a été lié à un document précis. Il ne certifie pas que le document est vrai, exact, licite, éthique ou institutionnellement approuvé."
            )}
          </p>
        </article>
      </div>

      <div class="foot-note">
        {dual(
            "Use this page only to understand the package. In normal use, people read the main document and keep the .ho.json verification file with it.",
            "Utilisez cette page uniquement pour comprendre le package. En usage normal, les gens lisent le document principal et gardent avec lui le fichier .ho.json de vérification."
        )}
      </div>
    </section>
  </div>

  <script>
    (function () {{
      const root = document.documentElement;
      const buttons = document.querySelectorAll("[data-lang-switch]");
      const saved = localStorage.getItem("humanorigin_open_first_lang");
      const initial = saved === "fr" ? "fr" : "en";

      function apply(lang) {{
        root.setAttribute("data-current-lang", lang);
        buttons.forEach(btn => btn.classList.toggle("is-active", btn.getAttribute("data-lang-switch") === lang));
        localStorage.setItem("humanorigin_open_first_lang", lang);
      }}

      buttons.forEach(btn => btn.addEventListener("click", () => apply(btn.getAttribute("data-lang-switch"))));
      apply(initial);
    }})();
  </script>
</body>
</html>"""


def build_published_alias(public_doc: Path | None, reference_proof: Path | None, bound_doc: Path | None) -> str:
    public_btn = f'<a class="btn btn-secondary" href="{escape(public_doc.name)}">Open public document</a>' if public_doc else ""
    proof_btn = f'<a class="btn btn-secondary" href="{escape(reference_proof.name)}">Open reference proof</a>' if reference_proof else ""
    source_btn = f'<a class="btn btn-secondary" href="{escape(bound_doc.name)}">Open source document</a>' if bound_doc else ""

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="1.5; url=HumanOrigin_OPEN_FIRST.html">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HumanOrigin — Companion Page</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #faf6ef 0%, #f3ede4 100%);
      color: #111827;
    }}
    .card {{
      width: min(760px, 100%);
      background: rgba(255,255,255,0.86);
      border: 1px solid rgba(17,24,39,0.10);
      border-radius: 28px;
      box-shadow: 0 18px 48px rgba(15,23,42,0.08);
      padding: 30px;
    }}
    .eyebrow {{
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 10px;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(28px, 5vw, 42px);
      line-height: 1.04;
      letter-spacing: -0.04em;
    }}
    p {{
      margin: 14px 0 0;
      color: #5b6472;
      font-size: 17px;
      line-height: 1.55;
    }}
    .actions {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 22px;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      padding: 0 16px;
      border-radius: 999px;
      text-decoration: none;
      font-weight: 650;
    }}
    .btn-primary {{ color: #fff; background: #111827; }}
    .btn-secondary {{
      color: #111827;
      background: rgba(17,24,39,0.05);
      border: 1px solid rgba(17,24,39,0.08);
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">HumanOrigin · Secondary companion page</div>
    <h1>Use the main public entry instead.</h1>
    <p>
      The public reading path now starts with <strong>HumanOrigin_OPEN_FIRST.html</strong>.
      This page remains only as a companion page inside the bundle.
    </p>
    <div class="actions">
      <a class="btn btn-primary" href="HumanOrigin_OPEN_FIRST.html">Open main entry</a>
      {public_btn}
      {proof_btn}
      {source_btn}
    </div>
  </div>
</body>
</html>"""


def build_readme(
    public_doc: Path | None,
    bound_doc: Path | None,
    reference_proof: Path | None,
    legacy_proof: Path | None,
    verifier_url: str,
) -> str:
    public_name = public_doc.name if public_doc else "No public PDF included yet"
    source_name = bound_doc.name if bound_doc else "Not included"
    ref_name = reference_proof.name if reference_proof else "Not included"
    legacy_name = legacy_proof.name if legacy_proof else "Not included"

    return f"""HUMANORIGIN — START HERE

Main entry
- HumanOrigin_OPEN_FIRST.html

Public path
1. Open the public document first
   {public_name}

2. Keep the reference proof with it
   {ref_name}

3. Treat the source document as underlying material
   {source_name}

4. Keep the legacy file only for compatibility when needed
   {legacy_name}

5. Verify only if needed
   {verifier_url}

Meaning
HumanOrigin certifies that a measured human process was linked to a specific document.
It does not certify that the document is true, accurate, lawful, ethical, or institutionally endorsed.
"""


def build_verify(reference_proof: Path | None, bound_doc: Path | None, verifier_url: str) -> str:
    ref_name = reference_proof.name if reference_proof else "CERTIFICAT_FINAL.v1.ho.json"
    source_name = bound_doc.name if bound_doc else "BOUND_DOCUMENT.*"

    return f"""HUMANORIGIN — OPTIONAL VERIFICATION

Verification is secondary in the package reading path.

Recommended order
1. Open the public document
2. Keep the reference proof with it
3. Verify only if you want an independent external check

Verifier
{verifier_url}

Recommended verification files
- Reference proof: {ref_name}
- Source document: {source_name}

Interpretation
- Preferred proof: CERTIFICAT_FINAL.v1.ho.json
- Public document: HumanOrigin_PUBLISHED.pdf when included
- Source document: BOUND_DOCUMENT.*
"""


def update_manifest(
    manifest_path: Path,
    public_doc: Path | None,
    bound_doc: Path | None,
    reference_proof: Path | None,
    legacy_proof: Path | None,
    verifier_url: str,
) -> None:
    data = read_json(manifest_path)
    data["primary_entry_file"] = "HumanOrigin_OPEN_FIRST.html"
    data["public_document_filename"] = public_doc.name if public_doc else None
    data["public_document_role"] = "public_document" if public_doc else "not_included"
    data["reference_proof_filename"] = reference_proof.name if reference_proof else None
    data["reference_proof_role"] = "preferred_portable_proof"
    data["source_document_filename"] = bound_doc.name if bound_doc else None
    data["legacy_compatibility_filename"] = legacy_proof.name if legacy_proof else None
    data["secondary_public_page"] = "HumanOrigin_PUBLISHED.html"
    data["verification_url"] = verifier_url
    data["verification_priority"] = "secondary_optional"
    data["package_hierarchy_version"] = "public-clarity-v3"
    data["recommended_share_file"] = public_doc.name if public_doc else "HumanOrigin_OPEN_FIRST.html"
    manifest_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: reframe_public_bundle.py /path/to/export_bundle", file=sys.stderr)
        return 1

    bundle = Path(sys.argv[1]).expanduser().resolve()
    if not bundle.exists() or not bundle.is_dir():
        print(f"Bundle directory not found: {bundle}", file=sys.stderr)
        return 1

    manifest_path = bundle / "HumanOrigin_MANIFEST.json"
    manifest = read_json(manifest_path)

    verifier_url = (
        manifest.get("verification_url")
        or manifest.get("verifier_url")
        or manifest.get("public_verifier_url")
        or DEFAULT_VERIFIER_URL
    )

    public_doc = first_existing(bundle, ["HumanOrigin_PUBLISHED.pdf"])
    if public_doc is None:
        bound_probe = detect_bound_document(bundle)
        if bound_probe and bound_probe.suffix.lower() == ".pdf":
            public_doc = bound_probe

    bound_doc = detect_bound_document(bundle)
    reference_proof = first_existing(bundle, ["CERTIFICAT_FINAL.v1.ho.json", "CERTIFICAT_FINAL.ho.json"])
    legacy_proof = (bundle / "CERTIFICAT_FINAL.ho.json") if (bundle / "CERTIFICAT_FINAL.ho.json").exists() else None

    write_text(
        bundle / "HumanOrigin_OPEN_FIRST.html",
        build_open_first(public_doc, bound_doc, reference_proof, legacy_proof, verifier_url),
    )
    write_text(
        bundle / "HumanOrigin_PUBLISHED.html",
        build_published_alias(public_doc, reference_proof, bound_doc),
    )
    write_text(
        bundle / "HumanOrigin_READ_ME_FIRST.txt",
        build_readme(public_doc, bound_doc, reference_proof, legacy_proof, verifier_url),
    )
    write_text(
        bundle / "HumanOrigin_VERIFY.txt",
        build_verify(reference_proof, bound_doc, verifier_url),
    )

    if manifest_path.exists():
        update_manifest(manifest_path, public_doc, bound_doc, reference_proof, legacy_proof, verifier_url)

    print(f"OK: premium public bundle refresh -> {bundle}")
    print(f"  public_document = {public_doc.name if public_doc else 'None'}")
    print(f"  reference_proof = {reference_proof.name if reference_proof else 'None'}")
    print(f"  source_document = {bound_doc.name if bound_doc else 'None'}")
    print(f"  legacy_file = {legacy_proof.name if legacy_proof else 'None'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
