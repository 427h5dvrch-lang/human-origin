# Verify Design V2 — valeur du processus observé

Objectif produit **prioritaire**, enregistré le 2026-10-10.

> La richesse du processus observé doit être compréhensible en moins de 3 secondes.
> Deux contenus ayant le même résultat final mais des processus très différents ne doivent pas
> donner une impression de preuve équivalente.

Code concerné (dépôt `humanorigin-web`) : `verify-record/src/app.js`,
`verify-record/engine/src/adapters/humanorigin.js`,
`verify-record/engine/presentation/present.js`.

**Rien n'a été modifié.** Verify est une zone protégée : ce document est un constat et un plan.

---

## 1 — Les deux cas de référence

| | A — rédaction réellement observée | B — gros collage puis finalisation |
|---|---|---|
| durée | significative | courte |
| saisie | progressive | contenu massif d'un coup |
| suppressions, révisions | présentes | quasi absentes |
| séances | éventuellement plusieurs | une |
| profondeur observée | forte | faible |

## 2 — Ce que Verify fait aujourd'hui : mesuré, pas supposé

Les deux cas ont été fabriqués au format réel (`ho-evidence/1.0`, adapter `word-office-js`) et
passés dans le **vrai** chemin de Verify — `normalizeProof`, adaptateur HumanOrigin, moteur,
présentation :

- **A** : 74 événements, 90 minutes, 2 séances, +2 000 / −700 caractères, révisions de
  paragraphes déjà écrits ;
- **B** : 3 événements, 70 secondes, un apport de 4 120 caractères d'origine non déterminée.

Résultat :

```
assertions identiques entre A et B : OUI
phrases affichées en plus dans A   : aucune
phrases affichées en plus dans B   : aucune
```

**Aucune phrase ne diffère.** Les deux pages Verify sont, mot pour mot, la même page. Le seul
chiffre qui change nulle part ailleurs est `event_count` (74 contre 3), et il n'apparaît que
dans un champ technique de méthode de vérification.

L'objectif produit n'est donc pas « améliorer une distinction faible » : **la distinction
n'existe pas du tout**.

## 3 — La cause, exactement

`normalizeProof` (`src/app.js`) réduit la preuve à dix champs et **jette `events`** :

```
session_id · object_id · event_count · chain_head_hash · final_state_commit
large_inserts · chain_continuous · capture_adapter · observation_profile
listed_event_count · declared_event_count
```

L'adaptateur ne lit que ces dix champs — vérifié. Il ne voit donc jamais : les durées, les
`observation_periods`, les `length_delta`, les suppressions, les paragraphes touchés, ni
`process_evidence.observed_facts`.

Reste `large_inserts`, qui devrait porter le signal du cas B. Il est **dérivé** par
`normalizeProof` des événements dont `operation === "LARGE_INSERT"`.

Or `operation` appartient au format de laboratoire **C1** (`ho-evidence-kernel-v2-lab`,
adapter `c1-docx`), retiré depuis. La production émet autre chose :

```json
{ "sequence": 7, "kind": "paragraph_changed", "at": "...", "period": 1,
  "paragraphs": [...], "length_delta": 4120,
  "source": "unknown", "capture_assurance": "low" }
```

**Une migration de format a laissé la dérivation derrière elle.** Pour toute preuve réelle,
`large_inserts` vaut `[]`, et les assertions `ORIGIN.contribution` qui localiseraient un apport
d'origine non déterminée ne se déclenchent jamais. Le vocabulaire existe chez le lecteur ; le
producteur ne le parle plus.

## 4 — Bonne nouvelle : les faits existent déjà

Le volet Word enregistre déjà, par événement : l'horodatage, la séance (`period`), les
paragraphes touchés, la variation de longueur signée, et il **marque déjà** un apport massif :

```js
const LARGE = 40;                       // au-delà, la source d'un apport n'est pas établie
const large = Math.abs(delta) >= LARGE;
source: large ? "unknown" : "local_editing",
capture_assurance: large ? "low" : "medium"
```

Et `process_evidence` porte `observed_facts.recorded_changes`,
`observed_facts.undetermined_source` et `observation_periods`.

Conséquence : **aucun changement du modèle de preuve, aucun changement du producteur, aucun
changement du finalizer Rust.** Tout le manque est côté Verify.

## 5 — Ce qui est honnêtement calculable

| Fait | Source | Honnête ? |
|---|---|---|
| durée observée | union des `observation_periods` | oui |
| séances observées | nombre de périodes | oui |
| modifications enregistrées | `event_count` | oui, déjà là |
| caractères ajoutés sous observation | somme des `length_delta > 0`, `source = local_editing` | oui |
| caractères retirés sous observation | somme des `length_delta < 0` | oui |
| retours sur un passage déjà modifié | paragraphe déjà touché par un événement antérieur | oui |
| apports d'origine non déterminée | événements `source ≠ local_editing`, avec leur longueur | oui |
| part du contenu final liée à des actions observées | ratio sur les deltas | **sous condition** |

Le ratio n'est calculable que si aucun contenu préexistant non observé n'entre dans le
document. C'est vrai d'un document créé par HumanOrigin, **faux** d'une nouvelle version créée
depuis un contenu déjà présent — l'application le dit déjà à l'écran. Quand une lacune de
couverture est déclarée, le ratio doit être **retiré**, pas estimé.

## 6 — Une correction de vocabulaire à acter

Le ticket demande un compteur de « collages ». Le fait disponible n'est pas un collage : c'est
un **apport dont l'origine n'a pas pu être établie**. Un collage interne au document reste
`local_editing` ; un apport d'origine inconnue peut être un collage, une insertion de fichier,
une macro ou un complément tiers. Écrire « collages » serait une inférence sur le geste de
l'utilisateur, exactement ce que Verify s'interdit.

Libellé proposé : **« contenu entrant d'origine non déterminée »**, avec sa longueur.

Interdits confirmés et élargis : aucun score d'effort, de mérite, d'authenticité humaine ou de
probabilité d'IA — et **aucun indice composite unique**, même nommé « profondeur », parce
qu'un chiffre unique sera lu comme une note. Un petit ensemble de faits comptés, et les deux
phrases explicites demandées.

## 7 — La décision qui m'appartient pas

`engine/` est **gelé au bit près** : `test_engine_display.mjs` verrouille l'empreinte des huit
modules du bundle, suite à l'arbitrage du 2026-10-03. Deux voies, et il faut choisir.

**Voie 1 — à la frontière du rendu (`src/`).** On calcule la synthèse là où `normalizeProof`
lit déjà la preuve, et on l'affiche au-dessus de la sortie du moteur. Ne touche pas au moteur
gelé. Mais la synthèse vit alors **hors du graphe d'assertions**, donc hors du modèle STATUS
et hors de `FORBIDDEN_INFERENCES` / invariant I8 — la discipline qui fait précisément la
valeur de Verify. Pour une surface de confiance, c'est une perte réelle.

**Voie 2 — faits dans le graphe.** Les faits comptés deviennent de vraies assertions, avec
portée, statut et limites, et les empreintes gelées sont mises à jour sous décision explicite.
Correct, plus lourd, et cela dégèle le moteur.

**Recommandation** : voie 2 pour tout ce qui **affirme** quelque chose — les deux phrases, les
apports d'origine non déterminée, le ratio conditionnel ; voie 1 uniquement pour ce qui est
purement présentation — l'ordre, la mise en page des 3 secondes.

## 8 — À mesurer avant de concevoir : le seuil de 40 caractères

Toute la distinction A/B repose sur le marqueur `source: "unknown"`, déclenché à partir de
**40 caractères** dans un seul événement. Une frappe rapide peut dépasser 40 caractères dans
un seul `paragraph_changed` : si c'est fréquent, une rédaction réelle afficherait de nombreux
« apports d'origine non déterminée », et le cas A ressemblerait au cas B.

Je n'ai pas pu le mesurer sur des données réelles : les Records stockés au registre sont
chiffrés au repos (`alg`/`iv`/`tag`/`ciphertext`), par conception, et la seule preuve lisible
sur cette machine est au format C1 retiré.

Mesure proposée, une fois : écrire un vrai document d'une page dans Word, le finaliser, puis
compter la part des événements marqués `unknown`. Si elle est élevée, le seuil doit être revu
**avant** de construire l'affichage, sans quoi la synthèse donnerait une fausse impression —
dans le sens le plus dommageable, en faisant passer du travail réel pour un apport opaque.

## 9 — Les deux phrases exigées

- Preuve pauvre : « Peu de processus de création a été observé avant la finalisation. »
- Preuve riche : « Le contenu a évolué progressivement pendant une période observée, avec
  saisies, suppressions et révisions. »

Chacune doit être **adossée aux faits comptés** et ne s'afficher que lorsque ces faits
l'établissent. Aucune inférence sur l'identité, l'intention, l'usage d'IA, la qualité du
travail ou la vérité du contenu.

## 10 — Test UX comparatif, à livrer avec

Banc comparatif A contre B : les deux pages doivent être nettement distinguables en quelques
secondes **sans lire les détails techniques**. Mesure objective proposée :

1. les deux pages diffèrent sur au moins N énoncés de premier niveau — aujourd'hui, **zéro** ;
2. la phrase « preuve pauvre » apparaît en B et jamais en A, et réciproquement ;
3. la distinction tient dans la première zone de la page, sans défilement ;
4. aucun énoncé interdit n'apparaît dans l'une ni dans l'autre.

Le banc de mesure écrit aujourd'hui (`/tmp/mesure_ab.mjs`) sera promu dans le dépôt web.

---

## En attente de décision

1. Voie 1 ou voie 2 pour la section 7 — c'est la question structurante.
2. Mesure du seuil de 40 caractères avant conception (section 8) : oui ou non.
3. Libellé « apports d'origine non déterminée » en remplacement de « collages » : validé ou non.
4. Ratio de contenu final : affiché sous condition, ou écarté de la V2.

Aucune ligne de Verify ne sera touchée avant ces réponses.
