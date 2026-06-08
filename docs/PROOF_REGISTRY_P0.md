# PROOF_REGISTRY_P0.md — HumanOrigin Public Proof Registry

Étape 4 du plan cloud signing. Endpoint public de lookup d'une preuve officielle.

---

## Endpoint

```
GET /functions/v1/proof-registry?id={proof_id}
```

**Pas d'authentification requise.** Endpoint public (`verify_jwt = false`).

---

## Réponse — preuve active

```json
{
  "ok": true,
  "proof_id": "uuid",
  "status": "active",
  "server_signed_at": "2026-06-08T10:00:00Z",
  "visible_verdict": "COHERENT",
  "server_key_id": "ho-server-v1",
  "app_version": "0.1.19",
  "security_schema_version": "2026-06-p0",
  "revoked_at": null,
  "revocation_reason": null
}
```

## Réponse — preuve révoquée

```json
{
  "ok": true,
  "proof_id": "uuid",
  "status": "revoked",
  "server_signed_at": "...",
  "revoked_at": "...",
  "revocation_reason": "..."
}
```

## Réponse — preuve inconnue (`404`)

```json
{ "ok": false, "error": "proof_not_found" }
```

## Réponse — paramètre manquant (`400`)

```json
{ "ok": false, "error": "Missing required parameter: id" }
```

---

## Champs publics exposés

| Champ | Description |
|-------|-------------|
| `proof_id` | UUID de la preuve |
| `status` | `active` / `revoked` / `superseded` |
| `server_signed_at` | Date de contre-signature serveur |
| `visible_verdict` | Verdict visible HumanOrigin |
| `server_key_id` | Identifiant de la clé serveur |
| `app_version` | Version de l'app qui a produit la preuve |
| `security_schema_version` | Version du schéma de sécurité |
| `revoked_at` | Date de révocation si applicable |
| `revocation_reason` | Raison de révocation si applicable |

## Champs explicitement non exposés

| Champ | Raison |
|-------|--------|
| `issuer_account_id` | Identifiant privé — jamais exposé |
| `organization_id` | Privé — P0 toujours null |
| `server_signature` | Redondant pour le lookup public |
| `payload_sha256` | Pourrait servir à des corrélations |
| `document_sha256` | Idem — minimal P0 |
| `local_signature` | Non stocké dans `proofs` |
| `local_public_key` | Non stocké dans `proofs` |

---

## Sécurité

- La fonction utilise le `SERVICE_ROLE_KEY` (env secret) pour lire depuis la table `proofs` qui a RLS activé.
- Elle sélectionne explicitement les colonnes publiques — pas de `SELECT *`.
- Validation UUID de `proof_id` avant toute requête DB.
- CORS `*` : le verifier est une page web publique, les requêtes cross-origin sont attendues.

---

## Intégration verifier

Le verifier (`humanorigin-verifier-repo/index.html`) appelle cet endpoint automatiquement
si un `server_attestation.proof_id` est présent dans le HO-JSON.

Constante dans le verifier :
```javascript
const HO_REGISTRY_LOOKUP_URL =
  "https://bhlisgvozsgqxugrfsiu.supabase.co/functions/v1/proof-registry";
```

Comportement verifier :
| Résultat | Affichage |
|----------|-----------|
| `status: "active"` | "Preuve enregistrée dans le registre HumanOrigin ✅" |
| `status: "revoked"` | "Preuve révoquée ❌" |
| `error: "proof_not_found"` | "Preuve inconnue du registre HumanOrigin ⚠️" |
| Fetch timeout / erreur réseau | "Registre inaccessible — statut de révocation non vérifié ⚠️" |
| `server_attestation` absent | Aucun appel registre |

**Principe offline-first :** si le registre est inaccessible, la vérification cryptographique
locale reste valide. Le verifier n'invalide jamais une preuve pour cause d'inaccessibilité du registre.

---

## Variables d'environnement requises

| Variable | Description |
|----------|-------------|
| `SERVICE_ROLE_KEY` | Clé service role Supabase (déjà présente dans `countersign-proof`) |

---

## Limites P0

- Pas de pagination ni de lookup par `payload_sha256` dans ce patch.
- Pas de rate limiting côté Edge Function (à ajouter en P1 si trafic significatif).
- La révocation est manuelle via Supabase Dashboard (champ `status = 'revoked'`).
- Déploiement : `supabase functions deploy proof-registry`

---

*Voir aussi : `docs/SERVER_COUNTERSIGN_P0.md`, `docs/HUMANORIGIN_SERVER_ATTESTATION_SPEC.md`*
