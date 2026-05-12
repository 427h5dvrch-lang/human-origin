from pathlib import Path
import zipfile
import html
import json
import re
from datetime import datetime
from urllib.parse import quote

PROJECTS = Path.home() / "Documents" / "HumanOrigin" / "Projects"

def latest_package_dir():
    candidates = []
    if not PROJECTS.exists():
        raise SystemExit(f"STOP: dossier introuvable: {PROJECTS}")

    for p in PROJECTS.glob("*"):
        if p.is_dir() and ((p / "1_OPEN_FIRST.html").exists() or (p / "2_SEND_TO_RECIPIENT").exists()):
            candidates.append(p)

    if not candidates:
        raise SystemExit("STOP: aucun package HumanOrigin trouvé.")

    return max(candidates, key=lambda x: x.stat().st_mtime)

def find_first(folder, patterns):
    if not folder or not folder.exists():
        return None
    for pat in patterns:
        hits = sorted(folder.glob(pat))
        if hits:
            return hits[0]
    return None

def read_manifest(pkg):
    for name in ["HumanOrigin_MANIFEST.json", "manifest.json", "MANIFEST.json"]:
        fp = pkg / name
        if fp.exists():
            try:
                return json.loads(fp.read_text())
            except Exception:
                return {}
    return {}

def clean_project_name(name):
    name = re.sub(r"\s*[—-]\s*HumanOrigin Package$", "", name).strip()
    name = re.sub(r"[^A-Za-z0-9À-ÿ._ -]+", "", name).strip()
    return name or "HumanOrigin"

def project_title_from(pkg, manifest):
    for k in ["project_title", "projectTitle", "title", "project"]:
        v = manifest.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return clean_project_name(pkg.name)

def file_url(p):
    return p.resolve().as_uri() if p else "#"

def safe_name(p):
    return html.escape(p.name) if p else "Non trouvé"

pkg = latest_package_dir()
manifest = read_manifest(pkg)
project_title = project_title_from(pkg, manifest)

send_dir = pkg / "2_SEND_TO_RECIPIENT"
tech_dir = pkg / "3_TECHNICAL_PROOF_ARCHIVE"

if not send_dir.exists():
    raise SystemExit(f"STOP: dossier à envoyer introuvable: {send_dir}")

pdf = find_first(send_dir, ["*.pdf"]) or find_first(pkg, ["HumanOrigin_PUBLISHED.pdf", "*.pdf"])
proof = find_first(send_dir, ["*.ho.json", "*.json"]) or find_first(pkg, ["CERTIFICAT_FINAL.v1.ho.json", "*PROOF*.json", "*.ho.json"])

zip_name = f"{clean_project_name(pkg.name)} — HumanOrigin_PACKAGE_EMAIL.zip"
zip_path = pkg / zip_name

if zip_path.exists():
    zip_path.unlink()

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for f in sorted(send_dir.rglob("*")):
        if f.is_file():
            z.write(f, arcname=f.relative_to(send_dir.parent))

message = f"""Bonjour,

Je vous transmets le package HumanOrigin associé au document.

À ouvrir en priorité : le PDF présent dans le dossier d’envoi.

Une preuve HumanOrigin est également incluse. Elle permet une vérification publique si nécessaire, mais vous n’avez pas besoin de l’ouvrir directement.

HumanOrigin ne certifie pas que le contenu du document est vrai. Il indique qu’un processus humain mesuré a été associé à ce document.

Bien à vous,"""

subject = "Document à consulter — preuve HumanOrigin jointe"
mailto = f"mailto:?subject={quote(subject)}&body={quote(message)}"
generated_at = datetime.now().strftime("%d/%m/%Y à %H:%M")

send_url = file_url(send_dir)
zip_url = file_url(zip_path)
pdf_url = file_url(pdf)
proof_url = file_url(proof)
tech_url = file_url(tech_dir)

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
      max-width:790px;
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
      background:rgba(255,255,255,.92);
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
    .recommended {{
      border-color:rgba(199,154,59,.45);
      background:linear-gradient(135deg,#fff,#fffaf0);
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
        Envoyez le dossier complet au destinataire. Pour un envoi par email, utilisez le fichier ZIP prêt à joindre.
      </p>
      <div class="hero-actions">
        <a class="btn primary" href="{send_url}">Ouvrir le dossier à envoyer</a>
        <a class="btn secondary" href="{zip_url}">Ouvrir le ZIP pour email</a>
        <a class="btn secondary" href="{pdf_url}">Voir le PDF</a>
        <button class="btn secondary" onclick="copyMessage()">Copier le message</button>
      </div>
    </section>

    <section class="grid">
      <article class="card">
        <h2>Ce qu’il faut envoyer</h2>
        <p>
          La voie la plus claire est d’envoyer le dossier complet <strong>2_SEND_TO_RECIPIENT</strong>.
          Si vous envoyez par email, le ZIP contient exactement ce même dossier, prêt à joindre.
        </p>

        <div class="steps">
          <div class="step">
            <div class="num">1</div>
            <div>
              <strong>Ouvrir le dossier à envoyer</strong>
              <span>Il contient le PDF et le fichier de vérification.</span>
            </div>
          </div>
          <div class="step">
            <div class="num">2</div>
            <div>
              <strong>Envoyer le dossier complet</strong>
              <span>Ou utiliser le ZIP si vous passez par email.</span>
            </div>
          </div>
          <div class="step">
            <div class="num">3</div>
            <div>
              <strong>Le destinataire lit le PDF</strong>
              <span>La vérification reste disponible en cas de besoin.</span>
            </div>
          </div>
        </div>

        <div class="filebox recommended">
          <div class="label">Recommandé</div>
          <div class="filename">2_SEND_TO_RECIPIENT</div>
          <p>À envoyer complet lorsque c’est possible.</p>
        </div>

        <div class="filebox">
          <div class="label">Option email</div>
          <div class="filename">{html.escape(zip_path.name)}</div>
          <p>À utiliser si vous devez joindre un seul fichier dans un email.</p>
        </div>

        <div class="filebox">
          <div class="label">PDF à lire</div>
          <div class="filename">{safe_name(pdf)}</div>
        </div>

        <div class="filebox">
          <div class="label">Fichier de vérification inclus</div>
          <div class="filename">{safe_name(proof)}</div>
          <p>Le destinataire n’a pas besoin de l’ouvrir directement. Il sert uniquement à la vérification publique si nécessaire.</p>
        </div>
      </article>

      <aside class="card">
        <h2>Message d’accompagnement</h2>
        <p>Copiez ce texte dans votre email, puis joignez le dossier complet ou le ZIP si l’email n’accepte qu’un fichier.</p>
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

Priorité :
1. Ouvrez 1_OPEN_FIRST.html.
2. Envoyez le dossier 2_SEND_TO_RECIPIENT au destinataire.
3. Pour un envoi par email, utilisez le ZIP prêt à joindre :
   {zip_path.name}
4. Le destinataire lit le PDF normalement.
5. Le fichier de vérification est inclus si une vérification publique est nécessaire.

Important :
- Le PDF est le document à lire.
- Le fichier de vérification n’est pas destiné à être lu directement.
- HumanOrigin ne certifie pas que le contenu du document est vrai.
- HumanOrigin indique qu’un processus humain mesuré a été associé à ce document.
"""

(pkg / "README_START_HERE.txt").write_text(readme)

print("✅ Option ZIP corrigée : dossier principal, ZIP secondaire email.")
print(f"Package : {pkg}")
print(f"Dossier principal : {send_dir}")
print(f"ZIP email : {zip_path}")
print(f"Open First : {pkg / '1_OPEN_FIRST.html'}")
