# Azure Artifact Signing — procédure pour DAZEAS CORP

Préparé le 2026-10-01. **Rien n'a été engagé** : aucun compte Azure créé, aucun
abonnement souscrit, aucune dépense. Le point d'arrêt est signalé clairement plus bas.

**Entité légale : DAZEAS CORP.** HumanOrigin reste la marque et le nom du produit. Toute
la validation Microsoft se fait au nom légal exact de DAZEAS CORP, avec ses données
officielles — jamais « HumanOrigin », qui n'est pas une personne morale.

---

## 0 · Une conséquence à connaître avant de commencer

Le certificat portera le sujet **DAZEAS CORP**. C'est donc ce nom, et non « HumanOrigin »,
que Windows affichera comme éditeur dans la boîte de dialogue au lancement de
l'installateur — là où il écrit aujourd'hui « Éditeur inconnu ».

Le paquet déclare par ailleurs `publisher: "HumanOrigin"` dans sa configuration. Les deux
peuvent diverger sans erreur technique, mais l'utilisateur verra DAZEAS CORP.

**Décision à prendre, pas un bug** : garder la divergence (le produit est HumanOrigin,
l'éditeur est DAZEAS CORP — c'est la situation habituelle d'un éditeur logiciel), ou
aligner `publisher` sur DAZEAS CORP. Je n'ai rien changé.

---

## 1 · Ce qu'il faut rassembler avant de toucher à Azure

Microsoft vérifie l'entité contre des **registres publics**. L'onboarding est d'autant
plus rapide que les données saisies correspondent exactement à ces registres.

| Champ Microsoft | Ce qu'il faut y mettre |
|---|---|
| **Organization Name** | le nom légal **exact** de DAZEAS CORP, tel qu'au registre — ponctuation et suffixe compris |
| **Website url** | `https://humanorigin.io` — il doit appartenir à DAZEAS CORP |
| **Business Identifier** | voir ci-dessous selon le pays d'immatriculation |
| **Street / City / Country / State / Postal code** | l'adresse du **siège légal**, pas une adresse postale de confort |
| **First Name / Last Name** | prénom et nom de Philippe **exactement** comme sur sa pièce d'identité officielle |

### L'identifiant d'entreprise, selon le pays

Le suffixe « CORP » n'indique pas le pays à lui seul. Les deux cas sont couverts par
l'éligibilité géographique d'Artifact Signing :

- **DAZEAS CORP immatriculée en France** → **SIREN** (9 chiffres) ou SIRET du siège. Le
  nom et l'adresse doivent correspondre à l'avis de situation INSEE / extrait Kbis.
- **DAZEAS CORP immatriculée aux États-Unis** → numéro d'immatriculation de l'État
  (*state registration number*) et/ou **EIN**. Le nom et l'adresse doivent correspondre au
  registre de l'État d'immatriculation.

Dans les deux cas, prévoir un **justificatif d'immatriculation** récent : Kbis de moins de
trois mois pour la France, *Certificate of Good Standing* ou *Articles of Incorporation*
pour les États-Unis.

### Si des pièces sont demandées

Microsoft peut réclamer des documents complémentaires, et alors :

- ils doivent avoir été **émis dans les 12 derniers mois** ;
- leur date d'expiration doit être à **au moins deux mois** ;
- **trois tentatives de dépôt au maximum** — au-delà, la demande repart de zéro ;
- une **facture de domaine** (enregistrement ou renouvellement de `humanorigin.io`) faisant
  apparaître DAZEAS CORP est une pièce fréquemment acceptée. Elle est disponible chez
  Hostinger : la récupérer dès maintenant évite une course plus tard.

---

## 2 · Les deux adresses sur humanorigin.io

Microsoft exige deux adresses **distinctes**, sur un domaine détenu par l'entité. Pour une
organisation, **la seconde doit être sur le même domaine que la première**.

### Ce que je recommande

| Rôle | Adresse | Qui la relève |
|---|---|---|
| **Primary Email** | `admin@humanorigin.io` | Philippe, directement |
| **Secondary Email** | `contact@humanorigin.io` | Philippe également, mais boîte séparée |

Pourquoi ces deux-là : `admin@` est l'adresse d'administration de l'entité, celle qui
portera plus tard le compte Azure et le renouvellement du domaine — c'est elle qui doit
recevoir les liens sensibles. `contact@` existe de toute façon pour un produit public, et
sert de second canal vérifiable sur le même domaine.

**À éviter** : `noreply@`, une boîte jamais relevée, un alias qui redirige vers Gmail sans
boîte propre, et toute adresse sur un domaine qui n'appartient pas à DAZEAS CORP.

### Les deux boîtes doivent accepter les liens externes

Microsoft envoie des courriels contenant des **liens cliquables depuis un expéditeur
externe**. Si un filtre anti-hameçonnage réécrit ou neutralise ces liens, la validation
échoue et **il faut recréer toute la demande**. À vérifier avant de lancer la procédure,
en s'envoyant un lien depuis une adresse extérieure.

### Quand Microsoft s'en sert, précisément

1. **À la création de la demande** — un courriel de vérification part vers la **primary**.
   Le lien **expire en 7 jours**. S'il expire ou si la vérification échoue, la demande est
   perdue : il faut en créer une nouvelle.
2. **Pendant la validation** — la **secondary** sert de second canal de vérification du
   contrôle du domaine.
3. **À l'étape de validation d'identité individuelle** — le lien vers le vérificateur
   tiers (AU10TIX) est envoyé à la **primary**. Philippe devra se connecter avec un compte
   Microsoft utilisant **cette même adresse**, puis présenter une pièce d'identité
   officielle depuis un téléphone.
4. **Si des pièces sont demandées** — la demande arrive sur la **primary**, et le statut
   passe à *Action Required*.
5. **À la conclusion** — *Completed* ou *Failed*, notifié sur la **primary**.

Autrement dit : la **primary** porte tout ce qui est bloquant. Elle doit être relevée
quotidiennement pendant les trois semaines que peut durer la validation.

---

## 3 · L'abonnement Azure, s'il n'en existe aucun

Aucun n'existe : il n'y a ni Azure CLI ni session Azure sur cette machine.

Le chemin exact, dans l'ordre :

1. Aller sur **portal.azure.com** et se connecter avec un compte Microsoft. Si possible,
   utiliser **`admin@humanorigin.io`** — l'abonnement appartiendra ainsi à l'entité, pas à
   une adresse personnelle.
2. Un **locataire Microsoft Entra** est créé automatiquement à la première connexion. Rien
   à faire de plus.
3. **Abonnements → Ajouter**. Choisir **Paiement à l'utilisation** (*Pay-As-You-Go*).
   - Le compte gratuit Azure offre un crédit de bienvenue, mais Artifact Signing n'entre
     pas dans l'offre gratuite : il faut un abonnement facturable.
   - Le type de compte de facturation doit être **Organisation**, cohérent avec DAZEAS
     CORP. Il n'est pas exigé pour la validation d'organisation, mais il évite une
     incohérence plus tard.
4. Une **carte bancaire est demandée** à cette étape. Une autorisation de validité
   d'environ 1 € peut être prélevée puis annulée.

### ⛔ POINT D'ARRÊT

**C'est ici que je m'arrête.** La création de l'abonnement engage un moyen de paiement et
ne peut se faire qu'avec les identifiants de Philippe. Je ne vais pas plus loin sans son
geste.

Tant que l'abonnement n'existe pas, **rien de la suite n'est faisable**, même en lecture.

---

## 4 · Après l'abonnement — ce que je ferai

Ces étapes ne coûtent rien tant qu'aucun profil de certificat n'est créé. Je peux les
mener si Philippe me donne accès, ou les lui faire dérouler pas à pas.

### 4.1 Enregistrer le fournisseur de ressources

```bash
az login
az account set -s <ID de l'abonnement>
az provider register --namespace Microsoft.CodeSigning
az provider show --namespace Microsoft.CodeSigning --query registrationState
```

Gratuit, réversible, sans effet de bord.

### 4.2 Créer le compte Artifact Signing

```bash
az group create --name rg-humanorigin-signing --location westeurope
az artifact-signing create -n dazeascorp -l westeurope -g rg-humanorigin-signing --sku Basic
```

Région **West Europe** ou **North Europe** — les deux sont disponibles.
Le nom du compte fait 3 à 24 caractères alphanumériques, commence par une lettre, est
**unique mondialement**, et ne peut pas commencer par « one ».

**SKU Basic : 9,99 $/mois**, 5 000 signatures, 1 profil de certificat. Large pour le
rythme de release de HumanOrigin. La facturation démarre à la création du compte.

### 4.3 Le rôle, avant toute validation

La validation d'identité se fait **uniquement dans le portail**, pas en ligne de commande,
et seulement si le compte porte le rôle **Artifact Signing Identity Verifier**. Sans lui,
le bouton *New identity* reste grisé — c'est la cause la plus fréquente de blocage à cette
étape.

### 4.4 Lancer la validation d'identité

Portail → le compte Artifact Signing → **Identity validations** → **Organization** →
**New Identity** → **Public**.

Remplir avec les données du § 1. **Vérifier deux fois avant de valider** : toute correction
après création oblige à refaire une demande complète, ce qui invalide les certificats déjà
émis.

Le bouton *Certificate subject preview* montre exactement ce qui figurera sur le
certificat — donc ce que Windows affichera. **Le regarder avant de créer.**

Puis : statut *In Progress*, validation d'identité individuelle par Philippe via le lien
reçu sur la primary, et attente. **1 à 20 jours ouvrés**, davantage si des pièces sont
demandées.

### 4.5 Créer le profil de certificat

Une fois le statut *Completed* : **Certificate profiles → Create → Public Trust**, en
sélectionnant la validation d'identité de DAZEAS CORP.

### 4.6 Brancher la signature dans la CI

Secrets GitHub à créer (identité d'application Azure avec le rôle *Artifact Signing
Certificate Profile Signer*) :

- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`, `AZURE_SIGNING_ENDPOINT`

Étape à insérer dans `release.yml`, après le bundle NSIS et **avant** l'upload :

```yaml
      - name: Signer l'installateur Windows
        if: matrix.platform == 'windows-latest'
        uses: azure/trusted-signing-action@v0
        with:
          azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
          azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
          endpoint: ${{ secrets.AZURE_SIGNING_ENDPOINT }}
          trusted-signing-account-name: ${{ secrets.AZURE_SIGNING_ACCOUNT }}
          certificate-profile-name: ${{ secrets.AZURE_CERT_PROFILE }}
          files-folder: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis
          files-folder-filter: exe
          file-digest: SHA256
          timestamp-rfc3161: http://timestamp.acs.microsoft.com
          timestamp-digest: SHA256
```

Puis un contrôle post-signature qui échoue si la signature n'est pas valide **ou si
l'horodatage manque** — sans horodatage, la signature meurt avec le certificat et les
installateurs déjà distribués deviennent invalides :

```yaml
      - name: Verifier la signature
        if: matrix.platform == 'windows-latest'
        shell: pwsh
        run: |
          $exe = Get-ChildItem "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe"
          foreach ($f in $exe) {
            $s = Get-AuthenticodeSignature $f.FullName
            Write-Host "$($f.Name) : $($s.Status)  $($s.SignerCertificate.Subject)"
            if ($s.Status -ne 'Valid')      { throw "Signature invalide : $($s.Status)" }
            if (-not $s.TimeStamperCertificate) { throw "Signature sans horodatage" }
          }
```

**Cette étape n'est pas appliquée.** Elle est écrite ici pour être collée le jour où le
profil de certificat existe. `release.yml` n'a pas été modifié.

---

## 5 · Ce qui reste à Philippe, dans l'ordre

1. Confirmer le **pays d'immatriculation** de DAZEAS CORP et réunir le justificatif.
2. Créer **`admin@`** et **`contact@humanorigin.io`**, et vérifier qu'elles reçoivent bien
   des liens cliquables depuis l'extérieur.
3. Récupérer la **facture du domaine** chez Hostinger, au nom de DAZEAS CORP si possible.
4. Créer l'**abonnement Azure** — le point d'arrêt du § 3.
5. Me dire quand c'est fait : je reprends au § 4.

Tant que le point 4 n'est pas franchi, **aucune alternative OV ou EV n'est à envisager**.
Azure n'a pas encore été essayé ; le juger avant serait prématuré.
