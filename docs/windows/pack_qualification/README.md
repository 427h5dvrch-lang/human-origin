# HumanOrigin Windows — pack de qualification V1

Pour une machine **Windows 11 x64** avec **Microsoft Word desktop** (Microsoft 365 ou
Office 2016+), connectée à Internet, où HumanOrigin n'a **jamais** été installé.

Compter environ 45 minutes.

## Ce qu'il y a dans le pack

| Fichier | Rôle |
|---|---|
| `HumanOrigin_0.3.1_x64-setup.exe` | l'installateur à tester (livré à part, 7 265 664 octets) |
| `SHA256.txt` | son empreinte, à vérifier avant d'exécuter quoi que ce soit |
| `CHECKLIST.md` | les 10 étapes, avec le résultat attendu de chacune |
| `RESULTAT.md` | le formulaire à remplir — une ligne PASS/FAIL par étape |
| `collecte_logs.ps1` | ramasse les traces utiles, sans secret |
| `smartscreen.md` | pourquoi l'avertissement apparaît et comment passer outre **en test** |

## Avant de commencer

**Vérifier l'empreinte.** Dans PowerShell, au dossier du pack :

```powershell
Get-FileHash .\HumanOrigin_0.3.1_x64-setup.exe -Algorithm SHA256 | Format-List Hash
```

Elle doit valoir exactement :

```
EB161389C5683EF7357BCD2D49C62427BD1657B2FD96AF2DEDDD5B09F05C1255
```

Si elle diffère, **s'arrêter** : le fichier n'est pas celui qui a été construit.

**Relever l'état de départ**, pour pouvoir comparer ensuite :

```powershell
.\collecte_logs.ps1 -Etape avant
```

## Comment mener le test

Suivre `CHECKLIST.md` dans l'ordre, sans sauter d'étape : plusieurs en dépendent d'une
précédente. Après chaque étape, noter PASS ou FAIL dans `RESULTAT.md`, avec ce qui a été
vu — pas une interprétation.

**Un FAIL n'arrête pas le test** sauf si l'étape suivante en dépend matériellement. La
colonne « bloque » de la checklist le dit pour chacune.

À la fin :

```powershell
.\collecte_logs.ps1 -Etape apres
```

Puis renvoyer `RESULTAT.md` et le dossier `HO_Qualification_*` produit par le script.

## Ce qu'il ne faut jamais envoyer

Le script de collecte est écrit pour n'emporter aucun secret, et il caviarde ce qu'il
croise. Mais deux choses relèvent du testeur :

- **Le lien Verify complet.** Il contient la clé de déchiffrement après le `#`. Cette clé
  ne transite jamais par un serveur, et c'est exactement pour cela qu'elle ne doit pas
  être recopiée dans un rapport. Ne noter que la partie avant le `#`.
- **Les identifiants du compte.** Aucune étape ne les demande par écrit.

Si un doute subsiste sur un fichier, ne pas l'envoyer et le signaler.
