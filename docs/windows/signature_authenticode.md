# Signature Windows — ce qui bloque, et ce qu'il faut acheter

Préparé le 2026-10-01. **Aucun achat n'a été engagé.**

## Où en est le produit sans signature

L'installateur se construit et s'installe. Ce qui change sans signature, c'est l'accueil
que Windows lui réserve :

- **SmartScreen** affiche « Windows a protégé votre ordinateur » au premier lancement de
  l'installateur. L'utilisateur doit cliquer *Informations complémentaires* puis
  *Exécuter quand même*. Beaucoup s'arrêtent là.
- L'éditeur s'affiche **« Éditeur inconnu »** dans la boîte de dialogue.
- Certaines politiques d'entreprise et certains antivirus bloquent purement l'exécution
  d'un binaire non signé téléchargé depuis Internet.

Pour une bêta privée distribuée à des personnes prévenues, c'est franchissable. Pour une
bêta publique, non.

## Les deux certificats possibles

> **Correction du 2026-10-01.** Une version antérieure de ce document affirmait qu'un
> certificat EV supprime l'avertissement SmartScreen dès la première signature. **C'est
> faux.** Microsoft a retiré ce comportement en 2024 : un fichier signé EV passe désormais
> par le même processus de construction de réputation qu'un fichier signé OV. Voir
> « Ce que la signature ne fait pas » plus bas.

| | OV (Organization Validation) | EV (Extended Validation) |
|---|---|---|
| Réputation SmartScreen | se construit avec la diffusion réelle | se construit aussi, un peu plus vite en pratique |
| Stockage de la clé | jeton matériel ou HSM cloud (obligatoire depuis juin 2023) | jeton matériel ou HSM cloud |
| Validation | entité légale vérifiée | entité légale + vérification renforcée |
| Ordre de prix annuel | ~200–400 € | ~350–700 € |
| Signature en CI | possible via HSM cloud (Azure Trusted Signing, DigiCert KeyLocker, SSL.com eSigner) | idem |

Depuis juin 2023, **aucune autorité ne délivre plus de certificat de signature de code
sous forme de simple fichier `.pfx`**. La clé doit vivre dans un jeton matériel ou un HSM
cloud. Un jeton physique ne se branche pas sur un runner GitHub : pour signer en CI, il
faut un service HSM cloud.

## Option recommandée : Azure Trusted Signing

C'est celle qui convient à la situation — facturation à l'usage plutôt qu'au certificat,
et conçue pour la CI.

- Environ **9 $ par mois**, sans jeton matériel à acheter.
- Signe depuis GitHub Actions via l'action officielle `azure/trusted-signing-action`.
- Donne une réputation SmartScreen de niveau OV.
- Exige une **entité légale vérifiable, existant depuis au moins 3 ans** — c'est le point
  à vérifier en premier pour HumanOrigin. Si l'entité est plus récente, Microsoft propose
  un parcours de validation alternatif, plus long.

Alternatives si l'ancienneté bloque : SSL.com eSigner ou DigiCert KeyLocker, plus chers
(certificat + service de signature), sans condition d'ancienneté comparable.

## Ce que la signature ne fait pas

**Signer ne garantit pas la disparition de l'avertissement SmartScreen.** C'est le point
qu'il ne faut pas se raconter, ni raconter aux testeurs.

SmartScreen ne juge pas seulement le certificat : il juge la **réputation**, c'est-à-dire
la télémétrie accumulée par ce fichier précis, par ce certificat, et par l'URL qui le
distribue. Un installateur fraîchement signé, téléchargé par quelques dizaines de
personnes, reste « peu répandu » et peut continuer d'afficher « Windows a protégé votre
ordinateur ».

Ce qui change avec la signature :

- l'éditeur affiché devient **DAZEAS CORP** au lieu de « Éditeur inconnu » ;
- la réputation peut **commencer** à s'accumuler, ce qui est impossible sans signature ;
- les stratégies d'entreprise qui bloquent tout binaire non signé cessent de bloquer.

Ce qui ne change pas tout de suite : l'avertissement lui-même, qui s'efface avec la
diffusion, sur des semaines.

**Un risque réel et documenté** : en mars 2026, Artifact Signing a changé d'autorité
intermédiaire sans préavis. Des fichiers signés sous la nouvelle autorité ont vu leur
réputation SmartScreen repartir de zéro, alors que des installateurs identiques signés
sous l'ancienne passaient sans avertissement. Le problème a été rapporté à plusieurs
reprises sur le forum Microsoft. À connaître avant de promettre quoi que ce soit sur une
date de disparition de l'avertissement.

## Ce qu'il faudra brancher ensuite

Une fois le certificat obtenu, trois choses :

1. Les secrets GitHub du fournisseur retenu (pour Azure Trusted Signing : identité de
   l'application Azure, compte et profil de certificat).
2. Une étape de signature dans `release.yml`, après le bundle NSIS, avant l'upload.
3. Le contrôle post-build correspondant : `Get-AuthenticodeSignature` doit retourner
   `Valid`, et l'horodatage doit être présent — sans horodatage, la signature expire avec
   le certificat et les installateurs déjà distribués deviennent invalides.

## Décision attendue de Philippe

1. L'entité légale HumanOrigin existe-t-elle, et depuis quand ?
2. OV via Azure Trusted Signing (~9 $/mois) ou EV (SmartScreen immédiat, ~350–700 €/an) ?
3. La bêta privée part-elle **non signée** en attendant, avec une consigne écrite
   expliquant l'avertissement SmartScreen aux testeurs ?

Tant que ces réponses manquent, l'installateur reste non signé : c'est la seule gate du
chantier Windows qui ne peut pas être franchie sans lui.
