# HumanOrigin V2 — Roadmap multimodale

> Blueprint. Paliers réalistes, du plus proche au plus lointain. Chaque palier réutilise
> le noyau (observation + évidence + signature + vérification) et n'ajoute qu'un adaptateur.

## Principe de séquencement

On avance **par média**, du terrain le plus maîtrisé (document) au plus complexe (temps réel/audio-vidéo). Un palier n'ouvre que si : (a) l'adaptateur *détection de version* est fiable, (b) l'adaptateur *marquage/liaison* est défini, (c) les claims restent sobres, (d) le cold test réel passe.

Difficulté : ★ (faible) → ★★★★★ (élevée).

---

## V2-A — Documents renforcés
- **Valeur utilisateur** : fiabiliser le socle (observation continue, moins de friction, DOCX/Word→PDF), corriger la fragmentation des périodes.
- **Preuve possible** : identique à aujourd'hui, plus robuste ; support DOCX via conversion en version finale.
- **Risque technique** : ★★ (consolidation périodes, conversion DOCX déterministe).
- **Risque légal** : ★ (claims déjà cadrés).
- **Dépendances** : chantier UX anti-fragmentation (0.1.28) ; pipeline DOCX→PDF existant.

## V2-B — Image / photo
- **Valeur** : prouver qu'une image a été **produite/éditée** pendant une session observée ; utile presse, design, illustration.
- **Preuve possible** : périodes reliées au hash de l'image finale (+ empreinte perceptuelle optionnelle pour intégrité).
- **Marquage** : cartouche visible optionnelle **hors zone utile** OU sidecar `.ho.json` + métadonnées EXIF/XMP signées (ne pas altérer le pixel utile).
- **Risque technique** : ★★★ (édition dans apps tierces, capter l'activité sans intrusion).
- **Risque légal** : ★★★ (confusion « preuve anti-IA » à désamorcer explicitement).
- **Dépendances** : adaptateur d'observation d'apps d'édition ; politique empreinte perceptuelle.

## V2-C — Vidéo
- **Valeur** : preuve de montage/production observé reliée à un rendu final.
- **Preuve possible** : périodes reliées au hash du rendu + empreinte de séquence (échantillonnage de frames/segments).
- **Marquage** : sidecar signé + métadonnées conteneur ; pas de watermark destructif par défaut.
- **Risque technique** : ★★★★ (durées longues, exports multiples, poids).
- **Risque légal** : ★★★ (mêmes désamorçages ; droits sur le contenu filmé hors périmètre).
- **Dépendances** : V2-B (empreintes), stockage/perf.

## V2-D — Audio / musique
- **Valeur** : preuve de session de composition/enregistrement reliée à un mixdown.
- **Preuve possible** : périodes reliées au hash du bounce + empreinte audio optionnelle.
- **Marquage** : sidecar signé + métadonnées (ID3/BWF) ; jamais dans le signal utile.
- **Risque technique** : ★★★★ (DAW hétérogènes, prises multiples, temps réel).
- **Risque légal** : ★★★ (attention à ne pas suggérer « composé sans IA »).
- **Dépendances** : adaptateurs DAW ; V2-C pour l'infra empreinte.

## V2-E — Code / workflows
- **Valeur** : preuve d'une session de développement/création observée reliée à un état de dépôt/artefact.
- **Preuve possible** : périodes reliées à un hash d'archive ou un identifiant de commit local (sans juger la paternité du code).
- **Marquage** : sidecar `.ho.json` attaché au dépôt/livrable ; annotation optionnelle.
- **Risque technique** : ★★★ (définir « version » d'un dépôt vivant ; multi-fichiers).
- **Risque légal** : ★★ (ne pas revendiquer l'auteur ; ne pas se confondre avec des attestations de licence).
- **Dépendances** : modèle d'objet « état de projet » ; intégration éditeurs.

## V2-F — Intégrations (Word / iPhone / navigateur)
- **Valeur** : réduire la friction ; capter là où les gens travaillent réellement.
- **Preuve possible** : mêmes garanties, surface d'entrée élargie.
- **Risque technique** : ★★★★ (sandbox iOS, add-ins Office, extensions navigateur, permissions).
- **Risque légal** : ★★★ (vie privée renforcée sur mobile/navigateur ; conformité stores).
- **Dépendances** : SDK noyau stable ; politique permissions ; distribution (stores).

---

## Vue d'ensemble

| Palier | Difficulté | Risque légal | Prérequis fort |
|---|---|---|---|
| V2-A Documents+ | ★★ | ★ | anti-fragmentation |
| V2-B Image | ★★★ | ★★★ | observation apps tierces |
| V2-C Vidéo | ★★★★ | ★★★ | infra empreintes/perf |
| V2-D Audio | ★★★★ | ★★★ | adaptateurs DAW |
| V2-E Code | ★★★ | ★★ | modèle « état de projet » |
| V2-F Intégrations | ★★★★ | ★★★ | SDK noyau + permissions |

## Recommandation de séquence
**V2-A d'abord** (consolide le socle et le sens de la preuve), puis **V2-B** (premier vrai multimodal, forte demande, révèle les vraies questions d'observation d'apps tierces). V2-E peut se paralléliser si une demande claire émerge (dev/creative tools). Vidéo/audio après maîtrise des empreintes.
