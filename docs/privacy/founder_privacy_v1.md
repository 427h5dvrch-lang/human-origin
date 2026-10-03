# Founder Privacy V1 — nettoyage, identité, et passage en privé

Aucune réécriture d'historique, aucun force-push, aucun changement de visibilité, aucun
déploiement. Ce document rend compte de ce qui a été fait et recommande la suite.

## 1 · HEAD nettoyé

Quatre fichiers portaient un chemin identifiant un poste personnel. Ils portent désormais
des variables, ce qui les rend aussi plus justes : un chemin en dur n'était de toute façon
pas reproductible ailleurs.

| Fichier | Avant | Après |
|---|---|---|
| `docs/CLOUD_ACTIVATION_RUNBOOK.md` | chemin personnel ×3 | `$HO_REPO`, `$HO_VERIFIER_REPO` |
| `docs/HUMANORIGIN_UX_CHECKPOINT_*.md` | chemin personnel | `~/Documents/...` |
| `tools/check_all.sh` | chemin en dur | `${HO_VERIFIER_REPO:-$HOME/...}` |
| `tools/post_export_latest.sh` | chemin en dur ×2 | `${HO_REPO:-$HOME/...}` |

`src-tauri/Cargo.toml` : `authors = ["Philippe"]` devient `["HumanOrigin"]`. C'est ce champ
qui alimente `CompanyName` dans les ressources PE Windows.

Syntaxe des deux scripts revérifiée.

### Ce que je n'ai PAS retiré, et pourquoi

`docs/windows/azure_blocage_validation.md` et `azure_demande_motif.md` citent « Dazeas
Philippe » comme **nom figurant sur la facture Hostinger du domaine**. Ce n'est pas une
métadonnée technique : c'est un fait du dossier Azure, et précisément la faiblesse
identifiée — la preuve de propriété du domaine est au nom d'une personne et non de la
société. **Le supprimer rendrait le dossier faux.** Laissé en place, signalé pour arbitrage.

## 2 · Identité Git dédiée

```
user.name  = HumanOrigin
user.email = 251050037+427h5dvrch-lang@users.noreply.github.com
```

Posée au niveau du dépôt, donc **héritée par les quatre worktrees** de `human-origin` —
ils partagent `.git/config` — et posée séparément sur `humanorigin-web`.

Le `user` **global reste inchangé** : les autres projets de la machine ne sont pas touchés.

L'adresse `noreply` de GitHub rattache les commits au compte sans exposer d'adresse
personnelle. Elle ne corrige rien du passé : seuls les commits futurs en bénéficient.

## 3 · Windows — préparé, non appliqué

`authors` est changé, ce qui changera `CompanyName` **au prochain build**. Aucun build,
aucune release : le rail Windows est gelé jusqu'à sa qualification sur machine réelle.

Reste à faire quand ce rail rouvrira, et **pas avant** :

- `bundle.publisher` passe de `HumanOrigin` à `DAZEAS CORP`, en cohérence avec le sujet du
  futur certificat Authenticode ;
- vérifier dans les ressources PE que `CompanyName` ne porte plus de prénom ;
- l'empreinte du RC changera, donc le pack de qualification devra être régénéré.

## 4 · Ce qui casse si `human-origin` devient privé

Les ressources de release d'un dépôt privé **exigent une authentification**. Trois choses
cassent, et l'une est irréversible.

| Surface | Casse | Gravité |
|---|---|---|
| Bouton de téléchargement de la landing | `releases/latest/download/...dmg` → 404 pour le public | réparable : changer la cible |
| `latest.json` servi publiquement | 404 | réparable côté serveur |
| **Updater des applications DÉJÀ INSTALLÉES** | **l'URL est figée dans le binaire v0.3.1** | **irréversible** |
| CI / GitHub Actions | continue de fonctionner | aucune |

### Le point qui commande tout

`tauri.conf.json` fige l'endpoint dans **chaque binaire distribué** :

```
https://github.com/427h5dvrch-lang/human-origin/releases/latest/download/latest.json
```

Une v0.3.1 déjà installée interrogera **toujours** cette URL. Passer le dépôt en privé la
rend inaccessible, et **ces installations ne pourront plus jamais se mettre à jour** — y
compris vers une version qui corrigerait le problème. Elles deviennent orphelines
silencieusement : l'updater échoue sans que l'utilisateur comprenne pourquoi.

Aucun redirect ne sauve ce cas : GitHub ne redirige pas les ressources d'un dépôt privé.

## 5 · Migration minimale, en trois temps

**Temps 1 — déplacer l'endpoint, en restant public.**
Publier une **v0.3.2** dont l'updater pointe vers une adresse que nous contrôlons, par
exemple `https://humanorigin.io/updates/latest.json`, servie par Netlify. Le dépôt reste
public. La chaîne de signature de l'updater est inchangée : seule l'adresse bouge.

Changer **en même temps** la cible du bouton de téléchargement, pour que la landing ne
dépende plus de GitHub.

**Temps 2 — attendre l'adoption.**
Mesurable avec ce qui existe déjà : le trafic sur l'ancienne URL d'une part, sur la
nouvelle d'autre part. Tant que l'ancienne reçoit des requêtes, des installations v0.3.1
vivent encore.

**Temps 3 — passer en privé.**
Seulement quand l'ancienne URL est devenue silencieuse, ou quand on décide d'assumer
d'abandonner les retardataires — **et en le disant**, pas par omission.

### Ce qui reste nécessaire côté public

Même après migration, les **binaires** doivent rester téléchargeables publiquement. Deux
voies :

- un dépôt public **sans source**, ne contenant que les releases, alimenté par la CI du
  dépôt privé. C'est la voie la plus simple et elle ne demande aucune réécriture ;
- ou héberger DMG et `latest.json` sur Netlify. Attention à la bande passante : 11 Mo par
  téléchargement, sur un plan Pro, cela se surveille.

## 6 · `humanorigin-verifier` — privé ou miroir propre

63 commits sous nom et adresse personnels.

| | Rendre le dépôt privé | Nouveau miroir public squashé |
|---|---|---|
| Masque l'historique personnel | oui | oui |
| Exige une réécriture | non | non — c'est un **nouveau** dépôt |
| Verify reste publiquement auditable | **non** | **oui** |
| Les clones existants gardent l'historique | oui | oui |
| Effort | nul | faible |
| Risque | **élevé** | faible |

**Recommandation : le miroir propre.**

Le rendre privé ferait perdre la seule chose qui rend Verify crédible : **n'importe qui
peut lire le code qui vérifie une preuve**. Un vérificateur dont le code est fermé demande
de lui faire confiance, ce qui est exactement ce que HumanOrigin refuse de demander.

Le miroir se crée en un commit initial, sans historique, sous l'identité HumanOrigin. Le
dépôt actuel peut alors devenir privé : son historique cesse d'être public sans que la
vérifiabilité soit perdue.

## Recommandation d'ensemble

**Fait maintenant** : HEAD nettoyé, identité Git posée. Coût nul, effet immédiat sur tout
ce qui sera écrit désormais.

**Ensuite, dans cet ordre** : le miroir propre de `humanorigin-verifier`, qui est le gain
le plus net pour le moindre risque. Puis la migration de l'updater, qui conditionne tout le
reste et ne peut pas être raccourcie.

**Jamais sans décision explicite** : passer `human-origin` en privé avant que l'updater
soit migré et adopté. Ce serait abandonner des utilisateurs sans le leur dire.

**Hors d'atteinte** : l'historique déjà cloné, et la signature des DMG v0.3.1 déjà
distribués. Ils portent le nom, ils sont signés, personne ne peut les modifier — et c'est
précisément ce qui fait leur valeur.
