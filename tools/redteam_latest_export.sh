#!/usr/bin/env bash
# redteam_latest_export.sh — vérifie les invariants de non-surpromesse du dernier package HumanOrigin
# Usage : ./tools/redteam_latest_export.sh
# Retourne 0 si aucun invariant critique violé, 1 si overclaim détecté.

set -euo pipefail

PROJECTS_DIR="${HOME}/Documents/HumanOrigin/Projects"

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
echo -e "${BOLD}HumanOrigin — Red-team proof invariant check${RESET}"
echo "────────────────────────────────────────────"

if [[ -z "$PKG" ]]; then
  fail "Aucun package HumanOrigin trouvé dans ${PROJECTS_DIR}"
  echo ""
  echo -e "${RED}${BOLD}✗ RED TEAM FAIL — aucun package disponible.${RESET}"
  exit 1
fi

echo "  Package : $(basename "$PKG")"
echo ""

PROOF_FILE="${PKG}/2_SEND_TO_RECIPIENT/HumanOrigin_PROOF.v1.ho.json"

if [[ ! -f "$PROOF_FILE" ]]; then
  fail "HumanOrigin_PROOF.v1.ho.json introuvable dans 2_SEND_TO_RECIPIENT"
  echo ""
  echo -e "${RED}${BOLD}✗ RED TEAM FAIL — fichier de preuve manquant.${RESET}"
  exit 1
fi

# ── Analyse Python inline ─────────────────────────────────────────────────────
python3 - "$PROOF_FILE" <<'PYEOF'
import json, sys

COHERENT_VARIANTS = {"COHERENT", "COHÉRENT", "COHÉRENT"}

def normalize_verdict(v):
    return str(v or "").strip().upper().replace("LIMITEE", "LIMITÉE")

def is_coherent(v):
    return normalize_verdict(v) in COHERENT_VARIANTS

path = sys.argv[1]
try:
    d = json.load(open(path, encoding='utf-8'))
except Exception as e:
    print(f"  \033[0;31m✗\033[0m Impossible de lire le fichier : {e}")
    sys.exit(1)

ok_f   = lambda s: print(f"  \033[0;32m✓\033[0m {s}")
warn_f = lambda s: print(f"  \033[0;33m~\033[0m {s}")
fail_f = lambda s: print(f"  \033[0;31m✗\033[0m {s}")

p    = d.get('payload', {})
ps   = p.get('process_summary', {})
le   = p.get('label_eligibility', {})
doc  = p.get('document', {})
paste = ps.get('paste_summary') or {}
gates = le.get('security_gates') or {}

raw_verdict     = ps.get('verdict', '')
visible_verdict = le.get('visible_verdict') or raw_verdict
raw_engine      = le.get('raw_engine_verdict') or visible_verdict
caps_applied    = le.get('caps_applied') or []
claims_allowed  = le.get('claims_allowed') or []
claims_forbidden = le.get('claims_forbidden') or []

binding_mode       = doc.get('binding_mode', '')
binding_coverage   = doc.get('binding_coverage')
covered_sessions   = doc.get('covered_session_count')
uncovered_sessions = doc.get('uncovered_session_count')
document_modified  = doc.get('document_modified')
delta_significant  = doc.get('delta_significant')
delta_ratio        = doc.get('delta_bytes_ratio')
contribution_score = doc.get('contribution_score')
contribution_coh   = doc.get('contribution_coherence', '')
contribution_flags = doc.get('contribution_flags') or []

paste_events   = paste.get('total_paste_events', 0) or 0
paste_chars    = paste.get('total_pasted_chars', 0) or 0
paste_dominant = paste.get('paste_dominant_sessions', 0) or 0
paste_heavy    = paste.get('paste_heavy_sessions', 0) or 0
paste_material = paste.get('paste_material_sessions', 0) or 0

# ── Détection format ──────────────────────────────────────────────────────────
is_recent = le.get('visible_verdict') is not None

# ── 1. Verdicts ───────────────────────────────────────────────────────────────
print("1. Verdicts")
print(f"     raw_engine_verdict  : {raw_engine or '—'}")
print(f"     visible_verdict     : {visible_verdict or '—'}")
print(f"     caps_applied        : {', '.join(caps_applied) if caps_applied else 'aucun'}")

# ── 2. Binding / delta ────────────────────────────────────────────────────────
print("")
print("2. Binding / delta")
print(f"     binding_mode        : {binding_mode or '—'}")
print(f"     binding_coverage    : {binding_coverage if binding_coverage is not None else '—'}")
print(f"     covered_sessions    : {covered_sessions if covered_sessions is not None else '—'}")
print(f"     uncovered_sessions  : {uncovered_sessions if uncovered_sessions is not None else '—'}")
print(f"     document_modified   : {document_modified if document_modified is not None else '—'}")
print(f"     delta_significant   : {delta_significant if delta_significant is not None else '—'}")
print(f"     delta_bytes_ratio   : {delta_ratio if delta_ratio is not None else '—'}")

# ── 3. Contribution ───────────────────────────────────────────────────────────
print("")
print("3. Contribution")
print(f"     contribution_score      : {contribution_score if contribution_score is not None else '—'}")
print(f"     contribution_coherence  : {contribution_coh or '—'}")
print(f"     contribution_flags      : {', '.join(contribution_flags) if contribution_flags else 'aucun'}")

# ── 4. Paste risk ─────────────────────────────────────────────────────────────
print("")
print("4. Paste risk")
print(f"     total_paste_events      : {paste_events}")
print(f"     total_pasted_chars      : {paste_chars}")
print(f"     paste_dominant_sessions : {paste_dominant}")
print(f"     paste_heavy_sessions    : {paste_heavy}")

# ── 5. Claims ─────────────────────────────────────────────────────────────────
print("")
print("5. Claims")
print(f"     claims_allowed   : {', '.join(claims_allowed) if claims_allowed else '—'}")
print(f"     claims_forbidden : {', '.join(claims_forbidden) if claims_forbidden else '—'}")

# ── 6. Invariants ─────────────────────────────────────────────────────────────
print("")
print("6. Invariants")

failures = 0

if not is_recent:
    warn_f("FORMAT ANCIEN — champs label_eligibility absents. Invariants A–6 non applicables.")
    warn_f("Relancez un export avec la version actuelle de HumanOrigin pour une vérification complète.")
    print("")
    print("  \033[0;33m~ RED TEAM SKIP — package antérieur aux gates de sécurité.\033[0m")
    sys.exit(0)

# ── Invariant A : champs obligatoires (format récent) ────────────────────────
required_le = ['visible_verdict', 'raw_engine_verdict', 'claims_allowed', 'claims_forbidden', 'security_gates']
for field in required_le:
    if le.get(field) is None:
        fail_f(f"Invariant A — label_eligibility.{field} manquant (format récent)")
        failures += 1

required_doc = ['binding_mode', 'delta_significant', 'contribution_score']
for field in required_doc:
    if doc.get(field) is None:
        fail_f(f"Invariant A — document.{field} manquant (format récent)")
        failures += 1

if ps.get('paste_summary') is None:
    fail_f("Invariant A — process_summary.paste_summary manquant (format récent)")
    failures += 1

if failures == 0:
    ok_f("Invariant A — tous les champs obligatoires présents")

# ── Invariant 1 : binding_mode export_time → pas COHERENT ────────────────────
if binding_mode == "export_time":
    if is_coherent(visible_verdict):
        fail_f("Invariant 1 — binding_mode=export_time mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant 1 — binding_mode=export_time → visible_verdict={visible_verdict} (non COHERENT ✓)")
else:
    ok_f(f"Invariant 1 — binding_mode={binding_mode or '—'} (non export_time, règle non applicable)")

# ── Invariant 2 : document_modified false → pas COHERENT ─────────────────────
if document_modified is False:
    if is_coherent(visible_verdict):
        fail_f("Invariant 2 — document_modified=false mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant 2 — document_modified=false → visible_verdict={visible_verdict} (non COHERENT ✓)")
elif document_modified is None:
    warn_f("Invariant 2 — document_modified absent (champ optionnel, non vérifié)")
else:
    ok_f(f"Invariant 2 — document_modified={document_modified} (règle non déclenchée)")

# ── Invariant 3 : delta_significant false → pas COHERENT ─────────────────────
if delta_significant is False:
    if is_coherent(visible_verdict):
        fail_f("Invariant 3 — delta_significant=false mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant 3 — delta_significant=false → visible_verdict={visible_verdict} (non COHERENT ✓)")
elif delta_significant is None:
    warn_f("Invariant 3 — delta_significant absent (champ optionnel, non vérifié)")
else:
    ok_f(f"Invariant 3 — delta_significant={delta_significant} (règle non déclenchée)")

# ── Invariant 4 : contribution_score < 55 → pas COHERENT + claim forbidden ───
if contribution_score is not None and contribution_score < 55:
    inv4_fail = False
    if is_coherent(visible_verdict):
        fail_f(f"Invariant 4 — contribution_score={contribution_score} (<55) mais visible_verdict=COHERENT : overclaim")
        failures += 1
        inv4_fail = True
    if "substantial_document_contribution_attested" not in claims_forbidden:
        fail_f("Invariant 4 — contribution_score<55 mais 'substantial_document_contribution_attested' absent de claims_forbidden")
        failures += 1
        inv4_fail = True
    if not inv4_fail:
        ok_f(f"Invariant 4 — contribution_score={contribution_score} (<55) → verdict et claims_forbidden cohérents")
elif contribution_score is None:
    warn_f("Invariant 4 — contribution_score absent (champ optionnel, non vérifié)")
else:
    ok_f(f"Invariant 4 — contribution_score={contribution_score} (≥55, règle non déclenchée)")

# ── Invariant 5 : paste risk élevé → pas COHERENT + claim forbidden ──────────
paste_risk_high = paste_dominant > 0 or paste_heavy > 0
if paste_risk_high:
    inv5_fail = False
    if is_coherent(visible_verdict):
        fail_f(f"Invariant 5 — paste dominant/heavy détecté ({paste_dominant}/{paste_heavy}) mais visible_verdict=COHERENT : overclaim")
        failures += 1
        inv5_fail = True
    if "no_external_generation" not in claims_forbidden:
        fail_f("Invariant 5 — paste dominant/heavy détecté mais 'no_external_generation' absent de claims_forbidden")
        failures += 1
        inv5_fail = True
    if not inv5_fail:
        ok_f(f"Invariant 5 — paste risk élevé (dominant={paste_dominant}, heavy={paste_heavy}) → claims_forbidden cohérent")
else:
    ok_f(f"Invariant 5 — paste risk faible (dominant={paste_dominant}, heavy={paste_heavy}, règle non déclenchée)")

# ── Invariant 6 : si COHERENT, toutes les conditions doivent être remplies ────
if is_coherent(visible_verdict):
    inv6_fail = False

    if binding_mode not in ("pre_observation", ""):
        if binding_mode:
            fail_f(f"Invariant 6 — COHERENT mais binding_mode={binding_mode} (attendu pre_observation uniquement)")
            failures += 1
            inv6_fail = True

    if binding_coverage is not None and binding_coverage != "full":
        fail_f(f"Invariant 6 — COHERENT mais binding_coverage={binding_coverage} (attendu full)")
        failures += 1
        inv6_fail = True

    if document_modified is False:
        fail_f("Invariant 6 — COHERENT mais document_modified=false")
        failures += 1
        inv6_fail = True

    if delta_significant is False:
        fail_f("Invariant 6 — COHERENT mais delta_significant=false")
        failures += 1
        inv6_fail = True

    if contribution_score is not None and contribution_score < 55:
        fail_f(f"Invariant 6 — COHERENT mais contribution_score={contribution_score} (<55)")
        failures += 1
        inv6_fail = True

    if paste_dominant > 0:
        fail_f(f"Invariant 6 — COHERENT mais paste_dominant_sessions={paste_dominant}")
        failures += 1
        inv6_fail = True

    if paste_heavy > 0:
        fail_f(f"Invariant 6 — COHERENT mais paste_heavy_sessions={paste_heavy}")
        failures += 1
        inv6_fail = True

    has_strong_claim = (
        "strong_process_evidence" in claims_allowed
        or "contribution_plausible" in claims_allowed
    )
    if not has_strong_claim:
        fail_f("Invariant 6 — COHERENT mais ni 'strong_process_evidence' ni 'contribution_plausible' dans claims_allowed")
        failures += 1
        inv6_fail = True

    if not inv6_fail:
        ok_f("Invariant 6 — COHERENT : toutes les pré-conditions vérifiées")
else:
    ok_f(f"Invariant 6 — visible_verdict={visible_verdict or '—'} (non COHERENT, règle non applicable)")

# ── Invariant 7 : si short_evidence, visible_verdict ≠ COHERENT + claims_forbidden cohérents ──
short_evidence = le.get('short_evidence', False) if le else False
if short_evidence is True:
    inv7_fail = False
    if is_coherent(visible_verdict):
        fail_f("Invariant 7 — short_evidence=true mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
        inv7_fail = True
    if "substantial_document_contribution_attested" not in claims_forbidden:
        fail_f("Invariant 7 — short_evidence=true mais 'substantial_document_contribution_attested' absent de claims_forbidden")
        failures += 1
        inv7_fail = True
    if not inv7_fail:
        ok_f(f"Invariant 7 — short_evidence=true → visible_verdict={visible_verdict}, claims_forbidden cohérents")
else:
    ok_f("Invariant 7 — short_evidence=false (pas de trace courte, règle non applicable)")

# ── Invariants de couverture de binding (B1-B3) ───────────────────────────────
# B1 : post_session_binding → non COHERENT
if binding_mode == "post_session_binding":
    if is_coherent(visible_verdict):
        fail_f("Invariant B1 — binding_mode=post_session_binding mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant B1 — binding_mode=post_session_binding → visible_verdict={visible_verdict} (non COHERENT ✓)")
else:
    ok_f(f"Invariant B1 — binding_mode={binding_mode or '—'} (non post_session_binding, règle non applicable)")

# B2 : partial_pre_observation → non COHERENT
if binding_mode == "partial_pre_observation":
    if is_coherent(visible_verdict):
        fail_f("Invariant B2 — binding_mode=partial_pre_observation mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant B2 — binding_mode=partial_pre_observation → visible_verdict={visible_verdict} (non COHERENT ✓)")
else:
    ok_f(f"Invariant B2 — binding_mode={binding_mode or '—'} (non partial_pre_observation, règle non applicable)")

# B3 : binding_coverage != full → non COHERENT
if binding_coverage is not None and binding_coverage != "full" and binding_coverage != "unknown":
    if is_coherent(visible_verdict):
        fail_f(f"Invariant B3 — binding_coverage={binding_coverage} (non full) mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant B3 — binding_coverage={binding_coverage} (non full) → visible_verdict={visible_verdict} (non COHERENT ✓)")
elif binding_coverage == "full":
    ok_f("Invariant B3 — binding_coverage=full (règle non déclenchée)")
else:
    ok_f("Invariant B3 — binding_coverage absent ou unknown (ancien package, non vérifié)")

# ── Invariants multimodaux (M1-M4) ───────────────────────────────────────────
mp = p.get('media_profile')
bos = p.get('bound_objects') or []
bo = bos[0] if bos else {}

MEDIA_FORBIDDEN_IN_ALLOWED = {
    "authentic_photo", "real_human_voice", "scene_authenticity_verified",
    "image_not_ai_generated", "video_not_ai_generated", "audio_not_ai_generated",
    "no_ai_generation",
}
MEDIA_FORBIDDEN_REQUIRED = {
    "authentic_photo", "real_human_voice", "scene_authenticity_verified",
    "image_not_ai_generated", "video_not_ai_generated", "audio_not_ai_generated",
    "code_correctness_verified",
}

if mp is not None:
    # Invariant M1 — media_profile.primary_type doit être "document" en V1
    m1_type = mp.get('primary_type', '')
    if m1_type != "document":
        fail_f(f"Invariant M1 — media_profile.primary_type='{m1_type}' : attendu 'document' en V1")
        failures += 1
    else:
        ok_f(f"Invariant M1 — media_profile.primary_type=document ✓")
else:
    warn_f("Invariant M1 — media_profile absent (ancien package, non vérifié)")

if bo:
    # Invariant M2 — bound_objects[0].media_type doit être "document" en V1
    m2_type = bo.get('media_type', '')
    if m2_type != "document":
        fail_f(f"Invariant M2 — bound_objects[0].media_type='{m2_type}' : attendu 'document' en V1")
        failures += 1
    else:
        ok_f(f"Invariant M2 — bound_objects[0].media_type=document ✓")
else:
    warn_f("Invariant M2 — bound_objects absent (ancien package, non vérifié)")

# Invariant M3 — claims_allowed ne doit pas contenir de claims médias
forbidden_in_allowed = set(claims_allowed) & MEDIA_FORBIDDEN_IN_ALLOWED
if forbidden_in_allowed:
    fail_f(f"Invariant M3 — claims_allowed contient des claims médias interdits : {forbidden_in_allowed}")
    failures += 1
else:
    ok_f("Invariant M3 — claims_allowed : aucun claim média interdit présent")

# Invariant M4 — claims_forbidden doit contenir les claims médias obligatoires
missing_media_forbidden = MEDIA_FORBIDDEN_REQUIRED - set(claims_forbidden)
if missing_media_forbidden:
    fail_f(f"Invariant M4 — claims_forbidden manque : {missing_media_forbidden}")
    failures += 1
else:
    ok_f("Invariant M4 — claims_forbidden : tous les claims médias interdits présents")

# ── Invariants Object Evidence Core (OE1–OE6) ────────────────────────────────
print("")
print("7. Object Evidence Core invariants")

doc_oe  = p.get('document', {})
obj_delta = doc_oe.get('object_delta')
pol_oe    = doc_oe.get('process_object_link', {})
dca       = doc_oe.get('document_contribution_attested')

if obj_delta is not None:
    hash_changed   = obj_delta.get('hash_changed')
    meaningful     = obj_delta.get('meaningful_delta')
    chg_during     = obj_delta.get('changed_during_observed_sessions')
    chg_after      = obj_delta.get('changed_after_last_observed_session')
    pol_level      = pol_oe.get('level') if pol_oe else None

    # OE1 : hash_changed=false → document_contribution_attested=false
    if hash_changed is False and dca is True:
        fail_f("Invariant OE1 — hash_changed=false mais document_contribution_attested=true : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant OE1 — hash_changed={hash_changed} / dca={dca} (cohérent)")

    # OE2 : meaningful_delta=false → document_contribution_attested=false
    if meaningful is False and dca is True:
        fail_f("Invariant OE2 — meaningful_delta=false mais document_contribution_attested=true : overclaim")
        failures += 1
    else:
        ok_f(f"Invariant OE2 — meaningful_delta={meaningful} / dca={dca} (cohérent)")

    # OE3 : changed_after_last_observed_session=true → document_contribution_attested=false
    if chg_after is True and dca is True:
        fail_f("Invariant OE3 — changed_after_last_observed_session=true mais document_contribution_attested=true")
        failures += 1
    else:
        ok_f(f"Invariant OE3 — changed_after={chg_after} / dca={dca} (cohérent)")

    # OE4 : changed_during_observed_sessions=false (avec données) → dca=false
    if chg_during is False and dca is True:
        fail_f("Invariant OE4 — changed_during_observed_sessions=false mais document_contribution_attested=true")
        failures += 1
    else:
        ok_f(f"Invariant OE4 — changed_during={chg_during} / dca={dca} (cohérent)")

    # OE5 : process_object_link=none → COHERENT impossible
    if pol_level == "none" and is_coherent(visible_verdict):
        fail_f("Invariant OE5 — process_object_link.level=none mais visible_verdict=COHERENT : overclaim critique")
        failures += 1
    else:
        ok_f(f"Invariant OE5 — process_object_link.level={pol_level or '—'} / verdict={visible_verdict} (cohérent)")

    # OE6 : document_contribution_attested=false → claims_forbidden contient document_work_link_not_demonstrated
    if dca is False:
        if "document_work_link_not_demonstrated" not in claims_forbidden:
            fail_f("Invariant OE6 — dca=false mais 'document_work_link_not_demonstrated' absent de claims_forbidden")
            failures += 1
        else:
            ok_f("Invariant OE6 — dca=false → document_work_link_not_demonstrated dans claims_forbidden ✓")
    elif dca is True:
        ok_f("Invariant OE6 — dca=true (règle non déclenchée)")
    else:
        warn_f("Invariant OE6 — document_contribution_attested absent (ancien package, non vérifié)")

    # OE7 : extraction ok + text_hash_changed=false → dca=false
    text_hash_changed_oe = obj_delta.get('text_hash_changed')
    ext_conf_oe = obj_delta.get('extraction_confidence', 'none')
    if ext_conf_oe == 'ok' and text_hash_changed_oe is False and dca is True:
        fail_f("Invariant OE7 — extraction ok + text_hash_changed=false mais document_contribution_attested=true : overclaim")
        failures += 1
    elif ext_conf_oe == 'ok':
        ok_f(f"Invariant OE7 — extraction ok / text_hash_changed={text_hash_changed_oe} / dca={dca} (cohérent)")
    else:
        ok_f(f"Invariant OE7 — extraction_confidence={ext_conf_oe} (règle non applicable)")

    # OE8 : suspicious_low_keystrokes → dca=false
    tac_oe = (gates or {}).get('text_activity_coherence')
    if tac_oe == 'suspicious_low_keystrokes' and dca is True:
        fail_f("Invariant OE8 — text_activity_coherence=suspicious_low_keystrokes mais dca=true : overclaim")
        failures += 1
    elif tac_oe == 'suspicious_low_keystrokes':
        ok_f(f"Invariant OE8 — text_activity_coherence={tac_oe} / dca={dca} (cohérent)")
    else:
        ok_f(f"Invariant OE8 — text_activity_coherence={tac_oe or '—'} (règle non applicable)")

    # OE9 : process_object_link=strong → extraction_confidence=ok requis
    if pol_level == 'strong' and ext_conf_oe != 'ok':
        fail_f(f"Invariant OE9 — process_object_link=strong mais extraction_confidence={ext_conf_oe} (doit être ok)")
        failures += 1
    elif pol_level == 'strong':
        ok_f(f"Invariant OE9 — process_object_link=strong / extraction_confidence={ext_conf_oe} (cohérent)")
    else:
        ok_f(f"Invariant OE9 — process_object_link.level={pol_level or '—'} (non strong, règle non applicable)")

else:
    warn_f("Invariants OE1–OE9 non applicables (object_delta absent — ancien package)")

# ── Résultat final ────────────────────────────────────────────────────────────
print("")
if failures == 0:
    print("  \033[0;32m✓ RED TEAM OK — no overclaim detected\033[0m")
    sys.exit(0)
else:
    print(f"  \033[0;31m✗ RED TEAM FAIL — {failures} overclaim risk(s) detected\033[0m")
    sys.exit(failures)

PYEOF

RT_EXIT=$?

echo ""
echo "────────────────────────────────────────────"
if [[ $RT_EXIT -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✓ RED TEAM OK — no overclaim detected.${RESET}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}✗ RED TEAM FAIL — overclaim risk detected. Recheck before distributing.${RESET}"
  echo ""
  exit 1
fi
