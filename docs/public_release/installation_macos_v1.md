# Guide d'installation macOS — V1

> Phrase boussole : **« HumanOrigin prouve que vous avez travaillé sur ce document — pas ce que vous avez écrit. »**
> Compass line: **“HumanOrigin proves you worked on this document — not what you wrote.”**

---

## 🇫🇷 Français

### Installer HumanOrigin sur macOS

1. Téléchargez le fichier HumanOrigin.
2. Glissez **HumanOrigin** dans votre dossier **Applications**.
3. Au premier lancement, macOS peut afficher un avertissement de sécurité (application non encore notarisée par Apple).
   **Faites un clic droit sur l'icône → Ouvrir → Ouvrir.** Vous n'aurez à le faire qu'une seule fois.
4. Autorisez l'accès **Accessibilité** quand l'app le demande : c'est ce qui lui permet d'observer votre activité (frappes et clics).

### Confidentialité

HumanOrigin traite localement votre document pour calculer des empreintes et des indicateurs de modification. Le contenu du document n'est pas envoyé à HumanOrigin, et HumanOrigin ne juge pas ce que vous avez écrit.

### Si le message « HumanOrigin est endommagé » apparaît

Ouvrez le Terminal et lancez :

```
xattr -dr com.apple.quarantine /Applications/HumanOrigin.app
```

Puis relancez l'application.

> Note : cette étape manuelle disparaîtra une fois l'application notarisée par Apple.

---

## 🇬🇧 English

### Install HumanOrigin on macOS

1. Download the HumanOrigin file.
2. Drag **HumanOrigin** into your **Applications** folder.
3. On first launch, macOS may show a security warning (the app is not yet notarized by Apple).
   **Right-click the icon → Open → Open.** You only need to do this once.
4. Grant **Accessibility** access when the app asks: this is what lets it observe your activity (keystrokes and clicks).

### Privacy

HumanOrigin processes your document locally to compute fingerprints and change indicators. The document's content is not sent to HumanOrigin, and HumanOrigin does not judge what you wrote.

### If you see “HumanOrigin is damaged”

Open Terminal and run:

```
xattr -dr com.apple.quarantine /Applications/HumanOrigin.app
```

Then relaunch the app.

> Note: this manual step will disappear once the app is notarized by Apple.
