# Beyond Word V0 — audit, wedge, prototype

Branche `beyond-word-v0`. Rien de la production n'est modifié : ni Registry, ni HO-JSON,
ni Verify, ni la cryptographie, ni le scoring, ni le publisher. Aucune fusion, aucun
déploiement.

---

## 1 · Architecture actuelle

### Ce qui est réellement spécifique à Word

Beaucoup moins que la réputation du produit ne le suggère. La surface Office.js tient en
**16 points d'appel**, dont onze `Word.run`.

| Dépendance | Où | Ce qu'elle apporte |
|---|---|---|
| `Word.run` + événement `onChanged` | volet | l'éditeur **annonce** ce qui a changé |
| `paragraphs.uniqueLocalId` | volet | une identité d'unité stable entre deux mesures |
| `customXmlParts` | volet + natif | **le transport** : HOLocator et HOFacts voyagent DANS le .docx |
| `insertOoxml`, `contentControls` | volet | le sceau et l'identifiant réservé dans le document |
| `Office.context.document.url` | volet | le chemin du fichier |
| `read_custom_part()` | `ho_finalizer.rs` | relit la partie customXml d'un ZIP OOXML |
| `ho_docx_scrub` | natif | retire les références du complément du .docx |

### Ce qui est déjà portable, et ne demande rien à Word

| Élément | Pourquoi c'est portable |
|---|---|
| **`commit_bytes`** = `sha256(base64(octets))` | opère sur des octets quelconques. Rien du format n'y entre. |
| Le format des faits | `{sequence, period, kind, at, paragraphs[], length_delta, source, capture_assurance}` — aucune notion Word |
| Le scellement AES-256-GCM, `record_id` en AAD | générique |
| La signature Ed25519 | générique |
| Le dépôt au registre | HTTP, générique |
| **Verify** | lit le Record, jamais le .docx |
| Les périodes d'observation | notion propre à HumanOrigin |

### Le constat qui commande tout

**La chaîne de preuve est portable à environ 90 %.** Ce qui enferme HumanOrigin dans Word,
ce n'est pas la preuve : ce sont **deux** choses, et seulement deux.

1. **La capture** — qui annonce les changements.
2. **Le transport** — où les faits voyagent : aujourd'hui dans une partie customXml du
   `.docx`, ce qui impose un conteneur OOXML.

Le second est le verrou le plus bête et le plus coûteux : il force le format du livrable.

---

## 2 · Les chemins possibles, comparés

Noté de 1 à 5. « Preuve » = force réelle de ce qui est établi, pas impression produite.

| Chemin | Preuve | Robustesse | UX | Difficulté | Sécurité | Cross-media | Dépendance | Potentiel |
|---|---|---|---|---|---|---|---|---|
| Éditeur de texte autonome | 5 | 5 | 1 | 4 | 5 | 2 | 1 | 2 |
| Surveillance d'un fichier local | **1** | 3 | 4 | 1 | 3 | **5** | 1 | 3 |
| Extension d'un éditeur tiers (code) | 4 | 4 | 4 | 2 | 4 | 2 | 3 | **5** |
| SDK / couche de capture | 4 | 4 | 3 | 3 | 4 | 4 | 2 | 4 |
| Image / audio / vidéo | 2 | 2 | 2 | 5 | 3 | 5 | 4 | 4 |

**Ce que la comparaison tranche.**

L'éditeur autonome donne la meilleure preuve et aucune adoption : on construirait un
éditeur dont personne ne veut pour écrire ce qu'on écrit ailleurs.

La surveillance de fichier est séduisante — elle marche sur tout — et c'est précisément
le piège. Le red-team le montre : **elle ne peut jamais établir qu'un contenu a été
tapé.** Elle constate des états, pas un processus. Bâtir la promesse dessus la viderait.

L'image, l'audio et la vidéo ne sont pas mûrs : leur processus de création ne se réduit
pas à une suite de deltas de longueur.

---

## 3 · Le wedge choisi

**Sortir les faits du conteneur, avant de sortir de Word.**

C'est-à-dire : une **couche de capture générique** qui produit les faits actuels, et un
**fichier de preuve à côté de l'artefact** plutôt qu'à l'intérieur. Puis, comme première
source de capture non-Word, **l'éditeur de code**.

Pourquoi celui-là plutôt qu'un autre :

- **Valeur stratégique** — c'est le verrou qui fait dire « plugin Word ». Levé une fois,
  il l'est pour tous les formats à venir. L'engagement `commit_bytes` marche déjà sur
  n'importe quels octets : rien à inventer.
- **Crédibilité de preuve** — la capture reste au niveau de l'éditeur, le seul niveau qui
  distingue une frappe d'un collage. On ne descend pas vers la surveillance de fichier.
- **Vitesse** — le prototype ci-dessous a été écrit et éprouvé en une session, sans
  toucher au protocole. Une extension d'éditeur de code expose nativement des événements
  de changement avec leurs plages exactes : le contrat dont la couche a besoin.

Le code comme première extension, et non l'image : l'API d'édition y est stable et fine,
le public comprend la provenance, et un fichier source est un artefact aussi
« finalisable » qu'un document.

---

## 4 · Le prototype

`capture.mjs` · `finaliser.mjs` · `verifier.mjs` · `demo.mjs` · `red_team.mjs`

```sh
node demo.mjs       # bout en bout
node red_team.mjs   # les attaques
```

Il démontre qu'un contenu peut être créé hors Word, observé, lié à son état final, et
représenté avec les concepts actuels — sans inventer de vérité nouvelle.

**La primitive d'engagement est croisée avec la production.** `commit_bytes("bonjour
monde")` rend `82b228462efff4d0f333f2aba3d0e160a0990ad6d2d969da16dffbb79a198b2a` côté
Rust ; le prototype rend la même valeur. Ce n'est pas une réimplémentation approximative.

**Ce qui est simulé, et dit comme tel** : la signature Ed25519, remplacée par une
empreinte pour ne toucher à aucune clé ; le dépôt au registre, jamais appelé ;
l'identifiant de Record, tiré localement. Le schéma s'appelle
`ho-prototype-sidecar/0` — **il ne prétend pas être du HO-JSON**.

Une faiblesse volontaire du prototype : l'identité d'unité est la ligne, là où Word
fournit un `uniqueLocalId` qui survit à l'édition. C'est plus faible, exprès.

---

## 4 bis · V0.1 — ce qui a été durci

### P0 · La fenêtre entre l'arrêt de l'observation et la finalisation

C'était la faille la plus sérieuse du V0 : rien ne liait les faits à l'état final autrement
que par l'instant de la finalisation. On éditait hors observation, on finalisait, la preuve
sortait valide.

L'engagement est désormais pris **à l'instant exact où l'observation s'arrête**, conservé
dans la preuve, et recalculé à la finalisation. Trois états possibles, tous explicites :
`concordant`, `non_concordant`, `sans_engagement_d_arret`. Un mode `strict` fait refuser la
finalisation ; par défaut, la preuve **dit** son désaccord plutôt que de disparaître, ce qui
est plus utile à un banc. Le vérificateur traite les deux états non concordants comme
INVALIDE.

**Un cas documenté, pas corrigé** : un aller-retour qui restitue les **octets exacts** reste
indétectable. L'engagement porte sur l'état final, jamais sur le chemin parcouru. Ce n'est
pas un oubli — c'est ce que cette primitive peut faire, et elle ne prétend pas davantage.

### P1 · Le volume préexistant

Tout ce qui existe avant la première période est figé dans un bloc `preexistant` —
octets, unités, empreinte, et `observe: false`. Un fichier vide donne une baseline de zéro
octet, déclarée : c'est un cas normal, pas une absence. `ce_qui_reste_inconnu` nomme
désormais explicitement l'origine de ce contenu.

Le point qui comptait : 1 000 caractères importés produisent **un seul** événement observé
pour 1 023 octets. Rien dans la preuve ne laisse croire que ce volume a été créé sous
observation.

### P2 · Les signaux de capture

Cadence, rafales, taille médiane et maximale des insertions, répartition des sources, et
deux coefficients de variation — sur les intervalles et sur les tailles.

**C'est le coefficient de variation qui attrape le collage fractionné**, là où un seuil par
quantité ne voit rien : 40 blocs de 100 caractères à cadence métronomique donnent
`cv = 0` sur les deux axes, et le signal passe à `inhabituelle`. Une frappe irrégulière
donne `cv ≈ 1.0` et `≈ 0.6`, et reste `ordinaire`. Sous huit événements, le signal répond
`indeterminee` plutôt que de juger sur rien.

**Ces signaux ne sont pas des preuves d'auteur.** Chaque signal transporte sa propre portée
dans le champ `portee_du_signal`, pour qu'ils ne puissent pas se séparer : une suite
régulière peut venir d'une saisie régulière, et un collage à intervalles volontairement
irréguliers passerait. Aucun libellé de production n'est touché.

---

## 5 · Red-team — 9 détectées sur 9

Les trois attaques que le V0 ne tenait pas sont désormais tenues, et chacune garde sa
limite écrite.

**Le collage fractionné sous le seuil** — vu par la régularité, pas par la quantité. Limite :
le signal décrit une forme, il n'établit rien.

**L'import de contenu préexistant** — 1 000 octets déclarés non observés pour un événement.
Limite : la preuve dit combien préexistait, jamais d'où cela venait.

**L'édition par une application non observée** — `non_concordant`, verdict INVALIDE, et le
mode strict refuse. Limite : l'aller-retour aux octets exacts reste indétectable.

Les six autres tiennent comme avant : modification externe, remplacement du fichier, preuve
recopiée d'un autre Record, collage massif, reprise en deux périodes visibles, et
surveillance de fichier qui n'attribue jamais rien à la frappe.

**Banc V0.1 : 21 contrôles, 0 échec** (`node tests.mjs`).

## 6 · Recommandation

**GO** pour adapter un éditeur.

Ce qui est acquis : le transport hors conteneur fonctionne, l'engagement est le même qu'en
production et croisé avec elle, Verify n'a besoin d'aucun changement, et la promesse tient
mot pour mot sur un artefact qui n'est pas un `.docx`.

La réserve du V0 est levée : **la fenêtre est fermée**, et le red-team ne la rouvre plus.

Ce qui reste su, et qui ne doit pas disparaître dans l'enthousiasme : l'aller-retour aux
octets exacts est indétectable ; l'intervalle entre deux périodes reste inconnu ; l'origine
du contenu préexistant n'est pas établie ; et les signaux de régularité décrivent une forme
sans rien prouver de l'auteur. Ces quatre limites sont dans la preuve elle-même, pas
seulement dans ce document.

**NO-GO** sur la surveillance de fichier comme chemin principal, et sur l'image, l'audio
et la vidéo à ce stade.

---

## 7 · Prochain sprint

1. **Une extension d'éditeur de code**, branchée sur cette couche. Le contrat dont elle a
   besoin existe : ouvrir une période, annoncer les unités changées, fermer en prenant
   l'engagement.
2. **Éprouver les signaux sur de la frappe réelle**, pas simulée. Les seuils — `RAFALE_MS`,
   `REGULARITE_SUSPECTE`, `MIN_POUR_JUGER` — sont posés sur des hypothèses et doivent être
   calibrés sur des sessions authentiques avant de signifier quoi que ce soit.
3. **Décider du sort de l'intervalle entre périodes** : le combler, ou le déclarer plus
   fortement qu'aujourd'hui.
4. **Ensuite seulement**, la question du format de production — ticket séparé, HO-JSON hors
   périmètre.

Rien de tout cela ne touche Registry, HO-JSON, Verify ni la cryptographie.

---

# V0.2 — adapter VS Code

Banc technique, pas un produit. Rien n'est publiable : l'extension est `private`, sans
commande ni contribution.

## L'API réellement disponible

Lue dans `vscode.d.ts` de la version installée, pas de mémoire.

| Ce que l'API donne | Conséquence |
|---|---|
| `TextDocumentContentChangeEvent` : `range`, `rangeOffset`, `rangeLength`, `text` | insertion, suppression et remplacement se déduisent **exactement** |
| `TextDocumentChangeEvent.reason` : `Undo = 1`, `Redo = 2`, sinon `undefined` | **annulation et rétablissement sont observables** — Word ne le permet pas |
| `TextEditorSelectionChangeKind` : `Keyboard`, `Mouse`, `Command` | événement séparé, non rattaché au changement |
| **aucun événement de collage** | `DocumentPasteEditProvider` existe, mais c'est une API de *participation* au collage, pas d'observation : s'en servir changerait le comportement de l'éditeur. L'adapter ne s'en sert pas. |
| aucune information de périphérique d'entrée | **« tapé au clavier » n'est pas observable. Jamais.** |

## Le mapping

`insertion` / `suppression` / `remplacement` d'après `rangeLength` et `text.length`.
`length_delta = text.length - rangeLength`. L'unité est la ligne de départ du changement,
là où Word donne un identifiant de paragraphe.

`undo` et `redo` sortent de `local_editing` pour `editor_operation` : rejouer un état
antérieur n'est pas de la saisie.

Chaque fait porte `collage_observable: false` et `frappe_clavier_observable: false`, pour
que l'absence de ces informations ne puisse pas passer pour une négation.

## Le banc

VS Code **1.96.4 téléchargé et isolé**, profil séparé dans `~/.ho-vsc`. L'installation de
Philippe et ses extensions ne sont jamais touchées.

```sh
cd vscode_adapter && npm install && npm test
```

**10 scénarios, 10 passants**, dans un vrai hôte d'extensions pilotant un vrai éditeur.

## Ce que l'adapter voit, scénario par scénario

| Scénario | Ce qu'il voit — rien de plus |
|---|---|
| Saisie normale | des insertions successives |
| Suppression, remplacement | les deux types, distingués exactement |
| Collage massif (4 000 car.) | **une** insertion, `source: unknown`. Jamais « un collage » |
| Collage fractionné régulier | 25 insertions. Indiscernable d'une saisie |
| Collage fractionné **irrégulier** | 20 insertions. **Indiscernable, et aucun signal ne le rattrape** |
| Undo / redo | `reason` les nomme ; classés `editor_operation` |
| Replace-all | plusieurs changements dans **un seul** événement |
| Modification hors VS Code | **rien**. L'adapter n'invente pas ce qu'il n'a pas vu |
| Fichier préexistant | la baseline le déclare non observé |
| Multi-périodes | l'intervalle est nommé `modifie_hors_observation` |

## Multi-périodes

Session A → fermeture avec engagement → modification hors observation et hors VS Code →
session B. À la réouverture, l'état réel est comparé à l'engagement de fermeture et
l'écart est enregistré dans `intervalles_non_observes`, avec les deux engagements et sa
mention.

**La divergence n'invalide pas la preuve** — un intervalle non observé est normal — mais
elle est lisible, et son silence, lui, serait une faute. C'est pourquoi le vérificateur
échoue si le champ est absent.

Observé au passage : VS Code a lui-même détecté le conflit (« File Modified Since ») en
tentant d'enregistrer. L'éditeur sait. L'adapter ne doit pas s'y fier pour autant.

## Correction du rapport V0.1

J'avais écrit que le red-team « tenait » 9 attaques sur 9, collage fractionné compris.
**C'était faux et il faut le dire clairement.**

La régularité signale certaines séquences inhabituelles. Elle **ne tient pas** la classe
d'attaque « collage fractionné » : le banc VS Code le démontre, un collage fractionné à
intervalles irréguliers passe sans qu'aucun signal ne le distingue d'une saisie. Et elle
ne prouve ni collage, ni frappe, ni auteur.

Un signal d'assurance décrit une forme. Il ne ferme pas une classe d'attaque.
