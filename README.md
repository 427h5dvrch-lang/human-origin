# HumanOrigin™ (Core)
### La preuve d'effort à l'ère synthétique.

> **Standard de preuve d’origine humaine par analyse comportementale locale.**
> *Local-first keystroke dynamics observer & certification layer.*

---

## 📥 Téléchargement (V1.0)

Ceci est une version Alpha fonctionnelle.

- **🍏 Pour Mac (Apple Silicon & Intel) :** [Télécharger le .dmg](LIEN_VERS_TON_DMG)
- **🪟 Pour Windows (10/11) :** [Télécharger le .exe](LIEN_VERS_TON_EXE)

*(Note : Le logiciel n'est pas encore signé numériquement. Sur Mac, faites Clic-droit > Ouvrir. Sur Windows, acceptez l'exécution via SmartScreen).*

---

## 📜 Le Manifeste

Nous sommes entrés dans l'ère de l'abondance synthétique. Si le résultat final d'une IA est indiscernable de celui d'un humain, alors la valeur ne réside plus dans le résultat, mais dans le **processus**.

**HumanOrigin** n'est pas un outil de détection d'IA. C'est une infrastructure de **Preuve d'Effort**.
Nous construisons le standard technique qui permet à un créateur de prouver, de manière cryptographique et infalsifiable, qu'il a passé du temps, réfléchi, hésité et construit son œuvre lui-même.

### Nos 3 Piliers

1.  **La Preuve par le Geste :** L'humain a un rythme, une cadence, des pauses cognitives. Nous capturons cette signature temporelle unique (le "comment") pour certifier l'origine (le "quoi").
2.  **Souveraineté Radicale (Zero-Knowledge) :** Vos données biométriques ne quittent jamais votre machine. Seul le certificat mathématique final est partagé.
3.  **Neutralité :** Nous certifions la réalité physique de l'effort de production, pas la qualité des idées.

---

## ⚙️ Fonctionnement Technique

HumanOrigin™ est un agent logiciel desktop (Rust/Tauri) fonctionnant en arrière-plan. Il observe la **dynamique de frappe** lors de l’écriture afin de produire, à la demande explicite de l’utilisateur, un certificat de compatibilité avec une origine humaine.

### 🚫 Règle d’Or (Non négociable)

* ❌ **Pas de plugin applicatif :** Aucune intrusion dans Word, Chrome, Notion, etc.
* ❌ **Pas de cloud :** Aucun envoi réseau requis. Tout est local.
* ❌ **Pas d’analyse de contenu :** Le sens des mots est ignoré (KeyChar non capturé).
* ❌ **Pas de détection d’IA spécifique :** On certifie l’humain, on ne chasse pas le robot.
* ❌ **Pas d’auto-certification :** L’utilisateur décide toujours quand observer et quand certifier.

### 🧠 Principe fondamental

Un acte d’écriture humaine laisse des traces motrices et temporelles observables. Le logiciel traite le texte comme une **trace temporelle**, jamais comme un message sémantique.

### 🛠 Tech Stack

* **Core Logic :** Rust (performance, sûreté mémoire, OS-level).
* **App Framework :** Tauri 2.x (architecture légère).
* **OS Hooks (Global) :**
    * macOS : CoreGraphics + Accessibility API.
    * Windows : Win32 API (SetWindowsHookEx).
* **Cryptographie :** Chiffrement Argon2 & AES-256 GCM local.

---

## 🚀 Utilisation (Mode d'emploi)

HumanOrigin™ repose sur deux actions strictement distinctes :

1.  **Activation (Start) :** Démarre l’observation de la dynamique de frappe. Aucune sortie n'est produite à ce stade.
2.  **Génération (Stop & Finalize) :** Produit volontairement le certificat, stoppe l’observation et détruit les données temporaires.

*Sans activation explicite, aucune observation n’a lieu.*

---

**© 2024-2025 HumanOrigin Project.**
*Construit pour restaurer la confiance.*
