from pathlib import Path
import shutil
from datetime import datetime

projects_dir = Path.home() / "Documents" / "HumanOrigin" / "Projects"

published_files = list(projects_dir.rglob("HumanOrigin_PUBLISHED.html"))
if not published_files:
    print("WARN: aucun HumanOrigin_PUBLISHED.html trouvé.")
    raise SystemExit(0)

published = sorted(published_files, key=lambda p: p.stat().st_mtime, reverse=True)[0]
pkg = published.parent
open_first = pkg / "HumanOrigin_OPEN_FIRST.html"

if not open_first.exists():
    print(f"WARN: OPEN_FIRST introuvable dans {pkg}, redirection ignorée.")
    raise SystemExit(0)

backup = published.with_suffix(".html.bak-redirect-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
shutil.copy2(published, backup)

html = """<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=HumanOrigin_OPEN_FIRST.html">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HumanOrigin — Open First</title>
  <style>
    body{
      margin:0;
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      background:#f7f3ec;
      color:#0f172a;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    }
    main{
      width:min(720px, calc(100% - 40px));
      padding:36px;
      border-radius:28px;
      background:white;
      border:1px solid rgba(15,23,42,.10);
      box-shadow:0 24px 70px rgba(15,23,42,.10);
    }
    .kicker{
      font-size:11px;
      letter-spacing:.14em;
      text-transform:uppercase;
      font-weight:900;
      color:#64748b;
      margin-bottom:10px;
    }
    h1{
      margin:0 0 12px 0;
      font-size:34px;
      line-height:1.05;
      letter-spacing:-.04em;
    }
    p{
      color:#475569;
      font-size:16px;
      line-height:1.5;
      margin:0 0 22px 0;
    }
    a{
      display:inline-flex;
      padding:12px 16px;
      border-radius:999px;
      background:#0f172a;
      color:white;
      text-decoration:none;
      font-weight:900;
      font-size:14px;
    }
  </style>
</head>
<body>
  <main>
    <div class="kicker">HumanOrigin Package</div>
    <h1>Ouvrez la page principale du package.</h1>
    <p>
      Cette ancienne page de publication est secondaire.
      La façade officielle du package est maintenant
      <strong>HumanOrigin_OPEN_FIRST.html</strong>.
    </p>
    <a href="HumanOrigin_OPEN_FIRST.html">Ouvrir HumanOrigin_OPEN_FIRST.html</a>
  </main>
</body>
</html>
"""

published.write_text(html)

print("OK: HumanOrigin_PUBLISHED.html redirige maintenant vers OPEN_FIRST.")
print("Package :", pkg)
print("Backup  :", backup)
