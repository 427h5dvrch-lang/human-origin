from pathlib import Path
import json
import re
import shutil
from datetime import datetime
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

projects_dir = Path.home() / "Documents" / "HumanOrigin" / "Projects"

open_files = list(projects_dir.rglob("HumanOrigin_OPEN_FIRST.html"))
if not open_files:
    raise SystemExit("STOP: aucun HumanOrigin_OPEN_FIRST.html trouvé.")

html = sorted(open_files, key=lambda p: p.stat().st_mtime, reverse=True)[0]
pkg = html.parent
manifest = pkg / "HumanOrigin_MANIFEST.json"

if not manifest.exists():
    raise SystemExit(f"STOP: HumanOrigin_MANIFEST.json introuvable dans {pkg}")

data = json.loads(manifest.read_text())

project_title = (
    data.get("project_title")
    or data.get("projectTitle")
    or data.get("project_name")
    or data.get("projectName")
    or pkg.name.replace(" - HumanOrigin Package", "")
)

published = (
    data.get("published_output_filename")
    or data.get("published_document_filename")
    or "HumanOrigin_PUBLISHED.pdf"
)

proof = (
    data.get("reference_proof_filename")
    or "CERTIFICAT_FINAL.v1.ho.json"
)

verifier_url = (
    data.get("verifier_url")
    or data.get("verification_url")
    or data.get("verificationUrl")
    or "https://427h5dvrch-lang.github.io/humanorigin-verifier/"
)

def with_params(url, params):
    parts = urlsplit(url)
    q = dict(parse_qsl(parts.query))
    q.update(params)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))

context_url = with_params(verifier_url, {
    "project": project_title,
    "expected_document": published,
    "expected_proof": proof,
})

backup = html.with_suffix(".html.bak-enhance-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
shutil.copy2(html, backup)

txt = html.read_text()

# Nettoyage anciennes injections
txt = re.sub(r"\s*<section class=\"ho-package-status HO_PACKAGE_STATUS_HEADER_V1\">.*?</section>\s*", "\n", txt, flags=re.S)
txt = re.sub(r"\s*<section class=\"ho-send-ready HO_SEND_READY_ZONE_V1\">.*?</section>\s*", "\n", txt, flags=re.S)
txt = re.sub(r"\s*<style id=\"HO_PACKAGE_STATUS_HEADER_CSS_V1\">.*?</style>\s*", "\n", txt, flags=re.S)
txt = re.sub(r"\s*<style id=\"HO_SEND_READY_ZONE_CSS_V1\">.*?</style>\s*", "\n", txt, flags=re.S)
txt = re.sub(r"\s*<script id=\"HO_SEND_READY_COPY_JS_V1\">.*?</script>\s*", "\n", txt, flags=re.S)

# Titre principal stable
txt = re.sub(
    r"<h1[^>]*>\s*(Envoyez ce document\.?|Package prêt à transmettre\.?)\s*</h1>",
    "<h1>Envoyez ce document.</h1>",
    txt,
    count=1,
    flags=re.I
)

send_text = f"""Bonjour,

Je vous transmets le document publié avec son marquage HumanOrigin.

Document à consulter :
{published}

Si une vérification renforcée est nécessaire, utilisez aussi :
{proof}

Vérificateur public :
{context_url}
"""

safe_send_text = (
    send_text
    .replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace('"', "&quot;")
)

css = r'''
<style id="HO_PACKAGE_STATUS_HEADER_CSS_V1">
  .ho-package-status{
    margin:18px 0 28px 0;
    padding:22px 24px;
    border:1px solid rgba(15,23,42,.10);
    border-radius:24px;
    background:linear-gradient(135deg,rgba(15,23,42,.045),rgba(255,255,255,.92));
    box-shadow:0 18px 45px rgba(15,23,42,.06);
  }
  .ho-status-kicker{
    font-size:11px;
    letter-spacing:.14em;
    text-transform:uppercase;
    font-weight:900;
    color:#64748b;
    margin-bottom:8px;
  }
  .ho-status-title{
    font-size:28px;
    line-height:1.04;
    font-weight:950;
    color:#0f172a;
    margin-bottom:18px;
  }
  .ho-status-grid{
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:12px;
  }
  .ho-status-grid div{
    padding:14px 15px;
    border-radius:16px;
    background:rgba(255,255,255,.78);
    border:1px solid rgba(15,23,42,.08);
  }
  .ho-status-grid span{
    display:block;
    font-size:10px;
    letter-spacing:.10em;
    text-transform:uppercase;
    font-weight:900;
    color:#64748b;
    margin-bottom:6px;
  }
  .ho-status-grid strong{
    display:block;
    font-size:13px;
    line-height:1.35;
    color:#0f172a;
    word-break:break-word;
  }
  @media(max-width:760px){
    .ho-status-grid{grid-template-columns:1fr;}
    .ho-status-title{font-size:24px;}
  }
</style>

<style id="HO_SEND_READY_ZONE_CSS_V1">
  .ho-send-ready{
    margin:22px 0 24px 0;
    padding:22px;
    border-radius:28px;
    border:1px solid rgba(15,23,42,.10);
    background:radial-gradient(circle at top left,rgba(15,23,42,.055),transparent 36%),linear-gradient(135deg,rgba(255,255,255,.96),rgba(248,250,252,.92));
    box-shadow:0 22px 55px rgba(15,23,42,.075);
  }
  .ho-send-ready-top{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:18px;
    margin-bottom:18px;
  }
  .ho-send-kicker{
    font-size:11px;
    letter-spacing:.14em;
    text-transform:uppercase;
    font-weight:950;
    color:#64748b;
    margin-bottom:7px;
  }
  .ho-send-title{
    font-size:26px;
    line-height:1.08;
    font-weight:950;
    color:#0f172a;
    margin:0;
  }
  .ho-send-project{
    display:inline-flex;
    align-items:center;
    max-width:280px;
    padding:9px 12px;
    border-radius:999px;
    border:1px solid rgba(15,23,42,.10);
    background:rgba(255,255,255,.78);
    font-size:12px;
    font-weight:850;
    color:#334155;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }
  .ho-send-grid{
    display:grid;
    grid-template-columns:1.05fr .95fr;
    gap:14px;
    margin-top:12px;
  }
  .ho-send-card{
    border-radius:22px;
    border:1px solid rgba(15,23,42,.09);
    background:rgba(255,255,255,.82);
    padding:18px;
  }
  .ho-send-card.primary{
    background:#0f172a;
    color:white;
  }
  .ho-send-card h3{
    margin:0 0 8px 0;
    font-size:20px;
    line-height:1.12;
    letter-spacing:-.025em;
  }
  .ho-send-card p{
    margin:0 0 14px 0;
    font-size:13px;
    line-height:1.45;
    color:#64748b;
  }
  .ho-send-card.primary p{
    color:rgba(255,255,255,.76);
  }
  .ho-file-pill{
    display:block;
    width:fit-content;
    max-width:100%;
    padding:10px 12px;
    border-radius:13px;
    border:1px solid rgba(15,23,42,.10);
    background:#f8fafc;
    color:#0f172a;
    font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
    font-size:12px;
    font-weight:850;
    overflow-wrap:anywhere;
    margin:8px 0;
  }
  .ho-send-card.primary .ho-file-pill{
    border-color:rgba(255,255,255,.18);
    background:rgba(255,255,255,.10);
    color:white;
  }
  .ho-send-actions{
    display:flex;
    flex-wrap:wrap;
    gap:9px;
    margin-top:15px;
  }
  .ho-send-btn{
    appearance:none;
    border:0;
    cursor:pointer;
    text-decoration:none;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    padding:11px 14px;
    border-radius:999px;
    font-size:13px;
    font-weight:900;
    line-height:1;
    background:#0f172a;
    color:white;
  }
  .ho-send-card.primary .ho-send-btn{
    background:white;
    color:#0f172a;
  }
  .ho-send-btn.secondary{
    background:#f1f5f9;
    color:#0f172a;
    border:1px solid rgba(15,23,42,.08);
  }
  .ho-send-note{
    margin-top:14px;
    padding:12px 14px;
    border-radius:16px;
    background:rgba(241,245,249,.78);
    color:#475569;
    font-size:12px;
    line-height:1.45;
    font-weight:700;
  }
  @media(max-width:820px){
    .ho-send-ready-top{display:block;}
    .ho-send-project{margin-top:12px;max-width:100%;}
    .ho-send-grid{grid-template-columns:1fr;}
  }
</style>
'''

status_block = f'''
<section class="ho-package-status HO_PACKAGE_STATUS_HEADER_V1">
  <div class="ho-status-kicker">HUMANORIGIN PACKAGE</div>
  <div class="ho-status-title">Package prêt à transmettre</div>
  <div class="ho-status-grid">
    <div>
      <span>Projet</span>
      <strong>{project_title}</strong>
    </div>
    <div>
      <span>Document principal</span>
      <strong>{published}</strong>
    </div>
    <div>
      <span>Preuve vérifiable</span>
      <strong>{proof}</strong>
    </div>
  </div>
</section>
'''

send_block = f'''
<section class="ho-send-ready HO_SEND_READY_ZONE_V1">
  <div class="ho-send-ready-top">
    <div>
      <div class="ho-send-kicker">Action recommandée</div>
      <h2 class="ho-send-title">Le package est prêt. Envoyez le document principal.</h2>
    </div>
    <div class="ho-send-project">Projet&nbsp;: {project_title}</div>
  </div>

  <div class="ho-send-grid">
    <div class="ho-send-card primary">
      <h3>Envoi standard</h3>
      <p>C’est le cas normal. Envoyez uniquement ce fichier lisible, déjà marqué HumanOrigin.</p>
      <span class="ho-file-pill">{published}</span>
      <div class="ho-send-actions">
        <a class="ho-send-btn" href="{published}">Ouvrir le document</a>
        <button class="ho-send-btn" type="button" data-ho-copy="{safe_send_text}">Copier le message d’accompagnement d’envoi</button>
      </div>
    </div>

    <div class="ho-send-card">
      <h3>Contrôle renforcé</h3>
      <p>À utiliser seulement si le destinataire demande une vérification indépendante ou hors ligne.</p>
      <span class="ho-file-pill">{published}</span>
      <span class="ho-file-pill">{proof}</span>
      <div class="ho-send-actions">
        <a class="ho-send-btn secondary" href="{context_url}">Ouvrir le vérificateur</a>
      </div>
    </div>
  </div>

  <div class="ho-send-note">
    HumanOrigin certifie un processus humain mesuré lié à ce document. Il ne certifie pas que le contenu du document est vrai, exact, légal, éthique ou institutionnellement approuvé.
  </div>
</section>
'''

script = r'''
<script id="HO_SEND_READY_COPY_JS_V1">
(function(){
  function decodeHtml(s){
    var t=document.createElement("textarea");
    t.innerHTML=s||"";
    return t.value;
  }
  document.addEventListener("click",function(e){
    var btn=e.target&&e.target.closest?e.target.closest("[data-ho-copy]"):null;
    if(!btn)return;
    var text=decodeHtml(btn.getAttribute("data-ho-copy"));
    function done(){
      var old=btn.textContent;
      btn.textContent="Message copié";
      setTimeout(function(){btn.textContent=old;},1800);
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(function(){
        window.prompt("Copiez ce message :",text);
      });
    }else{
      window.prompt("Copiez ce message :",text);
    }
  });
})();
</script>
'''

# CSS
if "</head>" in txt:
    txt = txt.replace("</head>", css + "\n</head>", 1)
else:
    txt = css + "\n" + txt

# JS
if "</body>" in txt:
    txt = txt.replace("</body>", script + "\n</body>", 1)
else:
    txt += "\n" + script

# Insertion : status après h1, send après paragraphe intro
h1 = re.search(r"</h1>", txt, flags=re.I)
if h1:
    txt = txt[:h1.end()] + "\n" + status_block + txt[h1.end():]
else:
    txt = status_block + "\n" + txt

intro = re.search(r"(<p[^>]*>.*?\.ho\.json.*?</p>)", txt, flags=re.S | re.I)
if intro:
    txt = txt[:intro.end()] + "\n" + send_block + txt[intro.end():]
else:
    h1b = re.search(r"</h1>", txt, flags=re.I)
    if h1b:
        txt = txt[:h1b.end()] + "\n" + send_block + txt[h1b.end():]
    else:
        txt = send_block + "\n" + txt

# Contextualise tous les liens verifier
txt = re.sub(
    r'href="https://427h5dvrch-lang\.github\.io/humanorigin-verifier/[^"]*"',
    f'href="{context_url}"',
    txt
)

html.write_text(txt)

print("OK: OPEN_FIRST enrichi avec la façade validée.")
print("Package :", pkg)
print("Backup  :", backup)
print("Projet  :", project_title)
print("Document:", published)
print("Preuve  :", proof)
