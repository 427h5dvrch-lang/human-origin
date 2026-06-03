#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import sys
from pathlib import Path


MANIFEST = "HumanOrigin_MANIFEST.json"
OPEN_FIRST = "HumanOrigin_OPEN_FIRST.html"


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

    manifests = []
    for root in roots:
        if root.exists():
            manifests.extend(root.rglob(MANIFEST))

    if not manifests:
        raise SystemExit("No export package found.")

    manifests = sorted(manifests, key=lambda p: p.stat().st_mtime, reverse=True)
    return manifests[0].parent


def main() -> None:
    export_dir = find_latest_export_dir()
    manifest_path = export_dir / MANIFEST
    open_first_path = export_dir / OPEN_FIRST

    if not manifest_path.exists():
        raise SystemExit(f"Missing manifest: {manifest_path}")
    if not open_first_path.exists():
        raise SystemExit(f"Missing OPEN_FIRST: {open_first_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    txt = open_first_path.read_text(encoding="utf-8")

    if 'data-ho-scope-band="1"' in txt:
        print(f"ALREADY ELEVATED: {open_first_path}")
        return

    document_filename = manifest.get("document_filename") or "Unknown document"
    bound_document_filename = manifest.get("bound_document_filename") or "Unknown bound file"
    bound_document_mime = manifest.get("bound_document_mime") or "Unknown MIME"
    document_sha256 = manifest.get("document_sha256") or "Unknown SHA-256"
    reference_proof = manifest.get("reference_proof_filename") or "CERTIFICAT_FINAL.v1.ho.json"
    verdict = manifest.get("verdict") or "UNKNOWN"

    if verdict == "PREUVE LIMITÉE":
        scope_statement_en = "This package establishes a document-bound proof package, but the current verdict remains incomplete."
        scope_statement_fr = "Ce dossier établit bien un ensemble de preuve lié au document, mais le verdict actuel reste incomplet."
    else:
        scope_statement_en = "This package binds the proof to one specific document and should be interpreted through that exact file relationship."
        scope_statement_fr = "Ce dossier relie la preuve à un document précis et doit être interprété à travers cette relation exacte au fichier."

    css_block = """
    .scope-band {
      margin-top: 24px;
      background: linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.70));
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 24px 22px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
    }

    .scope-head {
      margin-bottom: 16px;
    }

    .scope-head h2 {
      margin: 0 0 8px;
      font-size: 24px;
      letter-spacing: -0.02em;
    }

    .scope-head p {
      margin: 0;
      color: var(--muted);
      line-height: 1.65;
      max-width: 920px;
    }

    .scope-grid {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr 1fr;
      gap: 14px;
    }

    .scope-card {
      border-radius: 22px;
      border: 1px solid var(--line);
      background: var(--paper-strong);
      padding: 18px 18px 16px;
      min-height: 180px;
    }

    .scope-card.primary {
      background: linear-gradient(180deg, rgba(20,43,71,0.96), rgba(27,49,77,0.94));
      border-color: rgba(20,43,71,0.16);
      color: white;
    }

    .scope-card .eyebrow {
      margin-bottom: 12px;
    }

    .scope-card.primary .eyebrow {
      background: rgba(255,255,255,0.14);
      color: white;
    }

    .scope-card h3 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .scope-card p {
      margin: 0 0 14px;
      color: var(--muted);
      line-height: 1.6;
    }

    .scope-card.primary p {
      color: rgba(255,255,255,0.86);
    }

    .scope-meta {
      display: grid;
      gap: 10px;
      margin-top: 8px;
    }

    .scope-line {
      display: grid;
      gap: 6px;
    }

    .scope-label {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }

    .scope-card.primary .scope-label {
      color: rgba(255,255,255,0.72);
    }

    .scope-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.55;
      color: var(--accent);
      word-break: break-word;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255,255,255,0.72);
      border: 1px solid var(--line);
    }

    .scope-card.primary .scope-value {
      background: rgba(255,255,255,0.12);
      border-color: rgba(255,255,255,0.14);
      color: rgba(255,255,255,0.92);
    }

    .scope-note {
      margin-top: 10px;
      color: var(--muted);
      line-height: 1.6;
    }

    .scope-card.primary .scope-note {
      color: rgba(255,255,255,0.82);
    }

    @media (max-width: 920px) {
      .scope-grid {
        grid-template-columns: 1fr;
      }
    }
"""

    html_block = f"""
    <section class="scope-band" data-ho-scope-band="1">
      <div class="scope-head">
        <h2 data-en="What this package certifies" data-fr="Ce que ce dossier certifie"></h2>
        <p
          data-en="HumanOrigin does not certify a vague project state. It binds a portable proof to one specific document file and gives a third party a clear verification path."
          data-fr="HumanOrigin ne certifie pas un état de projet vague. Il relie une preuve portable à un fichier précis et donne à un tiers un chemin clair de vérification."></p>
      </div>

      <div class="scope-grid">
        <article class="scope-card primary">
          <div class="eyebrow" data-en="Bound document" data-fr="Document associé"></div>
          <h3 data-en="This exact file is in scope" data-fr="Ce fichier précis est dans le périmètre"></h3>
          <p
            data-en="The proof package is attached to one document, not to a vague folder or claim."
            data-fr="Le dossier de preuve est attaché à un document précis, pas à un dossier vague ni à une affirmation générale."></p>

          <div class="scope-meta">
            <div class="scope-line">
              <div class="scope-label" data-en="Document filename" data-fr="Nom du document"></div>
              <div class="scope-value">{html.escape(str(document_filename))}</div>
            </div>
            <div class="scope-line">
              <div class="scope-label" data-en="Bound package file" data-fr="Fichier lié dans le dossier"></div>
              <div class="scope-value">{html.escape(str(bound_document_filename))}</div>
            </div>
          </div>
        </article>

        <article class="scope-card">
          <div class="eyebrow" data-en="Portable reference" data-fr="Référence portable"></div>
          <h3 data-en="The proof that matters" data-fr="La preuve qui fait foi"></h3>
          <p
            data-en="The v1 proof is the authoritative portable proof file for this package."
            data-fr="La preuve v1 est le fichier de preuve portable de référence pour ce dossier."></p>

          <div class="scope-meta">
            <div class="scope-line">
              <div class="scope-label" data-en="Reference proof file" data-fr="Fichier de preuve de référence"></div>
              <div class="scope-value">{html.escape(str(reference_proof))}</div>
            </div>
            <div class="scope-line">
              <div class="scope-label" data-en="Bound file type" data-fr="Type du fichier lié"></div>
              <div class="scope-value">{html.escape(str(bound_document_mime))}</div>
            </div>
          </div>
        </article>

        <article class="scope-card">
          <div class="eyebrow" data-en="Binding scope" data-fr="Périmètre du lien"></div>
          <h3 data-en="The relationship is document-specific" data-fr="La relation est spécifique au document"></h3>
          <p
            data-en="{html.escape(scope_statement_en, quote=True)}"
            data-fr="{html.escape(scope_statement_fr, quote=True)}"></p>

          <div class="scope-meta">
            <div class="scope-line">
              <div class="scope-label" data-en="Document SHA-256" data-fr="SHA-256 du document"></div>
              <div class="scope-value">{html.escape(str(document_sha256))}</div>
            </div>
            <div class="scope-line">
              <div class="scope-label" data-en="Current verdict" data-fr="Verdict actuel"></div>
              <div class="scope-value">{html.escape(str(verdict))}</div>
            </div>
          </div>
        </article>
      </div>
    </section>
"""

    if css_block.strip() not in txt:
        if "</style>" not in txt:
            raise SystemExit("Could not find </style> in OPEN_FIRST.")
        txt = txt.replace("</style>", css_block + "\n  </style>", 1)

    marker = '</section>\n\n    <section class="section">'
    if marker not in txt:
        raise SystemExit("Could not find hero -> first section transition in OPEN_FIRST.")
    txt = txt.replace(marker, '</section>\n\n' + html_block + '\n\n    <section class="section">', 1)

    open_first_path.write_text(txt, encoding="utf-8")
    print(f"OK elevated scope: {open_first_path}")


if __name__ == "__main__":
    main()
