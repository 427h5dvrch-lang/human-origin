#!/usr/bin/env bash
# object_evidence_report_latest.sh — rapport Object Evidence sur le dernier package HumanOrigin
# Usage : ./tools/object_evidence_report_latest.sh
# Retourne 0 si PASS, 1 si FAIL.

PROJECTS_DIR="${HOME}/Documents/HumanOrigin/Projects"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
BOLD="\033[1m"
RESET="\033[0m"

ok()     { echo -e "  ${GREEN}✓${RESET} $*"; }
fail()   { echo -e "  ${RED}✗${RESET} $*"; FAILURES=$((FAILURES + 1)); }
warn()   { echo -e "  ${YELLOW}~${RESET} $*"; }
header() { echo -e "\n${BOLD}── $* ──${RESET}"; }

FAILURES=0

echo ""
echo -e "${BOLD}HumanOrigin — Object Evidence Report${RESET}"
echo "═══════════════════════════════════════"

# ── 1. Trouver la preuve la plus récente ─────────────────────────────────────
PROOF=$(find "$PROJECTS_DIR" -maxdepth 5 -name "HumanOrigin_PROOF.v1.ho.json" 2>/dev/null \
  | while IFS= read -r f; do
      ts=$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null || echo 0)
      echo "$ts $f"
    done \
  | sort -rn | head -1 | cut -d' ' -f2-)

if [[ -z "$PROOF" ]]; then
  echo -e "  ${RED}✗${RESET} Aucun package HumanOrigin trouvé dans ${PROJECTS_DIR}"
  exit 1
fi

SEND_DIR="$(dirname "$PROOF")"
PKG_DIR="$(dirname "$SEND_DIR")"
PKG_DATE=$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$PROOF" 2>/dev/null || date -r "$PROOF" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "—")
NOW_TS=$(date +%s)
PROOF_TS=$(stat -f '%m' "$PROOF" 2>/dev/null || stat -c '%Y' "$PROOF" 2>/dev/null || echo "$NOW_TS")
AGE_MIN=$(( (NOW_TS - PROOF_TS) / 60 ))

echo "  Projet  : $(basename "$PKG_DIR")"
echo "  Date    : ${PKG_DATE}  (il y a ${AGE_MIN} min)"
echo "  Preuve  : $PROOF"

# ── 2. Analyse Python ─────────────────────────────────────────────────────────
OE_EXIT=0
python3 - "$PROOF" "$SEND_DIR" "$PKG_DIR" <<'PYEOF'
import json, sys, os, glob, zipfile

proof_path = sys.argv[1]
send_dir   = sys.argv[2]
pkg_dir    = sys.argv[3]

G = "\033[0;32m"; R = "\033[0;31m"; Y = "\033[0;33m"
C = "\033[0;36m"; B = "\033[1m";    X = "\033[0m"

FAIL_REASONS  = []
PASS_CRITERIA = []

def ok(s):   print(f"  {G}✓{X} {s}")
def fail(s): print(f"  {R}✗{X} {s}"); FAIL_REASONS.append(s)
def warn(s): print(f"  {Y}~{X} {s}")

def row(label, val, sym="·", col=None):
    col = col or C
    v = str(val) if val is not None else "—"
    print(f"  {col}{sym}{X} {label:<46}: {v}")

def oe(label, val, hi=None, lo=None):
    v = str(val) if val is not None else "—"
    if hi is not None and val == hi:   col, sym = G, "✓"
    elif lo is not None and val == lo: col, sym = Y, "~"
    else:                              col, sym = C, "·"
    print(f"  {col}{sym}{X} {label:<46}: {v}")

with open(proof_path, encoding='utf-8') as f:
    d = json.load(f)

p   = d.get('payload', {}) or {}
le  = p.get('label_eligibility', {}) or {}
ps  = p.get('process_summary',   {}) or {}
doc = p.get('document',          {}) or {}
bos = p.get('bound_objects',     []) or []
bo  = bos[0] if bos else {}
sg  = le.get('security_gates',   {}) or {}

od  = doc.get('object_delta')             or bo.get('object_delta')             or {}
pol = doc.get('process_object_link')      or bo.get('process_object_link')      or {}
osi = doc.get('object_state_initial')     or bo.get('object_state_initial')     or {}
dca = doc.get('document_contribution_attested')
if dca is None:
    dca = bo.get('document_contribution_attested')

# ── Section 1 : Résumé des verdicts ──────────────────────────────────────────
print(f"\n{B}── 1. Résumé ──{X}")

vis  = le.get('visible_verdict') or ps.get('verdict', '—')
raw  = le.get('raw_engine_verdict', '—')
ev_l = ps.get('evidence_level', '—')
s_ev = le.get('short_evidence')
bmd  = doc.get('binding_mode',     '—')
bcov = doc.get('binding_coverage', '—')
cov  = doc.get('covered_session_count',   '—')
unc  = doc.get('uncovered_session_count', '—')

row("visible_verdict",    vis,  sym="·", col=G if vis == 'COHERENT' else (Y if vis and 'LIMIT' in str(vis).upper() else C))
row("raw_engine_verdict", raw)
row("evidence_level",     ev_l, sym="~" if 'short' in str(ev_l).lower() else "·")
row("short_evidence",     s_ev, sym="~" if s_ev else "·", col=Y if s_ev else C)
row("binding_mode",       bmd)
row("binding_coverage",   bcov)
row("covered_sessions",   cov)
row("uncovered_sessions", unc)

# ── Section 2 : Object Evidence détaillé ─────────────────────────────────────
print(f"\n{B}── 2. Object Evidence ──{X}")

hc   = od.get('hash_changed')
md   = od.get('meaningful_delta')
cds  = od.get('changed_during_observed_sessions')
cal  = od.get('changed_after_last_observed_session')
cec  = od.get('change_event_count', 0)
dc   = od.get('delta_confidence', '—')
thc  = od.get('text_hash_changed')
wcd  = od.get('word_count_delta')
tld  = od.get('text_length_delta')
exc  = od.get('extraction_confidence', 'none')
xs   = osi.get('extraction_status', '—')
pl   = pol.get('level',      '—')
pr   = pol.get('reason',     '—')
pc   = pol.get('confidence', '—')
tac  = sg.get('text_activity_coherence', '—')

oe("hash_changed",                          hc)
oe("meaningful_delta",                      md)
oe("changed_during_observed_sessions",      cds,  hi=True,  lo=False)
oe("changed_after_last_observed_session",   cal,  hi=False, lo=True)
oe("change_event_count",                    cec)
oe("delta_confidence",                      dc)
oe("text_hash_changed",                     thc,  hi=True)
oe("word_count_delta",                      wcd)
oe("text_length_delta",                     tld)
oe("extraction_confidence",                 exc,  hi='high')
oe("extraction_status_initial",             xs)
oe("process_object_link.level",             pl,   hi='strong', lo='none')
oe("process_object_link.reason",            pr)
oe("process_object_link.confidence",        pc)
oe("document_contribution_attested",        dca,  hi=True,  lo=False)
oe("text_activity_coherence",               tac,  hi='consistent')

# ── Section 3 : Intégrité du package ─────────────────────────────────────────
print(f"\n{B}── 3. Intégrité du package ──{X}")

zip_path    = os.path.join(pkg_dir, "HumanOrigin_SEND.zip")
readme_path = os.path.join(send_dir, "README_SEND_FIRST.txt")
pdf_files   = glob.glob(os.path.join(send_dir, "*HumanOrigin*.pdf"))
pdf_pres    = len(pdf_files) > 0

if os.path.isfile(zip_path):
    sz = os.path.getsize(zip_path)
    ok(f"HumanOrigin_SEND.zip présent ({sz:,} octets)")
    try:
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            if any('PROOF' in n for n in names):
                ok("ZIP contient le fichier de preuve JSON")
            else:
                fail("ZIP sans proof JSON (HumanOrigin_PROOF.v1.ho.json manquant)")
            if any('README' in n for n in names):
                ok("ZIP contient README_SEND_FIRST.txt")
            else:
                fail("ZIP sans README_SEND_FIRST.txt")
            if pdf_pres:
                if any(n.lower().endswith('.pdf') for n in names):
                    ok(f"ZIP contient le PDF labellisé")
                else:
                    warn("ZIP sans PDF labellisé (PDF présent dans sendDir mais absent du ZIP)")
            else:
                warn("ZIP sans PDF (normal si DOCX ou publisher non disponible)")
    except Exception as ze:
        fail(f"ZIP illisible : {ze}")
else:
    fail("HumanOrigin_SEND.zip MANQUANT")

if pdf_pres:
    ok(f"PDF labellisé : {os.path.basename(pdf_files[0])}")
else:
    warn("Aucun PDF labellisé dans 2_SEND_TO_RECIPIENT")

if os.path.isfile(readme_path):
    ok("README_SEND_FIRST.txt présent")
else:
    fail("README_SEND_FIRST.txt manquant")

# ── Section 4 : Claims critiques ─────────────────────────────────────────────
print(f"\n{B}── 4. Claims critiques ──{X}")

ca = le.get('claims_allowed',   []) or []
cf = le.get('claims_forbidden', []) or []

# document_work_link_not_demonstrated
if dca is False:
    if 'document_work_link_not_demonstrated' in cf:
        ok("document_work_link_not_demonstrated → forbidden ✓  (dca=false)")
    else:
        fail("document_work_link_not_demonstrated absent de claims_forbidden (dca=false)")
elif dca is True:
    if 'document_work_link_not_demonstrated' in cf:
        warn("document_work_link_not_demonstrated dans forbidden alors que dca=true")
    else:
        ok("document_work_link_not_demonstrated absent de forbidden ✓  (dca=true)")

# document_creation_attested
if dca is False:
    if 'document_creation_attested' in ca:
        fail("document_creation_attested dans claims_allowed (interdit si dca=false)")
    elif 'document_creation_attested' in cf:
        ok("document_creation_attested → forbidden ✓  (dca=false)")
    else:
        warn("document_creation_attested absent des deux listes (dca=false)")
elif dca is True:
    if 'document_creation_attested' in ca:
        ok("document_creation_attested → allowed ✓  (dca=true)")
    else:
        warn("document_creation_attested absent de claims_allowed (dca=true)")

# strong_process_evidence
if vis != 'COHERENT':
    if 'strong_process_evidence' in ca:
        fail("strong_process_evidence dans claims_allowed (verdict ≠ COHERENT)")
    else:
        ok("strong_process_evidence absent de claims_allowed ✓  (verdict ≠ COHERENT)")
else:
    if 'strong_process_evidence' in ca:
        ok("strong_process_evidence → claims_allowed ✓  (COHERENT)")
    else:
        warn("strong_process_evidence absent de claims_allowed (verdict=COHERENT)")

# contribution_plausible
if dca is False:
    if 'contribution_plausible' in ca:
        fail("contribution_plausible dans claims_allowed (interdit si dca=false)")
    else:
        ok("contribution_plausible absent de claims_allowed ✓  (dca=false)")
elif dca is True:
    if 'contribution_plausible' in ca:
        ok("contribution_plausible → claims_allowed ✓  (dca=true)")
    else:
        warn("contribution_plausible absent de claims_allowed (dca=true)")

# ── Section 5 : Cas détecté ───────────────────────────────────────────────────
print(f"\n{B}── 5. Cas détecté ──{X}")

if hc is False and dca is False:
    ok(f"Cas A — Document inchangé, activité observée ailleurs")
    if pl == 'none':
        ok("  pol=none ✓   dca=false ✓   (cohérent)")
        PASS_CRITERIA.append("Cas A : pol=none, dca=false — cohérent")
    else:
        warn(f"  pol={pl} (attendu : none)")

elif hc is True and s_ev is True and dca is False:
    ok(f"Cas B — Document modifié pendant observation, preuve courte (short_evidence=true)")
    b_ok = True
    if pl == 'plausible':
        ok("  pol=plausible ✓")
    else:
        warn(f"  pol={pl}  (attendu : plausible)"); b_ok = False
    ok("  dca=false ✓")
    ok("  short_evidence=true ✓")
    if b_ok:
        PASS_CRITERIA.append("Cas B : pol=plausible, dca=false, short_evidence=true — cohérent")
    else:
        FAIL_REASONS.append(f"Cas B : pol={pl} attendu plausible")

elif hc is True and dca is True:
    ok(f"Cas C — Document modifié, contribution attestée (dca=true)")
    if vis == 'COHERENT' and pl == 'strong':
        ok("  pol=strong ✓   dca=true ✓   verdict=COHERENT ✓")
        PASS_CRITERIA.append("Cas C : pol=strong, dca=true, COHERENT — cohérent")
    else:
        warn(f"  pol={pl}  verdict={vis}  (attendu : strong + COHERENT)")

elif hc is True and s_ev is False and dca is False:
    warn(f"Cas B2 — Document modifié, volume insuffisant, non short_evidence")
    warn(f"  pol={pl}  dca=false  short_evidence=false")

elif hc is None:
    warn(f"hash_changed non déterminé — objet non comparé (extraction échouée ?)")

else:
    warn(f"Cas non classifié : hash_changed={hc}  dca={dca}  short_evidence={s_ev}")

# ── Conclusion Python ─────────────────────────────────────────────────────────
print(f"\n{'═'*43}")
if not FAIL_REASONS:
    print(f"{G}{B}✓ OBJECT EVIDENCE REPORT: PASS{X}")
    for c in PASS_CRITERIA:
        print(f"  {G}✓{X} {c}")
else:
    print(f"{R}{B}✗ OBJECT EVIDENCE REPORT: FAIL{X}")
    for r in FAIL_REASONS:
        print(f"  {R}✗{X} {r}")
print("")

sys.exit(len(FAIL_REASONS))
PYEOF
OE_EXIT=$?
if [[ $OE_EXIT -ne 0 ]]; then
  FAILURES=$((FAILURES + OE_EXIT))
fi

# ── Smoke test ────────────────────────────────────────────────────────────────
header "Smoke test"
if bash "${SCRIPT_DIR}/smoke_latest_export.sh"; then
  ok "Smoke : PASS"
else
  SMOKE_CODE=$?
  fail "Smoke : FAIL (code ${SMOKE_CODE})"
fi

# ── Red team ──────────────────────────────────────────────────────────────────
header "Red team"
if bash "${SCRIPT_DIR}/redteam_latest_export.sh"; then
  ok "Red team : PASS"
else
  REDTEAM_CODE=$?
  fail "Red team : FAIL (code ${REDTEAM_CODE})"
fi

# ── Verdict final ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✓ OBJECT EVIDENCE REPORT: PASS${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}✗ OBJECT EVIDENCE REPORT: FAIL — ${FAILURES} problème(s)${RESET}"
  exit 1
fi
