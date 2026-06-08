# CLOUD_ACTIVATION_RUNBOOK.md — HumanOrigin Preuves Officielles

Procédure complète pour activer les preuves officielles HumanOrigin en production.
Applicable après les commits d'infrastructure cloud (Étapes 1–5).

> **Règle absolue** : ne jamais committer la clé privée serveur dans le dépôt.
> La clé privée existe uniquement dans les secrets Supabase et dans un stockage sécurisé hors-ligne.

---

## 0. Contexte technique

| Composant | Fichier / Endpoint | Rôle |
|-----------|--------------------|------|
| Spec | `docs/HUMANORIGIN_SERVER_ATTESTATION_SPEC.md` | Référence format |
| Edge Function countersign | `supabase/functions/countersign-proof/index.ts` | Signe `server_attestation` |
| Edge Function registry | `supabase/functions/proof-registry/index.ts` | Lookup public |
| Migration | `supabase/migrations/20260608000000_create_proofs_table.sql` | Table `proofs` |
| App integration | `src/main.js` — `tryCountersignHoJson()` | Appel post-signature |
| Verifier | `humanorigin-verifier-repo/index.html` — `HO_OFFICIAL_SERVER_KEYS` | Vérifie la clé serveur |

---

## 1. Pré-requis Supabase

- Accès au projet Supabase : `bhlisgvozsgqxugrfsiu`
- Supabase CLI installé localement (`npm install -g supabase` ou `brew install supabase/tap/supabase`)
- Accès au Dashboard Supabase : Project Settings > Edge Functions > Secrets

Vérifier l'authentification CLI :
```bash
supabase login
supabase projects list
```

---

## 2. Déploiement migration — table `proofs`

```bash
cd /Users/dazeasphilippe/Desktop/human-origin

# Appliquer la migration sur le projet distant
supabase db push --project-ref bhlisgvozsgqxugrfsiu
```

Vérification dans Supabase Dashboard > Table Editor : la table `proofs` doit apparaître avec RLS activé.

Si la migration a déjà été appliquée manuellement, vérifier que les colonnes correspondent à `supabase/migrations/20260608000000_create_proofs_table.sql`.

---

## 3. Déploiement Edge Functions

```bash
cd /Users/dazeasphilippe/Desktop/human-origin

# Déployer countersign-proof (authentification requise)
supabase functions deploy countersign-proof --project-ref bhlisgvozsgqxugrfsiu

# Déployer proof-registry (public, pas de JWT)
supabase functions deploy proof-registry --project-ref bhlisgvozsgqxugrfsiu
```

Vérifier dans Supabase Dashboard > Edge Functions que les deux fonctions apparaissent avec statut "Active".

---

## 4. Génération de la paire de clés serveur Ed25519

Cette étape se fait **une seule fois**, **hors-ligne**, et le résultat est stocké dans un gestionnaire de secrets (ex. 1Password, coffre-fort, note chiffrée).

### Option A — Python (recommandé si cryptography disponible)

```bash
python3 - <<'EOF'
import base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

priv = Ed25519PrivateKey.generate()
seed = priv.private_bytes_raw()
pub  = priv.public_key().public_bytes_raw()

print("=== CONSERVER EN LIEU SÛR — NE PAS COMMITTER ===")
print(f"HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64 = {base64.b64encode(seed).decode()}")
print(f"HUMANORIGIN_SERVER_PUBLIC_KEY_B64          = {base64.b64encode(pub).decode()}")
print(f"HUMANORIGIN_SERVER_KEY_ID                  = ho-server-v1")
EOF
```

### Option B — Node.js (si Python non disponible)

```bash
node - <<'EOF'
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);
const pub  = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
console.log("PRIVATE:", priv.toString('base64'));
console.log("PUBLIC: ", pub.toString('base64'));
EOF
```

> ⚠️ Stocker les trois valeurs dans un gestionnaire de secrets sécurisé immédiatement.
> Supprimer la sortie du terminal après avoir copié les valeurs.

---

## 5. Variables d'environnement à configurer

Configurer dans **Supabase Dashboard > Project Settings > Edge Functions > Secrets**.

| Variable | Valeur | Sensibilité |
|----------|--------|-------------|
| `HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64` | Base64 de la graine Ed25519 (32 octets) | 🔴 SECRET — jamais exposé |
| `HUMANORIGIN_SERVER_KEY_ID` | `ho-server-v1` (ou version suivante) | Peut être public |
| `HUMANORIGIN_SERVER_PUBLIC_KEY_B64` | Base64 de la clé publique Ed25519 (32 octets) | Public — ira dans le verifier |
| `SERVICE_ROLE_KEY` | Clé service role du projet Supabase | 🔴 SECRET |

La `SERVICE_ROLE_KEY` est disponible dans Supabase Dashboard > Project Settings > API > `service_role` (section "Project API keys").

### Via CLI (alternative au Dashboard)

```bash
supabase secrets set \
  HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64="<valeur>" \
  HUMANORIGIN_SERVER_KEY_ID="ho-server-v1" \
  HUMANORIGIN_SERVER_PUBLIC_KEY_B64="<valeur>" \
  SERVICE_ROLE_KEY="<valeur>" \
  --project-ref bhlisgvozsgqxugrfsiu
```

---

## 6. Règle : ne jamais committer la clé privée

- Ne pas mettre la clé privée dans `.env`, `config.js`, `CLAUDE.md`, ni aucun fichier du dépôt.
- Ne pas la passer en argument de ligne de commande visible dans l'historique shell.
- Si la clé est compromise : en générer une nouvelle, mettre à jour les secrets Supabase, mettre à jour `HO_OFFICIAL_SERVER_KEYS` dans le verifier avec la nouvelle clé publique, et révoquer les preuves signées par l'ancienne clé si nécessaire.
- Seule la **clé publique** peut apparaître dans le code source (dans le verifier).

---

## 7. Ajouter la clé publique dans le verifier

Fichier : `humanorigin-verifier-repo/index.html`

Trouver la ligne :
```javascript
const HO_OFFICIAL_SERVER_KEYS={};
```

Remplacer par :
```javascript
const HO_OFFICIAL_SERVER_KEYS={
  "ho-server-v1": "<HUMANORIGIN_SERVER_PUBLIC_KEY_B64>"
};
```

Exemple avec une vraie clé (fictive) :
```javascript
const HO_OFFICIAL_SERVER_KEYS={
  "ho-server-v1": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
};
```

> La valeur doit être **exactement** la base64 de la clé publique Ed25519 (32 octets = 44 caractères base64).

---

## 8. Redéploiement du verifier

```bash
cd /Users/dazeasphilippe/Desktop/humanorigin-verifier-repo

git add index.html
git commit -m "Add official server public key to verifier"
git push
```

Le verifier est une page statique hébergée directement depuis ce dépôt (GitHub Pages ou équivalent). Le push suffit à déployer.

---

## 9. Test end-to-end

### Pré-conditions
- Utilisateur connecté dans l'app (pas de mode local)
- Les 3 secrets Supabase configurés
- Les deux fonctions déployées
- La clé publique dans le verifier

### Séquence de test

**1. Export depuis l'app**
```
App → Projet → Exporter
→ Toast attendu : "Preuve officielle HumanOrigin ✅"
  (si toast = "Preuve locale HumanOrigin prête ✅" → countersign a échoué, voir Troubleshooting)
```

**2. Vérifier le HO-JSON exporté**
```bash
# Dans le package exporté
cat "*/2_SEND_TO_RECIPIENT/HumanOrigin_PROOF.v1.ho.json" | python3 -m json.tool | grep -A5 "server_attestation"
```
Attendu : bloc `server_attestation` présent à la racine, avec `proof_id`, `server_key_id: "ho-server-v1"`, `server_signature`.

**3. Vérifier dans le registre**
```bash
PROOF_ID=$(cat "*/HumanOrigin_PROOF.v1.ho.json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('server_attestation',{}).get('proof_id',''))")
curl "https://bhlisgvozsgqxugrfsiu.supabase.co/functions/v1/proof-registry?id=${PROOF_ID}"
```
Attendu :
```json
{ "ok": true, "proof_id": "...", "status": "active", "visible_verdict": "..." }
```

**4. Vérifier dans le verifier**
- Ouvrir `https://humanorigin.app/verify` (ou URL du verifier)
- Importer `HumanOrigin_PROOF.v1.ho.json`
- Attendu :
  - Bannière verte "Contre-signature serveur HumanOrigin ✅"
  - Bannière verte "Preuve enregistrée dans le registre HumanOrigin ✅"

---

## 10. Troubleshooting

### `500 { "error": "server signing key not configured" }`
**Cause** : les secrets `HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64`, `HUMANORIGIN_SERVER_KEY_ID` ou `HUMANORIGIN_SERVER_PUBLIC_KEY_B64` sont absents ou mal nommés.
**Solution** : vérifier dans Supabase Dashboard > Edge Functions > Secrets. Les noms doivent être **exactement** ceux du tableau section 5. Redéployer la fonction après avoir ajouté les secrets :
```bash
supabase functions deploy countersign-proof --project-ref bhlisgvozsgqxugrfsiu
```

### `409 { "error": "Duplicate payload: ..." }`
**Cause** : ce `payload_sha256` a déjà été countersigné. Anti-replay normal.
**Comportement app** : l'app reçoit 409, log `[COUNTERSIGN] Server error`, conserve la preuve locale sans `server_attestation`.
**Si légitime** : le proof_id existant est retourné dans la réponse. Il n'y a pas de nouvelle entrée dans `proofs`.

### `401 { "error": "Unauthorized" }`
**Cause** : l'utilisateur n'est pas connecté, ou le JWT est expiré.
**Comportement app** : `tryCountersignHoJson` retourne `{ ok:false, reason:"not_authenticated" }` immédiatement (pas d'appel réseau si `currentUser.isLocal`).

### Registre inaccessible dans le verifier
**Symptôme** : bandeau gris "Registre inaccessible — statut de révocation non vérifié ⚠️"
**Cause** : la fonction `proof-registry` n'est pas déployée, ou `SERVICE_ROLE_KEY` manquant, ou problème réseau.
**Impact** : la preuve cryptographique reste valide. Ce n'est qu'une vérification de révocation supplémentaire.
**Solution** : `supabase functions deploy proof-registry --project-ref bhlisgvozsgqxugrfsiu`

### `server_key_id` non reconnu dans le verifier
**Symptôme** : bandeau orange "Contre-signature serveur présente, mais clé non reconnue ⚠️"
**Cause** : `HO_OFFICIAL_SERVER_KEYS` dans le verifier ne contient pas le `server_key_id` de la preuve.
**Solution** : s'assurer que la clé publique dans le verifier correspond exactement à `HUMANORIGIN_SERVER_PUBLIC_KEY_B64` et que le `server_key_id` dans les secrets correspond à la clé dans `HO_OFFICIAL_SERVER_KEYS`.

### Signature serveur invalide dans le verifier
**Symptôme** : bandeau rouge "Contre-signature serveur invalide ❌"
**Cause probable** :
- La clé publique dans le verifier ne correspond pas à la clé privée utilisée pour signer
- La `server_attestation` a été altérée après signature
**Solution** : vérifier que `HUMANORIGIN_SERVER_PUBLIC_KEY_B64` dans les secrets est la clé publique dérivée de `HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64`. Les deux doivent former une paire Ed25519 cohérente.

### Toast "Preuve locale" au lieu de "Preuve officielle"
**Cause** : `tryCountersignHoJson` a échoué silencieusement (voir `console.warn [COUNTERSIGN]` dans les DevTools Tauri).
**Diagnostic** : ouvrir les DevTools Tauri (menu Vue > DevTools) et chercher `[COUNTERSIGN]`.
**Causes fréquentes** :
- Secrets Supabase manquants → voir "500 server signing key not configured"
- Utilisateur non connecté → mode local, comportement normal
- Timeout 7 s → vérifier la latence de la fonction (Dashboard > Edge Functions > Logs)

---

## 11. Rollback

### Désactiver les secrets (preuve locale uniquement)
```bash
# Supprimer les secrets de signature serveur
supabase secrets unset HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64 HUMANORIGIN_SERVER_KEY_ID HUMANORIGIN_SERVER_PUBLIC_KEY_B64 --project-ref bhlisgvozsgqxugrfsiu
```

Après cette opération :
- `countersign-proof` retourne `500 "server signing key not configured"`
- L'app capte l'erreur, log `[COUNTERSIGN] Server error`, continue avec la preuve locale
- L'export n'est **jamais bloqué** — le comportement dégradé est la preuve locale
- Toast : "Preuve locale HumanOrigin prête ✅"

### Désactiver le verifier (retirer la clé publique)
Dans `humanorigin-verifier-repo/index.html`, repasser à :
```javascript
const HO_OFFICIAL_SERVER_KEYS={};
```
Les preuves avec `server_attestation` existantes afficheront "clé non reconnue" au lieu de "valide", mais elles restent cryptographiquement vérifiables localement.

### Principe garanti
**L'export local ne dépend jamais du serveur de contre-signature.** Le bloc `tryCountersignHoJson` est entièrement non-bloquant. Si le serveur est indisponible, la preuve locale Ed25519 est produite et l'export se termine normalement.

---

## Références

| Document | Contenu |
|----------|---------|
| `docs/HUMANORIGIN_SERVER_ATTESTATION_SPEC.md` | Spec complète du format `server_attestation` |
| `docs/SERVER_COUNTERSIGN_P0.md` | Détails de la fonction `countersign-proof` |
| `docs/PROOF_REGISTRY_P0.md` | Détails de la fonction `proof-registry` |
| `supabase/functions/countersign-proof/index.ts` | Code Edge Function |
| `supabase/functions/proof-registry/index.ts` | Code Edge Function |
| `supabase/migrations/20260608000000_create_proofs_table.sql` | Schéma table `proofs` |
