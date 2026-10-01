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

## Entre les deux passes — périmètre fermé

Ne seront corrigés **que les défauts observés en passe 1**. Pas de refactor, pas
d'amélioration repérée en chemin, pas de dette traitée au passage. Chaque correctif
nomme l'étape qui l'a révélé.

Si un correctif touche le binaire : reconstruire par le workflow Windows RC, et **la
nouvelle empreinte remplace l'ancienne dans le pack**. Un pack dont l'empreinte ne
correspond plus à son installateur ne vaut rien.

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

Windows ARM64, iOS, Android, et toute amélioration produit : hors sujet jusqu'à PRIVATE
BETA READY.
