# SERVER_COUNTERSIGN_P0.md — HumanOrigin Edge Function countersign-proof

Étape 3 du plan cloud signing. La fonction valide et contre-signe un HO-JSON v1.

---

## Fichiers créés

| Fichier | Rôle |
|---------|------|
| `supabase/functions/countersign-proof/index.ts` | Edge Function principale |
| `supabase/functions/countersign-proof/deno.json` | Import map Deno |
| `supabase/migrations/20260608000000_create_proofs_table.sql` | Table `proofs` |
| `supabase/config.toml` | Enregistrement de la fonction |

---

## Variables d'environnement requises

Configurer dans Supabase > Project Settings > Edge Functions :

| Variable | Type | Description |
|----------|------|-------------|
| `HUMANORIGIN_SERVER_SIGNING_PRIVATE_KEY_B64` | secret | Base64 de la graine Ed25519 (32 octets) |
| `HUMANORIGIN_SERVER_KEY_ID` | secret | Identifiant opaque de la clé serveur (ex. `ho-server-v1`) |
| `HUMANORIGIN_SERVER_PUBLIC_KEY_B64` | secret | Base64 de la clé publique Ed25519 (32 octets) |
| `SERVICE_ROLE_KEY` | secret | Clé service role Supabase (déjà présente dans sign-cert) |

**Si les variables de clé serveur sont absentes** : la fonction retourne immédiatement
`500 { "ok": false, "error": "server signing key not configured" }` sans traiter la requête.

**Ne jamais générer une clé à la volée.** La clé doit être générée hors-ligne, vérifiée,
et injectée manuellement dans les secrets Supabase.

---

## Génération d'une clé serveur (exemple, hors-ligne)

```bash
# Avec @noble/ed25519 ou sodium-native, générer une graine Ed25519 (32 bytes)
# Exemple Python :
python3 -c "
import os, base64
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
priv = Ed25519PrivateKey.generate()
seed = priv.private_bytes_raw()
pub  = priv.public_key().public_bytes_raw()
print('PRIVATE (seed):', base64.b64encode(seed).decode())
print('PUBLIC:        ', base64.b64encode(pub).decode())
"
```

La clé publique doit ensuite être ajoutée dans `HO_OFFICIAL_SERVER_KEYS` du verifier
pour que les preuves officielles soient reconnues.

---

## Endpoint

```
POST /functions/v1/countersign-proof
Authorization: Bearer <user JWT>
Content-Type: application/json
```

---

## Format de requête

```json
{
  "format": "humanorigin-hojson",
  "version": "1.0",
  "payload": { "...": "..." },
  "payload_sha256": "abcdef...",
  "signatures": [
    {
      "role": "issuer",
      "algorithm": "ed25519",
      "signed_field": "payload_sha256",
      "public_key": "<base64>",
      "signature": "<base64>"
    }
  ]
}
```

**Règle privacy :** ne jamais envoyer de contenu document (champs `document_content`,
`document_bytes`, `file_content`). Le payload ne doit contenir que des métadonnées et
le hash du document (`payload.document.sha256`).

---

## Validations serveur P0

| # | Validation |
|---|------------|
| 1 | Méthode POST uniquement |
| 2 | Authorization Bearer JWT obligatoire et valide |
| 3 | `format = "humanorigin-hojson"` |
| 4 | `payload` présent et objet |
| 5 | `payload_sha256` présent |
| 6 | `signatures[0].signature` présente |
| 7 | `signatures[0].public_key` présente |
| 8 | Recalcul de `SHA256(canonical(payload))` côté serveur |
| 9 | Hash recalculé = `payload_sha256` fourni |
| 10 | Vérification signature Ed25519 locale (message = 32 octets bruts du hash) |
| 11 | `app_version` présent dans payload (depth 0 ou 1) |
| 12 | `security_schema_version` présent dans payload |
| 13 | `visible_verdict` présent dans payload |
| + | Rejet si contenu document envoyé |

---

## Format de réponse

### Succès `200`
```json
{
  "ok": true,
  "proof_id": "uuid",
  "server_attestation": {
    "proof_id": "uuid",
    "payload_sha256": "...",
    "document_sha256": "... ou null",
    "local_signature": "...",
    "local_public_key": "...",
    "issuer_account_id": "uuid",
    "organization_id": null,
    "app_version": "...",
    "security_schema_version": "...",
    "server_signed_at": "ISO 8601",
    "server_key_id": "...",
    "registry_url": null,
    "server_signature": "<base64>"
  },
  "status": "active"
}
```

### Erreur type
```json
{ "ok": false, "error": "description lisible" }
```

### Anti-replay `409`
```json
{ "ok": false, "error": "Duplicate payload: ...", "proof_id": "uuid existant" }
```

---

## Table `proofs`

Voir `supabase/migrations/20260608000000_create_proofs_table.sql`.

RLS activé. Les utilisateurs authentifiés ne peuvent lire que leurs propres preuves.
La fonction utilise le service role qui bypass RLS.

---

## Limites P0

- `organization_id` = null (pas encore implémenté)
- `registry_url` = null (registre lookup non implémenté)
- `HO_OFFICIAL_SERVER_KEYS` dans le verifier est vide → aucune preuve n'est déclarée
  officielle tant que la clé publique serveur n'y est pas ajoutée
- La fonction n'est **pas encore appelée par l'app** (`src/main.js` non modifié)
- Pas de déploiement automatique dans ce patch — à déployer manuellement via
  `supabase functions deploy countersign-proof`

---

## État du verifier

Le verifier (`humanorigin-verifier-repo/index.html`, commit `dcabe17`) est déjà prêt :
- `HO_OFFICIAL_SERVER_KEYS = {}` — map vide, aucune preuve officielle reconnue
- `verifyServerAttestation(doc)` — vérifie `server_attestation` si présent
- Quand la clé publique serveur sera ajoutée à `HO_OFFICIAL_SERVER_KEYS`, les preuves
  contre-signées seront automatiquement affichées comme officielles

---

## Prochaine étape (Étape 4)

- Ajouter `registry_url` pointant vers un endpoint de lookup public
- Implémenter le lookup dans le verifier (vérification en ligne du statut)
- Révocation : champ `status` déjà présent dans la table `proofs`

---

*Voir aussi : `docs/HUMANORIGIN_SERVER_ATTESTATION_SPEC.md` — spec complète du modèle.*
