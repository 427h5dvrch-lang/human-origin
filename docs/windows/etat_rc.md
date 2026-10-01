# Windows Private Beta — état du RC

Dernière mise à jour : 2026-10-01. Branche `windows-private-beta-v1`.

## Ce qui est fait et vérifié

| Point | État | Preuve |
|---|---|---|
| Compilation Rust x64 | **PASS** | `cargo check --target x86_64-pc-windows-msvc` propre, 0 erreur |
| Architecture cible | x86_64-pc-windows-msvc | ARM64 hors périmètre |
| Sidecars Windows | présents, non vides, signature `MZ` vérifiée en CI | `humanorigin-{publisher,converter}-x86_64-pc-windows-msvc.exe` |
| Chemins filesystem | déjà portables | `humanorigin_root_dir()` et `key_storage_path()` utilisent `data_local_dir()` sur Windows |
| Stockage de la capability | portable sans changement | `keyring 2` s'adosse au Gestionnaire d'identifiants Windows |
| Deep links | déjà gérés | tampon `pending_deep_link` prévu pour l'arrivée précoce de l'URL sur Windows |
| Transport du finalizer | **corrigé** | `curl.exe` / `NUL` au lieu de `/usr/bin/curl` / `/dev/null`, sous banc |
| PDFium | **corrigé** | `pdfium.dll` à côté de l'exécutable ; DLL téléchargée en CI, même version que macOS |
| Intégration Word | **corrigée** | catalogue de dossier approuvé déclaré dans la base de registre |
| Bancs exécutables sur Windows | **corrigé** | `fileURLToPath` remplace `new URL(...).pathname` (chemin à lecteur double) |
| Fins de ligne | **figées** | `.gitattributes` impose LF : les bancs comparent la source caractère par caractère |
| NSIS | configuré | `installMode: currentUser`, langues en-US/fr-FR, sélecteur affiché |
| WebView2 | géré | `downloadBootstrapper` — installé à la volée si absent |
| Updater | **branché** | Windows ajouté à la matrice de release : sans cela `latest.json` n'annonce que darwin |

## Ce qui n'est pas vérifié, et pourquoi

**Aucun environnement Windows n'était disponible.** La VM Parallels enregistrée sur la
machine est une coquille vide — `~/Parallels/` ne contient aucun fichier et son état est
`invalid` — et il reste 16 Gio libres sur le disque, là où une installation Windows 11
en demande une soixantaine. En créer une supposerait de surcroît un compte Microsoft et
une licence Word.

Ne sont donc **pas** vérifiés, et ne peuvent pas l'être depuis macOS :

1. l'installation réelle de l'installateur sur une machine propre ;
2. le premier lancement et la connexion ;
3. la déclaration du catalogue Word et l'apparition du complément dans le ruban ;
4. la création d'un document et l'observation ;
5. la finalisation réelle, donc le dépôt au registre par `curl.exe` ;
6. le rendu PDF par `pdfium.dll` ;
7. la désinstallation et la réinstallation par-dessus ;
8. la réception d'une mise à jour.

Les correctifs qui portent ces points sont tenus par des bancs de source et par la
compilation croisée, pas par une exécution. C'est une base solide, ce n'est pas une
preuve de fonctionnement.

## La gate ouverte

La signature Authenticode. Voir [signature_authenticode.md](signature_authenticode.md) :
l'installateur se construit et s'installe, mais SmartScreen affiche « Éditeur inconnu »
et un avertissement au premier lancement. Franchissable pour une bêta privée dont les
testeurs sont prévenus ; pas pour une diffusion publique.
