# W4 — audit du chemin d'initialisation du volet

2026-10-11. Suite du retest physique Windows, qui a isolé W4 au **code du volet** : sans
complément, volet caché, ou volet d'erreur avec un faux identifiant, W4 passe ; avec le vrai
volet chargé, il échoue. Géométrie, parties OOXML standard et registre sont écartés.

## Le chemin réellement exécuté avant « Activer »

`Office.onReady` ne fait que trois choses : câbler les gestionnaires de clic, appliquer le
catalogue de langue, et appeler `renderPreflight()` — puis le rappeler **toutes les
2 secondes** par `setInterval`.

Tout le reste est derrière un clic. Vérifié ligne par ligne : les enregistrements
d'événements `onParagraphAdded` / `onParagraphChanged` / `onParagraphDeleted` sont **dans
`activate()`**, pas à l'initialisation.

Donc, avant activation, le volet ne touche au document qu'en **deux endroits**, tous deux
dans `renderPreflight()` :

| appel | nature | peut-il écrire ? |
|---|---|---|
| `Office.context.document.url` | lecture d'une propriété | non |
| **`Office.context.document.settings.get("HOWorkFolders")`** | lecture du sac de réglages du complément | **c'est le seul candidat** |

### Inventaire des écritures, et où elles vivent

| opération | ligne | déclenchée par |
|---|---|---|
| `onParagraphAdded/Changed/Deleted.add()` | 180-182 | `activate()` |
| `ctx.document.properties.customProperties` (lecture) | 109, 467 | `activate()`, finalisation |
| `contentControls.getByTag` | 245 | finalisation |
| `body.insertOoxml` (badge) | 424 | finalisation |
| `customProperties.add("HOLocator"/"HOFacts")` | 681-682 | finalisation |
| `ctx.document.save()` | 690 | finalisation |

Aucune n'est atteignable sans clic. `Office.context.document.settings` est le **seul** accès
Office au document pendant la vie d'un volet non activé — et il est rejoué toutes les
2 secondes.

### Pourquoi ce candidat est crédible

Sur Word, le sac `Office.context.document.settings` **est persisté dans le document** : c'est
le bloc `<we:properties>` de la webextension. Or le générateur y écrit `HOWorkFolders` **à la
main**, dans son propre encodage :

```xml
<we:property name="HOWorkFolders" value="[&quot;/chemin&quot;]"/>
```

Si l'exécution Office normalise ce sac au premier accès, elle réécrit une partie du
document — et le document devient modifié sans qu'une ligne ait été tapée. Cela expliquerait
pourquoi un volet d'erreur, qui n'exécute jamais notre code, laisse W4 passer.

**Non confirmé.** Sur macOS, j'ai comparé `webextension1.xml` avant ouverture et après un
enregistrement par Word, volet chargé : le contenu est **identique**, à un octet d'espacement
près. Office ne normalise donc rien ici. Mais macOS ne reproduit plus W4, donc cette mesure
n'exclut pas le comportement Windows.

## Ce que je n'ai pas pu mesurer, et pourquoi

L'isolation demandée — neutraliser les appels candidats un par un — exige de servir une
variante du volet. Le volet de production est servi depuis `create.humanorigin.io`, et le
seul autre véhicule est le volet RC (`taskpane-rc.html` + manifeste RC), qui demande un
déploiement ou un service local sur la machine où W4 se reproduit.

Et W4 **ne se reproduit que sur Windows**. Côté macOS, le banc que j'avais monté — ouvrir un
document par AppleScript et lire la propriété `saved` de Word — s'est dégradé après une
vingtaine de cycles : Word n'ouvre plus aucun document, pas même ceux qu'il a lui-même
écrits. Il faudrait le relancer, ce que je n'ai pas fait : sept documents y sont ouverts,
dont un qui n'appartient pas à ce chantier.

Les mesures faites avant cette dégradation restent valables et sont consignées : elles ont
établi la matrice A/B/C et le fait qu'Office ne réécrit pas la propriété sur macOS.

## `Office.AutoShowTaskpaneWithDocument` retiré

Je l'avais ajoutée le 2026-10-11 en concluant qu'elle corrigeait W4, sur la foi d'une mesure
macOS. Le retest Windows a montré que non : elle y produit un **second onglet** HumanOrigin —
`visibility="1"` ouvrait déjà le volet, la propriété en demande un autre — et le document
reste modifié. Retirée du générateur.

`visibility="1"` est conservé : c'est lui qui fait passer W1 physiquement sur Windows.

Un banc empêche les deux mécanismes de coexister, et empêche aussi la propriété de revenir
seule : `un_seul_mecanisme_d_ouverture_du_volet` exige `visibility="1"`, une seule entrée
`<wetp:taskpane>`, une seule `<we:reference>`, et l'absence de `AutoShowTaskpaneWithDocument`.

Le banc qui portait le nom `ouvrir_le_document_ne_le_rend_pas_modifie` a été renommé
`le_volet_declare_correspond_au_manifeste` : il ne gardait pas W4, et son nom le promettait.

## Protocole d'isolation, prêt à être joué

Sur la machine où W4 se reproduit, avec le volet RC servi localement — il a son propre
identifiant de manifeste, donc il ne perturbe pas la production :

| variante | changement dans `renderPreflight()` | ce qu'elle teste |
|---|---|---|
| **V0** | aucun — volet RC tel quel | le banc reproduit-il W4 ? |
| **V1** | `workFolders()` rend `null` sans appeler `settings.get` | le sac de réglages est-il la cause ? |
| **V2** | `documentPath()` rend `""` sans lire `document.url` | la lecture d'URL est-elle en cause ? |
| **V3** | `setInterval` retiré, un seul rendu | la répétition toutes les 2 s compte-t-elle ? |
| **V4** | `renderPreflight()` entier neutralisé | borne haute : si W4 passe, la cause est bien dans ce chemin |

V0 d'abord : sans reproduction sur le banc, aucune des autres ne veut dire quoi que ce soit.
Et V1 dégrade W3 — le volet ne saurait plus dire « dans votre dossier de travail » — donc
c'est une variante de mesure, jamais un candidat de correctif.

Si V1 tranche, le correctif ne consiste pas à ne plus lire les dossiers : il consiste à les
lire **ailleurs que dans le sac de réglages Office**. Le générateur écrit déjà
`HOReservedId` en propriété de document personnalisée ; `HOWorkFolders` pourrait suivre le
même chemin, qui est une lecture franche. Cela se décide après la mesure, pas avant.

## Avant activation, le volet doit être strictement en lecture

C'est la règle que ce chantier doit laisser derrière lui, quelle que soit la cause trouvée.
Elle n'est pas encore gardée par un banc : le volet vit dans le dépôt web, et aucun banc n'y
vérifie aujourd'hui qu'aucune écriture Office n'est atteignable depuis `Office.onReady`.
C'est à ajouter avec le correctif.
