# countersign-record — attestation de service d'un engagement de Record

Endpoint **distinct** de `countersign-proof`. Les deux ne partagent ni protocole, ni format
d'attestation, ni canonicalisation, ni clé, ni table. Aucune modification du chemin HO-JSON.

Norme : `HUMANORIGIN_TRUST_FOUNDATION_V1_SPEC.md` (dépôt `humanorigin-web-consultation`).

---

## Ce que l'attestation établit — et ce qu'elle n'établit pas

> **Le service HumanOrigin a contre-signé cet engagement de Record.**

Elle **ne prouve pas** : qu'un client officiel a été employé · qu'une observation a
réellement eu lieu · qu'un humain est l'auteur · qu'aucune intelligence artificielle
n'est intervenue.

Le service ne reçoit **jamais** le Record en clair. Il ne voit qu'un condensé, qu'il ne
peut pas rapprocher d'un contenu. Son attestation porte sur l'émission par un compte
authentifié, pas sur la validité de ce qui a été condensé.

## Contrat

```
POST /functions/v1/countersign-record
Authorization: Bearer <jeton de la session existante>
{ "record_digest": "<64 caractères hexadécimaux minuscules>" }
```

Aucun autre champ n'est accepté. **Toutes les valeurs de confiance — domaine, version,
`key_id`, horodatage — sont produites par le serveur**, jamais choisies par le client.

```jsonc
201 { "ok": true, "server_attestation": {
        "version": 1, "alg": "ed25519", "key_id": "ho-record-server-v1",
        "record_digest": "…", "server_signed_at": "…", "signature": "…" } }
```

Aucun identifiant de compte, aucun courriel, aucune valeur corrélable n'entre dans
l'attestation distribuée.

## Anti-rejeu — décision figée

Une seule attestation par `record_digest`.

| Cas | Réponse |
|---|---|
| même digest, **même compte** | `200` — l'attestation existante **à l'identique** : même `server_signed_at`, même signature, même `key_id`. Aucun nouvel événement de signature. |
| même digest, **autre compte** | `409 { "ok": false, "error": "conflict" }` — rien d'autre. Ni attestation, ni horodatage, ni indication sur le propriétaire du digest. |

Une perte de réponse réseau après écriture est donc récupérable : la reprise renvoie la
même attestation au lieu d'en créer une seconde. Une course à l'écriture est rattrapée
par relecture, jamais par une deuxième signature.

## Signature

Ed25519 sur les **octets UTF-8 de l'énoncé canonique, directement**. Aucun SHA-256
intermédiaire — Ed25519 hache déjà en interne, et un pré-hachage ajouterait une liaison
plus faible. C'est une divergence assumée avec `countersign-proof`, qui signe historiquement
un condensé pré-calculé.

```jsonc
{"domain":"HumanOrigin.RecordAttestation/v1","key_id":"…","record_digest":"…",
 "server_signed_at":"…","version":1}
```

## Secrets

| Variable | Rôle |
|---|---|
| `HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64` | clé privée Ed25519, PKCS#8 base64 |
| `HUMANORIGIN_RECORD_KEY_ID` | `ho-record-server-v1` |
| `SERVICE_ROLE_KEY` | accès base pour l'anti-rejeu |

**Clé distincte de celle d'HO-JSON.** Motivation : séparation des protocoles, rayon
d'explosion borné, rotation indépendante, audit plus lisible.

La clé est générée **hors ligne** lors d'une cérémonie dédiée, jamais à la volée, jamais
dans un binaire distribué. Secret absent → `500`, le service ne sert pas.

**La cérémonie n'a pas eu lieu.** Aucune clé de production n'existe. Les tests emploient
exclusivement une paire TEST ONLY générée en mémoire.

## Vie privée

```
SERVER-SIDE ACCOUNT CORRELATION = YES   (table record_attestations, anti-abus et audit)
DISTRIBUTED IDENTITY LEAK       = NO
NEW LOGIN UX                    = NO    (la session existante est réutilisée)
```

## Tests

```bash
node supabase/functions/countersign-record/tests/run.mjs      # 47 contrôles
node supabase/functions/countersign-record/tests/croise.mjs   # accord avec Verify
```

Aucun réseau, aucune base, aucune clé de production. Le gestionnaire reçoit ses
dépendances par injection, ce qui le rend testable hors du runtime Deno.

Le banc croisé produit une attestation puis la soumet au module de vérification de Verify
et exige `SERVER_ATTESTED`. Il se déclare ignoré si l'autre dépôt est absent.

### Mutations rejouées

| Altération | Résultat |
|---|---|
| horodatage choisi par le client | détecté |
| secret de clé manquant toléré | détecté |
| identifiant de compte renvoyé dans l'attestation | détecté |
| conflit révélant le propriétaire du digest | détecté |
| champs inattendus acceptés | détecté |
| authentification retirée | détecté |

Deux de ces mutations n'étaient **pas** détectées au premier essai : le test du secret
manquant se contentait du statut `500` sans vérifier la raison, et l'horodatage n'était
protégé que par le contrôle des champs inattendus. Les deux contrôles ont été renforcés.
