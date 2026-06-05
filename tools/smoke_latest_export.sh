#!/usr/bin/env bash
# smoke_latest_export.sh — vérifie le dernier package HumanOrigin exporté
# Usage : ./tools/smoke_latest_export.sh
# Retourne 0 si tout est OK, 1 si un élément critique manque.

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
PROJECTS_DIR="${HOME}/Documents/HumanOrigin/Projects"
VERIFIER_URL="humanorigin-verifier"   # sous-chaîne attendue dans le README

# ── Couleurs ─────────────────────────────────────────────────────────────────
GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"
BOLD="\033[1m"

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "  ${YELLOW}~${RESET} $*"; }

FAILURES=0

# ── Trouver le package le plus récent ────────────────────────────────────────
PKG=$(find "$PROJECTS_DIR" -maxdepth 3 -name "* — HumanOrigin Package" -type d 2>/dev/null \
  | while IFS= read -r d; do
      ts=$(stat -f '%m' "$d" 2>/dev/null || stat -c '%Y' "$d" 2>/dev/null || echo 0)
      echo "$ts $d"
    done \
  | sort -rn \
  | head -1 \
  | cut -d' ' -f2-)

echo ""
echo -e "${BOLD}HumanOrigin — Smoke test du dernier package${RESET}"
echo "────────────────────────────────────────────"

if [[ -z "$PKG" ]]; then
  fail "Aucun package HumanOrigin trouvé dans ${PROJECTS_DIR}"
  echo ""
  echo -e "${RED}ÉCHEC — Aucun package disponible.${RESET}"
  exit 1
fi

echo "  Package : $(basename "$PKG")"
echo ""

# ── 1. Dossier 2_SEND_TO_RECIPIENT ───────────────────────────────────────────
SEND_DIR="${PKG}/2_SEND_TO_RECIPIENT"
echo -e "${BOLD}1. Dossier destinataire (2_SEND_TO_RECIPIENT/)${RESET}"

if [[ -d "$SEND_DIR" ]]; then
  ok "Dossier 2_SEND_TO_RECIPIENT trouvé"
else
  fail "Dossier 2_SEND_TO_RECIPIENT MANQUANT"
fi

# ── 2. PDF labellisé ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}2. PDF labellisé${RESET}"
PDF_FILE=$(find "$SEND_DIR" -maxdepth 1 -name "*HumanOrigin*.pdf" 2>/dev/null | head -1)

if [[ -n "$PDF_FILE" ]]; then
  ok "PDF labellisé : $(basename "$PDF_FILE")"
else
  warn "Aucun PDF labellisé dans 2_SEND_TO_RECIPIENT (normal pour DOCX sans publisher)"
fi

# ── 3. Fichier de preuve ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}3. Fichier de preuve (HumanOrigin_PROOF.v1.ho.json)${RESET}"
PROOF_FILE="${SEND_DIR}/HumanOrigin_PROOF.v1.ho.json"

if [[ -f "$PROOF_FILE" ]]; then
  ok "HumanOrigin_PROOF.v1.ho.json trouvé"
else
  fail "HumanOrigin_PROOF.v1.ho.json MANQUANT dans 2_SEND_TO_RECIPIENT"
fi

# ── 4. README ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}4. README_SEND_FIRST.txt${RESET}"
README_FILE="${SEND_DIR}/README_SEND_FIRST.txt"

if [[ -f "$README_FILE" ]]; then
  ok "README_SEND_FIRST.txt trouvé"
  if grep -q "$VERIFIER_URL" "$README_FILE" 2>/dev/null; then
    ok "URL verifier présente dans le README"
  else
    warn "URL verifier absente du README (ancien package — relancez un export)"
  fi
  if grep -qi "certifie pas\|does not certify" "$README_FILE" 2>/dev/null; then
    ok "Disclaimer présent dans le README"
  else
    warn "Disclaimer absent du README (ancien package)"
  fi
else
  fail "README_SEND_FIRST.txt MANQUANT"
fi

# ── 5. ZIP ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}5. HumanOrigin_SEND.zip${RESET}"
ZIP_FILE="${PKG}/HumanOrigin_SEND.zip"

if [[ -f "$ZIP_FILE" ]]; then
  ok "HumanOrigin_SEND.zip trouvé ($(du -sh "$ZIP_FILE" | cut -f1))"

  # Contenu du ZIP
  ZIP_CONTENTS=$(unzip -l "$ZIP_FILE" 2>/dev/null | awk 'NR>3{print $NF}' | grep -v "^$" | grep -v "^---")

  if echo "$ZIP_CONTENTS" | grep -q "HumanOrigin_PROOF"; then
    ok "ZIP contient le fichier de preuve"
  else
    fail "ZIP ne contient pas HumanOrigin_PROOF.v1.ho.json"
  fi

  if echo "$ZIP_CONTENTS" | grep -q "README"; then
    ok "ZIP contient le README"
  else
    fail "ZIP ne contient pas README_SEND_FIRST.txt"
  fi

  if echo "$ZIP_CONTENTS" | grep -q "HumanOrigin.pdf"; then
    ok "ZIP contient le PDF labellisé"
  else
    warn "ZIP sans PDF labellisé (normal pour DOCX sans publisher)"
  fi
else
  fail "HumanOrigin_SEND.zip MANQUANT"
fi

# ── 6. Contenu du .ho.json ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}6. Contenu du fichier de preuve${RESET}"

if [[ -f "$PROOF_FILE" ]]; then
  python3 - "$PROOF_FILE" <<'PYEOF'
import json, sys

path = sys.argv[1]
try:
    d = json.load(open(path, encoding='utf-8'))
except Exception as e:
    print(f"  \033[0;31m✗\033[0m Impossible de lire le .ho.json : {e}")
    sys.exit(1)

ok   = lambda s: print(f"  \033[0;32m✓\033[0m {s}")
warn = lambda s: print(f"  \033[0;33m~\033[0m {s}")
fail = lambda s: print(f"  \033[0;31m✗\033[0m {s}")

errors = 0

# Format
fmt = d.get('format','')
ver = d.get('version','')
if fmt == 'humanorigin-hojson' and ver == '1.0':
    ok(f"Format : {fmt} v{ver}")
else:
    warn(f"Format inattendu : {fmt} v{ver}")

# Payload
p = d.get('payload', {})

# Verdict
verdict = p.get('process_summary', {}).get('verdict', '')
if verdict:
    ok(f"Verdict : {verdict}")
else:
    fail("Verdict manquant dans process_summary")
    errors += 1

# Document SHA-256
sha = p.get('document', {}).get('sha256', '')
if sha:
    ok(f"document.sha256 : {sha[:16]}…")
else:
    fail("document.sha256 manquant")
    errors += 1

# issuer_mode
issuer_mode = p.get('issuer', {}).get('issuer_mode', '')
if issuer_mode:
    ok(f"issuer_mode : {issuer_mode}")
else:
    warn("issuer_mode absent (ancien format)")

# Signature
sigs = d.get('signatures', [])
sig_val = (sigs[0].get('signature','') if sigs else '') or d.get('signing',{}).get('signature','')
if sig_val:
    ok(f"Signature Ed25519 : {sig_val[:16]}…")
else:
    fail("Signature manquante")
    errors += 1

sys.exit(errors)
PYEOF
  PROOF_EXIT=$?
  if [[ $PROOF_EXIT -ne 0 ]]; then
    FAILURES=$((FAILURES + PROOF_EXIT))
  fi
else
  warn "Skipping .ho.json checks (fichier manquant)"
fi

# ── Résumé ────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────"
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✓ SMOKE TEST OK — Package destinataire cohérent.${RESET}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}✗ SMOKE TEST ÉCHOUÉ — ${FAILURES} problème(s) critique(s) détecté(s).${RESET}"
  echo ""
  exit 1
fi
