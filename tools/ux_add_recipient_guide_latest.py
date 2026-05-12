from pathlib import Path
import html
import json
import re
from datetime import datetime

PROJECTS = Path.home() / "Documents" / "HumanOrigin" / "Projects"

def latest_package_dir():
    candidates = []
    if not PROJECTS.exists():
        raise SystemExit(f"STOP: dossier introuvable: {PROJECTS}")

    for p in PROJECTS.glob("*"):
        if p.is_dir() and (p / "2_SEND_TO_RECIPIENT").exists():
            candidates.append(p)

    if not candidates:
        raise SystemExit("STOP: aucun dossier 2_SEND_TO_RECIPIENT trouvé.")

    return max(candidates, key=lambda x: x.stat().st_mtime)

def find_first(folder, patterns):
    if not folder or not folder.exists():
        return None
    for pat in patterns:
        hits = sorted(folder.glob(pat))
        if hits:
            return hits[0]
    return None

def file_url(p):
    return p.resolve().as_uri() if p else "#"

def safe_name(p):
    return html.escape(p.name) if p else "Non trouvé"

def project_title(pkg):
    for name in ["HumanOrigin_MANIFEST.json", "manifest.json", "MANIFEST.json"]:
        fp = pkg / name
        if fp.exists():
            try:
                data = json.loads(fp.read_text())
                for k in ["project_title", "projectTitle", "title", "project"]:
                    v = data.get(k)
                    if isinstance(v, str) and v.strip():
                        return v.strip()
            except Exception:
                pass
    n = re.sub(r"\s*[—-]\s*HumanOrigin Package$", "", pkg.name).strip()
    return n or "Document"

pkg = latest_package_dir()
send_dir = pkg / "2_SEND_TO_RECIPIENT"

pdf = find_first(send_dir, ["*.pdf"])
proof = find_first(send_dir, ["*.ho.json", "*.json"])

title = project_title(pkg)
generated_at = datetime.now().strftime("%d/%m/%Y à %H:%M")

guide = send_dir / "0_OUVRIR_EN_PREMIER.html"

html_doc = f"""<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HumanOrigin — Document reçu</title>
  <style>
    :root {{
      --navy:#071a2f;
      --navy2:#0b2744;
      --ink:#142033;
      --muted:#647184;
      --line:#dde6ef;
      --soft:#f4f7fb;
      --gold:#c79a3b;
    }}
    * {{ box-sizing:border-box; }}
    body {{
      margin:0;
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",sans-serif;
      color:var(--ink);
      background:
        radial-gradient(circle at top left, rgba(199,154,59,.15), transparent 34%),
        linear-gradient(135deg,#f8fafc,#eef3f8);
      -webkit-font-smoothing:antialiased;
    }}
    .wrap {{
      width:min(920px, calc(100% - 36px));
      margin:44px auto;
    }}
    .hero {{
      background:linear-gradient(135deg,var(--navy),var(--navy2));
      color:white;
      border-radius:28px;
      padding:36px;
      box-shadow:0 26px 70px rgba(7,26,47,.22);
    }}
    .eyebrow {{
      color:rgba(255,255,255,.65);
      font-size:12px;
      letter-spacing:.16em;
      text-transform:uppercase;
      font-weight:800;
      margin-bottom:14px;
    }}
    h1 {{
      font-size:42px;
      line-height:1.04;
      margin:0 0 14px;
      letter-spacing:-.04em;
    }}
    .lead {{
      font-size:18px;
      line-height:1.55;
      color:rgba(255,255,255,.82);
      max-width:720px;
      margin:0;
    }}
    .actions {{
      display:flex;
      flex-wrap:wrap;
      gap:12px;
      margin-top:28px;
    }}
    a.btn {{
      text-decoration:none;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:48px;
      padding:0 18px;
      border-radius:999px;
      font-weight:800;
      font-size:15px;
    }}
    .primary {{
      background:white;
      color:var(--navy);
    }}
    .secondary {{
      background:rgba(255,255,255,.12);
      color:white;
      border:1px solid rgba(255,255,255,.22);
    }}
    .grid {{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:18px;
      margin-top:18px;
    }}
    .card {{
      background:rgba(255,255,255,.92);
      border:1px solid var(--line);
      border-radius:24px;
      padding:24px;
      box-shadow:0 18px 50px rgba(23,38,58,.08);
    }}
    h2 {{
      margin:0 0 10px;
      font-size:22px;
      letter-spacing:-.025em;
    }}
    p {{
      color:var(--muted);
      line-height:1.55;
    }}
    .filebox {{
      margin-top:14px;
      border:1px solid var(--line);
      border-radius:18px;
      padding:14px;
      background:#fff;
    }}
    .label {{
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:.1em;
      color:#7d8795;
      font-weight:800;
      margin-bottom:6px;
    }}
    .filename {{
      font-weight:760;
      word-break:break-word;
    }}
    .steps {{
      display:grid;
      gap:12px;
      margin-top:16px;
    }}
    .step {{
      display:grid;
      grid-template-columns:34px 1fr;
      gap:12px;
      align-items:flex-start;
      padding:14px;
      background:var(--soft);
      border:1px solid var(--line);
      border-radius:18px;
    }}
    .num {{
      width:34px;
      height:34px;
      border-radius:50%;
      display:flex;
      align-items:center;
      justify-content:center;
      background:var(--navy);
      color:white;
      font-weight:800;
    }}
    .step strong {{
      display:block;
      margin-bottom:3px;
    }}
    details {{
      margin-top:16px;
      background:#fff;
      border:1px solid var(--line);
      border-radius:18px;
      padding:14px 16px;
    }}
    summary {{
      cursor:pointer;
      font-weight:800;
      color:var(--navy);
    }}
    .footer {{
      text-align:center;
      color:#8b96a5;
      font-size:13px;
      margin-top:24px;
    }}
    @media (max-width:780px) {{
      .grid {{ grid-template-columns:1fr; }}
      h1 {{ font-size:34px; }}
      .hero {{ padding:28px; }}
    }}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">Document HumanOrigin</div>
      <h1>Vous avez reçu un document vérifiable.</h1>
      <p class="lead">
        Ouvrez le PDF normalement. Une preuve HumanOrigin est incluse si vous souhaitez vérifier le processus humain associé au document.
      </p>
      <div class="actions">
        <a class="btn primary" href="{file_url(pdf)}">Ouvrir le PDF</a>
        <a class="btn secondary" href="{file_url(proof)}">Voir le fichier de vérification</a>
      </div>
    </section>

    <section class="grid">
      <article class="card">
        <h2>Que faire ?</h2>
        <div class="steps">
          <div class="step">
            <div class="num">1</div>
            <div>
              <strong>Lisez le PDF</strong>
              <span>C’est le document principal.</span>
            </div>
          </div>
          <div class="step">
            <div class="num">2</div>
            <div>
              <strong>Gardez le dossier complet</strong>
              <span>Le fichier de vérification doit rester avec le PDF.</span>
            </div>
          </div>
          <div class="step">
            <div class="num">3</div>
            <div>
              <strong>Vérifiez seulement si nécessaire</strong>
              <span>La vérification est optionnelle et publique.</span>
            </div>
          </div>
        </div>

        <div class="filebox">
          <div class="label">PDF à lire</div>
          <div class="filename">{safe_name(pdf)}</div>
        </div>

        <div class="filebox">
          <div class="label">Fichier de vérification inclus</div>
          <div class="filename">{safe_name(proof)}</div>
          <p>Vous n’avez pas besoin de l’ouvrir directement pour lire le document.</p>
        </div>
      </article>

      <aside class="card">
        <h2>Ce que HumanOrigin indique</h2>
        <p>
          HumanOrigin ne certifie pas que le contenu du document est vrai.
          Il indique qu’un processus humain mesuré a été associé à ce document.
        </p>

        <details>
          <summary>Détails avancés</summary>
          <p>
            La vérification utilise le fichier de vérification inclus dans ce dossier.
            Le document peut être ajouté au vérificateur public pour confirmer qu’il correspond à la preuve.
          </p>
          <p>Projet : {html.escape(title)}</p>
          <p>Page générée : {generated_at}</p>
        </details>
      </aside>
    </section>

    <p class="footer">
      HumanOrigin — preuve vérifiable du processus humain associé à un document.
    </p>
  </main>
</body>
</html>
"""

guide.write_text(html_doc)

txt = send_dir / "0_LIRE_AVANT.txt"
txt.write_text(f"""HUMANORIGIN — À LIRE AVANT

Vous avez reçu un document accompagné d’une preuve HumanOrigin.

1. Ouvrez le PDF.
2. Gardez le dossier complet.
3. Le fichier de vérification est inclus si une vérification publique est nécessaire.

Important :
- Le PDF est le document principal.
- Vous n’avez pas besoin d’ouvrir directement le fichier de vérification.
- HumanOrigin ne certifie pas que le contenu du document est vrai.
- HumanOrigin indique qu’un processus humain mesuré a été associé à ce document.

Projet : {title}
""")

print("✅ Guide destinataire ajouté dans le dossier à envoyer.")
print(f"Package : {pkg}")
print(f"Dossier destinataire : {send_dir}")
print(f"Guide HTML : {guide}")
print(f"Guide texte : {txt}")
