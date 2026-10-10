# Consolidation du 2026-10-10 — Mac fusionné, W1/W2 intégrés, W3 déployé, artefact signé

`main` = `1fc7b2a`. Run CI de signature : `38007810133`.

## 1 — Mac fusionné

`mac-deadend-openfile-v1` fusionnée en avance rapide : `aac91f7` → `36e8eb8`.
Quatre commits, neuf fichiers. Le retest physique Mac est PASS (voir
`HUMANORIGIN_UX_CHECKPOINT_20261010_DESKTOP_REFRESH.md`).

Le `main` **local** de certains worktrees pointait encore sur `ababbb5`, d'une autre
lignée visible : `git log main..branche` annonçait 124 commits d'écart. Face à
`origin/main`, l'écart réel était de 4 commits. Toujours comparer à `origin/main`.

## 2 — W1 et W2 intégrés

`windows-word-integration-v1` (`8744065`) fusionnée sans conflit.

- **W1** — `CLE_DEVELOPER` = `Software\Microsoft\Office\16.0\WEF\Developer`, écrite par
  `declarer_developpeur`, appelée depuis `install()`. Idempotente : le nom de la valeur est
  l'identifiant du manifeste, lu dans le manifeste embarqué.
- **W2** — `ouvrir_document` passe par `ShellExecuteW`, ce que fait le double-clic de
  l'Explorateur. `windows-sys` est confinée à
  `[target.'cfg(target_os = "windows")'.dependencies]`.

La fusion a créé un défaut de texte : le recours affiché quand Word refuse d'ouvrir disait
« Ouvrez-le depuis le Finder. », désormais lisible sur Windows où ce mot ne veut rien dire.
Corrigé par `#[cfg]` (`1fc7b2a`).

Vérifications : 75 tests Rust, 9 bancs `.mjs`, et `cargo check --target
x86_64-pc-windows-msvc` passé sur macOS — le code W1/W2 compile sans attendre la CI.

## 3 — W3 déployé sur create.humanorigin.io

Un seul fichier a changé : `word/taskpane.js`, `18fce93d` (41 166 o) → `9d35ae87`
(42 579 o). Vérifié après déploiement : `taskpane.html`, `taskpane.css`, `manifest.xml`,
`icon-16/32/80.png` et les en-têtes (CSP, HSTS, `no-store`, `noindex`) inchangés ;
`word/taskpane-rc.html` toujours 404.

Smoke rejoué **contre les fichiers réellement servis**, pas contre la copie du dépôt :
`test_taskpane_chemins` (15/15), `test_csp`, `test_taskpane_brand`, `test_taskpane_langue`,
`test_taskpane_reserved` — tous PASS. La casse reste distinctive sur macOS, un sous-dossier
et un autre dossier restent refusés, la normalisation NFC est conservée.

### Piège rencontré — à ne pas refaire

`deploy.sh` publie `create` depuis `~/Developer/HO_RC/create-origin`, un dossier **local et
non versionné** dont le `taskpane.js` est un vestige de **5 307 o**, contre 41 166 o en
production. Le lancer aurait écrasé le volet par une version huit fois plus petite.

Le lot déployé a donc été assemblé depuis le dépôt, branche `word-windows-path-v1`,
répertoire `create-record/` — identique à la production sur tous les fichiers sauf
`taskpane.js`. Le banc `test_taskpane_chemins.mjs`, nouveau, a été retiré du lot : il n'a pas
à devenir public par ce déploiement. Un brouillon Netlify a été vérifié avant le `--prod`.

Snapshot et procédure de retour arrière : `~/Desktop/W3-ROLLBACK-20261010/`.

## 4 — Artefact Windows 0.3.4 signé

| | |
|---|---|
| `setup.exe` | `f9f3209f…fde30153` · 4 952 264 o |
| `setup.nsis.zip` | `a7b59e31…6513d86a` · 4 931 801 o |
| `setup.nsis.zip.sig` | `aab3c57e…88791393` · 428 o |

- **Authenticode** — `CN=DAZEAS CORP, O=DAZEAS CORP, L=Marseille, C=FR`, émis par
  `Microsoft ID Verified CS AOC CA 04`, horodaté le 2026-10-10 00:16:26 GMT. Vérifié
  **localement, hors CI**, avec `osslsigncode` ancré sur la racine Microsoft Identity
  Verification 2020 : `Signature verification: ok — Succeeded`, CRL ok.
  Le certificat ne vaut que du 9 au 12 octobre 2026 — Azure Trusted Signing émet des
  certificats courts ; c'est le contreseing d'horodatage qui porte la validité ensuite.
- **minisign** — vérifié indépendamment contre la clé publique de `tauri.conf.json`
  (`8B2AD327FAEE2E7`) : `Signature and comment signature verified`, le commentaire signé
  nomme bien l'archive.
- **Identité octet pour octet** — l'EXE autonome et l'EXE extrait de l'archive sont
  identiques (`cmp` ne relève rien), et l'EXE extrait porte lui aussi une signature valide.

La CI ne vérifiait la signature minisign que par la forme de son bloc ; la vérification
cryptographique a été faite ici, à la main.

## 5 — Rien n'est publié

Aucune Release GitHub créée ni modifiée (`permissions: contents: read`). Les actifs de
`v0.3.4` datent tous du 2026-10-06. Le `latest.json` servi annonce 0.3.4 du 2026-10-06 et
**ne porte que `darwin-aarch64`** : l'artefact Windows n'est proposé à personne.

**Nuance à ne pas confondre** : le déploiement W3 est, lui, **en ligne pour tout le monde**,
macOS compris — c'est un déploiement web, pas un binaire. Il était explicitement autorisé.

Conséquence ouverte : le `latest.json` pointe sur un build du 2026-10-06, qui ne contient
aucun des correctifs Mac fusionnés aujourd'hui. Les utilisateurs macOS ne les reçoivent donc
pas encore.
