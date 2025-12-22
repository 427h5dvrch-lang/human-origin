# HumanOrigin™ (V0)

> **Standard de preuve d’origine humaine par analyse comportementale locale**  
> *Local-first keystroke dynamics observer & certification layer*

---

## 🎯 Mission

HumanOrigin™ V1 est un agent logiciel desktop fonctionnant en arrière-plan, qui observe **la dynamique de frappe** lors de l’écriture afin de produire, à la demande explicite de l’utilisateur, un **certificat de compatibilité avec une origine humaine**.

- Le contenu sémantique n’est jamais analysé.
- Aucune donnée n’est exfiltrée.
- Tout le traitement est local.

HumanOrigin™ certifie un **acte d’écriture**, pas une identité, ni une vérité absolue.

---

## 🚫 Règle d’Or (Non négociable)

- ❌ **Pas de plugin applicatif**  
  (aucune intégration dans Word, Chrome, Notion, Cursor, etc.)

- ❌ **Pas de cloud**  
  (aucun envoi réseau requis pour le MVP)

- ❌ **Pas d’analyse de contenu**  
  (le sens des mots est hors périmètre)

- ❌ **Pas de détection d’IA spécifique**  
  (on certifie l’humain, on ne chasse pas le robot)

- ❌ **Pas d’auto-certification**  
  (l’utilisateur décide toujours quand observer et quand certifier)

---

## 🧠 Principe fondamental

HumanOrigin™ repose sur un postulat simple :

> Un acte d’écriture humaine laisse des traces motrices et temporelles
> observables indépendamment du contenu du texte.

Le logiciel traite le texte comme une **trace temporelle**, jamais comme un message.

---

## 🛠 Tech Stack (MVP)

- **Core Logic** :  
  [Rust](https://www.rust-lang.org/) — performance, sûreté mémoire, OS-level

- **Application Framework** :  
  [Tauri 2.x](https://tauri.app/) — architecture légère Rust / WebView

- **OS Hooks (Global)** :
  - macOS : `CoreGraphics` + `Accessibility API`
  - Windows : `Win32 API` (`SetWindowsHookEx`)

- **Interface minimale** :  
  HTML / JavaScript (Tray / Menu Bar / Overlay discret)

- **Cryptographie** :  
  Signature locale (`Ed25519` ou équivalent)

---

## ⚙️ Modèle d’usage (clé)

HumanOrigin™ repose sur **deux actions strictement distinctes** :

1. **Activation (début)**  
   → démarre l’observation de la dynamique de frappe  
   → aucune sortie produite

2. **Génération (fin)**  
   → produit volontairement le certificat  
   → stoppe l’observation et détruit les données temporaires

Sans activation, aucune observation n’a lieu.  
Sans demande de génération, aucun certificat n’est produit.

---

## ✅ Roadmap & Checklist Dev — MVP V1

### 1. Setup & Environnement
- [ ] Initialiser projet Tauri (Rust + Frontend minimal)
- [ ] App sans fenêtre principale (Service + Tray uniquement)
- [ ] Packaging installable (DMG / `.exe`)

---

### 2. Permissions & Intégration OS
- [ ] **macOS** : Demande permission *Accessibilité*
- [ ] **macOS** : Gestion du refus (message clair, pas de crash)
- [ ] **Windows** : Préparer le Global Hook clavier

---

### 3. Mécanisme d’écoute globale (The Ear)
- [ ] Capture événements `KeyDown` / `KeyUp`
- [ ] Capture timestamps précis (millisecondes)
- [ ] **Privacy** : aucune capture de caractère (`KeyChar`)
- [ ] Écoute inactive tant que `Mode != Actif`

---

### 4. Logique & Mémoire (The Brain)
- [ ] États explicites : `Passif` / `Actif`
- [ ] **Buffer RAM uniquement**
- [ ] Stockage des intervalles temporels (flight times)
- [ ] **Kill switch** :
  - génération du certificat
  - abandon utilisateur
  - crash / quit app
- [ ] Implémentation de l’algorithme V1
      (variance / écarts validés en prototype)

---

### 5. Cryptographie & Certificat
- [ ] Génération paire de clés à l’installation
- [ ] Stockage sécurisé :
  - macOS : Keychain
  - Windows : Credential Locker
- [ ] Format de sortie : JSON signé
- [ ] Contenu :
