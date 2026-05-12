# HumanOrigin — UX surface checkpoint

Date : 2026-05-12 17:08:39

## Objectif

Transformer le parcours visible de HumanOrigin en expérience simple : choisir → associer → lancer → travailler → terminer → valider → envoyer.

## Ce qui a été fait

- wording app principale plus humain ;
- bouton principal rendu plus visible par écran ;
- Open First clarifié ;
- message d’accompagnement amélioré ;
- dossier destinataire conservé comme voie principale ;
- ZIP ajouté comme option email secondaire ;
- guide destinataire ajouté dans `2_SEND_TO_RECIPIENT` ;
- verifier public simplifié en surface ;
- détails techniques déplacés autant que possible vers niveau avancé.

## Ce qui reste à valider visuellement

- écran projet ;
- écran document ;
- écran HumanOrigin actif ;
- écran après arrêt ;
- historique / package final ;
- Open First ;
- guide destinataire ;
- verifier public.

## Mots techniques restants à surveiller

### src/main.js
- `session` : 60
- `Session` : 71
- `certificat` : 75
- `Certificat` : 10
- `hash` : 34
- `Hash` : 23
- `SHA-256` : 4
- `JSON` : 19
- `archive` : 4
- `TEMP` : 9

### index.html
- `session` : 25
- `Session` : 4
- `certificat` : 4
- `Certificat` : 2
- `hash` : 1
- `Hash` : 2
- `SHA-256` : 1
- `.ho.json` : 1
- `Preuve (Hash)` : 1
- `clé publique` : 1

### tools/ux_finalize_latest_package.py
- `.ho.json` : 3
- `archive` : 1

### tools/ux_create_send_zip_latest.py
- `.ho.json` : 3
- `archive` : 1

### tools/ux_add_recipient_guide_latest.py
- `.ho.json` : 1

## Bons libellés détectés

### src/main.js
- `Lancer HumanOrigin` : 1
- `Terminer ce moment de travail` : 1
- `Valider ce moment de travail` : 7
- `Créer le package final` : 1
- `Travail enregistré` : 1
- `dossier à envoyer` : 1
- `fichier de vérification` : 55
- `Détails avancés` : 2
- `Votre package est prêt` : 1

### index.html
- `Lancer HumanOrigin` : 1
- `Terminer ce moment de travail` : 1
- `Valider ce moment de travail` : 1
- `Créer le package final` : 4
- `Travail enregistré` : 2
- `dossier à envoyer` : 1
- `fichier de vérification` : 4
- `Détails avancés` : 1

### tools/ux_finalize_latest_package.py
- `dossier à envoyer` : 3
- `fichier de vérification` : 6
- `Détails avancés` : 1
- `Votre package est prêt` : 2

### tools/ux_create_send_zip_latest.py
- `dossier à envoyer` : 3
- `fichier de vérification` : 4
- `Détails avancés` : 1
- `Votre package est prêt` : 2

### tools/ux_add_recipient_guide_latest.py
- `dossier à envoyer` : 1
- `fichier de vérification` : 5
- `Détails avancés` : 1

### tools/post_export_latest.sh
- `fichier de vérification` : 1

### /Users/dazeasphilippe/Documents/HumanOrigin/Projects/Version2/HumanOrigin_OPEN_FIRST.html
- `dossier à envoyer` : 1
- `fichier de vérification` : 4
- `Détails avancés` : 1
- `Votre package est prêt` : 1

## Règle pour la suite

Ne plus ajouter de patch lourd sans test visuel. Corriger uniquement les éléments qui gênent réellement le parcours utilisateur.

## Ne pas toucher

- core scan ;
- login ;
- signature ;
- HO-JSON ;
- verifier logique ;
- cartouche PDF ;
- publisher DOCX/PDF ;
- binding document/preuve.
