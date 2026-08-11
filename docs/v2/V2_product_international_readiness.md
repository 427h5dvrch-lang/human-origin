# HumanOrigin V2 — Audit produit international (PDF-first)

> Audit interne **brutal**, orienté produit. Pas de marketing. Objectif : passer d'une
> « Alpha PDF-first solide » à un « produit international simple, premium, autonome,
> crédible, diffusable ». V2 ici = **perfectionner le PDF-first**, pas ouvrir le multimodal.
> Statut : V2-1 (audit). Aucune implémentation engagée.

## 0. Résumé exécutif

HumanOrigin 0.1.28 a un **cœur crédible** (observation → preuve locale signée → cartouche B4 → vérification) et un **socle de distribution mûr** (DMG signé/notarisé/staplé). Ce qui manque n'est **pas** technique : c'est de la **compréhension**, de la **confiance perçue** et de la **diffusion**. Le produit est *fonctionnellement prêt*, pas encore *culturellement lisible* pour un inconnu international.

**Le vrai risque n'est pas que ça marche mal. C'est que personne ne comprenne pourquoi ça compte.**

## 1. Position actuelle (0.1.28)

**Déjà solide**
- Moteur de preuve : observation, périodes, évidence signée Ed25519, HO-JSON portable.
- Cartouche B4 : iconique, sobre, claims-clean, placement 1re page validé (PDFium réel).
- Panneau « État de création » : explique enfin le blocage (fragmentation).
- Distribution macOS : Developer ID + notarisation + stapling, Gatekeeper OK.
- Cadrage claims : lexique verrouillé, tests anti-claims.

**Encore alpha**
- Onboarding : suppose un guide de 5 min ; pas d'apprentissage **par design**.
- Notion de « preuve » : jamais expliquée en 1 phrase compréhensible par un non-initié.
- Page Record publique : basique ; l'expérience destinataire n'est pas conçue.
- Zéro internationalisation : tout FR, aucun EN.
- Friction observation : le modèle « enregistrer pendant l'observation continue » reste contre-intuitif (le panneau aide, mais le concept doit être *évident*, pas *expliqué*).
- Écran legacy résiduel (masqué) avec claims interdits (dette).

**Ce qui empêche un créateur autonome international de comprendre**
- Pas de réponse immédiate à « c'est quoi ? » et « pourquoi je ferais ça ? ».
- Vocabulaire produit (observation, période, version finale) sans métaphore claire.
- Tout est en français.

**Ce qui empêche un destinataire de faire confiance**
- L'estampille est belle mais **muette** sur ce qu'elle prouve/ne prouve pas.
- La page Record ne raconte pas une histoire de confiance sobre et internationale.
- Aucune marque/réputation encore : un inconnu n'a aucune raison d'accorder du crédit.

**Ce qui empêche une diffusion facile**
- DMG non distribuable par email (Gmail bloque `.dmg`) → dépend d'un lien Drive bricolé.
- Pas de landing page, pas de vidéo démo, pas de point d'entrée public crédible.
- Windows absent (pause).

## 2. Expérience créateur idéale (par étape)

| Étape | État actuel | Friction | Correction V2 | Priorité |
|---|---|---|---|---|
| Installation | DMG signé/notarisé | Gatekeeper 1er lancement ; `.dmg` non joignable | Page de téléchargement claire + instructions Gatekeeper illustrées | **P0** |
| Premier écran | Parcours V1 direct | Ne dit pas « c'est quoi / pourquoi » en 3 s | Écran d'accueil avec **1 phrase + 1 visuel** de la promesse | **P0** |
| Choix du document | « Choisir un PDF » | OK | RAS (léger : type de doc attendu) | P2 |
| Observation | Boutons 1→5 | Concept « observation » abstrait | Métaphore visuelle (un « enregistreur de session ») + micro-animation | **P1** |
| Sauvegarde finale | Panneau + guidance | Contre-intuitif (enregistrer *pendant*) | Rendre l'action **évidente par design** (pas juste par texte) ; détecter/guider en direct | **P0** |
| Création | Bouton + garde qual≥1 | OK depuis 0.1.28 | RAS | P2 |
| Quoi envoyer | « Partager le dossier » | Comprend-on qu'il faut le dossier entier ? | 1 écran final « voici ce que vous envoyez » explicite | **P1** |
| Compréhension de la preuve | Faible | « J'ai quoi au juste ? » | 1 phrase de preuve + lien Record | **P0** |

## 3. Expérience destinataire idéale (par étape)

| Étape | Ce qu'il comprend | Risque d'interprétation | Wording nécessaire | Confiance |
|---|---|---|---|---|
| Reçoit un PDF HumanOrigin | « Il y a un tampon » | « C'est officiel ? » | Sobre, non institutionnel | moyenne |
| Voit l'estampille | Marque + QR | « Certifié ? garanti humain ? » | « Travail observé — preuve locale signée » | **fragile** |
| Comprend en 3 s | Variable | Surinterprétation (anti-IA) | 1 ligne : ce que ça atteste / pas | faible→moyenne |
| Scanne le QR | Arrive sur Record | Page confuse = perte de confiance | Page Record **sobre, claire, multilingue** | à construire |
| Voit le Record | Statut + métadonnées | « Ça prouve quoi vraiment ? » | Statut factuel + **phrase de limite** explicite | **P0** |
| Sait ce qui est prouvé / non | Rarement | Le point de rupture de crédibilité | Bloc « ce que cela ne signifie pas » | **P0** |

**Le maillon faible = le destinataire.** Toute la valeur meurt si, après scan, il ne comprend pas *sobrement* ce qui est prouvé. La page Record est le chantier de confiance n°1.

## 4. Moteur de confiance perçu

| Niveau | État |
|---|---|
| **Confiance réelle du moteur** | Élevée (crypto correcte, vérifiable hors ligne, portable). |
| **Confiance perçue par le créateur** | Moyenne (il voit l'estampille, mais doute de ce que ça « vaut »). |
| **Confiance perçue par le destinataire** | Faible (inconnu, muet, pas de réputation). |

**Ce qui manque pour paraître sérieux / premium / international / non-gadget / non anti-IA-bullshit / non-startup-fragile :**
1. Une **page Record** au ton « standard documentaire international » (sobre, factuel, bilingue).
2. Un **langage de preuve** cohérent et répété partout (app, cartouche, Record, docs, site).
3. Une **phrase de limite** systématique (« ne détecte pas l'IA, ne certifie ni l'auteur ni l'originalité ») — c'est ce qui, paradoxalement, **augmente** la crédibilité.
4. Une **identité visuelle stable** (la plaque B4 comme emblème, palette crème/navy).
5. Un **point d'entrée public** crédible (landing sobre) plutôt qu'un lien Drive.
6. Zéro promesse au-delà du prouvable (la moindre dérive « garanti » détruit tout).

## 5. Internationalisation

| Élément | État | À internationaliser dès V2 ? |
|---|---|---|
| App (UI) | FR only | **Oui (FR/EN) — P1** |
| Cartouche | FR (« Travail observé ») | **Oui (FR/EN) — P1** (wording court, facile) |
| Page Record / verifier | FR basique | **Oui (FR/EN) — P0** (c'est la vitrine de confiance) |
| Guide testeur | FR | **Oui (FR/EN) — P1** |
| Site public | inexistant | EN d'abord, FR ensuite — P1 |
| Universalité du claim | « travail observé » traduit bien | OK — « observed work » |
| Compatibilité juridique | disclaimers sobres | Vérifier EN + juridictions (P1, revue) |

**Dès V2 :** page Record bilingue (P0) + cartouche bilingue (P1) + app EN (P1). **Peut attendre :** site multilingue riche, langues au-delà de FR/EN.

## 6. Ludicité / simplicité (froid)

- **Assez ludique aujourd'hui ?** Non. C'est un outil « sérieux » sans récompense émotionnelle.
- **Le moment magique ?** Il existe mais est **enfoui** : c'est l'instant où l'estampille apparaît sur *votre* document. Il faut le **mettre en scène** (écran de succès plus fort, aperçu immédiat de la plaque).
- **Ce qui doit devenir plus simple :** le concept « enregistrer pendant l'observation continue » — le rendre évident par l'interface, pas par un paragraphe.
- **Ce qui doit disparaître de l'écran :** tout reliquat legacy ; le jargon résiduel ; les étapes numérotées trop « techniques » (les rendre naturelles).
- **Ce qui doit être expliqué par design plutôt que par texte :** l'observation en cours (indicateur vivant), la nécessité de sauvegarder (invite contextuelle au bon moment), ce que contient le dossier final (aperçu visuel).

## 7. Diffusion

| Canal | État | Correction |
|---|---|---|
| DMG | signé/notarisé/staplé | OK technique |
| Installation macOS | glisser-déposer | OK ; documenter Gatekeeper visuellement |
| Confiance Gatekeeper | Notarized accepted | OK (fort atout — à mettre en avant) |
| Envoi (Gmail vs Drive) | `.dmg` bloqué Gmail | **Landing de téléchargement** (P1) au lieu du Drive bricolé |
| Pack testeur | prêt (0.1.27/0.1.28) | Bon ; à internationaliser |
| Landing page | inexistante | **P1** (point d'entrée crédible) |
| Vidéo démo | inexistante | **P1** (montre le moment magique en 30 s) |
| Onboarding | guide externe | Intégrer un onboarding **dans l'app** (P1) |
| Windows | pause (non signé) | **P2** (après entité légale pour signature) |

## 8. Score readiness (/10, honnête)

| Dimension | Note | Commentaire |
|---|---|---|
| Compréhension créateur | **5** | fonctionne avec guide ; pas encore autonome |
| Compréhension destinataire | **3** | maillon faible ; Record muet |
| Confiance perçue | **4** | moteur solide, perception faible |
| Beauté / premium | **6** | cartouche B4 forte ; reste de l'UI correct |
| Simplicité | **5** | parcours ok mais concept contre-intuitif |
| Diffusion | **4** | DMG ok, mais pas de point d'entrée public |
| International | **2** | tout FR |
| Robustesse produit | **7** | cold tests PASS, crypto saine |
| Potentiel plateforme | **7** | noyau généralisable (cf. blueprint) |
| **Moyenne** | **~4.8/10** | socle sérieux, produit international pas encore |

## 9. Top 10 des manques avant produit international

1. **Page Record publique** sobre, claire, **bilingue** — la vitrine de confiance (destinataire).
2. **Phrase de preuve unique** répétée partout + **phrase de limite** systématique.
3. **Internationalisation FR/EN** (Record P0, app + cartouche P1).
4. **Onboarding autonome** (comprendre sans guide externe).
5. **Rendre évidente la sauvegarde pendant l'observation** (par design, pas par texte).
6. **Écran d'accueil « c'est quoi / pourquoi »** en 3 secondes.
7. **Mise en scène du moment magique** (succès + aperçu estampille).
8. **Point d'entrée public** (landing + téléchargement, fin du Drive bricolé).
9. **Vidéo démo 30 s** montrant le parcours et la preuve.
10. **Nettoyage dette legacy** (écran classic masqué avec claims interdits).

## 10. Top 5 corrections V2 prioritaires (P0)

1. **Page Record bilingue** (statut sobre + métadonnées + « ce que ça ne signifie pas » + `.ho.json`).
2. **Langage de preuve unifié FR/EN** appliqué partout (app, cartouche, Record, docs).
3. **Écran d'accueil + onboarding autonome** (promesse en 1 phrase + guidage par design).
4. **Sauvegarde-pendant-observation évidente** (invite contextuelle, indicateur vivant).
5. **Point d'entrée public** (landing + téléchargement crédible remplaçant le Drive).

## 11. Recommandations

**GO / NOGO testeurs élargis : NOGO (élargi) / GO (restreint).**
- **NOGO** pour un élargissement large maintenant : le destinataire ne comprend pas encore la preuve (Record muet) et tout est FR → risque de mauvaise première impression internationale, non réversible.
- **GO** pour un cercle **restreint et accompagné** (proches, contextes à enjeux FR) afin de récolter du signal — c'est déjà en cours avec le pack 0.1.27/0.1.28.

**Premier chantier V2 code recommandé : la Page Record (verifier public) bilingue.**
- C'est le **maillon faible** (confiance destinataire) et le plus fort **levier de crédibilité**.
- **Ne touche pas** le moteur/cartouche/crypto : c'est une surface web + wording.
- Débloque l'international (bilingue) et la diffusion (URL stable citable).
- Aligne avec `V2_public_record_and_verifier.md` du blueprint.

## 12. Séquence V2 recommandée

1. **V2-1** — Audit produit international *(ce document)*.
2. **V2-2** — Parcours créateur parfait (accueil, onboarding autonome, sauvegarde évidente, mise en scène du succès).
3. **V2-3** — Page Record / verifier public **bilingue** *(premier chantier code recommandé)*.
4. **V2-4** — Onboarding + pack de diffusion (landing, vidéo démo, téléchargement).
5. **V2-5** — Internationalisation FR/EN (app + cartouche + docs).
6. **V2-6** — Lancement testeurs élargi (une fois Record + i18n prêts).

**Interdits maintenus :** pas de multimodal (photo/vidéo/audio), pas de refonte moteur, pas de publication prématurée, aucun claim interdit (100 % humain, absence d'IA, certifié/garanti humain, authenticité/auteur/origine garantie, verified human).

---

**En un mot :** le moteur est prêt, le **sens** ne l'est pas. Le prochain vrai gain n'est pas dans le code du cœur — il est dans **la page Record et le langage de preuve, en FR/EN**.
