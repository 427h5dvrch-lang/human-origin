#!/bin/bash
# HumanOrigin — orchestration du smoke RC de bout en bout. RC UNIQUEMENT, jamais production.
#
# Ce script ne contient et n'imprime JAMAIS : clé privée, JWT, capability, lien magique.
# La seule valeur qu'il lit est la clé PUBLIQUE du reçu, et elle n'est pas affichée.
#
# ISOLATION PAR ADRESSE LITTÉRALE. Le registre RC écoute sur 127.0.0.1:8443, et le build RC
# vise cette adresse, compilée. Aucun nom n'est résolu : donc aucune ligne /etc/hosts, aucun
# DNS détourné, aucune famille d'adresses à oublier. L'incident du 2026-09-22 est venu d'un
# détournement IPv4 que la résolution IPv6 contournait ; cette classe de panne disparaît.
#
#   ./rc_e2e.sh preflight   contrôles seuls, AUCUNE mutation
#   ./rc_e2e.sh up          monte l'environnement et le tient au premier plan
#   ./rc_e2e.sh down        démontage, idempotent
#   ./rc_e2e.sh status      état courant
#
# `up` reste au premier plan : Ctrl-C, une erreur ou un kill déclenchent le même nettoyage.
set -uo pipefail

APP="${HO_APP_DIR:-$HOME/Developer/HO_RECORD_STEP_D/human-origin}"
WEB="${HO_WEB_DIR:-/private/tmp/rwa}"
RECU="$HOME/ho-registry-write-v1.public.txt"
HOTE_RC="127.0.0.1"
PORT_REGISTRE=8443
PORT_VOLET=3000
POINTEUR="$HOME/.ho-rc-smoke.current"      # ne contient QU'UN CHEMIN, aucun secret
TRAVAIL=""
CAROOT_RC=""
WEF="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
PROD_MANIFEST="$WEF/humanorigin-prod.xml"
APP_RC="$APP/src-tauri/target/release/bundle/macos/HumanOrigin RC.app"
BUNDLE_RC="com.humanorigin.app.rc"
SCHEME_RC="humanorigin-rc"

vert()  { printf "  \033[32m✓\033[0m %s\n" "$1"; }
rouge() { printf "  \033[31m✗\033[0m %s\n" "$1"; }
info()  { printf "    %s\n" "$1"; }

# ---------------------------------------------------------------- CA éphémère
# Le CAROOT par défaut de mkcert n'est JAMAIS employé : une CA de confiance persistante n'a
# pas à survivre à un smoke. La CA RC vit dans le répertoire temporaire et disparaît avec lui,
# après un -uninstall dont l'effet est VÉRIFIÉ.
empreinte_ca() {
  [ -f "$1" ] || return 1
  openssl x509 -in "$1" -noout -fingerprint -sha1 2>/dev/null | sed 's/.*=//' | tr -d ':'
}
ca_encore_trustee() {
  local fp="$1"; [ -n "$fp" ] || return 1
  for k in /Library/Keychains/System.keychain "$HOME/Library/Keychains/login.keychain-db"; do
    [ -e "$k" ] || continue
    security find-certificate -a -Z "$k" 2>/dev/null | tr -d ':' | grep -qi "SHA-1 hash $fp" && return 0
  done
  return 1
}
charge_travail() {
  [ -n "$TRAVAIL" ] && return 0
  if [ -f "$POINTEUR" ]; then TRAVAIL="$(cat "$POINTEUR")"; CAROOT_RC="$TRAVAIL/ca"; fi
}
# Inventaire des processus par IDENTITÉ, jamais par chemin : un build posé ailleurs que
# dans /Applications porte le même identifiant et se comporte comme la production. C'est
# précisément ce qui a laissé tourner un faux RC pendant deux jours.
# Écrit une ligne « <bundle_id> <chemin de l'exécutable> » par processus HumanOrigin trouvé.
inventaire_processus() {
  local exe id
  for pid in $(pgrep -f "\.app/Contents/MacOS/HumanOrigin" 2>/dev/null); do
    exe="$(ps -o comm= -p "$pid" 2>/dev/null)"
    case "$exe" in
      */Contents/MacOS/*) id="$(plutil -extract CFBundleIdentifier raw "${exe%/Contents/MacOS/*}/Contents/Info.plist" 2>/dev/null)" ;;
      *) id="" ;;
    esac
    printf '%s\t%s\t%s\n' "${id:-<inconnu>}" "$pid" "$exe"
  done
}

handler_de() {   # handler effectif d'un schéma, sans ouvrir d'URL ni lancer d'application
  swift - "$1" <<'SW' 2>/dev/null
import AppKit
let s = CommandLine.arguments[1]
if let a = NSWorkspace.shared.urlForApplication(toOpen: URL(string: "\(s)://x")!) { print(a.path) }
else { print("<aucun>") }
SW
}

# ---------------------------------------------------------------- nettoyage
NETTOYE_FAIT=0
NETTOYE_ECHEC=0
nettoyage() {
  [ "$NETTOYE_FAIT" = "1" ] && return
  NETTOYE_FAIT=1
  charge_travail
  echo
  echo "── nettoyage ──"

  "$APP/tools/rc/word_rc.sh" remove >/dev/null 2>&1 \
    && vert "manifeste Word RC retiré" || rouge "retrait du manifeste RC"

  for p in "$TRAVAIL/volet.pid" "$TRAVAIL/registre.pid"; do
    if [ -f "$p" ]; then
      kill "$(cat "$p")" 2>/dev/null && vert "arrêté : $(basename "$p" .pid)"
      rm -f "$p"
    fi
  done
  sleep 1
  pkill -f "rc_local_server.mjs" 2>/dev/null
  pkill -f "rc_word_server.mjs" 2>/dev/null
  vert "aucun serveur RC"

  # CA éphémère : désinstallation PUIS vérification. Un échec ici n'est pas masqué.
  if [ -n "$CAROOT_RC" ] && [ -d "$CAROOT_RC" ]; then
    local fp; fp="$(empreinte_ca "$CAROOT_RC/rootCA.pem")"
    CAROOT="$CAROOT_RC" mkcert -uninstall >/dev/null 2>&1
    if ca_encore_trustee "$fp"; then
      rouge "CLEANUP = FAIL — la CA RC est ENCORE dans le trousseau"
      info "empreinte SHA-1 : $fp"
      info "répertoire CONSERVÉ pour intervention : $CAROOT_RC"
      info "retirez-la à la main, puis relancez « down »."
      NETTOYE_ECHEC=1
    else
      vert "CA RC désinstallée et absente du trousseau"
    fi
  fi

  if [ -f "$TRAVAIL/prod_manifest.sha256" ] && [ -f "$PROD_MANIFEST" ]; then
    local a b; a="$(cat "$TRAVAIL/prod_manifest.sha256")"; b="$(shasum -a 256 "$PROD_MANIFEST" | cut -d' ' -f1)"
    [ "$a" = "$b" ] && vert "manifeste de production intact" || rouge "MANIFESTE DE PRODUCTION MODIFIÉ"
  fi

  # Rien à restaurer côté résolution : le banc n'a jamais touché /etc/hosts.
  if grep -qE "registry\.humanorigin\.io" /etc/hosts 2>/dev/null; then
    rouge "/etc/hosts contient une entrée registre — elle ne vient PAS de ce script"
  else
    vert "/etc/hosts vierge, comme avant"
  fi

  if [ "$NETTOYE_ECHEC" = "1" ]; then
    rouge "répertoire temporaire CONSERVÉ : $TRAVAIL"
    echo; exit 1
  fi
  if [ -n "$TRAVAIL" ] && [ -d "$TRAVAIL" ]; then
    rm -rf "$TRAVAIL" && vert "répertoire temporaire détruit (CA, certificat et clé TLS compris)"
  fi
  rm -f "$POINTEUR"
  echo
}
trap nettoyage EXIT INT TERM

# ---------------------------------------------------------------- préflight
preflight() {
  local ko=0
  echo "── préflight, aucune mutation ──"

  command -v mkcert >/dev/null && vert "mkcert disponible ($(mkcert -version 2>&1))" || { rouge "mkcert ABSENT"; ko=1; }
  local defaut; defaut="$(mkcert -CAROOT 2>/dev/null)"
  if [ -f "$defaut/rootCA.pem" ]; then
    rouge "une CA existe dans le CAROOT PAR DÉFAUT — ce smoke ne doit pas l'employer ni la toucher"
    info "$defaut"
  else
    vert "aucune CA dans le CAROOT par défaut ; il ne sera pas employé"
  fi

  [ -f "$RECU" ] && vert "reçu public présent" || { rouge "reçu public absent : $RECU"; ko=1; }
  if [ -f "$RECU" ]; then
    [ -n "$(grep '^public_key' "$RECU" | sed 's/.*: //')" ] \
      && vert "clé PUBLIQUE ho-registry-write-v1 lisible (non affichée)" \
      || { rouge "clé publique illisible"; ko=1; }
  fi

  # Isolation par adresse littérale : /etc/hosts ne doit jouer AUCUN rôle.
  if grep -qE "registry\.humanorigin\.io|HumanOrigin-RC-smoke" /etc/hosts 2>/dev/null; then
    rouge "/etc/hosts contient une entrée registre — le banc RC n'en emploie plus, retirez-la"; ko=1
  else
    vert "/etc/hosts vierge : aucune isolation par DNS, aucune à restaurer"
  fi
  if nc -z "$HOTE_RC" "$PORT_REGISTRE" 2>/dev/null; then
    rouge "le port $PORT_REGISTRE est déjà occupé"; ko=1
  else
    vert "$HOTE_RC:$PORT_REGISTRE libre"
  fi

  [ -f "$WEB/registry/rc_local_server.mjs" ] && vert "registre RC présent" || { rouge "registre RC absent"; ko=1; }
  [ -f "$WEB/create-record/word/taskpane.js" ] && vert "volet RC présent" || { rouge "volet RC absent"; ko=1; }
  grep -q 'LEGACY COMPATIBILITY — REMOVE AFTER REGISTRY WRITE V1 CUTOVER' \
    "$WEB/create-record/word/taskpane.js" && vert "volet en mode transition" \
    || { rouge "le volet n'est pas le Transition"; ko=1; }
  grep -q 'const HOTE_ECRITURE = "registry.humanorigin.io";' \
    "$WEB/registry/netlify/functions/record.mjs" && vert "défense d'hôte intacte dans le registre" \
    || { rouge "défense d'hôte absente"; ko=1; }

  # --- identité du build RC
  if [ -d "$APP_RC" ]; then
    local id sch
    id="$(plutil -extract CFBundleIdentifier raw "$APP_RC/Contents/Info.plist" 2>/dev/null)"
    sch="$(plutil -extract CFBundleURLTypes.0.CFBundleURLSchemes.0 raw "$APP_RC/Contents/Info.plist" 2>/dev/null)"
    [ "$id" = "$BUNDLE_RC" ]  && vert "bundle RC = $BUNDLE_RC"  || { rouge "bundle RC = ${id:-<absent>}"; ko=1; }
    [ "$sch" = "$SCHEME_RC" ] && vert "schéma RC = $SCHEME_RC"  || { rouge "schéma RC = ${sch:-<absent>}"; ko=1; }
  else
    rouge "application RC absente — lancez tools/rc/build_rc.sh"; ko=1
  fi

  # --- répertoires de données : le RC ne doit jamais toucher l'état de production
  local dd_prod dd_rc
  dd_prod="$HOME/Library/Application Support/com.humanorigin.app"
  dd_rc="$HOME/Library/Application Support/com.humanorigin.app.rc"
  if grep -q 'HO_DATA_DIR_ID="com.humanorigin.app.rc"' "$APP/tools/rc/build_rc.sh"; then
    vert "le build RC isole son répertoire de données"
  else
    rouge "le build RC partagerait le répertoire de données de production"; ko=1
  fi
  [ "$dd_prod" != "$dd_rc" ] && vert "répertoires de données distincts" \
                             || { rouge "répertoires de données identiques"; ko=1; }
  if [ -d "$APP_RC" ] && strings "$APP_RC/Contents/MacOS/HumanOrigin RC" 2>/dev/null \
       | grep -qF "com.humanorigin.app.rc"; then
    vert "l'identifiant RC est bien compilé dans le binaire"
  else
    info "identifiant RC non retrouvé dans le binaire — reconstruisez le RC"
  fi

  # --- les deux schémas, chacun chez soi
  local h_prod h_rc
  h_prod="$(handler_de humanorigin)"
  h_rc="$(handler_de "$SCHEME_RC")"
  [ "$h_prod" = "/Applications/HumanOrigin.app" ] \
    && vert "handler humanorigin:// = application de production" \
    || { rouge "handler humanorigin:// = ${h_prod:-<aucun>}"; ko=1; }
  [ "$h_rc" = "$APP_RC" ] \
    && vert "handler $SCHEME_RC:// = application RC" \
    || { rouge "handler $SCHEME_RC:// = ${h_rc:-<aucun>}"; ko=1; }
  [ "$h_prod" != "$h_rc" ] && vert "aucune collision entre les deux schémas" \
                           || { rouge "les deux schémas mènent à la même application"; ko=1; }

  # --- processus, par IDENTITÉ et non par chemin
  local inv n_prod n_rc n_autre
  inv="$(inventaire_processus)"
  n_prod=$(printf '%s\n' "$inv" | grep -c "^com\.humanorigin\.app\b" || true)
  n_rc=$(printf '%s\n'   "$inv" | grep -c "^com\.humanorigin\.app\.rc\b" || true)
  n_prod=$((n_prod - n_rc))                 # le motif « .app » englobe « .app.rc »
  n_autre=$(printf '%s\n' "$inv" | grep -vc "^com\.humanorigin\.app" || true)
  [ -z "$inv" ] && { n_prod=0; n_rc=0; n_autre=0; }

  info "processus com.humanorigin.app    : $n_prod"
  info "processus com.humanorigin.app.rc : $n_rc"
  if [ -n "$inv" ]; then
    printf '%s\n' "$inv" | while IFS=$'\t' read -r id pid exe; do
      info "  [$id] pid $pid  $exe"
    done
  else
    info "  aucun processus HumanOrigin"
  fi

  [ "$n_prod" = "0" ] && vert "aucun processus com.humanorigin.app, quel que soit son chemin" \
                      || { rouge "$n_prod processus com.humanorigin.app en cours"; ko=1; }
  [ "$n_rc" -le 1 ] && vert "au plus une instance com.humanorigin.app.rc ($n_rc)" \
                    || { rouge "$n_rc instances RC"; ko=1; }
  [ "$n_autre" = "0" ] && vert "aucun processus HumanOrigin ambigu" \
                       || { rouge "$n_autre processus HumanOrigin d'identité inattendue"; ko=1; }

  [ -f "$PROD_MANIFEST" ] && vert "manifeste de production présent (empreinte relevée au montage)" \
                          || info "manifeste de production absent — rien à préserver"
  [ -f "$WEF/humanorigin-rc.xml" ] && { rouge "un manifeste RC est déjà posé — lancez « down »"; ko=1; } \
                                   || vert "aucun manifeste RC posé"

  echo
  [ "$ko" = "0" ] && echo "  PRÉFLIGHT = PRÊT" || echo "  PRÉFLIGHT = BLOQUÉ"
  return "$ko"
}

case "${1:-status}" in
  preflight) NETTOYE_FAIT=1; preflight; exit $? ;;
  down)      nettoyage; exit 0 ;;
  status)
    NETTOYE_FAIT=1
    echo "── état ──"
    [ -f "$WEF/humanorigin-rc.xml" ] && rouge "manifeste RC posé" || vert "aucun manifeste RC"
    pgrep -f rc_local_server.mjs >/dev/null && rouge "registre RC en cours" || vert "aucun registre RC"
    grep -qE "registry\.humanorigin\.io" /etc/hosts 2>/dev/null && rouge "/etc/hosts porte une entrée registre" || vert "/etc/hosts vierge"
    echo "  handler humanorigin://    : $(handler_de humanorigin)"
    echo "  handler $SCHEME_RC:// : $(handler_de "$SCHEME_RC")"
    exit 0 ;;
  up) : ;;
  *) echo "  usage : $0 preflight|up|down|status"; NETTOYE_FAIT=1; exit 2 ;;
esac

# ---------------------------------------------------------------- montage
preflight || { echo "  montage refusé."; exit 1; }
TRAVAIL="$(mktemp -d "${TMPDIR:-/tmp}/ho-rc-smoke.XXXXXXXX")"
CAROOT_RC="$TRAVAIL/ca"
mkdir -p "$CAROOT_RC"
printf '%s' "$TRAVAIL" > "$POINTEUR"
echo "  répertoire temporaire : $TRAVAIL"
[ -f "$PROD_MANIFEST" ] && shasum -a 256 "$PROD_MANIFEST" | cut -d' ' -f1 > "$TRAVAIL/prod_manifest.sha256"

echo
echo "── CA éphémère et certificat ──"
cd "$TRAVAIL" || exit 1
CAROOT="$CAROOT_RC" mkcert -install >/dev/null 2>&1 \
  && vert "CA RC installée depuis un CAROOT temporaire" \
  || { rouge "installation de la CA RC échouée"; exit 1; }
FP_CA="$(empreinte_ca "$CAROOT_RC/rootCA.pem")"
[ -n "$FP_CA" ] && info "empreinte SHA-1 de la CA RC : $FP_CA"
ca_encore_trustee "$FP_CA" && vert "CA RC effectivement dans le trousseau" \
  || { rouge "la CA RC n'est pas trustée"; exit 1; }
# Certificat pour l'ADRESSE, pas pour un nom : rien à résoudre.
CAROOT="$CAROOT_RC" mkcert 127.0.0.1 localhost >/dev/null 2>&1
CERT="$(ls "$TRAVAIL"/127.0.0.1*.pem 2>/dev/null | grep -v key | head -1)"
KEYF="$(ls "$TRAVAIL"/127.0.0.1*-key.pem 2>/dev/null | head -1)"
[ -n "$CERT" ] && [ -n "$KEYF" ] && vert "certificat local pour 127.0.0.1" || { rouge "certificat introuvable"; exit 1; }

echo
echo "── registre RC isolé, $HOTE_RC:$PORT_REGISTRE ──"
PUB="$(grep '^public_key' "$RECU" | sed 's/.*: //')"
node "$WEB/registry/rc_local_server.mjs" --key "$PUB" --port "$PORT_REGISTRE" \
     --cert "$CERT" --key-file "$KEYF" > "$TRAVAIL/registre.log" 2>&1 &
echo $! > "$TRAVAIL/registre.pid"
sleep 2
grep -q "registre RC" "$TRAVAIL/registre.log" && vert "registre RC démarré" || { rouge "registre RC : voir $TRAVAIL/registre.log"; exit 1; }

echo
echo "── volet RC, HTTPS localhost:$PORT_VOLET ──"
cat > "$TRAVAIL/rc_word_server.mjs" <<'JS'
import https from "node:https"; import fs from "node:fs"; import path from "node:path";
const [racine, cert, key, port] = process.argv.slice(2);
const T = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png" };
https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, (q, r) => {
  const f = path.join(racine, decodeURIComponent(q.url.split("?")[0]));
  if (!f.startsWith(racine) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
}).listen(Number(port), () => console.log("volet RC sur " + port));
JS
node "$TRAVAIL/rc_word_server.mjs" "$WEB/create-record" "$CERT" "$KEYF" "$PORT_VOLET" \
     > "$TRAVAIL/volet.log" 2>&1 &
echo $! > "$TRAVAIL/volet.pid"
sleep 1
grep -q "volet RC" "$TRAVAIL/volet.log" && vert "volet RC servi" || { rouge "volet RC : voir $TRAVAIL/volet.log"; exit 1; }

echo
echo "── manifeste Word RC ──"
"$APP/tools/rc/word_rc.sh" install | sed 's/^/  /'

echo
echo "── sondes ──"
curl -sS -o /dev/null -w "    GET  https://$HOTE_RC:$PORT_REGISTRE/r/HO-SONDE000001 → HTTP %{http_code}\n" \
     "https://$HOTE_RC:$PORT_REGISTRE/r/HO-SONDE000001"
curl -sS -o /dev/null -w "    POST sans Authorization → HTTP %{http_code}\n" \
     -X POST -H "content-type: application/json" -d '{}' "https://$HOTE_RC:$PORT_REGISTRE/r/HO-SONDE000001"
info "store initial : $(grep -o 'store isolé  : .*' "$TRAVAIL/registre.log" | head -1)"

echo
echo "══ ENVIRONNEMENT RC PRÊT ══"
echo "  Ouvrez « HumanOrigin RC », redémarrez Word, employez le volet « HumanOrigin RC »."
echo "  Ctrl-C ici démonte tout."
echo
wait
