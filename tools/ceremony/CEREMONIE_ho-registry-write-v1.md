# Cérémonie ho-registry-write-v1

> **AUCUNE CLÉ N'A ÉTÉ GÉNÉRÉE.** Ce document prépare une cérémonie à exécuter par un humain.
> La chaîne a été validée à blanc avec une paire jetable `TEST-ONLY-dry-run`, jamais écrite.

Clé **dédiée** à l'autorisation d'écriture au registre, strictement distincte de
`ho-record-server-v1` : protocoles séparés, rotation indépendante, rayon d'explosion borné.
La cérémonie de `ho-record-server-v1` et son script ne sont pas modifiés — ils constituent la
trace d'audit d'une clé déjà en service.

---

## 1. Règle qui prime sur tout le reste

> **Une clé publique posée chez Netlify n'existe qu'à partir du deploy suivant, et continue
> d'exister dans tous les deploys antérieurs.**

Les variables d'environnement sont capturées au moment du deploy. Modifier la variable ne
change **que** les deploys futurs. Toute manipulation de clé publique se lit donc ainsi :

```
variable modifiée  →  nouveau deploy  →  suppression des deploys portant encore l'ancienne clé
```

Tant que la troisième étape n'est pas faite, **la clé n'est pas retirée** : elle est seulement
retirée de la production. Aucun autre énoncé ne doit être tenu à son sujet.

---

## 2. Contrat exact, lu dans le code

| | Valeur |
|---|---|
| `key_id` | `ho-registry-write-v1` |
| Algorithme | Ed25519, signature **directe** sur les octets UTF-8 de l'énoncé canonique, **sans pré-hachage** |
| Domaine | `HumanOrigin.RegistryWrite/v1` |
| Durée de vie d'une capability | **90 jours** — `DUREE_JOURS`, `protocol.ts` |
| `SECRET ENV NAME` | `HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64` |
| Second secret | `HUMANORIGIN_REGISTRY_WRITE_KEY_ID` = `ho-registry-write-v1` |
| Variable publique | `HUMANORIGIN_REGISTRY_WRITE_PUBLIC_KEYS` |
| `PRIVATE KEY FORMAT EXPECTED` | **PKCS#8 DER, encodé en base64 standard** — `importerClePrivee`, `importKey("pkcs8", …)` via `atob` |
| `PUBLIC KEY FORMAT EXPECTED` | **32 octets bruts, base64 standard** — `capability.mjs`, `importKey("raw", …)`, longueur contrôlée |

**Piège d'encodage.** Le registre décode la clé publique par `atob` : base64 **standard**.
Une clé en base64**url** — avec `-` et `_` — serait refusée. Ne pas confondre avec le transport
de la capability elle-même, qui est en base64url.

**Format de la variable publique** : `key_id:cle_publique`, plusieurs paires séparées par des
virgules, espaces tolérés. Le découpage se fait au **premier** deux-points. Une clé publique en
base64 standard ne contient ni `:` ni `,` : le script le vérifie avant d'émettre quoi que ce soit.

Rien n'est supposé depuis `countersign-proof` ni depuis `ho-record-server-v1`, dont les secrets,
les formats et les canonicalisations diffèrent.

---

## 3. Deux destinations

| | Contenu | Où | Portée |
|---|---|---|---|
| **PRIVÉ** | `HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64` + `HUMANORIGIN_REGISTRY_WRITE_KEY_ID` | secrets Supabase | lu par `reserve-record-id`, qui **émet** les capabilities |
| **PUBLIC** | `HUMANORIGIN_REGISTRY_WRITE_PUBLIC_KEYS` | variable d'environnement Netlify, **scope Functions**, **contexte Production** | lu par le registre, qui **vérifie** les capabilities |

Le registre ne détient que du public : il ne peut pas émettre de capability.

**Pourquoi le contexte Production seul.** Un deploy preview ne reçoit alors pas la variable,
`clesPubliques()` renvoie une Map vide, toute capability tombe sur `UNKNOWN_KEY_ID` → `401`.
Le code échoue **fermé** sans configuration supplémentaire.

*État au 2026-09-20 : le site du registre n'est connecté à aucun dépôt Git. Deploy previews et
branch deploys sont donc impossibles par construction. Le scoping par contexte reste la bonne
pratique, et redeviendrait indispensable si le site était un jour branché sur GitHub.*

---

## 4. Déroulé

### Avant

```bash
cd ~/Developer/HO_RECORD_STEP_D/human-origin
node tools/ceremony/generate_registry_write_key.mjs --dry-run   # doit afficher 8 contrôles ✓
supabase projects list                                          # confirmer le projet lié
```

Le script **refuse de s'exécuter sans mode explicite** : aucune exécution accidentelle ne
produit de clé.

### Voie A — sans aucun passage sur disque, recommandée

```bash
node tools/ceremony/generate_registry_write_key.mjs \
  --stdout-env --public-out ~/ho-registry-write-v1.public.txt \
  | supabase secrets set --env-file /dev/stdin
```

La clé privée ne touche aucun disque, n'entre dans aucun historique, n'apparaît ni dans `argv`
ni dans `ps`. Le matériel public part sur **stderr** et dans le reçu ; il ne pollue pas le tube.

Si la commande échoue, **aucune clé n'est conservée** : relancer la cérémonie. Rien n'ayant été
publié à ce stade, changer de paire est sans conséquence.

> **`--public-out` n'est pas facultatif en pratique.** Sans lui, fermer le terminal après un
> tube réussi laisse une clé privée chez Supabase dont la clé publique est perdue :
> `supabase secrets list` n'en restitue qu'un condensé, et rien ne permet de la recalculer.
> Le seul recours serait de refaire la cérémonie.

### Voie B — fichier temporaire, si le tube n'est pas possible

```bash
F=~/ho-registry-key.env
node tools/ceremony/generate_registry_write_key.mjs \
  --env-file "$F" --public-out ~/ho-registry-write-v1.public.txt
supabase secrets set --env-file "$F"
rm "$F"
node tools/ceremony/generate_registry_write_key.mjs --verify-deleted "$F"
```

Le script contrôle lui-même que les permissions valent bien `600` et s'arrête sinon.

> **Réserve honnête.** Sur APFS, supprimer un fichier ne garantit pas l'effacement des blocs,
> et réécrire par-dessus n'y change rien sur SSD. La voie A est la seule sans résidu disque.

### Ensuite — clé publique et deploy

```bash
cat ~/ho-registry-write-v1.public.txt      # le reçu porte la ligne prête à recopier
supabase secrets list                      # doit montrer les deux noms, jamais les valeurs
```

1. Poser `HUMANORIGIN_REGISTRY_WRITE_PUBLIC_KEYS` chez Netlify — **scope Functions, contexte
   Production**.
2. **Redéployer le registre.** Sans nouveau deploy, la variable n'existe pour aucune fonction.
3. Smoke test : réserver un identifiant via `reserve-record-id`, puis `POST /r/<id>` avec la
   capability → `201`. Contrôle négatif : le même `POST` sans en-tête `Authorization` → `401`.
4. **Alors seulement**, supprimer le reçu public. Pas avant.

### Le reçu

Il ne contient **que du public** : `key_id`, clé publique, empreinte SHA-256 complète, et la
ligne d'environnement Netlify prête à recopier, avec son rappel de scope et de contexte.
Il est écrit en `0600` et refuse d'écraser un fichier existant.

---

## 5. Matériel public

Les trois seules valeurs montrables après la cérémonie :

```
key_id      : ho-registry-write-v1
public_key  : <44 caractères base64 standard>
fingerprint : <64 caractères hexadécimaux — SHA-256 des 32 octets BRUTS, pas du base64>
```

**Ne jamais conserver ni transmettre la clé privée.**

---

## 6. Sauvegarde — décision actée : AUCUNE

La clé privée vit **uniquement** dans le secret Supabase. Aucune sauvegarde hors ligne.

Ce que cela coûte, et c'est moins grave que pour la clé d'attestation : perdre la clé privée
empêche d'**émettre de nouvelles réservations**. Elle n'invalide **aucune écriture déjà faite**
au registre, et n'invalide aucune capability déjà émise tant que la clé publique reste posée.

Une seule copie, une seule surface d'exposition. Le risque assumé est la perte, pas le vol.

---

## 7. Rotation

Rotation ordinaire, sans interruption, en s'appuyant sur les 90 jours d'expiration.

1. Cérémonie `ho-registry-write-v2`.
2. Netlify : **les deux** clés coexistent dans la variable —
   `ho-registry-write-v1:<pub1>,ho-registry-write-v2:<pub2>` — puis **nouveau deploy**.
   Le registre accepte alors `v1` et `v2`.
3. Supabase : basculer `HUMANORIGIN_REGISTRY_WRITE_KEY_ID` **et**
   `HUMANORIGIN_REGISTRY_WRITE_PRIVATE_KEY_B64` vers `v2`, dans un **seul** appel
   `supabase secrets set`. Deux appels séparés laisseraient une fenêtre où le `key_id` ne
   correspond pas à la clé privée : toutes les capabilities émises pendant cette fenêtre
   seraient refusées.
4. Attendre l'**expiration de la dernière capability `v1`** — plus de 90 jours après le dernier
   appel à `reserve-record-id` servi sous `v1`.
5. Retirer `v1` de la variable Netlify.
6. **Redéployer.**
7. **Supprimer tous les deploys conservant `v1`.**

Les étapes 5 à 7 sont indissociables. S'arrêter à 5 ou à 6 ne retire rien : `v1` reste acceptée
par tout deploy antérieur, joignable par permalink, qui écrit dans le **même store**.

---

## 8. Révocation

Compromission suspectée ou avérée :

1. Retirer immédiatement le `key_id` de `HUMANORIGIN_REGISTRY_WRITE_PUBLIC_KEYS`.
2. **Nouveau deploy.**
3. **Supprimer tous les deploys portant encore la clé révoquée.**
4. Cérémonie de remplacement, puis étapes 2 et 3 de la rotation.

> **Une révocation n'est pas effective avant l'étape 3.** Avant elle, la clé révoquée reste
> acceptée par les deploys historiques. C'est le seul énoncé exact.

**Différence assumée avec le jeu de clés de Verify.** Dans `trust_keys.js`, une entrée révoquée
n'est **jamais** supprimée : la supprimer ferait dire à Verify « je ne connais pas cette clé »
là où la vérité est « je la connais et je la refuse » — un mensonge adressé à un utilisateur sur
un fait historique. Ici, c'est l'inverse : le registre n'émet aucun verdict public, il autorise
ou refuse une écriture, et son refus est volontairement **uniforme**
(`401 {"state":"unauthorized"}`, sans distinguer clé inconnue de clé révoquée — absence
d'oracle, voulue). La suppression **est** le mécanisme correct de ce côté.

---

## 9. Ce que la cérémonie ne résout pas

**Le deploy open-write actuel.** Au 2026-09-20, le site `humanorigin-registry` ne contient qu'un
seul deploy accessible, `6aa2a2b31ed9ee577d4d4a2a` du 2026-09-10, actuellement publié, et il
porte le `POST` **anonyme**. Il n'existe aujourd'hui aucun permalink périmé.

Le risque n'est pas absent, il est différé : au moment où le registre sécurisé sera publié, ce
deploy cessera d'être publié et **deviendra le premier permalink périmé — open-write, sur le
même store `ho-records`**. Il devra être supprimé **immédiatement après un smoke test réussi**.
Netlify interdit de supprimer le deploy publié ; il ne le sera plus à cet instant.

**La défense d'hôte du registre ne le remplace pas.** Le registre sécurisé refuse tout `POST`
dont l'hôte n'est pas `registry.humanorigin.io`, avant le limiteur de débit et avant toute
construction de client de stockage. Mais un ancien deploy exécute son **ancien code** et ignore
ce contrôle : la défense ne protège que les deploys qui la contiennent. Elle empêche le problème
de se reconstituer à chaque publication future ; elle ne ferme rien de ce qui est déjà publié.

**Sa fiabilité reste à établir empiriquement.** Elle repose sur le fait que Netlify sélectionne
le deploy par nom d'hôte. Test décisif, non écrivant, à passer sur le permalink du deploy
sécurisé juste après sa publication :

```bash
curl -s -X POST "https://<DEPLOY_ID>--humanorigin-registry.netlify.app/r/HO-audit-probe" \
  -H "content-type: application/json" -d '{}' -w "\n  → HTTP %{http_code}\n"
```

`401` ⇒ la défense filtre. `422` ⇒ l'hôte vu par la fonction n'est pas celui du permalink :
la défense est illusoire et ne doit plus figurer dans aucun raisonnement de sécurité.

**Les écritures anonymes déjà effectuées sont indétectables.** Le schéma C2.1 ne porte aucune
marque d'authentification, et `onlyIfNew` garantit qu'un Record existant n'est jamais remplacé :
un identifiant préempté avant la fermeture **bloque définitivement** le Record légitime
correspondant. Ce risque est antérieur et n'est pas refermable a posteriori.
