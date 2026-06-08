#!/usr/bin/env bash
# check_all.sh — HumanOrigin local automated checks
# Usage : ./tools/check_all.sh
# Exit 0 = all passed, 1 = at least one failure

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERIFIER_DIR="/Users/dazeasphilippe/Desktop/humanorigin-verifier-repo"
PROJECTS_DIR="${HOME}/Documents/HumanOrigin/Projects"

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
BOLD="\033[1m"
RESET="\033[0m"

ok()     { echo -e "  ${GREEN}✓${RESET} $*"; }
fail()   { echo -e "  ${RED}✗${RESET} $*"; FAILURES=$((FAILURES + 1)); }
warn()   { echo -e "  ${YELLOW}~${RESET} $*"; }
header() { echo -e "\n${BOLD}── $* ──${RESET}"; }

FAILURES=0

echo ""
echo -e "${BOLD}HumanOrigin — Local automated checks${RESET}"
echo "======================================"

# ── 1. Frontend build ─────────────────────────────────────────────────────────
header "1. Frontend build (npm run build)"
cd "$REPO_DIR"
if npm run build > /tmp/ho_build.log 2>&1; then
  ok "npm run build passed"
else
  fail "npm run build failed"
  grep -E "error|Error" /tmp/ho_build.log | head -10
fi

# ── 2. Rust cargo check ───────────────────────────────────────────────────────
header "2. Rust (cargo check)"
if cargo check --manifest-path "$REPO_DIR/src-tauri/Cargo.toml" > /tmp/ho_cargo.log 2>&1; then
  ok "cargo check passed"
else
  fail "cargo check failed"
  grep "^error" /tmp/ho_cargo.log | head -10
fi

# ── 3. Smoke test ─────────────────────────────────────────────────────────────
header "3. Smoke test (latest export package)"
HAS_PKG=$(find "$PROJECTS_DIR" -maxdepth 3 -name "* — HumanOrigin Package" -type d 2>/dev/null | wc -l | tr -d ' ')
if [ "$HAS_PKG" -eq 0 ]; then
  warn "Aucun package exporté trouvé dans $PROJECTS_DIR — smoke skipped"
elif [ -f "$REPO_DIR/tools/smoke_latest_export.sh" ]; then
  if bash "$REPO_DIR/tools/smoke_latest_export.sh"; then
    ok "Smoke test passed"
  else
    fail "Smoke test failed"
  fi
else
  warn "smoke_latest_export.sh introuvable — skipped"
fi

# ── 4. Red team ───────────────────────────────────────────────────────────────
header "4. Red team (overclaim check)"
if [ "$HAS_PKG" -eq 0 ]; then
  warn "Aucun package exporté trouvé — red team skipped"
elif [ -f "$REPO_DIR/tools/redteam_latest_export.sh" ]; then
  if bash "$REPO_DIR/tools/redteam_latest_export.sh"; then
    ok "Red team passed — aucun overclaim détecté"
  else
    fail "Red team FAIL — overclaim détecté"
  fi
else
  warn "redteam_latest_export.sh introuvable — skipped"
fi

# ── 5. Verifier static checks ─────────────────────────────────────────────────
header "5. Verifier static checks"
if [ ! -d "$VERIFIER_DIR" ]; then
  warn "Repo verifier absent ($VERIFIER_DIR) — skipped"
else
  VF="$VERIFIER_DIR/index.html"
  if [ ! -f "$VF" ]; then
    fail "index.html absent du repo verifier"
  else
    chk() {
      local label="$1" pattern="$2"
      if grep -qE "$pattern" "$VF"; then
        ok "$label"
      else
        fail "$label — pattern absent: $pattern"
      fi
    }
    chk "buildSimpleSummaryHtml présent"     "buildSimpleSummaryHtml"
    chk "buildTrustMetaHtml présent"         "buildTrustMetaHtml"
    chk "HO_OFFICIAL_SERVER_KEYS présent"    "HO_OFFICIAL_SERVER_KEYS"
    chk "verifyServerAttestation présent"    "verifyServerAttestation"
    chk "technical-details présent"       "technical-details"
    chk "explainSecurityGates présent"    "explainSecurityGates"
    chk "HumanOrigin_SEND référencé"      "HumanOrigin_SEND"
    chk "Verdict limité présent"          "PREUVE LIM|Preuve partielle"
    chk "Signature présent"              "Signature"
    chk "Document présent"               "Document"
    chk "Confiance/Trust présent"         "onfiance|Trust"
  fi
fi

# ── Résultat final ────────────────────────────────────────────────────────────
echo ""
echo "======================================"
if [ "$FAILURES" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}✓ ALL CHECKS PASSED${RESET}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}✗ CHECKS FAILED — ${FAILURES} problème(s)${RESET}"
  echo ""
  exit 1
fi
