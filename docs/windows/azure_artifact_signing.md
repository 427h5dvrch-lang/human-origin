# Azure Artifact Signing — éligibilité réelle de HumanOrigin

Vérifié le 2026-10-01 contre la documentation officielle Microsoft, dont la page
*Quickstart: Set up Artifact Signing* mise à jour le 2026-09-29. **Aucun achat engagé,
aucun compte créé, aucune modification de la CI de production.**

Le service s'appelait Azure Code Signing, puis Trusted Signing, et désormais **Azure
Artifact Signing**. C'est le même produit ; les trois noms se croisent encore en ligne.

## Le point qui décide de tout

> « Public Trust certificates are available to organizations in the United States,
> Canada, **the European Union**, the United Kingdom, Australia, New Zealand, Japan,
> South Korea, Singapore, Switzerland, Norway, and Israel.
> **Individual developers must be located in the United States or Canada.** »

Deux conséquences immédiates :

**La voie « développeur individuel » est fermée.** Elle est réservée aux États-Unis et au
Canada. Depuis la France, elle n'existe pas — quelle que soit la pièce d'identité.

**La voie « organisation » est ouverte**, la France étant dans l'Union européenne. Elle
suppose une **entité légale**.

## La règle des 3 ans : à relativiser

La condition « trois ans d'historique fiscal vérifiable » circule partout. Je l'ai
cherchée dans les prérequis officiels : **elle n'y figure pas**. Sur le forum Microsoft,
un employé répond explicitement, à propos d'une société créée en 2025 :

> « Artifact Signing has country/region onboarding pre-reqs, **no minimum org age
> restrictions**. »

La réponse « 3 ans » visible sur la même page est générée automatiquement et signalée
comme possiblement incorrecte.

Ce qu'il faut en retenir sans se mentir : l'ancienneté de trois ans vient des règles de
validation OV du CA/Browser Forum, que l'autorité applique en pratique. Une entité plus
jeune n'est pas exclue d'office, mais on lui demandera des pièces complémentaires. Des
refus ont été rapportés pendant la préversion 2025. **Le risque est un allongement du
délai et des pièces à fournir, pas une impossibilité annoncée.**

## Ce qu'il faudra fournir

| Champ | Exigence | État côté HumanOrigin |
|---|---|---|
| Nom de l'organisation | l'entité légale elle-même | **à confirmer** |
| Site web | doit appartenir à cette entité | `humanorigin.io` — en place et servi |
| E-mail principal | boîte **surveillée**, sur un domaine détenu par l'entité | possible : la messagerie du domaine est chez Hostinger |
| E-mail secondaire | différent, même domaine | idem |
| Identifiant d'entreprise | SIREN / SIRET pour la France | **à confirmer** |
| Adresse | celle de l'entité légale | **à confirmer** |
| Représentant | prénom et nom exactement comme sur la pièce d'identité | Philippe |

Les deux boîtes doivent accepter les liens venant d'expéditeurs externes, et les liens
de vérification expirent en **sept jours**.

Si des pièces sont demandées : documents émis dans les **12 derniers mois**, avec une
date d'expiration à **au moins deux mois**, et **trois tentatives** de dépôt au maximum.

## Délai et coût

- **Validation d'identité : 1 à 20 jours ouvrés**, davantage si des pièces sont demandées.
- **Basic : 9,99 $/mois** — 5 000 signatures, 1 profil de certificat. Largement suffisant.
- Premium : 99,99 $/mois — 100 000 signatures, 10 profils. Sans objet ici.

Région Azure à choisir : **West Europe** ou **North Europe**, toutes deux disponibles.

## Private Trust : à écarter

Les certificats Private Trust n'ont aucune restriction géographique — ce qui les rend
tentants. Ils ne servent à rien ici : ils établissent la confiance à l'intérieur d'un parc
géré par stratégie, pas auprès de SmartScreen. Un installateur signé en Private Trust
afficherait le même avertissement.

## Verdict

**Éligibilité : conditionnée à un seul fait que je ne peux pas vérifier — l'existence
d'une entité légale HumanOrigin.**

- **S'il existe une société française** : éligible géographiquement, aucune barrière
  d'ancienneté documentée, 9,99 $/mois, 1 à 20 jours ouvrés. C'est la bonne voie.
- **S'il n'existe aucune entité** : Azure Artifact Signing est **fermé**, la voie
  individuelle étant réservée aux États-Unis et au Canada. Les options deviennent alors
  créer l'entité, ou passer par un certificat OV classique chez une autorité acceptant un
  dirigeant en nom propre — plus cher, avec jeton matériel ou HSM, donc plus lourd à
  brancher en CI.

## Action humaine nécessaire

Trois réponses de Philippe, dans cet ordre :

1. **Une entité légale HumanOrigin existe-t-elle ?** Si oui : forme, pays, SIREN, date de
   création.
2. **Une boîte aux lettres surveillée existe-t-elle sur `humanorigin.io` ?** Il en faut
   deux, distinctes, acceptant les liens externes.
3. **Un abonnement Azure existe-t-il**, et sous quel compte de facturation ?

Avec ces trois réponses, la suite est mécanique : enregistrer le fournisseur de
ressources, créer le compte, lancer la validation, attendre, créer le profil de
certificat, puis brancher la signature dans `release.yml`. Je n'engage rien avant.
