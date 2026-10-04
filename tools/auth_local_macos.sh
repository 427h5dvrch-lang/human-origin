#!/bin/zsh
# Etat d'authentification local de HumanOrigin sur macOS : sauvegarder, simuler un nouvel
# utilisateur, restaurer a l'identique.
#
# Pourquoi ce script existe : le defaut B1 ne se voit que sur une session REELLEMENT neuve.
# Sur une machine qui a deja servi, la session Supabase persistee masque le defaut. Pour la
# confirmer a l'execution, il faut retirer cette session — et pouvoir la remettre exactement.
#
# CE QU'IL TOUCHE, et rien d'autre :
#   la table ItemTable du stockage local WebKit de com.humanorigin.app, et seulement
#   les cles « sb-*-auth-token ».
#
# CE QU'IL NE TOUCHE JAMAIS :
#   ho.langue (la preference de langue) ;
#   ~/Library/Application Support/com.humanorigin.app (dossiers surveilles, sentinelle Word,
#     brouillons, etat du finalizer) ;
#   ~/Library/Preferences/com.humanorigin.app.plist ;
#   le trousseau.
#
# Le stockage WebKit est en mode WAL. La sauvegarde prend les trois fichiers, mais la
# GARANTIE de restauration porte sur les deux qui portent les donnees : localstorage.sqlite3
# et son -wal. Le -shm n'est qu'un index en memoire partagee, que SQLite reconstruit ; le
# comparer ferait echouer une restauration pourtant exacte — c'est une repetition sur copie
# qui l'a montre. Il est donc sauvegarde, mais retire a la restauration plutot que remis.
#
# Aucune valeur de jeton n'est jamais affichee.
#
#   ./auth_local_macos.sh etat
#   ./auth_local_macos.sh sauvegarder
#   ./auth_local_macos.sh vider-session
#   ./auth_local_macos.sh restaurer
set -u

BASE="$HOME/Library/WebKit/com.humanorigin.app/WebsiteData/Default"
SAUVE="$HOME/Library/Application Support/HumanOrigin_auth_backup"

trouver() {
  local f
  f=$(find "$BASE" -name localstorage.sqlite3 2>/dev/null | head -1)
  if [[ -z "$f" ]]; then echo "stockage local introuvable sous $BASE" >&2; return 1; fi
  print -r -- "$f"
}

app_ouverte() { pgrep -x HumanOrigin >/dev/null 2>&1; }

exiger_fermee() {
  if app_ouverte; then
    echo "REFUS : HumanOrigin est ouvert. WebKit tient la base et la reecrirait en sortant." >&2
    echo "        Quitter l'application (Cmd-Q), puis relancer cette commande." >&2
    return 1
  fi
}

cmd_etat() {
  local db; db=$(trouver) || return 1
  echo "base      : $db"
  echo "app       : $(app_ouverte && echo OUVERTE || echo fermee)"
  echo "cles      : $(sqlite3 "$db" "SELECT group_concat(key, ' ') FROM ItemTable;" 2>/dev/null)"
  local n; n=$(sqlite3 "$db" "SELECT count(*) FROM ItemTable WHERE key LIKE 'sb-%-auth-token';" 2>/dev/null)
  echo "session   : $([[ "$n" == "0" ]] && echo "ABSENTE (etat neuf)" || echo "presente ($n cle)")"
  if [[ -d "$SAUVE" ]]; then
    echo "sauvegarde: $SAUVE"
    ls -1 "$SAUVE" | sed 's/^/            /'
  else
    echo "sauvegarde: aucune"
  fi
}

cmd_sauvegarder() {
  exiger_fermee || return 1
  local db; db=$(trouver) || return 1
  if [[ -d "$SAUVE" ]]; then
    echo "REFUS : une sauvegarde existe deja dans $SAUVE." >&2
    echo "        La restaurer ou la deplacer avant d'en prendre une autre." >&2
    return 1
  fi
  mkdir -p "$SAUVE" || return 1
  local n=0
  for f in "$db" "$db-wal" "$db-shm"; do
    if [[ -f "$f" ]]; then cp -p "$f" "$SAUVE/" || return 1; n=$((n+1)); fi
  done
  print -r -- "$db" > "$SAUVE/.origine"
  echo "sauvegarde : $n fichier(s) dans $SAUVE"
  # Une sauvegarde non verifiee ne vaut rien. Les deux porteurs de donnees doivent
  # correspondre exactement ; le -shm est un index reconstruit, on ne l'exige pas.
  for f in "$db" "$db-wal"; do
    [[ -f "$f" ]] || continue
    if cmp -s "$f" "$SAUVE/$(basename "$f")"; then echo "  identique : $(basename "$f")";
    else echo "  ECHEC de copie : $(basename "$f")" >&2; return 1; fi
  done
}

cmd_vider() {
  exiger_fermee || return 1
  [[ -d "$SAUVE" ]] || { echo "REFUS : sauvegarder d'abord." >&2; return 1; }
  local db; db=$(trouver) || return 1
  local avant; avant=$(sqlite3 "$db" "SELECT count(*) FROM ItemTable WHERE key LIKE 'sb-%-auth-token';")
  # Le WAL est replie d'abord, sinon la suppression pourrait ne pas etre vue.
  sqlite3 "$db" "PRAGMA wal_checkpoint(TRUNCATE); DELETE FROM ItemTable WHERE key LIKE 'sb-%-auth-token'; PRAGMA wal_checkpoint(TRUNCATE);" || return 1
  local apres; apres=$(sqlite3 "$db" "SELECT count(*) FROM ItemTable WHERE key LIKE 'sb-%-auth-token';")
  echo "session Supabase : $avant -> $apres"
  echo "cles restantes   : $(sqlite3 "$db" "SELECT group_concat(key, ' ') FROM ItemTable;")"
  [[ "$apres" == "0" ]] || { echo "la session n'a pas ete retiree" >&2; return 1; }
}

cmd_restaurer() {
  exiger_fermee || return 1
  [[ -d "$SAUVE" ]] || { echo "REFUS : aucune sauvegarde dans $SAUVE." >&2; return 1; }
  local db; db=$(cat "$SAUVE/.origine" 2>/dev/null)
  [[ -n "$db" ]] || { echo "origine inconnue dans la sauvegarde" >&2; return 1; }
  local d; d=$(dirname "$db")
  mkdir -p "$d" || return 1
  # On retire d'abord les trois fichiers courants : un WAL survivant reecrirait la base.
  rm -f "$db" "$db-wal" "$db-shm"
  # Les porteurs de donnees sont remis ; le -shm est laisse a SQLite, qui le refait.
  for n in localstorage.sqlite3 localstorage.sqlite3-wal; do
    [[ -f "$SAUVE/$n" ]] || continue
    cp -p "$SAUVE/$n" "$d/" || return 1
  done
  echo "restauration dans $d"
  local bon=1
  for n in localstorage.sqlite3 localstorage.sqlite3-wal; do
    [[ -f "$SAUVE/$n" ]] || continue
    if cmp -s "$SAUVE/$n" "$d/$n"; then echo "  identique : $n";
    else echo "  DIFFERENT : $n" >&2; bon=0; fi
  done
  [[ "$bon" == "1" ]] || return 1
  echo "cles      : $(sqlite3 "$db" "SELECT group_concat(key, ' ') FROM ItemTable;")"
  local n; n=$(sqlite3 "$db" "SELECT count(*) FROM ItemTable WHERE key LIKE 'sb-%-auth-token';")
  echo "session   : $([[ "$n" == "0" ]] && echo ABSENTE || echo "retablie ($n cle)")"
}

case "${1:-}" in
  etat)         cmd_etat ;;
  sauvegarder)  cmd_sauvegarder ;;
  vider-session) cmd_vider ;;
  restaurer)    cmd_restaurer ;;
  *) echo "usage : $0 {etat|sauvegarder|vider-session|restaurer}" >&2; exit 2 ;;
esac
