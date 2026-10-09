# HumanOrigin — UX checkpoint : réveil du Desktop

Date : 2026-10-10

Branche : `mac-deadend-openfile-v1` · commits `90ce9af`, `ae75a97`

## PASS physique — retest Mac

Validé sur le build `MAC-RETEST-M1-M2` (non signé, 26 Mo), parcours réel joué
par l'utilisateur sur sa machine :

- navigation accueil — OK ;
- changement et ouverture de document — OK ;
- création de document et bascule vers Word — OK ;
- retour depuis Word — OK ;
- rafraîchissement automatique au retour — OK ;
- aucun cul-de-sac constaté.

Ce PASS clôt les trois tickets enchaînés : **MAC DEAD-END / OPEN_FILE**,
**UX NAVIGATION — DOCUMENT SWITCHING**, **DESKTOP REFRESH / UX STATE**.

## Le défaut qui a motivé le dernier ticket

L'application lisait son état une seule fois, au moment de dessiner, et plus
jamais : aucun sondage, aucun écouteur de focus. Or le travail se fait dans Word,
donc dehors. On finalisait un document, on revenait sur la fenêtre, l'écran était
identique — « Ouverts dans Word » ignorait le document qui venait d'être scellé.
L'application n'était pas perdue : elle était figée sur le monde tel qu'il était
au dernier clic.

Deux défauts tenaient avec :

- `say()` n'écrivait que dans le nœud, donc tout redessin effaçait le message —
  déjà vrai au changement de langue, malgré un commentaire qui affirmait le
  contraire ;
- `VUE.ecran` restait nul sur les écrans **déduits**, donc un redessin pouvait
  redéduire l'écran et déplacer l'utilisateur sans qu'il ait rien demandé.

## Ce qui a été fait

- réveil sur `window.focus` **et** `tauri://focus`, dédoublonnés par un garde ;
  aucun sondage périodique ;
- on **redessine** l'écran courant avec des données fraîches ; on ne le redéduit
  jamais — être déplacé d'écran au seul fait de revenir sur une fenêtre serait
  pire que l'affichage périmé ;
- Réglages exclus du réveil, vérifié par mesure : zéro lecture native pendant un
  réveil sur cet écran ;
- `poser()` déclare tout écran déduit dans l'état de la vue ;
- `say()` retient son texte **et** sa nature ; `zoneMessage()` restitue les deux ;
- `redessiner()` repasse le contexte d'origine, sans quoi `installer-word`
  perdait son `etat` ;
- dernier libellé générique retiré : sur « Ce document a changé depuis sa
  finalisation », « Annuler » n'annulait rien et ramenait à l'accueil — il le dit
  désormais. La clé `action.cancel` est supprimée des deux catalogues.

## Garde

`tests/parcours_client.mjs` — câblé dans `npm run check:frontend`. Il fait
tourner le **vrai** `ho_desktop.js` (Tauri et Supabase doublés, un scénario par
processus) et clique comme un client. 5 scénarios, 33 vérifications, dont le
parcours exact du ticket : création → Word → finalisation → retour desktop →
document listé, preuve datée, toujours sur l'accueil, message intact.

Remis sur le code d'avant, ce banc rend **6 échecs** : il détecte bien le défaut
qu'il garde.

## Matrice de rollout — ce qui était faux dans le banc

`tests/rollout_matrix.mjs` échouait depuis avant ces tickets, pour deux raisons
qui ne concernaient pas le produit.

1. **Le « volet courant » n'est pas un fichier local.** Word charge le volet
   depuis `https://create.humanorigin.io/word/taskpane.html` : ce que voient les
   utilisateurs est un **déploiement**. Le banc lisait « le » volet dans le
   premier dossier trouvé sur la machine — ce jour-là un worktree de
   consultation, qui n'a jamais été la source d'expédition. Le verdict dépendait
   des dossiers présents, pas du produit.

   Mesuré le 2026-10-10 : le volet **déployé** est de classe `strict`, octet pour
   octet celui de `bilingual-launch-fix-v1` (`18fce93d…`, 41 166 o), tandis que
   `main` porte encore un volet `historique` de 11 013 o. La combinaison servie
   aux utilisateurs est donc `natif neuf + volet strict` → publication avec
   capability, la cible du basculement. **Aucun risque n'était masqué.**

   L'attente « classe exactement transition » décrivait un instant du
   basculement, désormais passé. Elle est remplacée par l'invariant : le volet
   servi ne doit **jamais** être de classe `historique`, seule combinaison qui
   refuse au finalizer avec le natif à jour.

2. **Une orthographe exigée au lieu d'un invariant.** Le banc réclamait
   littéralement `let capability = crate::ho_capability::lire(&m.record_id)?;`.
   Le finalizer traite désormais l'absence par un `match` explicite — même
   invariant, meilleure gestion d'erreur. Le banc mesure maintenant la lecture
   elle-même **et** qu'elle précède le premier travail coûteux, le déchiffrement
   des faits.

Un contrôle voisin passait **à vide** : il comparait la position du marqueur
`LEGACY COMPATIBILITY` à celle du tirage local, et `indexOf` rendant `-1` quand
le marqueur est absent, la comparaison était toujours vraie. Il ne s'applique
plus qu'à un volet de transition, et exige la présence du marqueur.

Hors réseau, les deux contrôles de conformité du déploiement se déclarent **non
établis** plutôt que verts : un banc local ne peut pas savoir ce qui est servi.
`HO_VOLET_COURANT=<fichier>` permet d'éprouver un volet candidat hors réseau.

Aucun fichier produit n'a été modifié pour cette remise au propre.

## État de la suite

- bancs `.mjs` : `frontend_symbols`, `brand_assets`, `i18n_langue`,
  `parcours_client`, `desktop_auth`, `deeplink_primary`, `registry_write_path`,
  `rollout_matrix`, `rc_identity` — tous PASS ;
- Rust : 70 passés, 0 échoué, 3 ignorés — six passes consécutives ;
- cohérence de version : 0.3.4.

### Instabilité connue, non traitée ici

`ho_finalizer::incident_tests::la_meme_cause_ne_reecrit_pas_le_fichier` a échoué
une fois sous charge, puis a passé neuf passes de suite, seul comme en suite.
Il compare deux horodatages produits à 20 ms d'intervalle : la résolution de
l'horloge peut les rendre égaux. C'est une fragilité du banc, pas du finalizer.
Hors du périmètre du ticket, laissée telle quelle et signalée.

## Ce qui reste ouvert

- **W4** — Word demande d'enregistrer sans qu'on ait tapé. Hypothèse non
  confirmée : paquet DOCX minimal dépourvu de `styles.xml`, `fontTable.xml`,
  `theme1.xml`, `webSettings.xml`. Demande d'ouvrir un document généré dans Word
  sans y toucher.
- **W5** — icône du ruban : carrés unis. Décision de design, pas de code.
- `retirer_registrations` n'est pas branché au désinstalleur NSIS (demande un
  modèle d'installeur personnalisé).
- Déploiements en attente de décision : correctif du volet Word
  (`word-windows-path-v1`, concerne aussi macOS) et patch Verify
  (`verify-capture-trust-v1`, DEPLOY READY = YES).
- Windows : retest physique en attente d'un Word sous licence ; anciennes
  installations 0.1.0 à retirer.
