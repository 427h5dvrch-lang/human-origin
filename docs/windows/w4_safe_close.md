# W4 / SAFE CLOSE — cause mesurée et correctif

2026-10-11. Branche `main`. Aucun déploiement, aucune publication.

## Le symptôme

Ouvrir un DOCX HumanOrigin neuf, ne rien taper, fermer → Word demande
« Enregistrer vos modifications dans ce fichier ? ». Confirmé physiquement sur Windows
(build 0.3.4 signé, Word licencié) : fichier inchangé à 4110 octets après « Ne pas
enregistrer », aucun `~$`.

## Reproduction sur macOS — OUI

W4 n'est **pas spécifique à Windows**. Mesuré en interrogeant Word lui-même, sur une copie :

```
osascript -e 'tell application id "com.microsoft.Word" to return saved of document 1'
```

| paquet | `saved` |
|---|---|
| document écrit par Word (témoin) | **true** |
| document neuf créé par Word (témoin) | **true** |
| DOCX HumanOrigin généré | **false** |

Les deux témoins valident la méthode : ce n'est pas l'ouverture par script qui salit un
document, c'est notre paquet.

## L'hypothèse du paquet minimal est FAUSSE

Elle circulait depuis le premier rapport Windows : il manquerait `styles.xml`,
`fontTable.xml`, `theme1.xml`, `webSettings.xml`, et Word les ajouterait. Word les ajoute
bien — c'est mesuré, un document qu'il réécrit les contient — mais ce n'est pas la cause :

| paquet | `saved` |
|---|---|
| généré, tel quel | false |
| généré + `styles.xml` | false |
| généré + `styles.xml` + `fontTable.xml` | false |
| généré + les **quatre** parties | **false** |

Le paquet généré est par ailleurs **cohérent** : une seule relation déclarée
(`settings.xml`), présente ; `document.xml` porte son `sectPr` ; `settings.xml` fixe
`compatibilityMode 15`. Word ne répare rien, il complète.

## La cause, par élimination

| paquet | `saved` |
|---|---|
| généré **sans** les parties `word/webextensions/` | **true** |
| généré + quatre parties, **sans** webextensions | **true** |
| généré sans `docProps/custom.xml` | false |
| généré sans `word/settings.xml` | false |

C'est donc la déclaration du volet embarquée dans le document. Puis, dans le triplet :

| variante | `saved` |
|---|---|
| `taskpanes.xml` avec `visibility="0"` | **true** |
| `webextension1.xml` sans `<we:properties>` | false |
| `webextension1.xml` sans `<we:snapshot/>` | false |

**`visibility="1"` est la cause.** Le document demande à Word d'ouvrir le volet ; Word
honore la demande et inscrit l'état du volet dans le document, qui devient modifié par le
seul fait de s'ouvrir.

Confirmation indépendante : quand Word enregistre lui-même un document HumanOrigin, il
écrit `visibility="0"` — relevé sur deux documents réels du corpus. Il traite donc cet
attribut comme l'état courant du volet, pas comme une préférence.

## Le correctif — une propriété, et `visibility="1"` conservé

`visibility="0"` corrigerait W4 **en cassant W1** : c'est lui qui ouvre le volet. Les deux
exigences passent par le même attribut, et il n'avait pas à être sacrifié.

`Office.AutoShowTaskpaneWithDocument` est la voie documentée pour qu'un document ouvre son
volet. Word y lit une **intention déclarée**, non un changement :

```xml
<we:properties>
  <we:property name="Office.AutoShowTaskpaneWithDocument" value="true"/>
  <we:property name="HOWorkFolders" value="…"/>
</we:properties>
```

| paquet | `saved` |
|---|---|
| généré, `visibility="1"` | false |
| généré, `visibility="1"` **+ la propriété** | **true** |

Mesuré **quatre fois, en alternance avec le témoin** : jamais d'inversion.

Et sur l'artefact réel, produit par le code patché — pas un zip fabriqué à la main :

```
DOCX produit par le code patché → saved = true   (4143 octets)
```

La propriété désigne le volet par le `<TaskpaneId>HOTaskpane</TaskpaneId>` que le manifeste
déclarait déjà : aucune autre pièce à ajouter, aucun changement de manifeste.

Le prompt de Word n'est **ni masqué, ni contourné** : le document n'est plus modifié, donc
Word n'a plus de raison de demander.

## Non-régression

`ouvrir_le_document_ne_le_rend_pas_modifie`, dans `ho_word_setup.rs`, tient les deux
moitiés ensemble : la propriété doit être présente, **et** `visibility="1"` doit rester.
Corriger l'un en cassant l'autre fait tomber le test. Il vérifie aussi que le manifeste
déclare toujours le `TaskpaneId`, sans lequel la propriété ne désignerait rien.

`ecrire_paquet_pour_mesure` (ignoré par défaut) écrit le paquet réel sur disque pour qu'il
puisse être rouvert et mesuré :

```
cargo test --bin human-origin ecrire_paquet_pour_mesure -- --ignored --nocapture
osascript -e 'tell application id "com.microsoft.Word"
  open POSIX file "/tmp/w4/produit_par_le_code.docx"
  delay 5
  set s to saved of document "produit_par_le_code.docx"
  close document "produit_par_le_code.docx" saving no
  return s
end tell'
```

## Ce qui reste à vérifier physiquement

Le script lit l'indicateur `saved` de Word, pas la **visibilité** du volet : Word n'expose
pas l'état d'un volet Office.js à AppleScript. Que le volet s'ouvre toujours de lui-même —
W1 — doit donc être revérifié sur Windows. C'est le seul point que cette mesure ne couvre
pas, et `visibility="1"` étant inchangé, rien ne devrait avoir bougé.

## Observations non bloquantes, consignées à part

Rapportées par le retest Windows, non investiguées ici pour ne pas détourner W4 :

- le processus Word reste parfois en mémoire après fermeture de la dernière fenêtre ;
- `pdfium.dll` absent de ce build ;
- `HumanOrigin.exe` non signé alors que l'installeur l'est. **Attendu en l'état** : la
  chaîne signe `files-folder: src-tauri/target/release/bundle/nsis` avec
  `files-folder-filter: exe`, donc l'installeur NSIS, pas le binaire applicatif qu'il
  dépose. Signer aussi l'exécutable interne est une décision à prendre, pas un défaut de la
  chaîne telle qu'elle a été spécifiée ;
- l'accueil affiche parfois « Installation… » alors que Word est prêt ;
- W5 : icône de ruban toujours un carré.
