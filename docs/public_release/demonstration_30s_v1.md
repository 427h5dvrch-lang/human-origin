# Démonstration réelle — 32 secondes · V1

> Phrase boussole : **« HumanOrigin établit qu'un travail a été observé sur ce document — ni son contenu, ni son auteur. »**
> Compass line: **“HumanOrigin establishes that work was observed on this document — neither its content nor its author.”**

Produit visé : **HumanOrigin Docs 0.3.6** (macOS Apple Silicon · Windows x64), le compagnon du
volet Microsoft Word. Le travail se fait **dans Word** ; la fenêtre HumanOrigin répond à une
seule question — *suis-je prêt, et que viens-je de prouver ?*

Cette démonstration montre les trois gestes du produit, et rien d'autre : **écrire**,
**produire la preuve**, **vérifier**.

---

## 1. Ce qui doit être vrai AVANT de lancer l'enregistrement

Une démonstration de 32 secondes ne peut pas contenir le premier lancement : celui-ci demande
une saisie d'e-mail, un aller-retour par la boîte de réception, l'installation du complément et
une relance de Word. On filme donc un poste **déjà activé**.

| À préparer | Pourquoi |
|---|---|
| Session ouverte dans HumanOrigin | sans session, l'écran de connexion prend la main (`src/ho_desktop.js:1464`) |
| Complément Word « opérationnel » | sinon l'application mène à l'écran d'installation (`src/ho_desktop.js:1488`) |
| Word **relancé** après l'installation | le complément ne se charge qu'au démarrage de Word (`src/ho_desktop.js:686`) |
| Un dossier de documents déjà choisi | sinon un panneau d'emplacement s'insère avant la création (`src/ho_desktop.js:711`) |
| Un document HumanOrigin **déjà créé et ouvert** dans Word, encore vierge | la création elle-même n'est pas le sujet du film |
| La fenêtre HumanOrigin **laissée ouverte** en arrière-plan | le dépôt est fait par l'application, pas par Word |
| Un navigateur ouvert sur un onglet vide | la vérification se fait hors de l'application (voir § 4) |
| Langue de l'interface fixée (FR ou EN) dans Réglages › Langue | une seule langue à l'écran par prise |

À masquer à l'image : adresse e-mail réelle, identifiant de Record réel, chemins de fichiers,
nom de client. Utiliser un texte neutre et libre de droits.

---

## 2. Script de tournage, seconde par seconde

Durée totale **32 s**. Trois plans, aucune coupe à l'intérieur d'un plan.

### Plan A — Écrire · 0 s → 16 s

| Temps | Ce qu'on voit | Ce qu'on fait |
|---|---|---|
| 0 → 3 s | Word plein écran. Document HumanOrigin vierge, volet HumanOrigin visible à droite. | Rien. Le cadre s'installe. |
| 3 → 13 s | Le texte apparaît au rythme de la frappe, sans accéléré. | Taper un vrai paragraphe, 2 à 3 phrases, au clavier. **Aucun copier-coller** : c'est le processus qui est prouvé. |
| 13 → 14 s | Rien ne bouge. | `Cmd+S` (macOS) / `Ctrl+S` (Windows). |
| 14 → 16 s | Un temps mort assumé. | **Attendre au moins 1,5 s.** L'application ne relit pas un fichier que Word vient d'écrire (`SETTLE_MS = 1200`, `src-tauri/src/ho_finalizer.rs:45`). |

### Plan B — Produire la preuve · 16 s → 25 s

| Temps | Ce qu'on voit | Ce qu'on fait |
|---|---|---|
| 16 → 20 s | Le volet HumanOrigin, à droite dans Word. | Lancer la finalisation depuis le volet. *Le libellé exact appartient au volet déployé (`create.humanorigin.io/word/taskpane.html`), pas à ce dépôt : relever le libellé servi le jour du tournage plutôt que de le citer de mémoire.* |
| 20 → 22 s | Word passe en arrière-plan. | Basculer sur la fenêtre HumanOrigin (`Cmd+Tab`). |
| 22 → 25 s | Une carte **verte** « Preuve créée » apparaît, avec le nom du document. | Rien. Le simple retour de focus suffit : l'application se réveille et relit son état (`src/ho_desktop.js:1521`). La carte verte n'apparaît **que** si un dépôt a réellement été enregistré au registre (`src/ho_desktop.js:858`). |

> Si le plan B montre à la place une carte **ambre** « Fermez Word pour terminer », Word tient
> encore le fichier : fermer le document dans Word et laisser le balayage de fond finir seul.
> Ce n'est pas une panne (`src/ho_desktop.js:53`). Reprendre la prise.

### Plan C — Vérifier · 25 s → 32 s

| Temps | Ce qu'on voit | Ce qu'on fait |
|---|---|---|
| 25 → 27 s | Sous la carte verte : « Copier le lien de vérification ». La ligne « Toute personne disposant de ce lien peut consulter cette preuve. » est déjà visible, avant toute copie. | Cliquer. Le message devient « Lien copié. » suivi du même avertissement (`src/ho_desktop.js:799`). |
| 27 → 29 s | Le navigateur passe au premier plan. | Coller dans la barre d'adresse, `Entrée`. |
| 29 → 32 s | `verify.humanorigin.io` affiche la preuve du document. | Rien. Image d'arrêt sur la preuve. |

Aucune voix off n'est nécessaire. Si un sous-titre est ajouté, trois cartons suffisent :
**« On écrit. » · « La preuve se fait. » · « N'importe qui peut la vérifier. »**

---

## 3. Indications pour reproduire · 🇫🇷 Français

1. Ouvrez votre document HumanOrigin dans Word. Laissez la fenêtre HumanOrigin ouverte derrière.
2. Écrivez normalement. Tapez votre texte ; ne le collez pas.
3. Enregistrez (`Cmd+S` ou `Ctrl+S`), puis patientez une seconde et demie.
4. Dans le volet HumanOrigin de Word, lancez la finalisation.
5. Revenez sur la fenêtre HumanOrigin. La carte verte « Preuve créée » s'affiche d'elle-même.
   Si la carte est ambre et demande de fermer Word, fermez le document : HumanOrigin termine seul.
6. Cliquez sur « Copier le lien de vérification ».
7. Collez ce lien dans un navigateur. La preuve s'ouvre sur `verify.humanorigin.io`.

**À savoir :** ce lien ouvre la preuve à **toute personne qui le détient**. La clé de lecture
voyage dans le fragment de l'adresse (après le `#`), donc elle n'est jamais envoyée à un
serveur — mais elle est bien dans ce que vous collez.

**Ce que HumanOrigin ne fait pas :** il ne détecte pas l'IA, ne certifie ni l'originalité ni la
véracité du contenu, et ne prouve pas un auteur unique. Il prouve un **processus de travail
observé**. Le document est traité localement ; son contenu n'est pas envoyé à HumanOrigin.

---

## 4. Instructions to reproduce · 🇬🇧 English

1. Open your HumanOrigin document in Word. Leave the HumanOrigin window open behind it.
2. Write normally. Type your text; do not paste it.
3. Save (`Cmd+S` or `Ctrl+S`), then wait a second and a half.
4. In the HumanOrigin task pane inside Word, start the finalisation.
5. Switch back to the HumanOrigin window. The green “Proof created” card appears on its own.
   If the card is amber and asks you to close Word, close the document: HumanOrigin finishes by itself.
6. Click “Copy the verification link”.
7. Paste that link into a browser. The proof opens at `verify.humanorigin.io`.

**Good to know:** that link opens the proof for **anyone who holds it**. The reading key travels
in the address fragment (after the `#`), so it is never sent to a server — but it is part of what
you paste.

**What HumanOrigin does not do:** it does not detect AI, it certifies neither the originality nor
the truthfulness of the content, and it does not prove a single author. It proves an **observed
work process**. The document is processed locally; its content is not sent to HumanOrigin.

---

## 5. Pourquoi la vérification sort de l'application

Le dernier geste se fait dans un navigateur, et ce n'est pas un choix de mise en scène.
L'application **copie** le lien de vérification (`ho_copy_verification_link`,
`src-tauri/src/main.rs:2190`) ; aucune commande exposée n'ouvre d'adresse, et le frontend
n'appelle jamais `@tauri-apps/api/shell`. Le lien est formé côté natif —
`https://verify.humanorigin.io/?record=…#k=…` (`src-tauri/src/ho_finalizer.rs:878`) — et la clé
reste dans le fragment, donc la fenêtre web de l'application ne la voit jamais.

Conséquence mesurable pour le tournage : entre « preuve créée » et « preuve vue », il y a
**1 clic dans l'application** puis **3 gestes hors de l'application** (changer d'application,
coller, valider). C'est tenable en 7 secondes de film ; c'est la friction la plus visible du
parcours de partage.

---

## 6. Présentation et marque

La marque n'est **pas** retouchée pour cette démonstration, et rien de ce document ne demande
de la retoucher.

- Le paquet d'identité est gelé : `STATUS = FROZEN` · `DO NOT REDRAW` ·
  `DO NOT RECREATE FROM FONT` · `DO NOT SUBSTITUTE FINGERPRINT` (`src/brand/README.md`).
  Le banc `tests/brand_assets.mjs` refuse toute divergence, octet pour octet.
- Le mot-symbole est un **seul raster** : `H` + « uman » + l'empreinte à la place du « O » +
  « rigin ». Il ne se recompose jamais en posant une empreinte à côté d'un « HumanOrigin » écrit
  dans une police système. Il entre dans l'interface par un seul point, `HumanOriginBrandMark`.
- Aucun texte « HumanOrigin » n'accompagne le mot-symbole dans un carton de titre.
- Couleurs à l'image, telles que le produit les emploie : papier `#FBFAF7`, encre `#1A1E24`,
  marine `#012454`. Le vert de la carte de preuve et l'ambre de la carte d'attente viennent des
  teintes du Creator Shell : ne pas les corriger au montage.
- Une seule animation existe dans le produit — le **DÉPÔT** du « O » à la création d'un document
  (`index.html:16`). Ne pas en ajouter, ne pas la rejouer au montage. Sur un poste réglé en
  « mouvement réduit », elle n'a pas lieu : c'est voulu, et le sens tient au texte de l'écran.

---

## 7. Ce que cette démonstration ne prouve pas

Le film montre un parcours **sur une machine réelle**. Il ne remplace ni le banc de parcours
(`npm run check:frontend`), ni une qualification Windows. Et il ne dit rien du **premier
lancement** : activation, installation du complément, relance de Word. Ce parcours-là demande sa
propre démonstration, plus longue, et reste la zone de friction la plus coûteuse du produit.
