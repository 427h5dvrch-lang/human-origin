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

> ### Dette V1 — portée Netlify
>
> Configuration réellement appliquée le 2026-09-20 à
> `HUMANORIGIN_REGISTRY_WRITE_PUBLIC_KEYS`, sur le site `humanorigin-registry` :
>
> - **contexte : Production uniquement** ;
> - **scopes : `builds`, `functions`, `post_processing`, `runtime`** — les quatre.
>
> Le plan Netlify **Free ne permet pas** de limiter la variable au seul scope `Functions` :
> l'API répond `403 Upgrade your Netlify account to set specific scopes`, et la capacité
> `env_var_scopes` du compte est déclarée `included: false`. Seul le ciblage de **contexte**
> a pu être appliqué, et il l'a été.
>
> La valeur étant une **clé publique**, cette extension de portée **n'introduit aucune fuite
> de secret**.
>
> **Cette configuration ne serait pas acceptable pour un secret.**
>
> À réévaluer si le site Registry est un jour connecté à Git, si des Deploy Previews ou des
> Branch deploys deviennent possibles, ou si l'architecture de déploiement change.

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

### INCIDENT 2026-09-21/22 — contournement de l'isolation RC par IPv6

**Un Record non réservé a été écrit dans le registre de production.**

`HO-2rWr2ptGaV9P`, déposé le **2026-09-22 à 10:51:13** (08:51:13 UTC), horodatage relevé dans
`finalizer_state.json`. Confirmé présent : `GET /r/<id>` en production répond `200`. Il
provient du document n°5 du smoke RC n°1, dont l'identifiant avait été **tiré localement** par
le volet Transition faute de `HOReservedId` — donc sans réservation ni capability.

**Cause — deux défauts qui se combinent.**

L'isolation du banc RC reposait sur une ligne `/etc/hosts` : `127.0.0.1
registry.humanorigin.io`. Cette ligne ne déclare qu'une adresse **IPv4**. macOS continue de
résoudre l'enregistrement **AAAA**, et `dscacheutil` rend les deux familles :

    ipv6_address: 2a05:d014:58f:6200::259    <- production, joignable
    ip_address:   127.0.0.1                  <- détournement, IPv4 seulement

Tant que le registre RC local écoutait, il absorbait le trafic et refusait tout (`401`). Le
second défaut a rouvert la porte : le finalizer **rejoue indéfiniment** un échec terminal —
voir le P1 « terminal Registry failure retry control », 232 POST observés. Lorsque le démontage
a arrêté le serveur local sans pouvoir retirer la ligne `/etc/hosts`, faute de `sudo`, la
tentative suivante a basculé sur IPv6, atteint le vrai registre, et y a été **acceptée** : la
production est encore en écriture ouverte.

**Conséquences.**

- `HO-2rWr2ptGaV9P` est **définitivement brûlé**. `onlyIfNew` interdit tout remplacement :
  l'identifiant est pris, sous un Record non réservé, et rien ne peut le corriger.
- Aucune réutilisation de cet identifiant n'est possible.
- Périmètre établi : **un seul** Record sur la fenêtre RC. Les 51 autres entrées `HO-*` du
  store sont antérieures, et les documents n°6 et 7 ne portent aucun locator.

**Décisions.**

- **`/etc/hosts` est interdit comme frontière d'isolation RC.** Une entrée IPv4 ne borne rien
  tant qu'un AAAA subsiste, et ajouter `::1` ne ferait que déplacer la fragilité : une
  frontière d'isolation ne doit pas dépendre de l'ordre de résolution du système.
- Le futur banc RC vise une **URL locale littérale**, compilée dans le build RC. Aucun nom de
  production n'est détourné, donc aucune résolution à contourner.
- Un build de production ne doit pouvoir contacter **que** l'URL canonique, un build RC **que**
  l'URL locale — ce qui ferme du même geste le P1 de destination ci-dessous.

**Limite de l'audit.** L'API Netlify Blobs ne rend que `key` et `etag` : **aucun horodatage**.
La datation des dépôts repose donc sur `finalizer_state.json`, local, et sur la corrélation
entre les locators des documents et les clés du store. Les 35 entrées sans document local
correspondant n'ont pas pu être datées.

### P1 BEFORE PUBLIC LAUNCH — Registry destination pinning

**Statut : OPEN.** Aucun correctif appliqué. Constaté le 2026-09-21 pendant la préparation
du RC Registry Write V1.

**État actuel.** `src-tauri/src/ho_finalizer.rs` lit `cfg.registry` depuis
`finalizer_config.json` sans validation stricte de destination : `scan_once` retient la
valeur telle quelle et ne retombe sur `https://registry.humanorigin.io` qu'en son absence.

**Risque.** Une modification locale de cette configuration peut rediriger un build de
**production** vers un autre endpoint Registry. Les Records partiraient alors, chiffrés mais
accompagnés d'une capability valide, vers un serveur choisi par qui a écrit ce fichier.

**Invariant cible avant lancement public.**

- Build de production : destination autorisée **uniquement** `https://registry.humanorigin.io`.
- Aucune URL arbitraire provenant de la configuration d'exécution.
- Une destination locale ou RC n'est permise que derrière un mécanisme **explicitement
  réservé aux builds de développement ou RC, et désactivé par défaut** — par exemple un
  `feature` Cargo qui n'est pas activé par `npm run build:mac-app`.
- **Aucune réduction de la défense d'hôte côté registre.** Le pinning se fait côté client ;
  le refus de tout `POST` dont l'hôte n'est pas `registry.humanorigin.io` reste entier.

**Le RC actuel ne dépend pas de cette faiblesse.** La procédure de smoke RC conserve le
**hostname canonique** de bout en bout — le volet, le finalizer et la capability visent tous
`registry.humanorigin.io` — et détourne uniquement sa **résolution réseau**, par une entrée
temporaire dans `/etc/hosts` pointant vers la machine locale. Aucune URL n'est surchargée,
`cfg.registry` n'est pas modifié, et la défense d'hôte est exercée pour de bon plutôt que
contournée. Corriger ce P1 ne remettra donc pas en cause le montage du RC.

**Les écritures anonymes déjà effectuées sont indétectables.** Le schéma C2.1 ne porte aucune
marque d'authentification, et `onlyIfNew` garantit qu'un Record existant n'est jamais remplacé :
un identifiant préempté avant la fermeture **bloque définitivement** le Record légitime
correspondant. Ce risque est antérieur et n'est pas refermable a posteriori.
