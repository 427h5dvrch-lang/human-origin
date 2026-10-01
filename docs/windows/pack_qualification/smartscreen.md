# L'avertissement SmartScreen — test privé seulement

## Ce qui va s'afficher

Au double-clic sur l'installateur, Windows affiche un écran bleu :

> **Windows a protégé votre ordinateur**
> Microsoft Defender SmartScreen a empêché le démarrage d'une application non reconnue.

et, dans la boîte de dialogue suivante, **Éditeur : inconnu**.

## Pourquoi

L'installateur n'est pas signé. Ce n'est pas un symptôme : c'est l'état connu du RC, et
la seule gate ouverte du chantier Windows. SmartScreen ne dit pas que le fichier est
dangereux, il dit qu'il ne connaît pas son éditeur — ce qui est exact.

Vérifier l'empreinte SHA-256 **avant** de passer outre remplace ici ce que la signature
apportera plus tard : la certitude que le fichier est bien celui qui a été construit.

## Comment passer outre, pour ce test

1. Sur l'écran bleu, cliquer **Informations complémentaires**.
2. Cliquer **Exécuter quand même**.

Si Windows a marqué le fichier comme venant d'Internet et bloque l'accès, retirer cette
marque — uniquement sur ce fichier, dont l'empreinte vient d'être vérifiée :

```powershell
Unblock-File -Path .\HumanOrigin_0.3.1_x64-setup.exe
```

## Ce qu'il ne faut pas faire

**Ne pas désactiver SmartScreen**, ni ajouter d'exclusion dans Microsoft Defender, ni
toucher aux stratégies de sécurité de la machine. Ces gestes dépassent le test, affaiblissent
durablement le poste, et fausseraient le résultat : le but est justement de voir ce qu'un
utilisateur rencontre.

Si la machine appartient à une organisation dont la stratégie bloque purement l'exécution
d'un binaire non signé, **c'est un résultat, pas un obstacle à contourner**. Le noter en
FAIL à l'étape 2, avec le message exact : c'est exactement l'information qui dira si la
bêta privée peut partir non signée.
