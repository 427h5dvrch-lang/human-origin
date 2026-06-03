# CLAUDE.md — HumanOrigin Agent Rules

> Ce fichier est chargé automatiquement par Claude Code à chaque session.
> Il définit les règles de travail non négociables pour ce repo.

---

## État produit actuel

- Core macOS : stable et validé.
- Export PDF/DOCX → PDF publié cartouché : validé.
- Cartouche PDF premium verticale : validée et verrouillée.
- HO-JSON v1 : preuve portable de référence (dual-format maintenu pour compatibilité).
- Verifier public : fonctionnel.
- Open First / package destinataire : zone produit prioritaire active.
- **Objectif en cours** : finaliser la circulation réelle du package, UX destinataire, support Windows — sans casser le stable.

---

## Zones de travail préférées

Travailler en priorité dans ces zones, qui sont sûres et ciblées :

- `tools/` — scripts Python/Bash de post-traitement
- `docs/` — spécifications, workflows, documentation
- Textes, package, export : contenu de circulation, wording, guides destinataire
- `src/main.js` — UX Open First uniquement, par **patch ciblé et isolé**
- Scripts de packaging (`.sh`, `.py` dans `tools/`)

---

## Zones protégées

Chaque zone ci-dessous est **protégée**.  
Règle : **ne jamais modifier sauf** ticket explicite + plan préalable + confirmation utilisateur + diff lisible + check adapté.

| Zone | Fichier(s) concernés | Risque |
|------|----------------------|--------|
| Core scan clavier/souris | `src-tauri/src/main.rs` | Hooks OS, cryptographie locale — cassure silencieuse |
| Signature HO-JSON | `src-tauri/src/publication_core.rs` | Format Ed25519 verrouillé — certificats invalides si touché |
| Verifier public | (vérificateur externe) | Confiance publique non réversible |
| Cartouche PDF premium | `tools/redesign_compact_cartouche_bundle.py` + `docs/HUMANORIGIN_CARTOUCHE_STANDARD.md` + `docs/HUMANORIGIN_CARTOUCHE_DIMENSIONS.md` | Standard visuel validé, régression visuelle immédiate |
| Updater / signature Tauri | `src-tauri/tauri.conf.json`, `src-tauri/build.rs` | Signature bundle, mise à jour auto — casser = app non distribuable |
| Config Supabase / Auth | `src/supabase.js`, variables d'environnement | Auth utilisateur, sessions, données |
| Build Windows/macOS | `src-tauri/`, pipeline Tauri | Ne toucher que si explicitement demandé dans le ticket |

---

## Règles de méthode (toujours, dans cet ordre)

1. **Commencer par** `git status --short` — comprendre l'état avant tout.
2. **Proposer un plan** clair avant tout patch — une action, un fichier, un objectif.
3. **Attendre la confirmation explicite** de l'utilisateur.
4. **Appliquer le patch** de façon chirurgicale et isolée.
5. **Après patch** : afficher `git diff -- <fichier>` immédiatement.
6. **Puis seulement** lancer les checks nécessaires (pas de build complet sans raison).
7. **Ne jamais modifier plusieurs zones protégées en même temps.**
8. **Ne jamais faire `git add .`** — stager uniquement les fichiers explicitement nommés.
9. **Ne jamais supprimer les fichiers `.bak.*`** — ce sont des sauvegardes historiques intentionnelles.

---

## Règles de communication

- Répondre en **français simple**.
- **Une action à la fois** — pas de chaîne de modifications non confirmées.
- **Pas de refonte large** sauf demande explicite.
- **Ne pas "améliorer" le produit** au-delà du ticket en cours — appliquer ce qui est demandé, rien de plus.
- Si une ambiguïté existe sur le périmètre : demander avant d'agir.

---

## Architecture de référence

```
src/main.js              — Frontend Tauri (UI, flux UX, orchestration export)
src/style.css            — Styles UI
src/config.js            — Config frontend
src/supabase.js          — [PROTÉGÉ] Auth Supabase
src-tauri/src/
  main.rs                — [PROTÉGÉ] Core Rust : scan clavier/souris, hooks OS
  network.rs             — Couche réseau Rust
  publication_core.rs    — [PROTÉGÉ] Signature HO-JSON, génération certificats
  drafts.rs              — Gestion brouillons
src-tauri/publication_pdf.rs — PDF publication
publisher/               — Binaire Rust séparé (publication Windows)
tools/                   — [ZONE PRÉFÉRÉE] Scripts post-traitement packages
docs/                    — [ZONE PRÉFÉRÉE] Specs techniques
humanorigin-server/      — Serveur Node.js annexe
dist/                    — Build frontend généré (ne pas éditer)
```

---

## Commandes utiles

```bash
git status --short                            # Toujours commencer ici
npm run dev                                   # Dev frontend (port 1420)
npm run build                                 # Build frontend uniquement
npm run build:mac-app                         # Build complet Vite + Tauri
npm run refresh:mac-app                       # Kill + rebuild + réinstaller
python3 tools/patch_latest_export_package.py  # Post-traitement package export
```
