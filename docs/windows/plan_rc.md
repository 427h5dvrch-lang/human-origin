# Windows RC — plan jusqu'à PRIVATE BETA READY

Décidé le 2026-10-01. **Le développement général est fermé.** Rien ne bouge sur Windows
tant qu'un test réel n'a pas eu lieu.

## Où en est le RC

Construit et qualifié autant qu'une machine de CI le permet : installateur
`HumanOrigin_0.3.1_x64-setup.exe`, 7 265 664 octets, empreinte
`EB161389C5683EF7357BCD2D49C62427BD1657B2FD96AF2DEDDD5B09F05C1255`, contenu vérifié en
l'ouvrant. Branche `windows-private-beta-v1`, jamais fusionnée, aucun tag, aucune release.

Trois chemins corrigés pour Windows n'ont **jamais** été exécutés : le dépôt au registre,
le rendu PDF par `pdfium.dll`, et la déclaration du catalogue Word dans la base de
registre. Ils sont tenus par des bancs de source et par la compilation croisée — ce qui
n'est pas la même chose que fonctionner.

## Passe 1 — le test qui décide

Une machine **Windows 11 + Microsoft Word desktop**, avec le pack de qualification
(`docs/windows/pack_qualification/`). Les 10 étapes, plus désinstallation et
réinstallation. Résultat PASS/FAIL par étape, avec les messages recopiés mot pour mot et
les dossiers de collecte.

**Aucun correctif n'est écrit avant d'avoir ce résultat.** Corriger sans observation,
c'est deviner — et c'est exactement ce qui a produit les trois hypothèses macOS que ce
chantier vient de lever.

## Entre les deux passes — six étapes, dans cet ordre

Arrêté le 2026-10-01. Rien d'autre n'entre dans cette fenêtre.

1. **Corriger uniquement les défauts réellement observés** en passe 1. Pas de refactor,
   pas d'amélioration repérée en chemin, pas de dette traitée au passage. Chaque correctif
   nomme l'étape qui l'a révélé.
2. **Aligner `publisher` sur DAZEAS CORP** dans la configuration du paquet. C'est le seul
   changement admis qui ne vienne pas d'un défaut observé : il est décidé, et il se fait
   ici plutôt que maintenant parce qu'il n'y a aucune raison de reconstruire le RC pour
   lui seul.
3. **Intégrer la signature Azure** — mais seulement **si la validation est disponible** à
   ce moment-là. Elle met 1 à 20 jours ouvrés et ne commande pas le calendrier : si elle
   n'est pas prête, la passe 2 se fait sur un installateur non signé, et la signature
   arrive après.
4. **Reconstruire** par le workflow Windows RC.
5. **Générer la nouvelle empreinte et un nouveau pack.** L'ancienne empreinte est retirée
   partout où elle figure. Un pack dont l'empreinte ne correspond plus à son installateur
   ne vaut rien, et c'est la première chose que le testeur vérifie.
6. **Passe 2 sur machine propre.**

## Passe 2 — le test propre

Même pack, même checklist, **machine remise à neuf** ou au minimum HumanOrigin désinstallé
et `%LOCALAPPDATA%\HumanOrigin` supprimé, pour que rien de la passe 1 ne masque un défaut
de première installation.

**PRIVATE BETA READY** se déclare quand la passe 2 est intégralement PASS, l'étape 10
exceptée — la mise à jour demande une version suivante publiée, ce qui viendra après.

## Ce qui reste hors périmètre

La signature Authenticode suit sa propre voie
(`azure_procedure_dazeas_corp.md`), sans bloquer les deux passes : une bêta privée peut
partir non signée auprès de testeurs prévenus, c'est précisément ce que la procédure
SmartScreen du pack encadre.

Et il ne faut pas attendre d'elle ce qu'elle ne donne pas : **signer ne fera pas
disparaître l'avertissement SmartScreen immédiatement**. SmartScreen juge la réputation
accumulée par le fichier, le certificat et l'URL, pas la seule validité du certificat. La
signature fait afficher DAZEAS CORP au lieu de « Éditeur inconnu » et permet à la
réputation de commencer à se construire — elle ne la fabrique pas.

Windows ARM64, iOS, Android, et toute amélioration produit : hors sujet jusqu'à PRIVATE
BETA READY.
