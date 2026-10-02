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

## 5 · Red-team — 6 détectées, 3 non détectées

**Tenu :** modification externe après finalisation · remplacement complet du fichier ·
preuve recopiée depuis un autre Record (le `record_id` en AAD fait son travail) ·
fermeture puis reprise, dont les périodes distinctes se voient · collage massif, signalé
en `source: unknown` · capture par surveillance de fichier, qui n'attribue jamais rien à
la frappe.

**Non tenu, et c'est le vrai apport de l'exercice :**

**Le collage fractionné sous le seuil.** 40 blocs de 100 caractères passent intégralement
pour de la frappe. Le seuil est une quantité **par événement**, pas un rythme. **Ce défaut
existe déjà dans le volet Word de production** — il n'est pas né du prototype.

**L'import de contenu préexistant.** L'observation démarre sur 1 000 caractères déjà
présents, et la preuve est valide avec un seul événement. La preuve ne prétend pas couvrir
tout le contenu, mais **rien ne quantifie la part non observée**. Exposer le volume
initial comme un fait réglerait l'essentiel.

**Re-finaliser après une édition non observée.** C'est la faille la plus sérieuse. Dans le
prototype, rien ne lie les faits à l'état final autrement que par l'instant de la
finalisation : on édite hors observation, on re-finalise, la preuve est VALIDE. En
production, le volet scelle puis **ferme** le document, ce qui referme cette fenêtre. Un
chemin par fichier de preuve doit reproduire cette fermeture — **à traiter avant tout
usage réel**.

---

## 6 · Recommandation

**GO**, sur le wedge ci-dessus, avec une réserve nommée.

Ce qui est acquis : le transport hors conteneur fonctionne, l'engagement est le même qu'en
production et croisé avec elle, Verify n'a besoin d'aucun changement, et la promesse tient
mot pour mot sur un artefact qui n'est pas un `.docx`.

La réserve : **la fenêtre entre dernière observation et finalisation doit être fermée**
avant qu'un fichier de preuve ne sorte d'un prototype. Sans cela, le modèle est plus
faible que celui de Word, et il serait malhonnête de le présenter autrement.

**NO-GO** sur la surveillance de fichier comme chemin principal, et sur l'image, l'audio
et la vidéo à ce stade.

---

## 7 · Prochain sprint

1. **Fermer la fenêtre de finalisation.** Un fait de clôture scellé, et un engagement pris
   sur l'artefact **au moment où l'observation s'arrête**, pas au moment où l'on finalise.
   C'est le préalable à tout le reste.
2. **Exposer le volume initial** comme un fait, pour que la part non observée soit lisible
   dans la preuve plutôt que déduite.
3. **Mesurer le rythme, pas seulement la quantité** — une réponse au collage fractionné,
   qui bénéficierait aussi au volet Word.
4. **Une extension d'éditeur de code**, source de capture réelle branchée sur cette même
   couche.
5. **Ensuite seulement**, décider si le fichier de preuve devient un format de production
   — ce qui demandera son propre ticket, HO-JSON étant hors périmètre ici.

Rien de tout cela ne touche Registry, HO-JSON, Verify ni la cryptographie.
