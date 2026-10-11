# W4 / SAFE CLOSE — deuxième passe : deux compléments, pas un paquet fautif

2026-10-11. Build `81bedd5`. Aucun changement de code, aucune publication.

## Ce que le retest Windows a mesuré

W1, W2, W3 passent. W4 échoue encore. Après l'enregistrement par Word :

| | avant | après |
|---|---|---|
| taille | 4 143 o | 14 150 o |
| `width` | `350` | **`438`** |
| `row` | `0` | **`1`** |
| `Office.AutoShowTaskpaneWithDocument` | présent | présent |
| icônes HumanOrigin | — | **deux** |

`row="1"` ne peut pas arriver seul : la valeur situe le volet dans une **pile**. S'il est en
rang 1, quelque chose occupe le rang 0.

## La cause : deux compléments HumanOrigin enregistrés, pas un défaut du paquet

Un document réel du corpus porte la preuve, et elle est nette. Il contient **deux** entrées
`<wetp:taskpane>` et **deux** webextensions :

| partie | identifiant de référence | ce que c'est |
|---|---|---|
| `webextension1.xml` | `7b3e1c62-4a58-4d1f-9c05-8e2f6a4b90d3` | le complément de **production** |
| `webextension2.xml` | `76e243a4-e038-49e8-861b-50b532ebb1a5` | `tools/rc/humanorigin-word-manifest-rc.xml` |

Ce second identifiant est celui du **manifeste RC**, introduit par le commit `6f7c71d`
« RC : manifeste Word isolé » — volontairement doté de son propre GUID pour que le volet RC
ne puisse jamais être confondu avec la production. Les deux sont enregistrés
`store="developer" storeType="Registry"` sur la machine Windows.

Donc : Word ouvre **deux** volets, l'un occupe le rang 0, le nôtre est repoussé au rang 1,
la pile est réconciliée, et le document devient modifié. Les deux icônes et le `row="1"` sont
le même fait.

### Pourquoi macOS reste propre

Un seul manifeste y est posé :

```
~/Library/Containers/com.microsoft.Word/Data/Documents/wef/humanorigin-prod.xml
  → <Id>7b3e1c62-4a58-4d1f-9c05-8e2f6a4b90d3</Id>
```

Un volet, rang 0, aucune réconciliation. Ce n'est pas que macOS tolère mieux : il n'a pas le
second complément.

### Et le désinstalleur ne l'enlèverait pas

`valeur_developer_nous_appartient` compare le nom de la valeur à `manifest_id()`, lu dans le
manifeste **embarqué**, c'est-à-dire la production. Le RC a un autre identifiant : il ne
serait donc jamais retiré — même si `retirer_registrations` était branché au désinstalleur,
ce qui n'est toujours pas le cas.

## Matrice mesurée sur macOS

Word n'expose aucun volet Office.js à AppleScript : la **visibilité** du volet n'est pas
mesurable ici. Ce qui l'est : l'indicateur `saved`, et ce que Word réécrit en enregistrant.

| variante | `taskpanes.xml` | `saved` | géométrie réécrite | volets dans le fichier |
|---|---|---|---|---|
| **A** état actuel | `visibility="1" width="350" row="0"` | **true** | non | 1 |
| **B** candidat | `visibility="0" width="350" row="0"` | **true** | non | 1 |
| **C** sans géométrie | `visibility="1"`, ni `width` ni `row` | — | — | **le document ne s'ouvre pas** |
| **D1** `width` seul | `visibility="1" width="350"` | — | — | non concluant (Word laissé en état modal par C) |
| **D2** sans géométrie | `visibility="0"` seul | — | — | idem |

**C tranche une question** : `width` et `row` sont **requis**. Omis, Word n'ouvre pas le
document du tout — il n'apparaît même pas dans sa liste de documents. La géométrie doit donc
être émise ; seule sa valeur est un levier.

Sur macOS, Word ne modifie **ni** la géométrie **ni** la visibilité : la seule différence
après enregistrement est **un octet**, une espace avant `r:id`. A et B sont donc
indiscernables ici, et macOS ne peut pas trancher entre eux.

## Candidat retenu — et il ne demande aucun build

Le défaut mesuré n'est pas dans le paquet : il est dans l'**état de la machine**. Le candidat
est donc de retirer l'enregistrement RC resté en place, puis de rejouer W4 **sur le build
déjà installé**.

Sur le PC Windows, PowerShell. D'abord **voir** ce qui est enregistré, sans rien modifier :

```powershell
Get-ItemProperty 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer' |
  Format-List
```

Deux valeurs sont attendues, nommées par les deux identifiants ci-dessus. Puis retirer **la
seule** qui n'est pas la production :

```powershell
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Office\16.0\WEF\Developer' `
  -Name '76e243a4-e038-49e8-861b-50b532ebb1a5'
```

Fermer Word entièrement — vérifier qu'aucun `WINWORD.EXE` ne subsiste — puis rejouer W4 :
nouveau document, aucune frappe, fermeture.

Attendu : **une** icône HumanOrigin, et aucune demande d'enregistrement.

### Nuance : les documents déjà enregistrés gardent les deux entrées

Un document que Word a enregistré avec deux volets porte `webextension2.xml` dans son
paquet : il montrera deux icônes même après le nettoyage. Le test doit porter sur un
**nouveau** document.

## Si W4 échoue encore avec une seule icône

Alors le `width` est la cause restante, indépendamment de la pile — Word reconcilierait la
largeur demandée avec la largeur réellement rendue, qui dépend de l'écran et de la mise à
l'échelle. Aucune valeur fixe ne serait alors sûre, et le candidat **B**
(`visibility="0"` + `AutoShowTaskpaneWithDocument`) devient le levier : le document ne
demande plus l'ouverture, donc Word n'a plus de raison d'écrire l'état du volet dedans.
B demanderait un nouveau build ; le nettoyage de registre, non.

## Ce qui n'est pas fait, volontairement

Aucun changement de code. Le ticket demandait de comprendre les deux icônes avant de
corriger : c'est fait, et la correction qui en découle n'est pas dans le produit.

Reste en file, sans rapport avec W4 : brancher `retirer_registrations` au désinstalleur NSIS,
et lui faire retirer aussi les identifiants HumanOrigin autres que celui du manifeste
embarqué — le RC en est un.
