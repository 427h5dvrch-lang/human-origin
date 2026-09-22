#!/bin/bash
# Construit l'application RC. RC UNIQUEMENT : aucune valeur de production n'est modifiée.
#
# Les quatre traits distinctifs sont posés à la COMPILATION, jamais à l'exécution :
#   identifiant de bundle   com.humanorigin.app.rc     (configuration RC fusionnée)
#   nom affiché             HumanOrigin RC             (configuration RC fusionnée)
#   schéma de lien          humanorigin-rc             (Info.plist du bundle produit)
#   redirection d'auth      humanorigin-rc://login     (variable Vite)
#   registre                https://127.0.0.1:8443     (option_env! côté Rust)
#
# Aucun nom de production n'apparaît dans le chemin réseau du RC : l'adresse est littérale,
# il n'y a donc aucune résolution à détourner et aucune ligne /etc/hosts.
# tools/rc/tauri.rc.conf.json ne porte aucun commentaire : le schéma Tauri refuse toute clé
# supplémentaire. Ce qu'il contient : productName et bundle.identifier, et rien d'autre. Il
# est FUSIONNÉ avec tauri.conf.json, qui garde ses valeurs de production intactes.
set -euo pipefail
cd "$(dirname "$0")/../.."
RACINE="$PWD"

export HO_BUNDLE_ID="com.humanorigin.app.rc"
export HO_DEEP_LINK_SCHEME="humanorigin-rc"
export HO_REGISTRY_URL="https://127.0.0.1:8443"
export VITE_HO_REDIRECT="humanorigin-rc://login"
# Répertoire de données. Sans cette variable, le RC partagerait finalizer_config.json,
# finalizer_state.json et les dossiers surveillés avec la production — ce qui a été constaté
# le 2026-09-22 : deux dépôts RC se sont inscrits dans l'état de production.
export HO_DATA_DIR_ID="com.humanorigin.app.rc"

echo "── identité RC ──"
echo "  bundle      : $HO_BUNDLE_ID"
echo "  schéma      : $HO_DEEP_LINK_SCHEME"
echo "  redirection : $VITE_HO_REDIRECT"
echo "  registre    : $HO_REGISTRY_URL"
echo "  données     : $HO_DATA_DIR_ID"

# option_env! est lu à la compilation et cargo ne surveille pas ces variables : sans cela, un
# binaire construit auparavant avec d'autres valeurs serait réemployé tel quel.
touch src-tauri/src/main.rs src-tauri/src/ho_finalizer.rs

echo "── frontend ──"
npm run build >/dev/null
# Ce que Tauri embarquera, c'est dist/. Le vérifier ICI est la seule façon de garantir que
# l'application produite contient vraiment le shell Compte : une fois embarqué, le frontend
# est compressé et n'est plus inspectable. Avoir le bon code dans src/ ne prouve rien.
echo "── le frontend construit contient-il le shell Compte ? ──"
MARQUEURS=(
  "account.section"            # titre de la section
  "account.sendLink"           # bouton du lien de connexion
  "account.signedInAs"         # état connecté
  "account.signOut"            # déconnexion
  "signInWithOtp"              # flux d'authentification
  "/functions/v1/reserve-record-id"   # réservation
  "take_pending_deep_link"     # reprise du lien profond
)
BUNDLE_JS="$(ls dist/assets/*.js 2>/dev/null | head -1)"
[ -n "$BUNDLE_JS" ] || { echo "  aucun bundle dans dist/ — build frontend échoué"; exit 1; }
MANQUE=0
for m in "${MARQUEURS[@]}"; do
  if grep -qF "$m" "$BUNDLE_JS"; then printf "  ✓ %s\n" "$m"
  else printf "  ✗ %s ABSENT\n" "$m"; MANQUE=1; fi
done
# La redirection RC doit y être, celle de production ne doit PAS y être.
if grep -qF "humanorigin-rc://login" "$BUNDLE_JS"; then echo "  ✓ redirection RC"
else echo "  ✗ redirection RC ABSENTE"; MANQUE=1; fi
if grep -qF '"humanorigin://login"' "$BUNDLE_JS"; then echo "  ✗ redirection de PRODUCTION présente"; MANQUE=1
else echo "  ✓ aucune redirection de production"; fi
[ "$MANQUE" = "0" ] || { echo; echo "  BUILD REFUSÉ : le frontend n'embarque pas le shell attendu."; exit 1; }

echo "── bundle ──"
npx tauri build --config tools/rc/tauri.rc.conf.json --bundles app

APP="$RACINE/src-tauri/target/release/bundle/macos/HumanOrigin RC.app"
[ -d "$APP" ] || { echo "  bundle RC introuvable : $APP"; exit 1; }

# Le schéma d'URL ne se déclare pas dans tauri.conf.json en Tauri 1 : il vient de
# src-tauri/Info.plist, que l'on NE TOUCHE PAS. On retouche le bundle PRODUIT.
PL="$APP/Contents/Info.plist"
plutil -replace CFBundleURLTypes.0.CFBundleURLSchemes.0 -string "$HO_DEEP_LINK_SCHEME" "$PL"
plutil -replace CFBundleURLTypes.0.CFBundleURLName     -string "$HO_BUNDLE_ID"        "$PL"

echo
echo "── identité du bundle produit ──"
echo "  chemin : $APP"
echo "  CFBundleIdentifier : $(plutil -extract CFBundleIdentifier raw "$PL")"
echo "  CFBundleName       : $(plutil -extract CFBundleName raw "$PL" 2>/dev/null || echo '-')"
echo "  schéma déclaré     : $(plutil -extract CFBundleURLTypes.0.CFBundleURLSchemes.0 raw "$PL")"
