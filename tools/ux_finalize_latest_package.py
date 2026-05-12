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
        if not p.is_dir():
            continue
        if (p / "1_OPEN_FIRST.html").exists() or (p / "HumanOrigin_OPEN_FIRST.html").exists():
            candidates.append(p)

    if not candidates:
        raise SystemExit("STOP: aucun package HumanOrigin trouvé.")

    return max(candidates, key=lambda x: x.stat().st_mtime)

def find_first(folder, patterns):
    for pat in patterns:
        hits = sorted(folder.glob(pat))
        if hits:
            return hits[0]
    return None

def file_url(p):
    return p.resolve().as_uri()

def safe_name(p):
    return html.escape(p.name) if p else "Non trouvé"

def read_manifest(pkg):
    for name in ["HumanOrigin_MANIFEST.json", "manifest.json", "MANIFEST.json"]:
        fp = pkg / name
        if fp.exists():
            try:
                return json.loads(fp.read_text())
            except Exception:
                return {}
    return {}

def project_title_from(pkg, manifest):
    for k in ["project_title", "projectTitle", "title", "project"]:
        v = manifest.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    name = pkg.name
    name = re.sub(r"\s*[—-]\s*HumanOrigin Package$", "", name).strip()
    return name or "Document"

pkg = latest_package_dir()
manifest = read_manifest(pkg)
project_title = project_title_from(pkg, manifest)

send_dir = pkg / "2_SEND_TO_RECIPIENT"
tech_dir = pkg / "3_TECHNICAL_PROOF_ARCHIVE"

pdf = find_first(send_dir, ["*.pdf"]) if send_dir.exists() else None
proof = find_first(send_dir, ["*.ho.json", "*.json"]) if send_dir.exists() else None

if not pdf:
    pdf = find_first(pkg, ["HumanOrigin_PUBLISHED.pdf", "*.pdf"])

if not proof:
    proof = find_first(pkg, ["CERTIFICAT_FINAL.v1.ho.json", "*PROOF*.json", "*.ho.json"])

send_url = file_url(send_dir) if send_dir.exists() else file_url(pkg)
pdf_url = file_url(pdf) if pdf else "#"
proof_url = file_url(proof) if proof else "#"
tech_url = file_url(tech_dir) if tech_dir.exists() else "#"

message = f"""Bonjour,

Je vous transmets le dossier HumanOrigin associé au document.

À ouvrir en priorité : le PDF présent dans le dossier d’envoi.

Une preuve HumanOrigin est également incluse. Elle permet une vérification publique si nécessaire, mais vous n’avez pas besoin de l’ouvrir directement.

HumanOrigin ne certifie pas que le contenu du document est vrai. Il indique qu’un processus humain mesuré a été associé à ce document.

Bien à vous,"""

subject = f"Document à consulter — preuve HumanOrigin jointe"
mailto_body = message.replace("\n", "%0D%0A")
mailto_subject = subject.replace(" ", "%20").replace("—", "%E2%80%94")
mailto = f"mailto:?subject={mailto_subject}&body={mailto_body}"

generated_at = datetime.now().strftime("%d/%m/%Y à %H:%M")

html_doc = f"""<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HumanOrigin — Package prêt</title>
  <style>
    :root {{
      --navy:#071a2f;
      --navy2:#0b2744;
      --ink:#122033;
      --muted:#637083;
      --line:#dfe6ee;
      --soft:#f4f7fb;
      --paper:#ffffff;
      --ok:#0f766e;
      --gold:#c79a3b;
    }}
    * {{ box-sizing:border-box; }}
    body {{
      margin:0;
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",sans-serif;
      color:var(--ink);
      background:
        radial-gradient(circle at top left, rgba(199,154,59,.16), transparent 34%),
        linear-gradient(135deg,#f7f9fc 0%,#eef3f8 100%);
      -webkit-font-smoothing:antialiased;
    }}
    .wrap {{
      width:min(1040px, calc(100% - 40px));
      margin:42px auto;
    }}
    .hero {{
      background:linear-gradient(135deg,var(--navy),var(--navy2));
      color:white;
      border-radius:28px;
      padding:38px;
      box-shadow:0 28px 80px rgba(7,26,47,.22);
      position:relative;
      overflow:hidden;
    }}
    .hero:after {{
      content:"";
      position:absolute;
      right:-90px;
      top:-90px;
      width:240px;
      height:240px;
      border:1px solid rgba(255,255,255,.16);
      border-radius:50%;
    }}
    .eyebrow {{
      color:rgba(255,255,255,.68);
      font-size:12px;
      letter-spacing:.16em;
      text-transform:uppercase;
      font-weight:700;
      margin-bottom:14px;
    }}
    h1 {{
      font-size:46px;
      line-height:1.03;
      margin:0 0 14px;
      letter-spacing:-.045em;
    }}
    .lead {{
      font-size:19px;
      line-height:1.55;
      color:rgba(255,255,255,.82);
      max-width:760px;
      margin:0;
    }}
    .hero-actions {{
      display:flex;
      flex-wrap:wrap;
      gap:12px;
      margin-top:30px;
    }}
    a.btn, button.btn {{
      appearance:none;
      border:0;
      text-decoration:none;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:48px;
      padding:0 18px;
      border-radius:999px;
      font-weight:750;
      font-size:15px;
      cursor:pointer;
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
      grid-template-columns:1.15fr .85fr;
      gap:18px;
      margin-top:18px;
    }}
    .card {{
      background:rgba(255,255,255,.9);
      border:1px solid rgba(223,230,238,.9);
      border-radius:24px;
      padding:24px;
      box-shadow:0 18px 60px rgba(23,38,58,.08);
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
    .steps {{
      display:grid;
      gap:12px;
      margin-top:18px;
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
      font-size:14px;
    }}
    .step strong {{
      display:block;
      margin-bottom:3px;
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
    .actions-row {{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      margin-top:16px;
    }}
    .smallbtn {{
      color:var(--navy);
      background:#eef3f8;
      border:1px solid #dbe5ef;
    }}
    .message {{
      white-space:pre-wrap;
      background:#fbfcfe;
      border:1px solid var(--line);
      border-radius:18px;
      padding:16px;
      color:#243247;
      line-height:1.5;
      font-size:14px;
    }}
    details {{
      margin-top:18px;
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
    .advanced {{
      margin-top:12px;
      display:grid;
      gap:10px;
      color:var(--muted);
      font-size:14px;
    }}
    .footer {{
      text-align:center;
      color:#8b96a5;
      font-size:13px;
      margin:26px 0 0;
    }}
    @media (max-width:820px) {{
      .grid {{ grid-template-columns:1fr; }}
      h1 {{ font-size:36px; }}
      .hero {{ padding:28px; }}
    }}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">HumanOrigin Package</div>
      <h1>Votre package est prêt.</h1>
      <p class="lead">
        Envoyez le dossier préparé au destinataire. Il contient le PDF lisible et le fichier de vérification HumanOrigin.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="{send_url}">Ouvrir le dossier à envoyer</a>
        <a class="btn secondary" href="{pdf_url}">Voir le PDF</a>
        <button class="btn secondary" onclick="copyMessage()">Copier le message d’accompagnement</button>
      </div>
    </section>

    <section class="grid">
      <article class="card">
        <h2>Ce qu’il faut envoyer</h2>
        <p>
          Le plus simple est d’envoyer le dossier complet <strong>2_SEND_TO_RECIPIENT</strong>.
          Le destinataire ouvrira le PDF normalement. Le fichier de vérification reste disponible uniquement si une vérification est demandée.
        </p>

        <div class="steps">
          <div class="step">
            <div class="num">1</div>
            <div>
              <strong>Ouvrir le dossier à envoyer</strong>
              <span>Il contient les éléments utiles au destinataire.</span>
            </div>
          </div>
          <div class="step">
            <div class="num">2</div>
            <div>
              <strong>Envoyer le dossier complet</strong>
              <span>Ne séparez pas le PDF du fichier de vérification.</span>
            </div>
          </div>
          <div class="step">
            <div class="num">3</div>
            <div>
              <strong>Le destinataire lit le PDF</strong>
              <span>La vérification est facultative et disponible en cas de besoin.</span>
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
          <p>Ce fichier n’est pas destiné à être lu directement. Il sert à vérifier publiquement le package HumanOrigin.</p>
        </div>
      </article>

      <aside class="card">
        <h2>Message d’accompagnement</h2>
        <p>Copiez ce texte dans votre email, puis joignez le dossier à envoyer.</p>
        <div id="message" class="message">{html.escape(message)}</div>
        <div class="actions-row">
          <button class="btn smallbtn" onclick="copyMessage()">Copier le message</button>
          <a class="btn smallbtn" href="{mailto}">Préparer un email</a>
        </div>

        <details>
          <summary>Détails avancés</summary>
          <div class="advanced">
            <a href="{proof_url}">Voir le fichier de vérification</a>
            <a href="{tech_url}">Ouvrir l’archive technique</a>
            <span>Projet : {html.escape(project_title)}</span>
            <span>Page générée : {generated_at}</span>
          </div>
        </details>
      </aside>
    </section>

    <p class="footer">
      HumanOrigin accompagne un document par une preuve vérifiable du processus humain associé. Il ne juge pas la vérité du contenu.
    </p>
  </main>

  <script>
    async function copyMessage() {{
      const text = document.getElementById("message").innerText;
      try {{
        await navigator.clipboard.writeText(text);
        alert("Message copié.");
      }} catch (e) {{
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        alert("Message copié.");
      }}
    }}
  </script>
</body>
</html>
"""

for name in ["1_OPEN_FIRST.html", "HumanOrigin_OPEN_FIRST.html"]:
    (pkg / name).write_text(html_doc)

readme = f"""HUMANORIGIN — À OUVRIR EN PREMIER

Votre package est prêt.

1. Ouvrez 1_OPEN_FIRST.html.
2. Envoyez le dossier 2_SEND_TO_RECIPIENT au destinataire.
3. Le destinataire lit le PDF normalement.
4. Le fichier de vérification est inclus pour une vérification publique si nécessaire.

Important :
- Le PDF est le document à lire.
- Le fichier de vérification n’est pas destiné à être lu directement.
- HumanOrigin ne certifie pas que le contenu du document est vrai.
- HumanOrigin indique qu’un processus humain mesuré a été associé à ce document.

Projet : {project_title}
"""

(pkg / "README_START_HERE.txt").write_text(readme)

print("✅ Package HumanOrigin finalisé UX.")
print(f"Package : {pkg}")
print(f"Open First : {pkg / '1_OPEN_FIRST.html'}")
print(f"Dossier à envoyer : {send_dir}")
print(f"PDF : {pdf}")
print(f"Fichier de vérification : {proof}")
