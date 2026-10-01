# Les 10 étapes

Chaque étape dit ce qu'il faut faire, ce qui doit se produire, et ce qui compte comme
échec. « Bloque » indique si un échec empêche de continuer.

---

## 1 · Télécharger l'installateur · bloque : oui

Récupérer `HumanOrigin_0.3.1_x64-setup.exe` et vérifier son empreinte (voir README).

**PASS** — l'empreinte correspond.
**FAIL** — elle diffère, ou le navigateur refuse le téléchargement. Noter le message exact.

---

## 2 · Installer · bloque : oui

Double-cliquer l'installateur.

Windows affichera **« Windows a protégé votre ordinateur »** : c'est attendu, l'installateur
n'est pas encore signé. Voir `smartscreen.md` pour passer outre.

L'installation se fait **pour l'utilisateur courant**, sans demander de droits
administrateur. Si WebView2 est absent, il est téléchargé et installé au passage — cela
peut prendre une minute.

**PASS** — l'installation se termine, et `%LOCALAPPDATA%\Programs\HumanOrigin` (ou le
dossier choisi) contient `HumanOrigin.exe`, `pdfium.dll`, `humanorigin-publisher.exe`,
`humanorigin-converter.exe`, `uninstall.exe`.
**FAIL** — erreur pendant l'installation, ou un de ces fichiers manque. Noter lequel.

À relever : le chemin d'installation exact, et si une demande d'élévation est apparue.

---

## 3 · Lancer l'application · bloque : oui

Ouvrir HumanOrigin depuis le menu Démarrer.

**PASS** — la fenêtre s'ouvre (400 × 580), la marque HumanOrigin est lisible en haut, et
l'interface répond.
**FAIL** — rien ne s'ouvre, fenêtre blanche, fenêtre d'erreur, ou la fenêtre se ferme
seule. Faire une capture.

Une fenêtre blanche signale en général WebView2 absent ou trop ancien : le noter tel quel.

---

## 4 · Se connecter · bloque : oui

Saisir l'adresse e-mail, recevoir le lien, et revenir dans l'application.

Le lien de connexion rouvre l'application par un lien profond. Si le navigateur demande
quelle application utiliser, choisir HumanOrigin et le noter.

**PASS** — l'application affiche l'état connecté.
**FAIL** — le lien n'arrive pas, n'ouvre pas l'application, ou la connexion est refusée.
Noter le message affiché, **sans recopier le lien**.

---

## 5 · Installer le complément Word · bloque : oui

Dans HumanOrigin, lancer l'installation du complément.

Sur Windows, l'application dépose le manifeste dans
`%LOCALAPPDATA%\HumanOrigin\WordAddin` et déclare ce dossier comme **catalogue approuvé**
dans la base de registre.

Puis, **dans Word** : fermer et rouvrir Word, aller dans **Insertion → Mes compléments →
Dossier partagé**, et choisir **HumanOrigin**.

**PASS** — HumanOrigin apparaît dans la liste du dossier partagé, et le volet s'ouvre dans
Word.
**FAIL** — l'application signale une erreur, ou l'onglet « Dossier partagé » est vide.

Cette étape est celle dont le comportement Windows diffère le plus de macOS : y consacrer
du soin et décrire précisément ce qui s'affiche.

---

## 6 · Créer un document · bloque : oui

Dans HumanOrigin, choisir l'emplacement de travail puis créer un document.

**PASS** — le document est créé et s'ouvre dans Word, le volet HumanOrigin se charge.
**FAIL** — aucun document, ou il s'ouvre dans une autre application que Word, ou le volet
reste vide. Noter le nom du fichier et son emplacement.

---

## 7 · Activer l'observation · bloque : oui

Dans le volet Word, démarrer l'observation. **Écrire réellement**, au clavier, pendant au
moins **deux minutes**, en faisant des pauses, des corrections, des retours en arrière.
Viser une centaine de frappes au minimum.

Ne pas coller de texte : l'observation distingue la frappe du collage, et un document
entièrement collé ne produit pas une preuve représentative.

**PASS** — le volet indique que l'observation est active et le compteur progresse.
**FAIL** — rien ne démarre, ou le compteur reste à zéro malgré la frappe.

---

## 8 · Finaliser · bloque : non

Dans le volet, finaliser le document.

C'est l'étape qui exerce le dépôt au registre, c'est-à-dire le chemin réseau corrigé pour
Windows. Si quelque chose doit casser faute de machine Windows pendant le développement,
c'est ici.

**PASS** — la finalisation aboutit, le volet affiche la durée observée et le nombre de
changements, et le document porte le sceau HumanOrigin.
**FAIL** — un message d'erreur apparaît. Le noter **mot pour mot** : il est typé, et c'est
lui qui dit si le registre a refusé, s'il était injoignable, ou si le transport lui-même a
échoué.

Après cette étape, lancer `.\collecte_logs.ps1 -Etape finalisation` : s'il y a eu un
incident, l'application en a gardé une trace typée, sans secret.

---

## 9 · Consulter la preuve · bloque : non

Depuis le document finalisé, ouvrir le lien de vérification.

**PASS** — la page Verify s'ouvre, affiche la preuve, et conclut que le Record est
authentique. L'analyse se fait dans le navigateur, sans compte.
**FAIL** — la page ne s'ouvre pas, ou annonce une preuve invalide.

**Ne pas recopier le lien complet** dans le rapport : tout ce qui suit le `#` est une clé.
Noter seulement l'identifiant du Record, de la forme `HO-xxxxxxxx`.

### 9 bis · Rendu PDF

Toujours depuis le document finalisé, demander l'export PDF publié.

C'est le chemin qui exerce `pdfium.dll`. Il n'a jamais tourné sur Windows.

**PASS** — un PDF est produit, il s'ouvre, et la cartouche HumanOrigin y figure, lisible,
avec son QR code.
**FAIL** — aucun PDF, erreur mentionnant PDFIUM, ou cartouche absente/déformée. Joindre le
PDF s'il existe, et une capture de la cartouche.

---

## 10 · Recevoir une mise à jour · bloque : non

Cette étape ne peut pas être menée aujourd'hui : elle demande qu'une version 0.3.2 soit
publiée après la 0.3.1 installée.

Ce qui **peut** être vérifié maintenant : au lancement, l'application interroge son canal
de mise à jour et ne doit ni planter ni afficher d'erreur.

**PASS** — aucune erreur de mise à jour au démarrage.
**FAIL** — un message d'erreur de mise à jour apparaît. Le noter.

Le test complet reste à faire quand une version suivante existera.

---

## Et ensuite

### Désinstallation · puis réinstallation

1. **Paramètres → Applications → Applications installées → HumanOrigin → Désinstaller.**
2. Vérifier que le dossier d'installation a disparu.
3. Relever ce qui reste : `%LOCALAPPDATA%\HumanOrigin` (données et manifeste du complément)
   et l'entrée de catalogue dans la base de registre survivent-ils ? Le script de collecte
   le dit.
4. **Réinstaller** le même installateur.
5. Relancer l'application : la session doit être retrouvée, et le complément Word ne doit
   pas être déclaré deux fois dans Word.

**PASS** — la désinstallation retire l'application, la réinstallation fonctionne, et Word
ne montre **qu'une seule** entrée HumanOrigin.
**FAIL** — un reliquat empêche la réinstallation, ou Word affiche deux fois le complément.

Ce dernier point est précisément ce que la clé de registre fixe est censée empêcher :
c'est le contrôle qui le vérifie.
