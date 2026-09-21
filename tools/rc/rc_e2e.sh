#!/bin/bash
# HumanOrigin — orchestration du smoke RC de bout en bout. RC UNIQUEMENT, jamais production.
#
# Ce script ne contient et n'imprime JAMAIS : clé privée, JWT, capability, lien magique.
# Il ne manipule aucun secret : la seule valeur qu'il lit est la clé PUBLIQUE du reçu.
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
HOTE="registry.humanorigin.io"
MARQUEUR="# HumanOrigin-RC-smoke"
POINTEUR="$HOME/.ho-rc-smoke.current"      # ne contient QU'UN CHEMIN, aucun secret
TRAVAIL=""                                  # répertoire temporaire, fixé au montage
CAROOT_RC=""                                # CA éphémère, JAMAIS le CAROOT par défaut
PORT_VOLET=3000
WEF="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
PROD_MANIFEST="$WEF/humanorigin-prod.xml"

vert() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
rouge() { printf "  \033[31m✗\033[0m %s\n" "$1"; }
info() { printf "    %s\n" "$1"; }

# ---------------------------------------------------------------- CA éphémère
# Le CAROOT par défaut de mkcert n'est JAMAIS employé : une CA de confiance persistante
# n'a pas à survivre à un smoke. La CA RC vit dans le répertoire temporaire et disparaît
# avec lui, après un -uninstall dont l'effet est VÉRIFIÉ.
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

# ---------------------------------------------------------------- nettoyage
NETTOYE_FAIT=0
NETTOYE_ECHEC=0
nettoyage() {
  [ "$NETTOYE_FAIT" = "1" ] && return
  NETTOYE_FAIT=1
  charge_travail
  echo
  echo "── nettoyage ──"

  # volet RC
  "$APP/tools/rc/word_rc.sh" remove >/dev/null 2>&1 \
    && vert "manifeste Word RC retiré" || rouge "retrait du manifeste RC"

  # serveurs
  for p in "$TRAVAIL/volet.pid" "$TRAVAIL/registre.pid"; do
    if [ -f "$p" ]; then
      kill "$(cat "$p")" 2>/dev/null && vert "arrêté : $(basename "$p" .pid)"
      rm -f "$p"
    fi
  done
  # le registre RC détruit son store temporaire sur SIGTERM ; on laisse le temps
  sleep 1
  pkill -f "rc_local_server.mjs" 2>/dev/null
  pkill -f "rc_word_server.mjs" 2>/dev/null

  # /etc/hosts : UNIQUEMENT la ligne portant notre marqueur
  if grep -q "$MARQUEUR" /etc/hosts 2>/dev/null; then
    sudo sed -i '' "/$MARQUEUR\$/d" /etc/hosts \
      && vert "entrée /etc/hosts retirée (ligne marquée uniquement)" \
      || rouge "RETRAIT /etc/hosts ÉCHOUÉ — intervenez à la main"
  else
    vert "aucune entrée marquée dans /etc/hosts"
  fi

  # contrôle explicite : le nom ne doit plus résoudre vers la boucle locale
  sudo dscacheutil -flushcache 2>/dev/null
  local r; r="$(dscacheutil -q host -a name "$HOTE" 2>/dev/null | awk '/ip_address/{print $2}' | head -3 | tr '\n' ' ')"
  case "$r" in
    *127.0.0.1*) rouge "ATTENTION : $HOTE résout ENCORE vers 127.0.0.1 → $r" ;;
    "")          vert "$HOTE ne résout plus vers la boucle locale (cache vide)" ;;
    *)           vert "$HOTE résout vers $r" ;;
  esac
  grep -c "$HOTE" /etc/hosts 2>/dev/null | xargs -I{} info "lignes restantes mentionnant $HOTE dans /etc/hosts : {}"

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

  # manifeste de production
  if [ -f "$TRAVAIL/prod_manifest.sha256" ] && [ -f "$PROD_MANIFEST" ]; then
    local a b; a="$(cat "$TRAVAIL/prod_manifest.sha256")"; b="$(shasum -a 256 "$PROD_MANIFEST" | cut -d' ' -f1)"
    [ "$a" = "$b" ] && vert "manifeste de production intact" || rouge "MANIFESTE DE PRODUCTION MODIFIÉ"
  fi

  # répertoire temporaire : détruit, sauf si la CA y est restée trustée
  if [ "${NETTOYE_ECHEC:-0}" = "1" ]; then
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
  local pub=""
  if [ -f "$RECU" ]; then
    pub="$(grep '^public_key' "$RECU" | sed 's/.*: //')"
    [ -n "$pub" ] && vert "clé PUBLIQUE ho-registry-write-v1 lisible (non affichée)" \
                  || { rouge "clé publique illisible"; ko=1; }
  fi

  if grep -q "$HOTE" /etc/hosts 2>/dev/null; then
    if grep -q "$MARQUEUR" /etc/hosts; then
      rouge "une entrée RC marquée subsiste d'un smoke précédent — lancez « down »"; ko=1
    else
      rouge "ENTRÉE PRÉEXISTANTE pour $HOTE dans /etc/hosts — STOP, elle ne sera pas écrasée"; ko=1
    fi
  else
    vert "aucune entrée préexistante pour $HOTE dans /etc/hosts"
  fi

  [ -f "$WEB/registry/rc_local_server.mjs" ] && vert "registre RC présent" || { rouge "registre RC absent"; ko=1; }
  [ -f "$WEB/create-record/word/taskpane.js" ] && vert "volet RC présent" || { rouge "volet RC absent"; ko=1; }

  grep -q 'LEGACY COMPATIBILITY — REMOVE AFTER REGISTRY WRITE V1 CUTOVER' \
    "$WEB/create-record/word/taskpane.js" && vert "volet en mode transition" \
    || { rouge "le volet n'est pas le Transition"; ko=1; }

  grep -q 'const HOTE_ECRITURE = "registry.humanorigin.io";' \
    "$WEB/registry/netlify/functions/record.mjs" && vert "défense d'hôte active dans le registre" \
    || { rouge "défense d'hôte absente"; ko=1; }

  local n w
  n="$(git -C "$APP" rev-parse HEAD 2>/dev/null)"; w="$(git -C "$WEB" rev-parse HEAD 2>/dev/null)"
  # Le SHA de référence du BUILD. La tête peut avancer sur de l'outillage RC sans rendre
  # l'artefact caduc : ce qui compte est qu'aucun fichier de produit n'ait bougé depuis.
  local BASE="c5062cdbe62fc155c6f382b0046932534c313cd6" diff_produit
  if git -C "$APP" merge-base --is-ancestor "$BASE" HEAD 2>/dev/null; then
    diff_produit="$(git -C "$APP" diff --name-only "$BASE" HEAD -- src src-tauri index.html package.json | head -5)"
    local sale; sale="$(git -C "$APP" status --porcelain -- src src-tauri index.html package.json | head -5)"
    if [ -n "$sale" ]; then
      # L'artefact est construit depuis l'ARBRE DE TRAVAIL : des modifications non
      # commitées le rendent irreproductible, et un garde qui ne les voit pas ment.
      rouge "des fichiers de produit sont modifiés et non commités — l'artefact est irreproductible"
      echo "$sale" | sed 's/^/      /'; ko=1
    elif [ -z "$diff_produit" ]; then
      vert "native : produit identique à ${BASE:0:7} (tête ${n:0:7})"
    else
      rouge "des fichiers de produit ont changé depuis ${BASE:0:7} — l'artefact n'est plus représentatif"
      echo "$diff_produit" | sed 's/^/      /'; ko=1
    fi
  else
    rouge "native : ${BASE:0:7} n'est pas un ancêtre de ${n:0:7}"; ko=1
  fi
  [ "$w" = "a523cfd285fd9dd83d287bd6b6adc326c35b4721" ] && vert "web à a523cfd" || { rouge "web à ${w:0:7}"; ko=1; }

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
    grep -q "$MARQUEUR" /etc/hosts 2>/dev/null && rouge "entrée RC présente dans /etc/hosts" || vert "/etc/hosts sans entrée RC"
    [ -f "$WEF/humanorigin-rc.xml" ] && rouge "manifeste RC posé" || vert "aucun manifeste RC"
    pgrep -f rc_local_server.mjs >/dev/null && rouge "registre RC en cours" || vert "aucun registre RC"
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
cp /etc/hosts "$TRAVAIL/hosts.avant"
echo "  copie de /etc/hosts : $TRAVAIL/hosts.avant"

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
CAROOT="$CAROOT_RC" mkcert "$HOTE" localhost 127.0.0.1 >/dev/null 2>&1
CERT="$(ls "$TRAVAIL"/"$HOTE"*.pem 2>/dev/null | grep -v key | head -1)"
KEYF="$(ls "$TRAVAIL"/"$HOTE"*-key.pem 2>/dev/null | head -1)"
[ -n "$CERT" ] && [ -n "$KEYF" ] && vert "certificat local pour $HOTE" || { rouge "certificat introuvable"; exit 1; }

echo
echo "── registre RC isolé, port 443 ──"
PUB="$(grep '^public_key' "$RECU" | sed 's/.*: //')"
sudo node "$WEB/registry/rc_local_server.mjs" --key "$PUB" --port 443 \
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
echo "── détournement de résolution ──"
echo "127.0.0.1 $HOTE $MARQUEUR" | sudo tee -a /etc/hosts >/dev/null
sudo dscacheutil -flushcache 2>/dev/null
grep -c "$MARQUEUR" /etc/hosts | xargs -I{} info "lignes marquées ajoutées : {}"
R="$(dscacheutil -q host -a name "$HOTE" | awk '/ip_address/{print $2}' | head -1)"
[ "$R" = "127.0.0.1" ] && vert "$HOTE → 127.0.0.1" || { rouge "$HOTE → ${R:-aucune} (attendu 127.0.0.1)"; exit 1; }

echo
echo "── manifeste Word RC ──"
"$APP/tools/rc/word_rc.sh" install | sed 's/^/  /'

echo
echo "── sondes ──"
curl -sS -o /dev/null -w "    GET  https://$HOTE/r/HO-SONDE000001 → HTTP %{http_code}\n" \
     "https://$HOTE/r/HO-SONDE000001"
curl -sS -o /dev/null -w "    POST sans Authorization            → HTTP %{http_code}\n" \
     -X POST -H "content-type: application/json" -d '{}' "https://$HOTE/r/HO-SONDE000001"
info "store initial : $(grep -o 'store isolé  : .*' "$TRAVAIL/registre.log" | head -1)"

echo
echo "══ ENVIRONNEMENT RC PRÊT ══"
echo "  Redémarrez Word, ouvrez le volet « HumanOrigin RC »."
echo "  Ctrl-C ici démonte tout et restaure /etc/hosts."
echo
wait
