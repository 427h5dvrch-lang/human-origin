#!/bin/bash
# HumanOrigin — pose et retrait du volet Word RC.
#
# Le manifeste RC est DISTINCT du manifeste de production : identifiant différent, version
# différente, nom affiché « HumanOrigin RC », et surtout NOM DE FICHIER différent. Il ne peut
# donc pas écraser l'add-in de production, qui reste installé et utilisable à côté.
#
#   ./word_rc.sh install   pose le manifeste RC
#   ./word_rc.sh remove    le retire
#   ./word_rc.sh status    montre ce qui est posé, sans rien changer
set -u
WEF="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
PROD="humanorigin-prod.xml"          # déposé par l'application, NE JAMAIS Y TOUCHER
RC="humanorigin-rc.xml"
SRC="$(cd "$(dirname "$0")" && pwd)/humanorigin-word-manifest-rc.xml"

etat() {
  echo "  dossier   : $WEF"
  echo "  production: $([ -f "$WEF/$PROD" ] && echo "présent ($PROD)" || echo absent)"
  echo "  RC        : $([ -f "$WEF/$RC" ] && echo "présent ($RC)" || echo absent)"
}

case "${1:-status}" in
  install)
    [ -f "$SRC" ] || { echo "  manifeste RC introuvable : $SRC"; exit 1; }
    [ "$PROD" = "$RC" ] && { echo "  refus : le RC porterait le nom du manifeste de production"; exit 1; }
    mkdir -p "$WEF"
    if [ -f "$WEF/$PROD" ]; then
      # Empreinte relevée avant et après : la preuve que le RC n'a pas touché la production.
      A=$(shasum -a 256 "$WEF/$PROD" | cut -d' ' -f1)
    fi
    cp "$SRC" "$WEF/$RC"
    if [ -n "${A:-}" ]; then
      B=$(shasum -a 256 "$WEF/$PROD" | cut -d' ' -f1)
      [ "$A" = "$B" ] && echo "  ✓ manifeste de production intact" \
                      || { echo "  ✗ LE MANIFESTE DE PRODUCTION A CHANGÉ"; exit 1; }
    fi
    echo "  ✓ RC posé"
    etat
    echo "  Redémarrez Word. Deux entrées « HumanOrigin » et « HumanOrigin RC » apparaissent."
    ;;
  remove)
    rm -f "$WEF/$RC" && echo "  ✓ RC retiré"
    etat
    echo "  Redémarrez Word."
    ;;
  status) etat ;;
  *) echo "  usage : $0 install|remove|status"; exit 2 ;;
esac
