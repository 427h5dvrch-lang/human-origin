# HUMANORIGIN SERVER ATTESTATION SPEC

Version : 1.0  
Statut : DRAFT — spec de référence avant implémentation  
Date : 2026-06-07  
Auteur : HumanOrigin Engineering

---

## 1. Définitions

### 1.1 Preuve locale

Une preuve locale est produite par l'application HumanOrigin sans aucun appel à un serveur tiers. Elle contient :

- un `payload` signé par une clé Ed25519 générée localement sur le device de l'utilisateur ;
- `payload.issuer.key_trust = "local_unregistered_key"` ;
- `payload.issuer.issuer_mode = "local"` ou `"cloud_account"` selon que l'utilisateur a un compte actif ;
- aucun champ `server_attestation` à la racine.

**Ce que la preuve locale garantit :**  
La signature Ed25519 est cryptographiquement valide. Si elle est vérifiée, le payload n'a pas été modifié depuis la signature.

**Ce qu'elle ne garantit pas :**  
L'identité de l'émetteur n'est pas vérifiée par HumanOrigin. La clé locale peut avoir été compromise. Il n'existe aucun registre de révocation.

---

### 1.2 Preuve compte cloud (sans contre-signature)

Un utilisateur avec un compte Supabase actif produit une preuve avec `issuer_mode = "cloud_account"`. Le JWT de session confirme l'identité du compte au moment de l'export. Cependant :

- La signature reste locale (`key_trust = "local_unregistered_key"`).
- Aucun champ `server_attestation` n'est présent.
- Le verifier l'identifie comme un compte cloud mais sans garantie officielle.

---

### 1.3 Preuve officielle HumanOrigin

Une preuve officielle est une preuve locale dont le payload a été soumis à un serveur HumanOrigin qui a :

1. vérifié la cohérence du payload selon les règles de sécurité courantes ;
2. vérifié la validité de la signature locale ;
3. vérifié l'identité et la licence du compte émetteur ;
4. produit une `server_attestation` signée avec une clé Ed25519 officielle HumanOrigin ;
5. enregistré la preuve dans le registre officiel avec un `proof_id` stable.

La preuve officielle contient un champ `server_attestation` à la racine du HO-JSON, hors `payload`.

---

### 1.4 Ce que le serveur atteste

- Le payload a été soumis par un compte HumanOrigin actif identifiable.
- La signature locale était valide au moment de la soumission.
- Le payload respectait le schéma de sécurité déclaré (`security_schema_version`).
- L'application utilisée (`app_version`) était dans la liste des versions autorisées.
- Le `payload_sha256` n'avait pas déjà été enregistré (anti-replay).
- La preuve est enregistrée et son statut peut être vérifié dans le registre.

---

### 1.5 Ce que le serveur n'atteste pas

- Le serveur n'a pas observé le processus comportemental. Il se fie au payload produit par l'application.
- Le serveur ne certifie pas le contenu du document.
- Le serveur ne garantit pas que la clé locale n'a pas été compromise avant la soumission.
- Le serveur ne prouve pas l'absence d'IA ni la véracité du contenu.
- Le serveur ne certifie pas une création complète.

**Cette limitation doit être documentée dans les interfaces destinataires et dans le verifier.**

---

## 2. Règle d'immutabilité du payload

### Principe fondamental

Le `payload` du HO-JSON est signé localement par `sign_payload_hash`. À partir du moment où la signature locale est produite, **le `payload` ne doit jamais être modifié**.

Toute modification du `payload` après signature locale invalide la signature et rend la preuve non vérifiable.

### Conséquences pour l'architecture

Le champ `server_attestation` est placé **à la racine du HO-JSON**, au même niveau que `payload`, `payload_sha256`, et `signatures`. Il n'est pas inclus dans `payload`.

```
{
  "format": "humanorigin-hojson",
  "version": "1.0",
  "payload": { ... IMMUABLE après signature locale ... },
  "payload_sha256": "hex",
  "signatures": [ ... ],
  "server_attestation": { ... ajouté post-soumission ... }
}
```

### Règle verifier

**Le verifier ne doit pas se fier uniquement à `payload.issuer.key_trust` pour déclarer une preuve officielle.**

`payload.issuer.key_trust = "local_unregistered_key"` restera présent dans le payload signé localement, même pour une preuve officielle. La preuve est officielle uniquement si toutes les conditions suivantes sont réunies :

1. La signature locale est valide (vérification de `signatures[0]` sur `payload_sha256`).
2. `server_attestation` est présent à la racine.
3. `server_attestation.server_signature` est valide pour `canonical(server_attestation sans server_signature)` avec la clé officielle correspondant à `server_key_id`.
4. `server_attestation.payload_sha256` est identique à `payload_sha256` à la racine.
5. Le registre confirme `status = "active"` pour `proof_id` (si online).

---

## 3. Canonicalisation

### Canonicalisation du payload local

La signature locale est produite sur :

```
SHA256( JSON.stringify( canonicalize( payload ) ) )
```

`canonicalize` applique un tri lexicographique récursif des clés (RFC 8785 / JSON Canonicalization Scheme). C'est l'implémentation existante dans `src/main.js` (`canonicalize()` + `stripForSigning()`).

### Canonicalisation de server_attestation

Le serveur produit sa signature sur :

```
SHA256( JSON.stringify( canonicalize( server_attestation_sans_server_signature ) ) )
```

Où `server_attestation_sans_server_signature` est l'objet `server_attestation` complet avec `server_signature` omis (non présent, pas null). Même algorithme de canonicalisation que le payload.

### Cohérence obligatoire

`server_attestation.payload_sha256` doit être identique à `payload_sha256` à la racine du HO-JSON. Le verifier vérifie cette égalité avant de valider la contre-signature.

---

## 4. Champs de server_attestation

```json
"server_attestation": {
  "proof_id":                  "uuid-v4 stable, généré par le serveur",
  "payload_sha256":            "hex SHA-256 du canonical payload — identique à payload_sha256 racine",
  "document_sha256":           "hex SHA-256 du document final ou null si non fourni",
  "local_signature":           "signature Ed25519 locale base64 — copie de signatures[0].signature",
  "local_public_key":          "clé publique Ed25519 locale base64 — copie de signatures[0].public_key",
  "issuer_account_id":         "UUID compte Supabase de l'émetteur",
  "organization_id":           "UUID organisation ou null si preuve individuelle",
  "app_version":               "version de l'application au moment de l'export",
  "security_schema_version":   "schéma de sécurité déclaré dans payload.issuer",
  "server_signed_at":          "ISO 8601 UTC — timestamp de la contre-signature serveur",
  "server_key_id":             "identifiant de la clé serveur — ex: ho-server-key-2026-01",
  "registry_url":              "URL publique de lookup du registre pour ce proof_id",
  "server_signature":          "signature Ed25519 serveur base64 sur canonical(server_attestation sans ce champ)"
}
```

### Détail de chaque champ

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `proof_id` | UUID v4 | Oui | Identifiant stable de la preuve dans le registre. Généré par le serveur, non réutilisable. |
| `payload_sha256` | string hex | Oui | SHA-256 du canonical payload. Doit être identique à `payload_sha256` racine. Le verifier vérifie cette égalité. |
| `document_sha256` | string hex | Non | SHA-256 du document final si fourni par l'app. Permet au verifier de lier la preuve officielle au document. |
| `local_signature` | base64 | Oui | Copie de `signatures[0].signature`. Inclus dans l'attestation pour que celle-ci soit auto-contenue. |
| `local_public_key` | base64 | Oui | Copie de `signatures[0].public_key`. Permet la vérification offline complète. |
| `issuer_account_id` | UUID | Oui | ID du compte Supabase. Non exposé publiquement dans le registre read-only. |
| `organization_id` | UUID | Non | ID de l'organisation si applicable. |
| `app_version` | string | Oui | Version de l'app (`payload.issuer.app_version`). Permet de détecter les versions dépréciées. |
| `security_schema_version` | string | Oui | Schéma de sécurité (`payload.issuer.security_schema_version`). |
| `server_signed_at` | ISO 8601 | Oui | Timestamp UTC de signature par le serveur. |
| `server_key_id` | string | Oui | Identifiant de la clé serveur. Le verifier l'utilise pour sélectionner la bonne clé publique officielle. |
| `registry_url` | string | Oui | URL de lookup publique. Format : `https://registry.humanorigin.io/proofs/{proof_id}` |
| `server_signature` | base64 | Oui | Signature Ed25519 sur `canonical(server_attestation sans ce champ)`. |

---

## 5. Données envoyées au serveur

### Autorisées

Le serveur reçoit le HO-JSON v1 complet pour pouvoir appliquer ses propres règles de validation :

- `payload` canonicalisé complet (méta-données comportementales, pas de contenu document)
- `payload_sha256`
- `signatures[0]` (signature locale + clé publique)
- `payload.issuer` (app_version, schema_version, issuer_mode)
- `payload.label_eligibility` (visible_verdict, claims, security_gates)
- `payload.document.sha256` (hash uniquement, pas contenu)
- `payload.process_summary` (totaux agrégés)
- `payload.paste_summary` (totaux agrégés)
- Compte utilisateur via JWT Supabase (Authorization header)

### Strictement interdites

Les données suivantes ne doivent **jamais** être envoyées au serveur, par aucun chemin :

- Contenu du document (texte, binaire, extraction)
- Séquences de frappes individuelles ou timing précis
- Contenu du presse-papier
- Captures d'écran
- PDF final complet
- Fichiers sources bruts
- Noms de fichiers complets (le hash suffit)

### Champs à minimiser

- `project_id` / `project_name` : UUID opaque uniquement, pas de nom de projet en clair dans le registre public
- Totaux agrégés (`active_ms`, `keystrokes`) uniquement — pas de détail par session individuelle
- `issued_at` : granularité jour suffit pour le registre public (heure UTC complète en interne)

---

## 6. Validations serveur avant signature

Le serveur effectue les vérifications suivantes dans l'ordre, et rejette avec un code d'erreur explicite si l'une échoue :

| # | Validation | Code d'erreur si échec |
|---|---|---|
| 1 | JWT Supabase valide — extraire `issuer_account_id` | `AUTH_INVALID` |
| 2 | Compte actif (non suspendu, non supprimé) | `ACCOUNT_INACTIVE` |
| 3 | Licence valide et quota disponible (si système de quota activé) | `QUOTA_EXCEEDED` |
| 4 | `payload.issuer.app_version` dans la whitelist des versions autorisées | `APP_VERSION_DEPRECATED` |
| 5 | `payload.issuer.security_schema_version` ≥ version minimale acceptée | `SCHEMA_TOO_OLD` |
| 6 | `payload_sha256` fourni == SHA-256 recalculé sur `canonical(payload)` | `PAYLOAD_HASH_MISMATCH` |
| 7 | `signatures[0].signature` est une signature Ed25519 valide sur `payload_sha256_bytes` avec `signatures[0].public_key` | `LOCAL_SIGNATURE_INVALID` |
| 8 | Si `registered_keys` activé : clé publique locale associée au compte | `KEY_NOT_REGISTERED` |
| 9 | `payload.label_eligibility.visible_verdict` cohérent avec les règles de sécurité courantes du serveur | `VERDICT_INCOHERENT` |
| 10 | `payload_sha256` non déjà présent dans la table `proofs` (anti-replay) | `PAYLOAD_ALREADY_REGISTERED` |
| 11 | Décrémentation atomique du quota | `QUOTA_RACE_CONDITION` |

Si toutes les validations passent, le serveur construit et signe `server_attestation`, insère dans `proofs`, retourne la réponse.

---

## 7. Table proofs (registre)

```sql
CREATE TABLE proofs (
  proof_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload_sha256            TEXT NOT NULL UNIQUE,
  document_sha256           TEXT,
  issued_at                 TIMESTAMPTZ NOT NULL,
  server_signed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  app_version               TEXT NOT NULL,
  security_schema_version   TEXT NOT NULL,
  issuer_account_id         UUID NOT NULL,
  organization_id           UUID,
  visible_verdict           TEXT NOT NULL,
  server_key_id             TEXT NOT NULL,
  server_signature          TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'revoked', 'superseded')),
  revoked_at                TIMESTAMPTZ,
  revocation_reason         TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON proofs (payload_sha256);
CREATE INDEX ON proofs (issuer_account_id);
CREATE INDEX ON proofs (status);
```

### Endpoint public de lookup (lecture seule)

```
GET /v1/proofs/{proof_id}
```

Retourne uniquement :

```json
{
  "proof_id": "uuid",
  "status": "active",
  "server_signed_at": "ISO",
  "visible_verdict": "COHERENT",
  "server_key_id": "ho-server-key-2026-01",
  "server_signature": "base64"
}
```

**Ne retourne pas** : `issuer_account_id`, `organization_id`, `document_sha256`, `app_version` en détail, ni aucune donnée personnelle.

---

## 8. Logique verifier — cas par cas

### Cas 1 — Preuve locale

**Condition** : `server_attestation` absent à la racine.

**Vérifications** :
1. `signatures[0].signature` valide sur `payload_sha256` avec `signatures[0].public_key`
2. `payload_sha256` == SHA-256 recalculé sur `canonical(payload)`

**Affichage** :  
"Signature locale valide — identité non vérifiée par HumanOrigin"  
`key_trust: local_unregistered_key` confirmé.

**Pas de lookup registre.**

---

### Cas 2 — Compte cloud sans contre-signature

**Condition** : `server_attestation` absent + `payload.issuer.issuer_mode = "cloud_account"`.

**Vérifications** : identiques au Cas 1.

**Affichage** :  
"Compte cloud détecté — signature locale uniquement, sans contre-signature serveur"

---

### Cas 3 — Preuve officielle contre-signée

**Condition** : `server_attestation` présent.

**Vérifications** :
1. `signatures[0].signature` valide sur `payload_sha256` (signature locale)
2. `payload_sha256` == `server_attestation.payload_sha256` (cohérence)
3. `server_attestation.server_key_id` présent dans `HO_OFFICIAL_PUBKEYS`
4. `server_attestation.server_signature` valide sur `canonical(server_attestation sans server_signature)` avec la clé officielle correspondante
5. (Si online) Lookup registre : `proof_id` → `status = "active"`

**Affichage si tout valide et online** :  
"Preuve officielle HumanOrigin ✅"

**Affichage si tout valide mais offline** :  
"Preuve officielle (signature valide) — Statut registre non vérifié (hors ligne)"

---

### Cas 4 — Preuve révoquée

**Condition** : Lookup registre → `status = "revoked"`.

**Affichage** :  
"Preuve révoquée ❌ — [revocation_reason] — Révoquée le [revoked_at]"

---

### Cas 5 — proof_id inconnu du registre

**Condition** : `server_attestation.server_signature` valide, mais `proof_id` absent du registre.

**Affichage** :  
"Contre-signature présente mais inconnue du registre HumanOrigin ⚠ — Ne pas accepter comme preuve officielle"

---

### Cas 6 — Registre inaccessible (offline)

**Condition** : Timeout ou erreur réseau lors du lookup.

**Affichage** :  
"Statut registre non vérifié (hors ligne) — La signature cryptographique est valide"

**Ne pas bloquer la vérification locale.** Le fallback offline est gracieux.

---

## 9. Gestion des clés serveur

### Type de clé

Ed25519 — même algorithme que la signature locale, cohérence de la chaîne de vérification. Implémentation : `ed25519-dalek` côté serveur (Rust) ou `@noble/ed25519` côté Node.

### Identifiant de clé

Format : `ho-server-key-{env}-{YYYY}-{seq}`

Exemples :
- `ho-server-key-dev-2026-01`
- `ho-server-key-prod-2026-01`
- `ho-server-key-prod-2026-06`

### Séparation environnements

**Règle absolue** : aucune clé de dev/staging ne doit être acceptée par le verifier de production. La map `HO_OFFICIAL_PUBKEYS` dans le verifier est versionnée dans le code du verifier et ne peut contenir que des clés `prod`.

```javascript
// Dans le verifier (prod uniquement)
const HO_OFFICIAL_PUBKEYS = {
  "ho-server-key-prod-2026-01": "base64_pubkey_prod_01",
  // Nouvelles clés ajoutées ici lors de rotation
};
```

### Rotation

1. Générer une nouvelle paire Ed25519.
2. Ajouter la clé publique dans `HO_OFFICIAL_PUBKEYS` du verifier avec le nouveau `server_key_id`.
3. Déployer le verifier avant d'activer la nouvelle clé côté serveur.
4. Configurer le serveur pour signer avec la nouvelle clé.
5. Conserver l'ancienne clé dans `HO_OFFICIAL_PUBKEYS` : les preuves historiques doivent rester vérifiables.
6. Ne jamais supprimer une clé de la map tant qu'une preuve active dans le registre y fait référence.

### Stockage de la clé privée serveur

| Environnement | P0 | P1/Production |
|---|---|---|
| Clé privée | Supabase Secrets (env var chiffrée) | Secret manager dédié (Infisical, AWS Secrets Manager) |
| Accès | Edge Function runtime | Backend dédié, accès restreint |
| Audit log | Limité | Obligatoire |

La clé privée serveur ne doit jamais être exposée en clair dans les logs, les réponses API, ou le code source.

---

## 10. Anti-abus et mitigations de sécurité

| Risque | Sévérité | Mitigation | Priorité |
|---|---|---|---|
| **Replay d'ancienne preuve** | Haute | `payload_sha256 UNIQUE` dans `proofs` — rejet immédiat si déjà enregistré. | P0 |
| **Payload modifié après signature locale** | Haute | Serveur recalcule `SHA-256(canonical(payload))` et compare à `payload_sha256` fourni. Puis vérifie la signature locale. Toute modification invalide les deux. | P0 |
| **Document remplacé** | Moyenne | `document_sha256` dans `server_attestation`. Le verifier compare au hash du document déposé. Divergence → avertissement explicite. | P0 |
| **Fausse clé locale** | Haute | Phase P1 : clé locale enregistrée (`registered_keys`) lors du login. Le serveur refuse une clé non enregistrée pour le compte. Phase P0 : non mitigé — risque résiduel documenté. | P1 |
| **Fausse contre-signature** | Haute | Le verifier vérifie `server_signature` avec la clé publique officielle hardcodée. Impossible à forger sans la clé privée serveur. | P0 |
| **Faux verifier** | Haute | Le verifier est distribué via GitHub Pages sur domaine HTTPS officiel contrôlé. L'app pointe vers une URL fixe dans sa config. | P1 |
| **Ancienne app vulnérable** | Haute | Whitelist `app_version` côté serveur. Les versions dépréciées reçoivent `APP_VERSION_DEPRECATED`. Les preuves locales produites par des versions dépréciées ne peuvent pas être officialisées. | P0 |
| **Schema de sécurité ancien** | Moyenne | `security_schema_version` minimum obligatoire côté serveur (`SCHEMA_TOO_OLD`). | P0 |
| **Licence contournée** | Haute | JWT Supabase vérifié côté serveur + lookup table `licenses`. Impossible de soumettre sans JWT valide. | P0 |
| **Quota contourné** | Moyenne | Décrémentation atomique du quota dans une transaction. Condition de race → `QUOTA_RACE_CONDITION`. | P1 |
| **Preuve officielle demandée après manipulation locale** | Haute | Le serveur ré-applique ses propres règles de cohérence verdict/security_gates indépendamment de l'app. Un payload manipulé qui viole ces règles est rejeté. | P1 |
| **Clé de test en production** | Haute | Maps `HO_OFFICIAL_PUBKEYS` strictement séparées dev/prod dans le code du verifier. Déploiements distincts. | P0 |
| **Clé locale compromise pré-soumission** | Très haute | **Risque résiduel non mitigeable.** La contre-signature atteste que la clé a signé le payload au moment de la soumission, pas que la clé n'a pas été volée avant. Ce risque est documenté dans les interfaces. La mitigation P2 est l'enregistrement de clé liée au compte avec détection d'anomalie de clé. | Documenté |

---

## 11. Roadmap d'implémentation

### Étape 1 — Spec validée ✓

Ce document. Aucun code écrit. Validation de l'architecture avant toute implémentation.

**Critère de sortie** : spec relue et validée, aucune ambiguïté ouverte sur le schéma, la canonicalisation, ou la logique verifier.

---

### Étape 2 — Verifier supporte server_attestation (sans registre)

**Périmètre** : `humanorigin-verifier-repo/index.html` uniquement.

Actions :
- Ajouter `isOfficialProof(doc)` : retourne `true` si `server_attestation` présent.
- Ajouter `verifyServerAttestation(doc, isFr)` : vérifie `server_signature` avec `HO_OFFICIAL_PUBKEYS`.
- Ajouter la map `HO_OFFICIAL_PUBKEYS` (vide pour l'instant, clé de dev uniquement).
- Afficher Cas 3 / Cas 5 selon résultat.
- Pas de lookup registre dans cette étape.

**Critère de sortie** : un HO-JSON de test avec `server_attestation` synthétique est correctement identifié comme "officiel" ou "signature inconnue".

---

### Étape 3 — Edge Function countersign P0

**Périmètre** : Supabase Edge Function `countersign`.

Actions :
- Implémenter les 11 validations serveur (section 6).
- Générer et signer `server_attestation` avec clé de dev.
- Insérer dans table `proofs`.
- Retourner `server_attestation`.
- Tester avec curl.

**Critère de sortie** : un appel curl avec un HO-JSON v1 valide retourne un `server_attestation` valide. Un payload rejoué retourne `PAYLOAD_ALREADY_REGISTERED`.

---

### Étape 4 — Table proofs + registre lookup

**Périmètre** : Supabase Postgres + Edge Function read-only + verifier.

Actions :
- Créer table `proofs` (section 7).
- Endpoint `GET /v1/proofs/{proof_id}` retournant les champs publics.
- Verifier : ajouter lookup registre dans Cas 3 avec timeout 3s et fallback offline.
- Verifier : afficher Cas 4 si `status = "revoked"`.
- Interface admin minimale : révoquer un `proof_id`.

**Critère de sortie** : une preuve révoquée s'affiche en rouge dans le verifier. Une preuve valide s'affiche "officielle" avec confirmation registre.

---

### Étape 5 — App appelle countersign avec fallback local

**Périmètre** : `src/main.js` — fonction `signHoDocV1` uniquement.

Actions :
- Après `await signHoDocV1()`, appeler `POST /v1/proofs/countersign` si utilisateur connecté.
- Si succès : insérer `server_attestation` dans `hoDocV1` et noter `proof_trust_level = "official_humanorigin_proof"` dans un champ hors-payload (pas modifier payload).
- Si échec réseau / timeout (5s) : continuer avec preuve locale. Avertir l'utilisateur.
- Si quota dépassé : informer l'utilisateur clairement.
- Si app_version dépréciée : informer l'utilisateur qu'une mise à jour est nécessaire.

**Critère de sortie** : un export produit un HO-JSON avec `server_attestation` valide si connecté. Un export offline produit une preuve locale sans bloquer.

---

## Annexe A — Exemple HO-JSON avec server_attestation

```json
{
  "format": "humanorigin-hojson",
  "version": "1.0",
  "payload": {
    "certificate_type": "final_project_certificate",
    "certificate_id": "uuid",
    "issued_at": "2026-06-07T14:32:00Z",
    "issuer": {
      "product": "HumanOrigin",
      "issuer_mode": "cloud_account",
      "app_version": "0.1.19",
      "security_schema_version": "2026-06-p0",
      "proof_trust_level": "account_bound_local_signature",
      "key_trust": "local_unregistered_key"
    },
    "...": "..."
  },
  "payload_sha256": "a3f8c1d2e4b7...",
  "signatures": [
    {
      "role": "issuer",
      "algorithm": "ed25519",
      "signed_field": "payload_sha256",
      "public_key": "base64_local_pubkey",
      "signature": "base64_local_sig"
    }
  ],
  "server_attestation": {
    "proof_id": "550e8400-e29b-41d4-a716-446655440000",
    "payload_sha256": "a3f8c1d2e4b7...",
    "document_sha256": "7f83b1657399...",
    "local_signature": "base64_local_sig",
    "local_public_key": "base64_local_pubkey",
    "issuer_account_id": "user-uuid",
    "organization_id": null,
    "app_version": "0.1.19",
    "security_schema_version": "2026-06-p0",
    "server_signed_at": "2026-06-07T14:32:05Z",
    "server_key_id": "ho-server-key-prod-2026-01",
    "registry_url": "https://registry.humanorigin.io/proofs/550e8400-e29b-41d4-a716-446655440000",
    "server_signature": "base64_server_sig"
  }
}
```

**Note** : `payload.issuer.key_trust` reste `"local_unregistered_key"` car il fait partie du payload immuable signé localement. Le statut officiel est porté par `server_attestation`, pas par `payload.issuer`.

---

## Annexe B — Algorithme de vérification complet (verifier)

```
function verifyComplete(doc):

  // 1. Vérification locale (toujours)
  canonPayload   = canonical(doc.payload)
  computedHash   = SHA256(JSON.stringify(canonPayload))
  localSig       = doc.signatures[0].signature
  localPubkey    = doc.signatures[0].public_key
  localSigValid  = ed25519.verify(computedHash_bytes, localSig, localPubkey)
  hashMatch      = (computedHash == doc.payload_sha256)

  if !localSigValid OR !hashMatch:
    return INVALID_LOCAL_SIGNATURE

  // 2. server_attestation absent → preuve locale
  if !doc.server_attestation:
    if doc.payload.issuer.issuer_mode == "cloud_account":
      return CLOUD_NO_COUNTERSIGN
    return LOCAL_PROOF

  att = doc.server_attestation

  // 3. Cohérence payload_sha256
  if att.payload_sha256 != doc.payload_sha256:
    return ATTESTATION_HASH_MISMATCH

  // 4. Clé serveur connue
  serverPubkey = HO_OFFICIAL_PUBKEYS[att.server_key_id]
  if !serverPubkey:
    return UNKNOWN_SERVER_KEY

  // 5. Signature serveur
  attToSign     = {... att sans server_signature ...}
  attHash       = SHA256(JSON.stringify(canonical(attToSign)))
  serverSigValid = ed25519.verify(attHash_bytes, att.server_signature, serverPubkey)

  if !serverSigValid:
    return INVALID_SERVER_SIGNATURE

  // 6. Lookup registre (optionnel, timeout 3s)
  try:
    registryStatus = fetch(att.registry_url, timeout=3000)
    if registryStatus.status == "revoked":
      return PROOF_REVOKED(registryStatus)
    if registryStatus.proof_id != att.proof_id:
      return UNKNOWN_IN_REGISTRY
    return OFFICIAL_PROOF_ACTIVE(registryStatus)
  catch NetworkError:
    return OFFICIAL_PROOF_OFFLINE_UNVERIFIED
```
