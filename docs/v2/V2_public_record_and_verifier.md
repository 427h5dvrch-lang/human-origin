# HumanOrigin V2 — Enregistrement public (Record) & Vérificateur

> Blueprint. Définit ce qu'un destinataire voit après scan du QR, et la frontière entre
> preuve locale et futur registre « officiel ». Aucune implémentation engagée.

## 1. Rôle de la page Record

Le QR de l'estampille pointe vers une **page publique de vérification (Record)**. Son rôle : permettre à un destinataire de **vérifier** une preuve sans installer d'outil, **sans exposer le contenu** de l'artefact.

La page Record **n'affirme rien sur le contenu**. Elle présente **factuellement** ce que la preuve signée contient.

## 2. Ce que voit un destinataire (après scan)

- **Statut de preuve** (langage sobre) : « Travail observé — preuve locale signée ».
- **Métadonnées minimales** : ID de preuve court, horodatage, empreinte de version (hash tronqué), type de média.
- **Vérification de signature** : indication que la signature Ed25519 est **valide** pour cette évidence canonicalisée.
- **Téléchargement `.ho.json`** : le certificat portable, re-vérifiable hors ligne par n'importe qui.
- **Avertissement explicite** (anti-claims) : ce que la preuve **ne** signifie **pas**.

**Jamais affiché** : contenu du document, chemins locaux, identité civile, détails fins d'activité.

## 3. États possibles de vérification

| État | Signification (sobre) |
|---|---|
| **Vérifiée** | Signature valide ; l'évidence correspond à la version référencée. |
| **Version différente** | Le fichier fourni ne correspond pas au hash de la preuve (document modifié après coup). |
| **Illisible / absente** | Aucune preuve valide trouvée. |

Aucun état ne porte de jugement sur la nature humaine/IA/originalité du contenu.

## 4. URL stable & portabilité

- **URL de Record stable** par preuve (identifiant durable), pour citation/partage long terme.
- La vérification **cœur** doit rester possible **hors ligne** via le `.ho.json` + clé publique : la page web est un confort, **pas** l'autorité. L'autorité est cryptographique.
- Migration de domaine (ex. `verify.humanorigin.io`) : traiter en P1, avec **redirections stables** pour ne pas casser les QR déjà émis. Ne jamais invalider un QR passé.

## 5. Langage public (règles)

- Factuel, sobre, non promotionnel. Ton « standard documentaire », pas « badge marketing ».
- Toujours accompagner le statut d'une **phrase de limite**.
- Autorisé : « travail observé », « preuve locale signée », « reliée à cette version », « vérifier les détails ».
- Interdit : « 100 % humain », « absence d'IA », « authenticité garantie », « auteur garanti », « originalité garantie », « certifié humain », « vérité du contenu ».

## 6. Preuve locale vs preuve « officielle » future

| Preuve **locale** (aujourd'hui) | Registre **officiel** (futur, optionnel) |
|---|---|
| Signée par la clé de l'appareil | Contresignée par un service HumanOrigin |
| Vérifiable hors ligne | Ancrée dans un registre horodaté central |
| Aucune dépendance réseau | Ajoute une **autorité tierce** et une **non-répudiation** renforcée |
| Défaut, gratuit, privé | Opt-in ; potentiel modèle économique |

**Non-négociable** : la preuve locale reste **pleinement valable seule**. Le registre officiel **ajoute** une garantie (horodatage tiers, contreseing), il ne **remplace** pas et ne **déprécie** pas la preuve locale. Aucun verrouillage cloud du socle.

## 7. Points ouverts

- Contreseing : à quel moment introduire une autorité sans trahir le principe « local d'abord » ?
- Rétention : que garde le service côté Record (idéalement : seulement des empreintes/métadonnées, jamais le contenu) ?
- Révocation : peut-on/doit-on révoquer une preuve ? (probablement non — préférer « version différente » à la révocation).
- Multilingue de la page publique (crédibilité internationale).
