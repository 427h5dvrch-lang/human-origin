# HumanOrigin V2 — Modèle de preuve

> Blueprint. Décrit le modèle d'évidence généralisé, sa compatibilité avec HO-JSON v1,
> et la frontière stricte des claims. Aucune implémentation engagée.

## 1. Principe

La preuve V2 est une **assertion signée** de la forme :

> « Des **périodes de travail humain** ont été **observées localement** entre T0 et Tn, et sont **reliées** à une **version précise** (`hash`) d'un **objet observé**. »

Rien de plus. Pas d'assertion sur la nature du contenu, l'auteur, l'originalité ou l'absence d'outils.

## 2. Objets du modèle

### 2.1 Objet observé (`observed_object`)
- Un artefact identifiable et versionnable : fichier (PDF, image, vidéo, audio, archive de code) ou référence d'état (ex. commit, snapshot de projet).
- Attributs : type de média, identifiant local, `hash_initial`, `hash_final`, taille, empreinte de version.
- **Le contenu n'est pas transmis** ; seuls des hashes/empreintes sortent (si publication).

### 2.2 Version finale (`final_version`)
- L'état de l'objet au moment où l'utilisateur **valide** sa version (enregistrement pendant l'observation).
- La preuve relie explicitement les périodes à **ce** hash final. Une nouvelle version = une nouvelle preuve reliée.

### 2.3 Période de travail (`work_period`)
- Fenêtre temporelle continue d'activité observée. Attributs : début/fin, durée active estimée, densité d'activité, indicateur de **changement net** de l'objet pendant la période.
- **Qualification** : une période compte si elle satisfait des seuils d'observation **et** relie un changement de version. La sémantique « seuils » reste **interne** (jamais exposée comme claim).

### 2.4 Évidence cumulée (`core_evidence`)
- Agrégat canonicalisé des périodes qualifiantes + empreinte de l'objet + version finale. C'est ce qui est **signé**.

### 2.5 Certificat (`certificate`)
- Signature (Ed25519) de l'évidence canonicalisée + métadonnées minimales (ID, séquence, statut d'observation, statut d'identité locale). Format **HO-JSON**.

## 3. Sources multimodales & événements observables

| Média | Signal de version (adaptateur) | Événements d'activité observables |
|---|---|---|
| Document/PDF | hash de fichier | frappe clavier, édition, enregistrements |
| Image/photo | hash de fichier + empreinte perceptuelle (optionnel) | édition dans un éditeur, sauvegardes |
| Vidéo | hash du rendu + empreinte de séquence | activité de montage, exports |
| Audio/musique | hash du mixdown + empreinte audio (optionnel) | activité DAW, prises, bounces |
| Code/workflow | état de dépôt / hash d'archive | activité d'édition, commits locaux |

**Note** : l'empreinte perceptuelle (image/audio) est un **complément d'intégrité**, jamais une preuve de « non-IA ». Elle sert à détecter des altérations, pas à qualifier l'origine du contenu.

## 4. Ce qui reste local vs ce qui peut devenir public

| Toujours local / privé | Publiable (choix explicite) |
|---|---|
| Le **contenu** de l'objet | Hashes / empreintes de version |
| Chemins de fichiers, noms | Statut d'observation (ex. « travail observé ») |
| Détails fins d'activité (contenu des frappes) | ID de preuve court + URL de vérification |
| Identité civile | Clé publique de signature, horodatage |

Défaut : **rien ne sort**. La publication d'un enregistrement (Record) est opt-in et ne publie **jamais** le contenu.

## 5. Claims — autorisés / interdits

**Autorisés (sobres, factuels)** :
- « Travail observé »
- « Périodes de travail enregistrées localement »
- « Reliées à cette version du document »
- « Preuve locale signée »
- « Vérifier les détails »
- « HumanOrigin ne détecte pas l'IA »
- « HumanOrigin ne certifie ni l'auteur unique, ni l'originalité, ni la vérité du contenu »

**Interdits (surclaim / non prouvable)** :
- « 100 % humain », « contenu humain garanti »
- « absence d'IA », « détecteur d'IA »
- « authenticité garantie », « auteur garanti », « originalité garantie »
- « certifié humain », « vérité du contenu »
- Tout verdict jugeant le contenu (ex. « cohérent », « authentique »).

Règle d'ingénierie : les **verdicts internes** (état d'observation, statut d'identité) peuvent exister dans la donnée **signée** mais ne doivent **jamais** être **affichés** comme jugement à l'utilisateur/destinataire.

## 6. Compatibilité avec HO-JSON v1

- **Superset, non rupture.** HO-JSON v2 ajoute : `media_type`, `final_version`, empreintes optionnelles, `schema_version` incrémenté.
- **Canonicalisation identique** (tri récursif des clés, sérialisation stable) pour préserver la vérifiabilité.
- **Signature identique** (Ed25519). Un vérificateur v2 valide v1 et v2 ; un vérificateur v1 ignore proprement les champs inconnus (ou refuse explicitement les `schema_version` supérieurs — décision à trancher, voir points ouverts).
- Le PDF-first actuel devient le **cas `media_type = "pdf"`** du modèle général.

## 7. Limites (à énoncer publiquement)

- Une preuve peut être **partielle** (observation interrompue, périodes fragmentées).
- L'observation atteste d'un **processus**, pas d'un **résultat** : elle ne dit rien de la *qualité* ni de l'*origine du contenu*.
- Un acteur déterminé peut **simuler** de l'activité ; la preuve n'est pas un test d'intention. Elle **augmente le coût** de la falsification, elle ne la rend pas impossible.

## 8. Points ouverts

- Politique de refus/acceptation cross-version du vérificateur.
- Empreintes perceptuelles : opt-in par média ? impact vie privée ?
- Consolidation des périodes fragmentées (lié au chantier UX 0.1.28) : comment définir une « période continue » robuste sans fausser la sémantique.
