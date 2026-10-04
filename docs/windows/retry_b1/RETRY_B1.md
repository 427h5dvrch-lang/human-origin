# Retry B1 — le retour d'authentification atteint l'instance primaire

Ce retry ne rejoue pas le Pass 1 entier. Il tranche **une seule question** : un lien
d'authentification cliqué pendant que HumanOrigin est ouvert atteint-il l'instance qui
tourne, et la connecte-t-il.

Le reste du parcours reste décrit dans `PASS1.md` du pack de qualification.

---

## Ce qui a été corrigé, et ce que cela change à l'écran

Le lien arrivait bien jusqu'au cœur de l'application : Windows lançait un second processus,
celui-ci transmettait l'URL à l'instance primaire puis s'arrêtait — tout cela fonctionnait.
Ce qui manquait est après : **rien, dans la fenêtre ouverte, n'écoutait ce retour**, et la
copie que le natif gardait de côté n'était récupérable par aucune commande.

À l'écran, la différence attendue est exactement celle-ci : après avoir cliqué le lien reçu
par e-mail, **la fenêtre déjà ouverte passe d'elle-même à l'état connecté**, sans relance,
sans second clic, sans fermer quoi que ce soit.

---

## Avant de commencer

| | |
|---|---|
| Installateur | `HumanOrigin_0.3.2_x64-setup.exe`, dans l'artefact `humanorigin-windows-rc` |
| Provenance | run **Windows RC #19**, commit `3a941b8`, branche `windows-blocker-b1-deeplink` |
| Correctif embarqué | B1 = commit `35780f5`, ancêtre vérifié de `3a941b8` |
| SHA-256 attendu | `________` — à calculer au téléchargement (voir ci-dessous) |
| Préalable | aucune session active : **se déconnecter** si l'application est déjà connectée |

Cet artefact n'est **pas publié** : il n'existe que comme artefact de CI, et il expire le
**2026-10-18**. Le télécharger depuis la page du run, puis relever son empreinte :

```powershell
Get-FileHash .\HumanOrigin_0.3.2_x64-setup.exe -Algorithm SHA256 | Format-List
```

Reporter la valeur obtenue dans la ligne ci-dessus **avant** de commencer, et la comparer à
celle annoncée dans le journal du run, étape « Empreintes ».

> Ce RC garde l'identité de production : même identifiant de paquet, même schéma de lien
> `humanorigin://`, même redirection e-mail. C'est voulu — sans cela le lien magique
> n'atteindrait pas l'application et le retry ne prouverait rien. En contrepartie, il revendique
> le schéma `humanorigin://` sur la machine où il est installé : à réserver au PC de test.

Vérifier l'empreinte avant d'installer :

```powershell
Get-FileHash .\HumanOrigin_*_x64-setup.exe -Algorithm SHA256 | Format-List
```

---

## R1 — l'application s'ouvre

**ACTION** — installer, puis ouvrir HumanOrigin depuis le menu Démarrer.
**CE QUI DOIT ÊTRE VISIBLE** — la fenêtre s'affiche, et l'application n'est **pas** connectée.
**PASS** — fenêtre affichée, état déconnecté.
**FAIL** — rien ne s'ouvre, fenêtre blanche, ou une session subsiste d'une installation
précédente : dans ce dernier cas, se déconnecter et reprendre, sinon le retry ne prouve rien.

---

## R2 — demander le lien, **sans fermer l'application**

**ACTION** — saisir l'adresse e-mail et demander le lien. **Laisser HumanOrigin ouvert.**
**CE QUI DOIT ÊTRE VISIBLE** — l'application confirme que le lien est envoyé.
**PASS** — confirmation affichée, application toujours ouverte.
**FAIL** — un message d'erreur. Le noter mot pour mot.

> **Si le message mentionne 429 ou « too many requests »** : c'est la limite d'envoi du
> fournisseur d'authentification, affichée brute. C'est un défaut connu, **NON BLOCKER**, hors
> de ce retry. Attendre quelques minutes et reprendre R2. Ce n'est pas B1.

---

## R3 — le gate qui tranche B1

**ACTION** — ouvrir la boîte mail et cliquer le lien, **HumanOrigin restant ouvert**.

**CE QUI DOIT ÊTRE VISIBLE** — la fenêtre déjà ouverte **passe d'elle-même à l'état
connecté**, en quelques secondes. Un second processus peut apparaître brièvement puis
disparaître : c'est normal, c'est lui qui transmet le lien.

**PASS** — l'application affiche l'état connecté, sans relance et sans second clic.

**FAIL** — l'un de ces cas, à noter tel quel :
- la fenêtre reste déconnectée, indéfiniment — **B1 n'est pas corrigé** ;
- une **seconde fenêtre** HumanOrigin s'ouvre — la transmission à l'instance primaire ne
  fonctionne pas, ce n'est plus le même défaut ;
- la connexion n'apparaît qu'après avoir relancé l'application — le rattrapage au démarrage
  fonctionne, mais pas la réception à chaud. À distinguer dans le rapport.

**À noter** — rien du lien lui-même. **Jamais ce qui suit le `#`** : ce sont les jetons.

---

## R4 — démarrage à froid, l'autre chemin

Le correctif couvre deux situations. R3 teste la plus dure ; R4 vérifie que l'autre n'a pas
été cassée au passage.

**ACTION** — se déconnecter, **fermer entièrement** HumanOrigin, demander un nouveau lien
depuis le site si nécessaire, puis cliquer le lien **application fermée**.
**CE QUI DOIT ÊTRE VISIBLE** — HumanOrigin s'ouvre et arrive connecté.
**PASS** — l'application démarre à l'état connecté.
**FAIL** — elle démarre déconnectée.

---

## R5 — une seule fois

**ACTION** — depuis l'état connecté obtenu en R3, cliquer **une seconde fois** le même lien.
**CE QUI DOIT ÊTRE VISIBLE** — rien d'anormal : pas de déconnexion, pas d'erreur affichée,
pas de seconde fenêtre.
**PASS** — l'état connecté est conservé, sans message d'erreur.
**FAIL** — l'application se déconnecte, affiche une erreur de jeton, ou ouvre une fenêtre.

---

## À renvoyer

- R1 à R5 : PASS ou FAIL, et ce qui a été vu ;
- tout message d'erreur, **mot pour mot** ;
- une capture de la fenêtre au moment de R3 ;
- l'identifiant du Record si le parcours a été poussé plus loin, sous la forme `HO-xxxxxxxx`
  **seulement**.

Si R3 est PASS, B1 est levé et le Pass 1 complet peut reprendre à son gate G2.
