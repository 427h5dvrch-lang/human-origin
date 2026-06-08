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
PKG_MTIME=$(stat -f '%m' "$PKG" 2>/dev/null || stat -c '%Y' "$PKG" 2>/dev/null || echo 0)
PKG_DATE=$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$PKG" 2>/dev/null || date -r "$PKG" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "?")
NOW_TS=$(date +%s)
AGE_MIN=$(( (NOW_TS - PKG_MTIME) / 60 )) || AGE_MIN=0
echo "  Chemin  : $PKG"
echo "  Date    : ${PKG_DATE} (il y a ${AGE_MIN} min)"
if [[ "$AGE_MIN" -gt 60 ]]; then
  warn "Package vieux de ${AGE_MIN} min — peut ne pas correspondre au projet courant."
fi
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

# Nom du projet depuis le payload
proj_name = d.get('payload', {}).get('project', {}).get('name', '')
if proj_name:
    ok(f"Projet : {proj_name}")
else:
    warn("Nom de projet absent du payload (ancien format)")

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

# issuer trust metadata (champs V5 — trust P0)
issuer = p.get('issuer', {})
issuer_mode = issuer.get('issuer_mode', '')
if issuer_mode:
    ok(f"issuer_mode : {issuer_mode}")
else:
    warn("issuer_mode absent (ancien format)")

app_ver = issuer.get('app_version')
if app_ver is not None:
    ok(f"issuer.app_version : {app_ver}")
else:
    warn("issuer.app_version absent (ancien package)")

schema_ver = issuer.get('security_schema_version')
if schema_ver is not None:
    ok(f"issuer.security_schema_version : {schema_ver}")
else:
    warn("issuer.security_schema_version absent (ancien package)")

trust_level = issuer.get('proof_trust_level')
if trust_level is not None:
    ok(f"issuer.proof_trust_level : {trust_level}")
else:
    warn("issuer.proof_trust_level absent (ancien package)")

key_trust = issuer.get('key_trust')
if key_trust is not None:
    ok(f"issuer.key_trust : {key_trust}")
else:
    warn("issuer.key_trust absent (ancien package)")

# Signature
sigs = d.get('signatures', [])
sig_val = (sigs[0].get('signature','') if sigs else '') or d.get('signing',{}).get('signature','')
if sig_val:
    ok(f"Signature Ed25519 : {sig_val[:16]}…")
else:
    fail("Signature manquante")
    errors += 1

# ── Binding documentaire (champs V2) ─────────────────────────────────────
doc = p.get('document', {})
binding_mode = doc.get('binding_mode', '')
if binding_mode:
    ok(f"binding_mode : {binding_mode}")
else:
    warn("binding_mode absent (ancien package)")

binding_coverage = doc.get('binding_coverage')
covered_sessions = doc.get('covered_session_count')
uncovered_sessions = doc.get('uncovered_session_count')
binding_scope = doc.get('binding_scope')
if binding_coverage is not None:
    cov_lbl = f"covered={covered_sessions}, uncovered={uncovered_sessions}, scope={binding_scope}"
    if binding_coverage == "full":
        ok(f"binding_coverage : {binding_coverage} ({cov_lbl})")
    elif binding_coverage in ("partial", "post_session_only"):
        warn(f"binding_coverage : {binding_coverage} ({cov_lbl}) — COHERENT non possible")
    else:
        ok(f"binding_coverage : {binding_coverage} ({cov_lbl})")
else:
    warn("binding_coverage absent (ancien package)")

delta_significant = doc.get('delta_significant')
if delta_significant is None:
    warn("delta_significant absent (ancien package)")
else:
    ok(f"delta_significant : {delta_significant}")

delta_ratio = doc.get('delta_bytes_ratio')
if delta_ratio is not None:
    ok(f"delta_bytes_ratio : {delta_ratio}")
else:
    warn("delta_bytes_ratio absent (ancien package ou pas de taille initiale)")

# ── Label eligibility ─────────────────────────────────────────────────────
le = p.get('label_eligibility', {})
if le:
    vis = le.get('visible_verdict', '')
    raw = le.get('raw_engine_verdict', '')
    cap = le.get('binding_cap_applied', None)
    claims_allowed = le.get('claims_allowed', [])
    claims_forbidden = le.get('claims_forbidden', [])
    gates = le.get('security_gates', {})
    if vis:
        ok(f"visible_verdict : {vis}")
    if raw and raw != vis:
        ok(f"raw_engine_verdict : {raw} → cap appliqué")
    if claims_allowed:
        ok(f"claims_allowed : {', '.join(claims_allowed[:3])}{'…' if len(claims_allowed) > 3 else ''}")
    if claims_forbidden:
        ok(f"claims_forbidden : {len(claims_forbidden)} entrée(s)")
    if gates:
        ok(f"security_gates : binding_mode={gates.get('binding_mode','?')}, delta_significant={gates.get('delta_significant','?')}")
        c_score = gates.get('contribution_score')
        c_coherence = gates.get('contribution_coherence')
        if c_score is not None:
            ok(f"security_gates.contribution_score : {c_score}")
        else:
            warn("security_gates.contribution_score absent (ancien package)")
        if c_coherence is not None:
            ok(f"security_gates.contribution_coherence : {c_coherence}")
        else:
            warn("security_gates.contribution_coherence absent (ancien package)")
    # evidence adaptif (champs V6)
    short_ev = le.get('short_evidence')
    if short_ev is not None:
        if short_ev:
            warn(f"short_evidence : {short_ev} (PREUVE LIMITÉE trace courte)")
        else:
            ok(f"short_evidence : {short_ev}")
    else:
        warn("short_evidence absent (ancien package)")
else:
    warn("label_eligibility absent (ancien package)")

# ── Evidence level adaptatif (champs V6) ─────────────────────────────────
ps2 = p.get('process_summary', {})
ev_level = ps2.get('evidence_level')
ev_scope = ps2.get('evidence_scope')
if ev_level is not None:
    if ev_level == "short_observed_activity":
        warn(f"evidence_level : {ev_level}")
    else:
        ok(f"evidence_level : {ev_level}")
else:
    warn("evidence_level absent (ancien package)")
if ev_scope is not None:
    ok(f"evidence_scope : {ev_scope}")
else:
    warn("evidence_scope absent (ancien package)")

# ── Multimodal schema (champs V6) ────────────────────────────────────────
mp = p.get('media_profile', {})
if mp:
    pt = mp.get('primary_type', '')
    pm = mp.get('product_mode', '')
    mr = mp.get('multimodal_ready')
    if pt:
        ok(f"media_profile.primary_type : {pt}")
    else:
        warn("media_profile.primary_type absent")
    if pm:
        ok(f"media_profile.product_mode : {pm}")
    else:
        warn("media_profile.product_mode absent")
    if mr is not None:
        ok(f"media_profile.multimodal_ready : {mr}")
    else:
        warn("media_profile.multimodal_ready absent")
else:
    warn("media_profile absent (ancien package)")

bos = p.get('bound_objects', [])
if bos:
    bo = bos[0]
    bo_mt = bo.get('media_type', '')
    bo_role = bo.get('role', '')
    bo_sha = bo.get('sha256', '')
    ok(f"bound_objects[0].media_type : {bo_mt}")
    ok(f"bound_objects[0].role : {bo_role}")
    if bo_sha:
        ok(f"bound_objects[0].sha256 : {bo_sha[:16]}…")
    else:
        warn("bound_objects[0].sha256 absent")
else:
    warn("bound_objects absent (ancien package)")

op = p.get('observed_process', {})
if op:
    ok(f"observed_process.process_type : {op.get('process_type','—')}")
    ok(f"observed_process.evidence_level : {op.get('evidence_level','—')}")
    ok(f"observed_process.evidence_scope : {op.get('evidence_scope','—')}")
else:
    warn("observed_process absent (ancien package)")

# ── Contribution documentaire (champs V3) ─────────────────────────────────
doc_v3 = p.get('document', {})
c_score_doc = doc_v3.get('contribution_score')
c_coherence_doc = doc_v3.get('contribution_coherence')
c_flags_doc = doc_v3.get('contribution_flags')
c_cap_doc = doc_v3.get('contribution_cap_reason')
if c_score_doc is not None:
    ok(f"document.contribution_score : {c_score_doc}")
else:
    warn("document.contribution_score absent (ancien package)")
if c_coherence_doc is not None:
    ok(f"document.contribution_coherence : {c_coherence_doc}")
else:
    warn("document.contribution_coherence absent (ancien package)")
if c_flags_doc is not None:
    ok(f"document.contribution_flags : {c_flags_doc}")
else:
    warn("document.contribution_flags absent (ancien package)")
if c_cap_doc is not None:
    ok(f"document.contribution_cap_reason : {c_cap_doc}")
else:
    warn("document.contribution_cap_reason absent (pas de cap, ou ancien package)")

# ── Paste risk (champs V4) ────────────────────────────────────────────────
ps = p.get('process_summary', {}).get('paste_summary')
if ps is not None:
    ok(f"paste_summary.total_paste_events : {ps.get('total_paste_events', 0)}")
    ok(f"paste_summary.total_pasted_chars : {ps.get('total_pasted_chars', 0)}")
    dom = ps.get('paste_dominant_sessions', 0)
    hvy = ps.get('paste_heavy_sessions', 0)
    mat = ps.get('paste_material_sessions', 0)
    if dom > 0:
        warn(f"paste_dominant_sessions : {dom} (session(s) collage dominant)")
    else:
        ok(f"paste_dominant_sessions : {dom}")
    if hvy > 0:
        warn(f"paste_heavy_sessions : {hvy} (session(s) collage lourd)")
    else:
        ok(f"paste_heavy_sessions : {hvy}")
    ok(f"paste_material_sessions : {mat}")
else:
    warn("process_summary.paste_summary absent (ancien package)")

paste_risk_gate = le.get('security_gates', {}).get('paste_risk') if le else None
if paste_risk_gate is not None:
    ok(f"security_gates.paste_risk présent : dominant={paste_risk_gate.get('paste_dominant_sessions',0)}, heavy={paste_risk_gate.get('paste_heavy_sessions',0)}")
else:
    warn("security_gates.paste_risk absent (ancien package)")

server_att = doc.get('server_attestation')
if server_att:
    ok(f"server_attestation présent — proof_id : {str(server_att.get('proof_id','—'))[:8]}…")
    ok(f"server_attestation.server_key_id : {server_att.get('server_key_id','—')}")
    reg_url = server_att.get('registry_url')
    if reg_url:
        ok(f"server_attestation.registry_url : {reg_url}")
    else:
        warn("server_attestation.registry_url absent (P0 — normal)")
else:
    warn("server_attestation absent — preuve locale (normal si countersign non configuré)")

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
  echo -e "  Pour vérifier les invariants de preuve : ${BOLD}./tools/redteam_latest_export.sh${RESET}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}✗ SMOKE TEST ÉCHOUÉ — ${FAILURES} problème(s) critique(s) détecté(s).${RESET}"
  echo ""
  exit 1
fi
