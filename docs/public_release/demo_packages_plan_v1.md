# Plan des packages de démonstration — V1

> Phrase boussole : **« HumanOrigin prouve que vous avez travaillé sur ce document — pas ce que vous avez écrit. »**
> Compass line: **“HumanOrigin proves you worked on this document — not what you wrote.”**

Objectif : permettre à un visiteur d'**inspecter une vraie preuve avant d'installer**, et de comprendre concrètement la différence entre les niveaux. Aucun de ces packages ne doit surpromettre.

---

## 🇫🇷 Français

### Pourquoi des packages de démo

- Montrer ce que reçoit réellement un destinataire.
- Démontrer l'honnêteté du produit : on publie aussi un cas « contribution non démontrée ».
- Permettre de tester le vérificateur public sans installer l'app.

### Packages à préparer

| Package | Cas | Ce qu'il illustre |
|--------|-----|-------------------|
| `DEMO_C_contribution_attestee` | Cas C | Document modifié pendant l'observation, volume suffisant → contribution attestée |
| `DEMO_B_lien_plausible` | Cas B | Document modifié mais volume insuffisant → lien plausible / preuve limitée |
| `DEMO_A_non_demontree` | Cas A | Document non modifié pendant l'observation → contribution non démontrée |

### Contenu de chaque package

Chaque package est un kit destinataire standard, identique à un envoi réel :

- `1_OPEN_FIRST.html`
- `README_START_HERE.txt`
- `2_SEND_TO_RECIPIENT/` (PDF marqué + fichier de preuve `.ho.json` + `README_SEND_FIRST.txt`)
- `3_TECHNICAL_PROOF_ARCHIVE/`
- `HumanOrigin_SEND.zip`

### Règles de préparation

1. Générer les 3 packages depuis l'app (export réel), pas à la main.
2. Vérifier chaque package avec le script de contrôle (disclaimer FR+EN présent, aucun bug de formulation).
3. Utiliser des documents **non sensibles** et **neutres** (texte d'exemple libre de droits).
4. Publier les 3 packages côte à côte avec une courte légende par cas.
5. Mettre en avant le **kit complet** (.zip) comme objet à télécharger, pas le PDF seul.

### Légendes publiques (à afficher à côté de chaque package)

- **Cas C** : « Document modifié pendant l'observation, avec un volume de travail suffisant. Contribution attestée. »
- **Cas B** : « Document modifié, mais volume insuffisant pour une attestation forte. Lien plausible, preuve limitée. »
- **Cas A** : « Le document n'a pas changé pendant l'observation. Activité humaine observée, mais contribution non démontrée. »

### Disclaimer à rappeler sous les démos

HumanOrigin ne détecte pas l'IA, ne certifie ni l'originalité ni la vérité du contenu, et ne prouve pas un auteur unique. Le document est traité localement ; son contenu n'est pas envoyé à HumanOrigin.

---

## 🇬🇧 English

### Why demo packages

- Show what a recipient actually receives.
- Demonstrate the product's honesty: we also publish a “contribution not demonstrated” case.
- Let people test the public verifier without installing the app.

### Packages to prepare

| Package | Case | What it illustrates |
|--------|------|---------------------|
| `DEMO_C_contribution_attested` | Case C | Document modified during observation, sufficient volume → contribution attested |
| `DEMO_B_plausible_link` | Case B | Document modified but volume insufficient → plausible link / limited proof |
| `DEMO_A_not_demonstrated` | Case A | Document not modified during observation → contribution not demonstrated |

### Contents of each package

Each package is a standard recipient kit, identical to a real send:

- `1_OPEN_FIRST.html`
- `README_START_HERE.txt`
- `2_SEND_TO_RECIPIENT/` (marked PDF + proof file `.ho.json` + `README_SEND_FIRST.txt`)
- `3_TECHNICAL_PROOF_ARCHIVE/`
- `HumanOrigin_SEND.zip`

### Preparation rules

1. Generate the 3 packages from the app (real export), not by hand.
2. Verify each package with the control script (FR+EN disclaimer present, no wording bug).
3. Use **non-sensitive**, **neutral** documents (royalty-free sample text).
4. Publish the 3 packages side by side with a short caption per case.
5. Highlight the **full kit** (.zip) as the object to download, not the PDF alone.

### Public captions (to display next to each package)

- **Case C**: “Document modified during observation, with a sufficient volume of work. Contribution attested.”
- **Case B**: “Document modified, but volume insufficient for a strong attestation. Plausible link, limited proof.”
- **Case A**: “The document did not change during observation. Human activity observed, but contribution not demonstrated.”

### Disclaimer to repeat under the demos

HumanOrigin does not detect AI, does not certify originality or factual truth, and does not prove sole authorship. The document is processed locally; its content is not sent to HumanOrigin.
