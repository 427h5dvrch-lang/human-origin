#!/usr/bin/env python3
"""Icône de l'application HumanOrigin, dérivée du seul master gelé.

Le paquet d'identité est gelé : DO NOT REDRAW · DO NOT SUBSTITUTE FINGERPRINT. Ce script
ne redessine rien et n'ajoute aucune forme à l'empreinte : il ne fait que la **cadrer**,
lui donner un **fond** et la mettre à l'**échelle**, ce que la spécification autorise pour
produire les tailles de l'icône. Aucun cercle, aucun halo, aucun monogramme.

    python3 tools/generer_icone_app.py
    npm run tauri icon tools/HumanOrigin_app_icon_1024.png

L'empreinte seule est légitime ici parce que le contexte établit déjà le nom : c'est
l'icône de l'application elle-même (BRAND_SPEC.md, « Symbole seul »).
"""
import hashlib
import pathlib
import sys

from PIL import Image, ImageDraw

RACINE = pathlib.Path(__file__).resolve().parent.parent
SOURCE = RACINE / "src" / "brand" / "HumanOrigin_fingerprint_white.png"
SORTIE = RACINE / "tools" / "HumanOrigin_app_icon_1024.png"

# Empreinte du master, telle que la déclare src/brand/SHA256SUMS.txt. Si elle change, on
# s'arrête : une icône ne se fabrique pas à partir d'une empreinte substituée.
EMPREINTE_ATTENDUE = "589e298b4a0f1c2fa56c962c3ee841b41e51b3488bbb74b62f57aac6b7793941"

MARINE = (1, 36, 84, 255)   # #012454 — fond, valeur de BRAND_SPEC.md
COTE = 1024                 # grille d'icône macOS
PLAQUE = 824                # carré arrondi, gabarit macOS
RAYON = 185                 # rayon du gabarit macOS
PART = 0.52                 # part de la plaque occupée par la hauteur de l'empreinte


def main() -> int:
    octets = SOURCE.read_bytes()
    reelle = hashlib.sha256(octets).hexdigest()
    if reelle != EMPREINTE_ATTENDUE:
        print(f"ARRÊT : {SOURCE.name} n'est pas le master gelé ({reelle[:16]}…)")
        return 1

    empreinte = Image.open(SOURCE).convert("RGBA")

    # Le carré arrondi, dessiné à 4× puis réduit : ses bords restent nets sans filtre.
    ech = 4
    plaque = Image.new("RGBA", (PLAQUE * ech, PLAQUE * ech), (0, 0, 0, 0))
    ImageDraw.Draw(plaque).rounded_rectangle(
        (0, 0, PLAQUE * ech - 1, PLAQUE * ech - 1), radius=RAYON * ech, fill=MARINE)
    plaque = plaque.resize((PLAQUE, PLAQUE), Image.LANCZOS)

    # L'empreinte : mise à l'échelle seule, ratio d'origine conservé au dixième de pixel.
    haut = round(PLAQUE * PART)
    large = round(haut * empreinte.width / empreinte.height)
    signe = empreinte.resize((large, haut), Image.LANCZOS)
    plaque.alpha_composite(signe, ((PLAQUE - large) // 2, (PLAQUE - haut) // 2))

    icone = Image.new("RGBA", (COTE, COTE), (0, 0, 0, 0))
    icone.alpha_composite(plaque, ((COTE - PLAQUE) // 2, (COTE - PLAQUE) // 2))
    icone.save(SORTIE)

    print(f"empreinte source : {SOURCE.name} {reelle[:16]}… conforme")
    print(f"empreinte à {large} × {haut} px dans une plaque de {PLAQUE} px, "
          f"ratio {empreinte.width / empreinte.height:.4f} conservé")
    print(f"écrit : {SORTIE.relative_to(RACINE)}  "
          f"{hashlib.sha256(SORTIE.read_bytes()).hexdigest()[:16]}…")
    return 0


if __name__ == "__main__":
    sys.exit(main())
