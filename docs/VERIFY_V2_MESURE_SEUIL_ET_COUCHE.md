# Verify V2 — mesure réelle du seuil, et couche Observed Process Summary

2026-10-10. Suite des arbitrages Control Tower. **`engine/` n'a pas été touché.** Aucun
déploiement. Prototype et analyseurs : `~/Developer/HO_VERIFY_V2_OPS/`.

## 1 — D'où viennent les données réelles

Les Records stockés au registre sont chiffrés au repos. Mais chaque document finalisé porte ses
propres faits : `HOFacts` dans `docProps/custom.xml`, chiffré AES-256-GCM, **et la clé est dans
`HOLocator`** (`ho1.<record_id>.<clé base64url>`), AAD `facts:<record_id>`. Qui détient le
document peut donc lire son processus observé — c'est le dessin voulu.

Corpus réel trouvé sur la machine : **74 documents porteurs de faits, 43 Records distincts,
904 événements.**

## 2 — Mesure du seuil de 40 caractères

`|length_delta|` sur 904 événements réels :

```
min 0   médiane 7   p90 12   p99 84   p999 1122   max 1122
>=  20 :  35 événements (3,87 %)
>=  40 :  27 événements (2,99 %)
>= 100 :   3 événements (0,33 %)
```

Cadence de Word, sur 861 écarts mesurés : **p10 1,07 s · médiane 1,14 s · p90 1,7 s.** Word
émet son événement à peu près chaque seconde. C'est cela qui borne ce qu'un seul événement peut
accumuler.

Variation par événement **de saisie** (`local_editing`, 798 mesures) :
**médiane 8 · p90 11 · p99 16 · max 30.**

### Le constat

```
plus gros événement de saisie observé : 30 caractères
seuil actuel                          : 40 caractères
plus PETIT apport réellement massif    : 43 caractères
```

Le seuil est dans l'intervalle **[30, 43]**. Sur ce corpus il **ne s'est jamais trompé** : aucun
des 798 événements de frappe n'a été classé `unknown`, et les 27 événements franchissant 40
étaient de vraies insertions programmatiques (documents de banc).

Atteindre 40 caractères en un événement demanderait ~35 caractères/seconde à l'écart médian,
soit environ **420 mots/minute** — hors de portée d'une frappe humaine soutenue. C'est la raison
structurelle pour laquelle le seuil tient.

### Décision proposée : ne pas toucher au seuil

La donnée le soutient. Mais **l'intervalle est étroit** : 10 caractères de marge au-dessus de la
frappe réelle, 3 en dessous du plus petit apport massif. À surveiller, pas à ignorer.

### Ce que cette mesure NE couvre pas

- Corpus de documents **courts** (2 s à 207 s, ≤ 718 caractères), produits en qualification.
  Aucun document long écrit vite.
- Cadence mesurée sur **macOS uniquement**. Si Word émet moins souvent sur Windows, ou sur un
  document volumineux, les deltas grossissent et la marge de 10 caractères fond. Le retest
  Windows W1–W4 peut fournir cette mesure sans effort supplémentaire.
- La sécurité du seuil **dépend d'un comportement de Word**, pas d'une propriété du produit.
  Un changement de version Office peut la modifier sans que rien ne le signale.

## 3 — Couche Observed Process Summary

`observed_process_summary.js`, schéma `ho-observed-process/1`. Séparée, typée, dérivée des
événements bruts. Ne touche à aucun STATUS, n'étend pas `FORBIDDEN_INFERENCES`, ne produit ni
score ni verdict.

```
events       recorded · declared · continuous
time         observed_seconds · sessions · bounds ("periods" | "events") · first_at · last_at
text         added_characters · removed_characters · added_undetermined_characters
passages     distinct_touched · returns_after_detour
provenance   determined_events · undetermined_events · undetermined[]
concentration largest_event_characters · total_added_characters · largest_event_sequence
              · largest_event_origin_determined · events_with_additions
```

Trois règles tenues partout :

1. **Une absence vaut `null` accompagné de sa raison**, jamais zéro. Un zéro constaté et une
   donnée manquante sont deux choses différentes.
2. **La durée déclare sa qualité.** `bounds: "periods"` quand la preuve porte de vraies fenêtres
   d'observation ; `bounds: "events"` quand le seul intervalle disponible va du premier au
   dernier fait — ce qui n'est pas la durée de la séance, et l'affichage doit le dire.
3. **Aucun pourcentage du contenu final.** Écarté de la V2 : après insertions, suppressions et
   réécritures, la somme des deltas ne reconstruit pas la contribution au texte final.

### Un défaut que la mesure a corrigé

La définition naïve d'une révision — « ce paragraphe a déjà été touché » — comptait **37 retours
sur 38 événements** sur le Record réel `HO-1JuladpjmLk8`, parce que le document n'avait qu'un
paragraphe et que taper en continu le re-touche à chaque événement. Elle ne mesurait rien.

Définition retenue : **retour après détour** — on ne compte un retour que si l'on est passé sur
un autre paragraphe entre les deux. Sur le même Record : **0**, ce qui est exact.

### `concentration` — ce que c'est, et ce que ce n'est pas

Part des caractères ajoutés arrivée dans le plus gros événement. C'est elle qui sépare une
rédaction progressive d'un apport massif **sans qu'aucun seuil n'ait à être choisi** : on compare
deux nombres portés par la preuve. Elle porte sur les **ajouts observés**, jamais sur le contenu
final — distinction à ne pas perdre.

## 4 — Sortie A contre B, sur des Records RÉELS

```
A — HO-LFv_IrTSxxmE
    Processus observé
    3 min (du premier au dernier fait) · 2 sessions · 94 événements
    +718 caractères saisis
      Ajouts répartis sur 94 événements ; le plus important en représente 2 %.

B — HO-orC8-d5B4tHn
    Processus observé
    5 s (du premier au dernier fait) · 6 événements
    +133 caractères ajoutés dont l'origine n'a pas pu être déterminée — 90 % des ajouts observés
      Cela peut notamment correspondre à un collage, un import, une macro, un complément
      tiers ou un autre mécanisme non observé.
    +15 caractères saisis · 2 retours sur un passage
      Ajouts répartis sur 3 événements ; le plus important en représente 54 %.

C — HO-P-vCflK7ZUDy
    Processus observé
    — · 1 événement
    +87 caractères ajoutés dont l'origine n'a pas pu être déterminée — 100 % des ajouts observés
      La totalité des ajouts est arrivée en un seul événement.
```

La différence vient de trois choses, et d'aucune note : les **faits**, la **hiérarchie** — le
fait dominant passe en premier, décidé en comparant deux nombres, pas par un seuil — et la
**chronologie**.

Pas de phrase qualitative du type « très peu d'évolution observée » : elle exigerait une règle à
seuil. La ligne de concentration dit la même chose en restant une mesure.

## 5 — Garde-fou

`test_couche_factuelle.mjs` — **13 contrôles, PASS.** La couche vivant hors du graphe, elle ne
bénéficie plus de `FORBIDDEN_INFERENCES` : ce banc remplace cette protection.

Il interdit dans la sortie de la couche tout mot de jugement (score, effort, mérite,
authenticité, humain, IA, probabilité, verdict, note, suspect, collage, plagiat…), toute clé
ressemblant à un score, tout booléen de verdict ; et il verrouille la définition du retour après
détour, la règle « une absence n'est pas un zéro », la déclaration de la qualité de la durée, et
l'absence de ratio de contenu final.

**Nuance à ne pas confondre** : le mot « collage » est interdit dans la **couche**. Il reste
autorisé dans la **phrase d'explication secondaire** du rendu, telle qu'arbitrée — parce qu'elle
énumère des possibilités sans en établir aucune.

## 6 — Risques ouverts

1. **Marge du seuil étroite** : 10 caractères au-dessus de la frappe réelle, 3 en dessous du plus
   petit apport massif.
2. **Cadence Word non mesurée sur Windows** ni sur document volumineux. La sûreté du seuil en
   dépend directement.
3. **La couche est hors du graphe** : rien dans l'architecture n'empêche d'y glisser un jugement
   plus tard. Seul le banc le tient. Il doit rester obligatoire.
4. **Lecture du pourcentage d'ajouts indéterminés** : « 90 % des ajouts observés » est un fait,
   mais sera lu comme une note si la mise en page le met en exergue seul. La formulation doit
   rester descriptive.

## 7 — Prochaine étape proposée

Promouvoir la couche et son banc dans `humanorigin-web` sur une branche dédiée, puis concevoir
la zone haute de Verify. Rien n'est promu pour l'instant : le worktree
`HO_VERSIONING_V1/humanorigin-web` est la source d'expédition du volet et porte des
modifications en cours ; y créer une branche demande une décision.
