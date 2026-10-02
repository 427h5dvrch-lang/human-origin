# Beta Analytics V1 — audit avant déploiement

**Rien n'est implémenté. Rien n'est déployé.** Ce document dit, métrique par métrique, ce
qu'il faudrait pour la mesurer et ce que cela coûterait. Deux métriques sont recommandées
à l'abandon.

## État de départ, vérifié dans le code

**Aucune mesure n'existe aujourd'hui.** La landing n'a ni script d'analytics, ni balise,
ni appel sortant, et sa CSP est `default-src 'none'` **sans `connect-src`** : toute mesure
côté landing exigerait de l'assouplir.

Trois faits d'architecture changent le coût de plusieurs métriques :

**Verify interroge déjà le registre.** La page fait `GET registry.humanorigin.io/r/<id>`
pour obtenir le Record. Le registre **voit donc déjà chaque ouverture**, par construction,
et c'était vrai avant toute discussion d'analytics. Ce n'est pas une surveillance que nous
ajouterions : c'est une conséquence de l'architecture, qu'il faut nommer honnêtement.

**L'identifiant de la démo publique est une constante connue**, inscrite en clair dans la
landing. Distinguer un vrai Record de la démo est donc une comparaison à une constante,
côté serveur, sans jamais conserver d'identifiant.

**La réservation d'identifiant authentifie déjà l'utilisateur et stocke la réservation.**
`ho_private.record_write_reservations` contient `(record_id, account_id, created_at)`,
pour appliquer un quota — une nécessité technique, pas une mesure. La donnée de rétention
existe donc déjà.

**La CSP de Verify autorise `connect-src 'self' https://registry.humanorigin.io`.** Une
question facultative pourrait renvoyer sa réponse à cette origine **sans modifier la CSP**.

---

## 1 · Première preuve finalisée

| | |
|---|---|
| **Besoin** | quelqu'un franchit-il le parcours en entier |
| **Donnée** | première réservation aboutie par compte |
| **Mécanisme** | agrégat en base sur `record_write_reservations`, exécuté côté serveur |
| **Linkabilité créée** | **aucune** — la table existe pour le quota, la requête ne sort qu'un nombre |
| **Rétention** | aucune nouvelle ; la table a déjà la sienne |
| **Restera inconnu** | qui, quel document, et si l'usage était réel ou un essai |

**Réserve** : une réservation n'est pas une preuve finalisée. Voir § 3.

## 2 · Erreurs techniques avant finalisation — **abandon recommandé**

| | |
|---|---|
| **Besoin** | où les gens se bloquent |
| **Donnée** | les causes typées existent déjà : `finalizer_incident.json`, écrit **localement**, sans secret ni chemin complet |
| **Mécanisme** | les agréger supposerait de les **envoyer depuis l'application** |
| **Linkabilité créée** | de la télémétrie d'application de bureau, là où il n'y en a aucune |
| **Rétention** | nouvelle, et à gouverner indéfiniment |

**Recommandation : ne pas collecter automatiquement.** Créer un canal de télémétrie
desktop pour un pilote de vingt personnes est hors de proportion, et une fois ouvert il ne
se referme pas. Le fichier d'incident est déjà typé et déjà lisible : pendant le pilote, il
se demande aux testeurs, qui sont nommés et joignables. Vingt personnes, c'est assez petit
pour demander ; c'est précisément ce qui rend la télémétrie inutile ici.

Si la décision est prise plus tard d'en créer une, ce sera son propre ticket, avec son
propre consentement.

## 3 · Deuxième preuve à J7 / J30

| | |
|---|---|
| **Besoin** | l'usage se répète-t-il, ou était-ce une curiosité |
| **Donnée** | horodatages des réservations par compte — **déjà présents** |
| **Mécanisme** | requête d'agrégation en base : part des comptes dont la 2ᵉ réservation survient à ≤ 7 j / ≤ 30 j de la 1ʳᵉ |
| **Linkabilité créée** | **aucune** — aucun identifiant nouveau, aucun cookie, aucune empreinte, rien dans les analytics |
| **Rétention** | aucune nouvelle |
| **Restera inconnu** | si la 2ᵉ réservation a donné une preuve finalisée, et si les documents visaient des destinataires différents |

**La métrique moins précise que vous avez acceptée d'avance, et il faut l'appeler par son
nom :** c'est une **deuxième réservation**, pas une deuxième preuve. Une réservation
jamais finalisée la gonfle.

Mesurer la finalisation exigerait de joindre l'état du registre à l'identité du compte —
deux systèmes aujourd'hui séparés. **C'est exactement la liaison à ne pas créer.** Le
nom de la métrique doit donc dire « réservation », partout, y compris dans les comptes
rendus internes, sans quoi le glissement se fera tout seul.

## 4 · `verify_open_real_record`

| | |
|---|---|
| **Besoin** | une preuve est-elle consultée |
| **Donnée** | une requête `GET /r/<id>` — **déjà reçue** par le registre |
| **Mécanisme** | dans la fonction qui sert déjà ces requêtes : comparer l'identifiant à la constante de démo, incrémenter l'un de deux compteurs |
| **Linkabilité créée** | **aucune si l'on ne stocke que des compteurs** |
| **Rétention** | deux entiers |
| **Restera inconnu** | **qui a ouvert** |

**Point d'attention qui n'est pas une analytics mais la concerne** : les journaux de la
plateforme qui héberge le registre enregistrent les URL, donc les identifiants de Record.
Cela existe aujourd'hui, indépendamment de toute mesure. Il faut en vérifier la durée de
conservation et la réduire si elle est longue — c'est une correction d'hygiène à faire
*avant* d'ajouter quoi que ce soit, pas à cause de ce qu'on ajoute.

**Sémantique, non négociable** : l'événement s'appelle `verify_open_real_record`. Jamais
« ouverture par destinataire », jamais « consultation externe ». Le rôle, s'il est demandé,
est une donnée distincte et facultative.

## 5 · Compréhension dans Verify

| | |
|---|---|
| **Besoin** | les limites sont-elles comprises, ou la preuve est-elle sur-lue |
| **Donnée** | une réponse à un choix, et le fait que la question a été **affichée** |
| **Mécanisme** | question après affichage de la preuve ; réponse envoyée à l'origine du registre, **déjà autorisée par la CSP de Verify** |
| **Linkabilité créée** | **aucune si l'envoi ne contient que `{choix, est_demo}`** — surtout pas l'identifiant du Record |
| **Rétention** | compteurs par choix |
| **Restera inconnu** | qui a répondu, et si la même personne a répondu deux fois |

Quatre choix, dont trois testent une confusion précise :

- *entièrement écrit par un humain, sans IA* — la sur-lecture que nous craignons
- *certains éléments du processus ont été observés, avec des limites* — la seule exacte
- *l'exactitude des affirmations du document* — la confusion avec la véracité du contenu
- *je ne sais pas*

**Ordre aléatoire** : simple à faire, et nécessaire — sans cela, la position de la bonne
réponse devient un indice.

**La réponse s'enregistre avant l'explication corrective.** Puis l'explication s'affiche :
la question sert à mesurer, pas à piéger, et personne ne doit repartir avec une idée fausse
parce que nous voulions une donnée propre.

**Rapporter toujours `n réponses / m personnes exposées`**, jamais un pourcentage seul. Un
taux de réponse bas est en soi un résultat.

## 6 · Utilité

Une seule question, `Oui / Non / Je ne sais pas`, même mécanisme, même absence de
linkabilité.

**Réserve d'exécution** : deux questions d'affilée feront chuter le taux de réponse des
deux. Je recommande de n'en afficher **qu'une par visite** — l'utilité seulement à ceux qui
ont déjà répondu à la compréhension, ou en alternance.

## 7 · Répétition du cycle preuve → Verify — **abandon recommandé**

| | |
|---|---|
| **Besoin** | le cycle se reproduit-il |
| **Donnée** | relier les Records d'un compte aux ouvertures de Verify |
| **Linkabilité créée** | **exactement la liaison que la doctrine interdit** : identité du compte ↔ consultations |

Il n'existe pas de version propre de cette métrique. Toute approximation — identifiant de
session, horodatages rapprochés, empreinte — reconstruit la liaison par un autre chemin.

**Recommandation : abandonner.** Pendant le pilote, la question se pose à l'auteur, qui est
nommé et joignable. La doctrine l'emporte sur la qualité de l'entonnoir, et c'est ici que
cela se décide concrètement.

---

## Le rôle, facultatif

Attaché à une ouverture : `creator / recipient_or_other / prefer_not_to_say`. Envoyé avec
`{role, est_demo}` et rien d'autre. Sans cette réponse, **aucune inférence** : une ouverture
reste une ouverture.

## L'alerte 3 / 30

Trois interprétations fausses parmi les trente premières réponses **déclenchent une revue
immédiate du wording**. Ce n'est pas une estimation de population, et le libellé de
l'alerte doit le dire, afin que personne ne lise « 10 % des utilisateurs comprennent mal ».

## Bilan

| Métrique | Verdict | Linkabilité nouvelle |
|---|---|---|
| 1 · première preuve | faisable | aucune |
| 2 · erreurs techniques | **abandon de la collecte automatique** | — |
| 3 · deuxième réservation J7/J30 | faisable, moins précise | aucune |
| 4 · `verify_open_real_record` | faisable | aucune |
| 5 · compréhension | faisable | aucune |
| 6 · utilité | faisable | aucune |
| 7 · répétition du cycle | **abandon** | — |

Cinq métriques sur sept sont réalisables **sans créer la moindre liaison nouvelle**, parce
que les données nécessaires existent déjà pour des raisons techniques. Les deux autres sont
abandonnées : l'une exigerait une télémétrie de bureau, l'autre la liaison même que la
doctrine interdit.

**STOP avant production.** Rien n'est implémenté.
