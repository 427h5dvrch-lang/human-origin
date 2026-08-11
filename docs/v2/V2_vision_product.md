# HumanOrigin V2 — Vision produit

> Document fondateur interne. Ton froid, stratégique. Ne promet que ce qui est prouvable.
> Statut : blueprint (V2-0). Aucune implémentation engagée.

## 1. Énoncé de vision

**HumanOrigin est une couche universelle de preuve de travail humain observable.**

Elle ne juge pas *ce qu'est* un contenu (humain, IA, original, vrai). Elle enregistre localement **qu'un travail humain a été observé dans le temps** et le **relie à une version précise d'un artefact** (aujourd'hui un PDF ; demain d'autres médias).

La preuve est **positive** : elle atteste d'un **processus observé**, pas d'une absence. Elle est **locale et signée** par défaut ; sa publication est un choix explicite de l'utilisateur.

## 2. Ce que HumanOrigin prouve / ne prouve pas

| Prouve | Ne prouve pas |
|---|---|
| Des **périodes de travail** ont été **observées localement** | Que le contenu est « humain » ou « sans IA » |
| Ces périodes sont **reliées à une version précise** d'un document | L'**auteur unique** ou l'identité civile |
| Le tout est **signé localement** et **vérifiable** | L'**originalité** ou la **vérité** du contenu |
| L'artefact **a évolué** pendant l'observation | Qu'aucun outil (IA ou autre) n'a été utilisé |

**Positionnement clé** : HumanOrigin **n'est pas un détecteur d'IA**. Un détecteur d'IA fait une inférence probabiliste sur un contenu fini. HumanOrigin fournit une **trace de processus** vérifiable, indépendante du contenu. Les deux répondent à des questions différentes ; confondre les deux est le principal risque de marque (voir `V2_risks_and_non_negotiables.md`).

## 3. Pourquoi PDF-first n'est qu'un premier terrain

Le PDF a servi de **socle** parce qu'il est : (a) un artefact fini et versionnable, (b) hashable simplement, (c) porteur d'un marquage visuel (estampille + QR), (d) universel en diffusion. Il a permis de valider le **cœur** : observation → évidence → certificat signé → marquage → vérification.

Mais le PDF est un **cas particulier** d'un modèle plus général : *un humain travaille dans le temps sur un artefact qui évolue vers une version finale*. Ce modèle s'applique à l'image, la vidéo, l'audio, le code, et à des workflows créatifs entiers. La V2 **généralise le cœur** et ajoute des **adaptateurs par média**, sans réécrire la cryptographie.

## 4. Architecture conceptuelle (centre stable + adaptateurs)

- **Centre invariant** : moteur d'observation (activité humaine dans le temps), accumulation d'évidence, canonicalisation, signature (HO-JSON), vérification.
- **Adaptateurs par média** (périphérie) : (1) *détection de version* (comment reconnaître qu'un artefact a changé / a une version finale) ; (2) *marquage/liaison* (cartouche PDF, sidecar signé pour média non-marquable, métadonnées embarquées).

On ne refait jamais le noyau. On ajoute des adaptateurs autour d'un centre figé.

## 5. Cas d'usage (par domaine)

- **Documents / bureautique** : rapports, mémoires, contrats — preuve qu'un travail rédactionnel observé a produit *cette* version.
- **Journalisme** : preuve de processus éditorial sur un article/photo, reliée à la version publiée.
- **Photo** : preuve qu'une image a été *produite/éditée* pendant une session observée (pas une preuve d'« absence d'IA »).
- **Vidéo** : preuve de montage/production observé lié à un rendu final.
- **Audio / musique** : preuve d'une session de composition/enregistrement reliée à un mixdown.
- **Code / workflows** : preuve d'une session de développement/création observée liée à un état de dépôt ou un artefact.
- **Création professionnelle** (design, architecture) : preuve d'atelier reliée au livrable.
- **Éducation** : preuve qu'un travail a été réalisé sur une durée observée (soutien à l'intégrité, sans juger le contenu).
- **Plateformes** : brique de confiance intégrable (API/label) pour attester d'un processus, pas d'une vérité de contenu.

## 6. Frontière de crédibilité

HumanOrigin gagne sa crédibilité en **restant en-deçà de ce qu'elle peut prouver**. La règle : *toujours sous-promettre le sens de la preuve*. Le jour où le langage dépasse la preuve (« garanti humain »), la confiance publique devient non réversible et le produit se disqualifie.

## 7. Points ouverts

- Jusqu'où « observation » doit-elle capter sans devenir intrusive (vie privée) ?
- Une preuve de processus a-t-elle une valeur perçue suffisante hors contextes à enjeux (école, presse, contrats) ?
- Modèle économique : local gratuit + registre public/officiel payant ? (voir verifier).
