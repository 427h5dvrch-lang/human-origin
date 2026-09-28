# Marque HumanOrigin — copie versionnée

`STATUS = FROZEN` · `DO NOT REDRAW` · `DO NOT RECREATE FROM FONT` · `DO NOT SUBSTITUTE FINGERPRINT`

Ces fichiers sont des copies **octet pour octet** du paquet d'identité officiel
`HUMANORIGIN_BRAND_MASTER_V1`, dont la spécification complète est `BRAND_SPEC.md`. Ils sont
versionnés ici pour que l'application puisse les embarquer et pour qu'une substitution soit
détectable — pas pour être modifiés.

| Fichier | Rôle | Dimensions |
|---|---|---|
| `HumanOrigin_fingerprint_navy.png` | empreinte seule, encre marine `#012454`, sur fond clair | 130 × 137 |
| `HumanOrigin_fingerprint_white.png` | même couche alpha, encre blanche `#FAFAFB`, sur fond marine | 130 × 137 |

L'empreinte a été isolée du Golden Master par composantes connexes : aucun pixel coupé ni
ajouté, **aucun cercle ajouté**. Ne pas l'entourer, ne pas la recadrer, ne pas la recolorer.

Seule la **taille** varie selon le contexte. Elle entre dans l'interface par un seul point,
`HumanOriginBrandMark` dans `../ho_desktop.js` : aucun écran ne redessine ni ne réimporte la
marque ailleurs.

## Vérifier

```sh
cd src/brand && shasum -a 256 -c SHA256SUMS.txt
```

Le banc `tests/brand_assets.mjs` fait la même vérification et refuse toute divergence.
