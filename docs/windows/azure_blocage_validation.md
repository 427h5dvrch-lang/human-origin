# Validation d'organisation DAZEAS CORP — deux échecs, et ce qu'on en sait

État au 2026-10-01. **Je n'ai pas accès au navigateur** : rien de ce qui suit n'a été
constaté dans le portail. Tout vient des données que Philippe a relevées, de la
documentation Microsoft et des fils de support publics.

## Les deux demandes en échec

| Identifiant | Nom soumis | Statut |
|---|---|---|
| `4e61c664-81b3-4b61-8cba-a0464899c9f7` | dazeas corp | Failed |
| `b082c3b7-42f7-4873-a44e-d412f0e37094` | Dazeas Corp | Failed |

Aucun motif n'est visible, et ce n'est pas une anomalie d'affichage. Un intervenant
Microsoft l'écrit noir sur blanc :

> « The failure reason isn't surfaced in the portal or the notification email. It sits
> with **Vetting Operations** and isn't exposed outside that team. »

Le motif ne s'obtient donc que par un canal humain. Aucune inspection du portail, par moi
ou par Philippe, ne le révélera.

## Hypothèse principale : l'ancienneté de l'entité

C'est la piste la plus étayée, et elle n'a rien à voir avec les adresses e-mail.

**DAZEAS CORP est active depuis le 15/11/2024.** Au 01/10/2026, cela fait **685 jours,
soit 1 an et 10 mois**.

Plusieurs fils de support Microsoft rapportent que les équipes de vérification **ne
peuvent pas instruire une organisation de moins de trois ans**, l'ancienneté étant établie
par l'historique fiscal ou l'immatriculation. Un cas d'échec documenté est explicitement
attribué à une société immatriculée depuis moins de trois ans.

Le seuil de trois ans serait atteint vers le **15/11/2027** — dans environ 13 mois.

**Ce qui contredit cette hypothèse, et qu'il faut dire aussi :** les prérequis officiels
ne mentionnent **aucune** condition d'ancienneté, et un employé Microsoft répond
explicitement, à propos d'une société créée en 2025, « Artifact Signing has
country/region onboarding pre-reqs, **no minimum org age restrictions** ».

La règle vient des exigences de validation OV du CA/Browser Forum, que l'autorité
applique. Une entité jeune n'est pas exclue par un texte, mais peut l'être en pratique —
avec, parfois, la possibilité de compenser par des pièces complémentaires. **Seul le motif
réel, détenu par Vetting Operations, tranchera.**

## Les autres causes possibles, non écartées

Aucune n'est à présenter comme certaine.

1. **Lien de vérification expiré.** Le courriel part vers la primary et le lien **expire
   en sept jours**. S'il n'a pas été suivi, la demande échoue sans autre explication.
   C'est la cause la plus fréquemment citée.
2. **Rapprochement impossible avec les registres publics.** Le nom soumis a varié entre
   les deux demandes — « dazeas corp » puis « Dazeas Corp » — alors que la dénomination au
   registre est vraisemblablement **DAZEAS CORP**. L'écart de casse n'est probablement pas
   déterminant, mais l'adresse et l'identifiant doivent correspondre à l'INSEE au
   caractère près.
3. **Trois tentatives de dépôt de pièces épuisées**, si des documents avaient été demandés.
4. **Les deux adresses identiques.** Sur la seconde demande, primary et secondary étaient
   toutes deux `dazeas.philippe@gmail.com`. Microsoft exige deux adresses **distinctes**,
   sur un domaine **détenu par l'entité** — `gmail.com` n'appartient pas à DAZEAS CORP.
   C'est une non-conformité **réelle et vérifiable**, mais rien ne prouve qu'elle soit la
   cause du refus : elle aurait dû, en principe, bloquer la création de la demande.

## Changer la primary d'une demande existante : vérifié

La question était de savoir s'il fallait passer par le support plutôt que créer une
troisième demande. **La documentation est explicite dans l'autre sens** :

> « If you need to make any changes after it's created, you must complete a **new identity
> validation request**. This change affects the associated certificates that are being
> used for signing. »

Un intervenant Microsoft le confirme : « A new identity validation request. The Quickstart
is explicit that any change after creation requires one. »

**Conclusion : la primary d'une demande existante ne se modifie pas.** Mais cela ne veut
pas dire qu'il faut créer la troisième demande tout de suite — voir ci-dessous.

## Pourquoi ne PAS créer une troisième demande maintenant

Si l'hypothèse de l'ancienneté est juste, une troisième demande échouera exactement comme
les deux précédentes, sans plus d'explication, et aura consommé du temps.

**L'ordre utile est donc : obtenir le motif d'abord, soumettre ensuite.**

## Obtenir le motif — et le coût

Deux voies.

### Voie gratuite, à tenter d'abord : Microsoft Q&A

`learn.microsoft.com/answers`, étiqueté Trusted Signing / Artifact Signing. Les fils
consultés montrent des intervenants Microsoft qui demandent l'identifiant de validation et
font remonter à Vetting Operations. C'est le canal où les motifs finissent par sortir.

Coût : nul. Délai : variable, quelques jours.

### Voie payante : cas de support Azure

C'est le canal documenté pour ce type de blocage. **Il exige un plan de support payant** —
le plan Developer, autour de **29 $/mois**. Le plan Basic, gratuit, ne couvre que la
facturation et la gestion d'abonnement, pas le support technique.

**⛔ Je n'engage pas cette dépense.** Elle demande l'accord explicite de Philippe, et elle
n'a de sens que si la voie gratuite n'aboutit pas.

## L'aperçu exact du sujet de certificat

Tel qu'il apparaîtra si la validation aboutit, et tel qu'il faut le contrôler dans
*Certificate subject preview* **avant** de valider quoi que ce soit :

```
CN = DAZEAS CORP
O  = DAZEAS CORP
L  = Marseille
S  = <à déterminer — voir ci-dessous>
C  = FR
```

Avec, en option, la rue et le code postal si les cases correspondantes sont cochées :
`22 Vallon de la Baudille` et `13007`.

**Un point ouvert sur le champ `S` (State/Province).** Le formulaire Microsoft le demande,
mais la France n'a pas d'équivalent direct. Deux valeurs plausibles :
**Bouches-du-Rhône** (département) ou **Provence-Alpes-Côte d'Azur** (région). Ce champ
apparaît sur le certificat, donc dans ce que Windows affiche. Il figure dans la demande de
motif, pour que Microsoft indique la valeur attendue plutôt que de la deviner.

## État des pièces

| Pièce | État |
|---|---|
| Dénomination sociale exacte | **à vérifier** — « DAZEAS CORP » retenu, à confirmer sur l'avis INSEE |
| SIREN `939445821` | fourni par Philippe, **non vérifié** par moi |
| SIRET `93944582100019` | idem |
| Adresse `22 Vallon de la Baudille, 13007 Marseille` | idem |
| Avis INSEE | **téléchargé** le 01/10/2026 par Philippe — je ne l'ai pas lu |
| Date d'activité 15/11/2024 | relevée sur l'avis par Philippe |
| Extrait Kbis | **non récupéré** |
| Preuve de domaine | **non récupérée** — facture HCY-19809076 au nom de *Dazeas Philippe*, **pas DAZEAS CORP** |

### La preuve de domaine est un problème à part

La facture Hostinger est au nom personnel de Philippe. Or Microsoft exige que le site web
déclaré **appartienne à l'entité légale**. Une facture de domaine au nom d'une personne
physique ne prouve pas que `humanorigin.io` appartient à DAZEAS CORP — elle prouve le
contraire.

Si une pièce de domaine est demandée, c'est une faiblesse réelle du dossier. La corriger
suppose de passer les données de facturation Hostinger au nom de DAZEAS CORP, puis
d'obtenir une facture à ce nom — ce qui n'a **pas** été fait, et que je ne ferai pas sans
instruction : cela touche au compte registrar du domaine de production.

## État des e-mails

| | Adresse | État |
|---|---|---|
| Primary | `admin@humanorigin.io` | réception externe et liens cliquables **testés et confirmés** par Philippe |
| Secondary | `contact@humanorigin.io` | idem |

**Réserve à ne pas masquer :** `admin@` est un **alias** de `philippe@humanorigin.io`.
Deux boîtes véritablement indépendantes ne sont pas établies. Microsoft exige deux adresses
distinctes sur le domaine de l'entité ; un alias et sa boîte cible peuvent être considérés
comme une seule et même boîte. **Cette exigence n'est pas remplie de façon certaine.**

## État de l'abonnement Azure

| | Valeur | État |
|---|---|---|
| Compte connecté | `dazeas.philippe@gmail.com` | **compte personnel**, pas une adresse de l'entité |
| Abonnement | AZUR subscription 2 — `eeb88305-899b-4de0-9908-c06403d3ea7d` | existe |
| Type exact (Pay-As-You-Go ?) | — | **non vérifié** |
| Facturation au nom de DAZEAS CORP | — | **non vérifié** |
| Groupe de ressources | `rg-humanorigin-signing` | existe |
| Compte Artifact Signing | `humanorigin-signing`, **North Europe** | existe |
| Rôle *Artifact Signing Identity Verifier* | — | **non vérifié** |

North Europe convient : la région fait partie de celles où le service est disponible. Il
n'y a **aucune raison de recréer quoi que ce soit** pour passer en West Europe.

Deux points méritent attention. Le compte de facturation doit être de type
**Organisation** et au nom de DAZEAS CORP : ce n'est pas exigé pour la validation
d'organisation, mais une facturation au nom d'un particulier, sur un compte Gmail, à côté
d'une demande au nom d'une société, n'aide pas un dossier déjà fragile. Et le rôle
*Identity Verifier* doit être porté par le compte : sans lui, le bouton de création reste
grisé — c'est le blocage le plus fréquent à cette étape.
