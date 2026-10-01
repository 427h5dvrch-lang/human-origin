# Demande du motif d'échec — texte prêt, NON envoyé

Deux versions du même message. **Rien n'a été publié ni soumis.** Philippe décide.

Commencer par la **version gratuite**. La version payante n'a de sens que si la première
reste sans réponse après environ une semaine, et elle suppose un plan de support à
~29 $/mois qui demande son accord explicite.

---

## Version 1 — Microsoft Q&A (gratuit)

À publier sur `learn.microsoft.com/answers`, étiquettes **Azure Artifact Signing** /
**Trusted Signing**.

> **Titre :** Organization identity validation failed twice with no reason — French SASU,
> need the vetting failure reason
>
> Two Public/Organization identity validations for the same French company have come back
> **Failed**, with no reason shown in the portal and none in the notification email. No
> certificate profile is linked to either. I understand the reason sits with Vetting
> Operations and is not exposed in the portal, so I am asking for it here.
>
> **Validation IDs**
> - `4e61c664-81b3-4b61-8cba-a0464899c9f7`
> - `b082c3b7-42f7-4873-a44e-d412f0e37094`
>
> **Artifact Signing account:** `humanorigin-signing`, resource group
> `rg-humanorigin-signing`, region North Europe.
> **Subscription ID:** `eeb88305-899b-4de0-9908-c06403d3ea7d`
>
> **The organization**
> - Legal name: DAZEAS CORP
> - Legal form: SASU (French simplified joint-stock company, single shareholder)
> - Country: France
> - Business identifier: SIREN 939445821 / SIRET 93944582100019
> - Registered address: 22 Vallon de la Baudille, 13007 Marseille, France
> - Active since: 15 November 2024 — i.e. about 1 year and 10 months
> - Website: https://humanorigin.io
>
> **What I would like to know**
>
> 1. **The actual failure reason** for either or both validation IDs. Without it I would
>    only be guessing at a third submission.
> 2. **Is there a minimum company age** for Public Trust organization validation? The
>    published prerequisites do not mention one, and I have seen a Microsoft reply stating
>    there are "no minimum org age restrictions". But several threads report that vetting
>    cannot proceed for organizations under three years old. My company is under two years
>    old, so I need a clear answer before resubmitting — if age is the blocker, no amount
>    of corrected paperwork will help.
> 3. **What value is expected in the State/Province field for a French address?** France
>    has no direct equivalent. Should I use the département (Bouches-du-Rhône), the région
>    (Provence-Alpes-Côte d'Azur), or leave it empty? This field appears on the
>    certificate subject, so I would rather not guess.
> 4. **What is accepted as proof that the website belongs to the legal entity**, when the
>    domain was registered and invoiced in the founder's personal name before the company
>    was formed? Is a domain transfer or a re-issued invoice in the company name required?
>
> **What I already know and have corrected**
>
> On the second request, both the primary and secondary email were the same personal
> Gmail address. I now have `admin@humanorigin.io` and `contact@humanorigin.io` on the
> company domain, both verified to receive external mail with working clickable links. I
> am not assuming this was the cause of the failures — I would rather fix what actually
> failed than guess.
>
> I understand from the Quickstart that a new request is required for any change, so I am
> deliberately **not** creating a third one until I know why the first two failed.

---

## Version 2 — cas de support Azure (exige un plan payant)

Même contenu, dans le formulaire de création de cas.

**Type de problème :** Trusted Signing / Artifact Signing → Identity Validation -
Organization
**Gravité :** C (impact faible) — la gravité supérieure n'accélérera rien sur un dossier
de vérification.

**Titre :**

```
Organization identity validation failed twice, no reason surfaced — DAZEAS CORP (FR)
```

**Corps :**

```
Two Public/Organization identity validations have failed with no reason shown in the
portal and none in the notification email. No certificate profile is linked to either.

Validation IDs:
  4e61c664-81b3-4b61-8cba-a0464899c9f7
  b082c3b7-42f7-4873-a44e-d412f0e37094

Account: humanorigin-signing / rg-humanorigin-signing / North Europe
Subscription: eeb88305-899b-4de0-9908-c06403d3ea7d

Organization:
  Legal name        DAZEAS CORP
  Legal form        SASU (France)
  SIREN             939445821
  SIRET             93944582100019
  Registered office 22 Vallon de la Baudille, 13007 Marseille, France
  Active since      2024-11-15
  Website           https://humanorigin.io

Requests:
  1. The failure reason held by Vetting Operations for either validation ID.
  2. Whether a minimum company age applies to Public Trust organization validation.
     The published prerequisites do not state one; community threads report a
     three-year threshold. This company is under two years old. If age is the
     blocker, a corrected resubmission cannot succeed and I need to know that now.
  3. The expected State/Province value for a French registered address.
  4. What is accepted as proof the website belongs to the legal entity when the
     domain was registered in the founder's personal name before incorporation.

I have not created a third validation request, and will not until I know why the
first two failed.
```

> **Note sur le champ « Décrivez brièvement le problème »** : il n'a pas accepté un collage
> lors d'une tentative précédente. Ne pas s'acharner — saisir une ligne courte au clavier,
> par exemple `Organization identity validation failed twice, no reason given`, et placer
> le texte complet dans le champ de description détaillée de l'étape suivante.

---

## Pièces à joindre, si elles sont demandées

| Pièce | État |
|---|---|
| Avis de situation INSEE | téléchargé le 01/10/2026 |
| Extrait Kbis de moins de 3 mois | **à récupérer** sur `procedures.inpi.fr` |
| Preuve de propriété du domaine | **problème ouvert** — la facture Hostinger est au nom de Dazeas Philippe, pas DAZEAS CORP |

Ne rien joindre spontanément à la première demande : le but est d'obtenir un motif, pas
d'ouvrir une instruction. Et le compteur de **trois tentatives** de dépôt de pièces ne se
déclenche que si Microsoft en demande — inutile de l'entamer de soi-même.
