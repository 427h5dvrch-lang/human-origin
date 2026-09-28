# Marque HumanOrigin — copie versionnée

`STATUS = FROZEN` · `DO NOT REDRAW` · `DO NOT RECREATE FROM FONT` · `DO NOT SUBSTITUTE FINGERPRINT`

Ces fichiers sont des copies **octet pour octet** du paquet d'identité officiel
`HUMANORIGIN_BRAND_MASTER_V1`, dont la spécification complète est `BRAND_SPEC.md`. Ils sont
versionnés ici pour que l'application puisse les embarquer et pour qu'une substitution soit
détectable — pas pour être modifiés.

| Fichier | Rôle | Dimensions |
|---|---|---|
| `HumanOrigin_wordmark_navy.png` | mot-symbole complet, encre marine `#012454`, sur fond clair | 850 × 150 |
| `HumanOrigin_wordmark_white.png` | même couche alpha, encre blanche `#FAFAFB`, pour fond sombre | 850 × 150 |
| `HumanOrigin_fingerprint_navy.png` | empreinte seule, encre marine, sur fond clair | 130 × 137 |
| `HumanOrigin_fingerprint_white.png` | même couche alpha, encre blanche, sur fond marine | 130 × 137 |

## Le mot-symbole contient l'empreinte

Le mot-symbole canonique s'écrit `H` + « uman » + **l'empreinte à la place du « O » d'Origin** +
« rigin ». Ce n'est pas une composition : c'est un seul raster gelé, extrait du Golden Master
(`GOLDEN_MASTER_SYSTEM.md`, lot A : « Contient le H, "uman", le O-empreinte d'origine et
"rigin" »). Il ne se recompose donc **jamais** en posant une empreinte à gauche d'un
« HumanOrigin » écrit dans une police système.

L'empreinte seule est **ce même « O »**, isolé par composantes connexes — aucun pixel coupé ni
ajouté, aucun cercle. Elle ne s'emploie que là où le nom HumanOrigin est déjà établi par le
contexte : icône d'application, favicon, volet Word.

Seule la **taille** varie. Le mot-symbole entre dans l'interface par un seul point,
`HumanOriginBrandMark` dans `../ho_shell.js` : aucun écran ne redessine ni ne réimporte la marque
ailleurs, et aucun texte « HumanOrigin » ne l'accompagne.

## Icône de l'application

`src-tauri/icons/` est **dérivé** de `HumanOrigin_fingerprint_white.png`, et de rien d'autre :

```sh
python3 tools/generer_icone_app.py          # écrit tools/HumanOrigin_app_icon_1024.png
npm run tauri icon tools/HumanOrigin_app_icon_1024.png
```

Le script ne change que le **cadrage, le fond et l'échelle** : la géométrie de l'empreinte est
reprise telle quelle, sans redessin ni ajout de cercle.

## Vérifier

```sh
cd src/brand && shasum -a 256 -c SHA256SUMS.txt
```

Le banc `tests/brand_assets.mjs` fait la même vérification et refuse toute divergence.
