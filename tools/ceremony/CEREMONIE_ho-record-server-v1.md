# Cérémonie ho-record-server-v1

> **AUCUNE CLÉ N'A ÉTÉ GÉNÉRÉE.** Ce document prépare une cérémonie à exécuter par un humain.
> La chaîne a été validée à blanc avec une paire jetable `TEST-ONLY-dry-run`, jamais écrite.

---

## 1. Contrat exact, lu dans le code

| | Valeur |
|---|---|
| `PRODUCTION KEY_ID` | `ho-record-server-v1` |
| `SECRET ENV NAME` | `HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64` |
| Second secret | `HUMANORIGIN_RECORD_KEY_ID` = `ho-record-server-v1` |
| `PRIVATE KEY FORMAT EXPECTED` | **PKCS#8 DER, encodé en base64 standard** — `protocol.ts:115`, `importKey("pkcs8", …)` via `atob` |
| `PUBLIC KEY FORMAT EXPECTED BY VERIFY` | **32 octets bruts, base64 standard** — `record_attestation.js:185-190`, `importKey("raw", …)`, longueur contrôlée |

**Point d'attention.** Verify valide la clé publique contre `/^[A-Za-z0-9+/]+={0,2}$/` : base64 **standard**.
Une clé en base64**url** — avec `-` et `_` — serait **refusée**, alors que le locator d'un Record, lui,
emploie base64url. Ne pas confondre les deux encodages.

Rien n'est supposé depuis `countersign-proof`, dont le secret, le format d'attestation et la
canonicalisation diffèrent.

---

## 2. Déroulé

### Avant

```bash
cd ~/Developer/HO_FIRSTRUN_RC/human-origin
node tools/ceremony/generate_record_key.mjs --dry-run      # doit afficher 7 contrôles ✓
supabase projects list                                     # confirmer le projet lié
```

Le script **refuse de s'exécuter sans mode explicite** : aucune exécution accidentelle ne
produit de clé.

### Voie A — sans aucun passage sur disque, recommandée

```bash
node tools/ceremony/generate_record_key.mjs --stdout-env \
  | supabase secrets set --env-file /dev/stdin
```

La clé privée ne touche aucun disque, n'entre dans aucun historique, n'apparaît dans aucun
`argv` ni dans `ps`. Le récapitulatif public part sur **stderr** et ne pollue pas le tube.

Si la commande échoue, **aucune clé n'est conservée** : relancer la cérémonie. Rien n'a été
publié à ce stade, changer de paire est sans conséquence.

### Voie B — fichier temporaire, si le tube n'est pas possible

```bash
F=~/ho-record-key.env
node tools/ceremony/generate_record_key.mjs --env-file "$F"     # écrit en 0600, refuse d'écraser
supabase secrets set --env-file "$F"
rm "$F"
node tools/ceremony/generate_record_key.mjs --verify-deleted "$F"
```

Le script contrôle lui-même que les permissions valent bien `600` et s'arrête sinon.

> **Réserve honnête.** Sur APFS, supprimer un fichier ne garantit pas l'effacement des blocs,
> et réécrire par-dessus n'y change rien sur SSD. La voie A est la seule sans résidu disque.

### Après

```bash
supabase secrets list       # doit montrer les deux noms, jamais les valeurs
```

Conserver, hors de tout dépôt : `key_id`, `public_key`, `public_key_sha256_fingerprint`.
**Ne jamais conserver ni transmettre la clé privée.**

---

## 3. Matériel public

Les trois seules valeurs montrables après la cérémonie :

```
key_id                       : ho-record-server-v1
public_key                   : <44 caractères base64 standard>
public_key_sha256_fingerprint: <64 caractères hexadécimaux>
```

Entrée à ajouter **ensuite** dans `verify-record/src/trust_keys.js` — pas avant :

```js
{
  key_id: "ho-record-server-v1",
  alg: "ed25519",
  public_key: "<public_key de la cérémonie>",
  status: "active",
  valid_from: "<date de la cérémonie, ISO 8601 UTC, millisecondes, Z>",
  retired_at: null,
  revoked_at: null,
},
```

`valid_from` doit être **antérieure ou égale** au premier `server_signed_at` émis, sans quoi
les premières attestations seraient refusées. La poser à l'instant de la cérémonie convient.

---

## 4. Sauvegarde — décision actée : AUCUNE

La clé privée de `ho-record-server-v1` vit **uniquement** dans le secret Supabase
`HUMANORIGIN_RECORD_SIGNING_PRIVATE_KEY_B64`. Aucune sauvegarde hors ligne pour V1.

Ce que cela coûte, et pourquoi c'est tenable : perdre la clé privée **n'invalide aucune
attestation déjà émise**, Verify ne se servant que de la clé publique. En cas de perte :

1. retirer `v1` de l'émission — `status: "retiring"` puis `"retired"` ;
2. générer `v2` lors d'une nouvelle cérémonie ;
3. **conserver la clé publique de `v1`** dans le jeu, pour que l'historique reste vérifiable.

Une seule copie, une seule surface d'exposition. Le risque assumé est la perte, pas le vol.

## 5. Rotation

### Perdre `v1` ne rend aucun Record invérifiable

Verify ne se sert **jamais** de la clé privée. Il valide une signature avec la **clé publique**
du jeu épinglé. Tant que l'entrée `ho-record-server-v1` reste dans `trust_keys.js`, toutes les
attestations émises pendant sa validité restent vérifiables, même si la clé privée a disparu.

### `v2` s'ajoute sans retirer `v1`

`trust_keys.js` porte une **liste**. `verifierAttestation` sélectionne l'entrée par `key_id`, puis
contrôle la fenêtre de validité contre `server_signed_at`. Deux entrées coexistent sans ambiguïté :
chaque attestation désigne la sienne.

### Quatre situations, distinctes

Une entrée révoquée **n'est jamais supprimée** du jeu. La supprimer ferait dire à Verify
« je ne connais pas cette clé » là où la vérité est « je la connais et je la refuse ».
`UNKNOWN_KEY_ID` reste réservé à une clé **réellement** inconnue.

| Situation | Entrée dans `trust_keys.js` | Résultat dans Verify |
|---|---|---|
| **ACTIVE** | `status: "active"`, `retired_at: null`, `revoked_at: null` | émission sous cette clé ; vérification normale |
| **RETIRED_BUT_TRUSTED** | `status: "retired"`, `retired_at` renseignée | plus aucune émission. Les attestations **antérieures** à `retired_at` restent `SERVER_ATTESTED` ; les postérieures donnent `ATTESTATION_PROBLEM / KEY_NOT_VALID_AT_TIME`. **Le retrait n'invalide pas le passé.** |
| **REVOKED** | `status: "revoked"`, `revoked_at` renseignée — **entrée conservée** | **toutes** les attestations de cette clé donnent `ATTESTATION_PROBLEM / REVOKED_KEY`, passées comprises. Jamais `SERVER_ATTESTED`, jamais `LEGACY`, jamais `UNKNOWN_KEY_ID`. |
| **INCONNUE** | absente du jeu | `ATTESTATION_PROBLEM / UNKNOWN_KEY_ID` |

La révocation est **totale et non bornée dans le temps** : une compromission se découvre
après coup, et l'on ignore quand la clé a fui. `revoked_at` consigne la date de la
**décision**, il ne sert pas de seuil. Une variante bornée dans le temps serait possible,
mais elle supposerait connaître l'instant de la fuite — ce qui n'est presque jamais le cas.

**Recouvrement.** Une clé en retrait reste au moins **90 jours** dans le jeu, le temps qu'une
version de Verify portant `v2` atteigne les utilisateurs. Un utilisateur sur une vieille version
ne connaît pas `v2` : il verra `ATTESTATION_PROBLEM` sur les Records récents. C'est le comportement
correct — il ne peut pas vérifier, il ne prétend pas le contraire.

---

## 6. Ce que la cérémonie ne résout pas

L'écriture au registre reste ouverte : `POST /r/<record_id>` sans authentification. Un Record
forgé en première écriture demeure possible. Consigné comme **PUBLIC LAUNCH BLOCKER**, chantier
distinct, hors de ce périmètre.
