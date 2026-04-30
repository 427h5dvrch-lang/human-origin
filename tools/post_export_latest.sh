#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CLEAN LATEST EXPORT PACKAGE (PRE) ==="
python3 tools/clean_latest_export_package.py

echo "=== PATCH LATEST EXPORT PACKAGE ==="
python3 tools/patch_latest_export_package.py
python3 tools/enhance_open_first_latest.py
python3 tools/elevate_open_first_scope_latest.py

echo "=== CLEAN LATEST EXPORT PACKAGE (POST) ==="
python3 tools/clean_latest_export_package.py

LATEST_DIR="$(python3 -c 'from pathlib import Path; root=Path.home()/"Documents"/"HumanOrigin"/"Projects"; c=list(root.glob("*/CERTIFICAT_FINAL.v1.ho.json")); print(max(c, key=lambda p: p.stat().st_mtime).parent if c else "")')"

if [ -z "$LATEST_DIR" ]; then
  echo "Aucun export v1 trouvé."
  exit 1
fi

echo "LATEST_DIR=$LATEST_DIR"
echo
echo "===== READ_ME_FIRST ====="
sed -n '1,120p' "$LATEST_DIR/HumanOrigin_READ_ME_FIRST.txt"
echo
echo "===== VERIFY ====="
sed -n '1,120p' "$LATEST_DIR/HumanOrigin_VERIFY.txt"
echo
echo "===== MANIFEST ====="
sed -n '1,200p' "$LATEST_DIR/HumanOrigin_MANIFEST.json"

echo
echo "===== OPEN FIRST ====="
OPEN_FIRST="$LATEST_DIR/HumanOrigin_OPEN_FIRST.html"
if [ -f "$OPEN_FIRST" ]; then
  echo "$OPEN_FIRST"
  open "$OPEN_FIRST"
else
  echo "HumanOrigin_OPEN_FIRST.html introuvable"
fi

# HUMANORIGIN_PUBLIC_REFRAME_BEGIN
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${LATEST_DIR:-${1:-}}"
if [ -z "$TARGET_DIR" ] || [ ! -d "$TARGET_DIR" ]; then
  TARGET_DIR="$(find "$HOME/Documents/HumanOrigin/Projects" -type f -name 'HumanOrigin_MANIFEST.json' -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -n 1 | xargs -I{} dirname "{}")"
fi

if [ -n "$TARGET_DIR" ] && [ -d "$TARGET_DIR" ]; then
  echo
  echo "=== INJECT RECORD URL ==="
  python3 "$SCRIPT_DIR/inject_record_verification_url.py" "$TARGET_DIR" || exit 1

  echo
  echo "=== REFRAME PUBLIC BUNDLE ==="
  python3 "$SCRIPT_DIR/reframe_public_bundle.py" "$TARGET_DIR" || exit 1

  echo
  echo "===== START_HERE ====="
  sed -n '1,120p' "$TARGET_DIR/HumanOrigin_START_HERE.txt"

  echo
  echo "===== VERIFY ====="
  sed -n '1,120p' "$TARGET_DIR/HumanOrigin_VERIFY.txt"

  echo
  echo "===== MANIFEST ====="
  sed -n '1,220p' "$TARGET_DIR/HumanOrigin_MANIFEST.json"

  echo
  echo "===== OPEN FIRST ====="
  if [ -f "$TARGET_DIR/HumanOrigin_OPEN_FIRST.html" ]; then
    open "$TARGET_DIR/HumanOrigin_OPEN_FIRST.html"
  fi
fi
# HUMANORIGIN_PUBLIC_REFRAME_END

# HUMANORIGIN_PACKAGE_RENAME_BY_PROJECT_TITLE_V1
# Renomme le dernier package avec le nom du projet, sans toucher au core.
if [ -n "$LATEST_DIR" ] && [ -d "$LATEST_DIR" ] && [ -f "$LATEST_DIR/HumanOrigin_MANIFEST.json" ]; then
  PROJECT_TITLE="$(python3 - "$LATEST_DIR/HumanOrigin_MANIFEST.json" <<'PY2'
import json, sys, re
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
title = data.get("project_title") or data.get("projectTitle") or data.get("project_name") or data.get("projectName") or "HumanOrigin Project"
title = str(title).strip() or "HumanOrigin Project"

title = re.sub(r'[\/:*?"<>|]+', "-", title)
title = re.sub(r"\s+", " ", title).strip().strip(". ")
if len(title) > 80:
    title = title[:80].rstrip()

print(title)
PY2
)"

  PARENT_DIR="$(dirname "$LATEST_DIR")"
  TARGET_DIR="$PARENT_DIR/$PROJECT_TITLE - HumanOrigin Package"

  if [ "$LATEST_DIR" != "$TARGET_DIR" ]; then
    if [ -e "$TARGET_DIR" ]; then
      TARGET_DIR="$PARENT_DIR/$PROJECT_TITLE - HumanOrigin Package $(date +%Y%m%d-%H%M%S)"
    fi

    mv "$LATEST_DIR" "$TARGET_DIR"
    LATEST_DIR="$TARGET_DIR"
    export LATEST_DIR

    echo "OK: package renommé:"
    echo "$LATEST_DIR"
  else
    echo "OK: package déjà correctement nommé:"
    echo "$LATEST_DIR"
  fi
else
  echo "WARN: renommage package ignoré — LATEST_DIR ou manifest introuvable."
fi
# /HUMANORIGIN_PACKAGE_RENAME_BY_PROJECT_TITLE_V1

echo
echo "=== ENRICHISSEMENT OPEN_FIRST — FAÇADE VALIDÉE ==="
python3 "/Users/dazeasphilippe/Desktop/human-origin/tools/enhance_latest_open_first.py" || true

echo
echo "=== REDIRECTION PUBLISHED.HTML VERS OPEN_FIRST ==="
python3 "/Users/dazeasphilippe/Desktop/human-origin/tools/redirect_published_html_to_open_first.py" || true
