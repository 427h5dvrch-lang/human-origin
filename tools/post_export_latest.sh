#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== PATCH LATEST EXPORT PACKAGE ==="
python3 tools/patch_latest_export_package.py

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
