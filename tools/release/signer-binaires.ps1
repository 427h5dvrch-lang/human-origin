# Signe les binaires qui seront RÉELLEMENT INSTALLÉS, avant que Tauri ne les empaquette.
#
# Pourquoi ici. La chaîne ne signait que l'installeur. Après installation, mesuré sur le PC de
# qualification, HumanOrigin.exe et les deux sidecars étaient non signés : un installeur signé
# ne dit rien de ce qu'il dépose. Tauri appelle ce script par `beforeBundleCommand`, donc après
# la compilation et avant l'empaquetage — la seule fenêtre où signer sans que cargo relie
# ensuite le binaire et efface la signature.
#
# Hors Windows, ou sans signature configurée, le script ne fait rien et rend 0 : un build local
# de développement ne doit pas échouer faute de certificat. Mais si la signature EST demandée
# et qu'elle échoue, on arrête le build — mieux vaut pas d'artefact qu'un artefact qui ment.
$ErrorActionPreference = "Stop"

if ($env:HO_SIGN -ne "1") {
  Write-Host "signer-binaires : HO_SIGN absent, aucun binaire signe (build local)."
  exit 0
}

$racine = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$cibles = @()
# L'exécutable de l'application, tel qu'il sera posé dans le dossier d'installation.
$cibles += Get-ChildItem -Path (Join-Path $racine "src-tauri/target/release") -Filter "*.exe" -File `
  -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*build-script*" }
# Les sidecars déclarés en externalBin : Tauri les copie tels quels à côté de l'application.
$cibles += Get-ChildItem -Path (Join-Path $racine "src-tauri/binaries") -Filter "*.exe" -File `
  -ErrorAction SilentlyContinue

if ($cibles.Count -eq 0) { Write-Error "signer-binaires : aucun binaire a signer, ce n'est pas normal" }

Write-Host "signer-binaires : $($cibles.Count) binaire(s) a signer"
foreach ($f in $cibles) { Write-Host "  - $($f.Name)  $($f.Length) octets" }

Import-Module TrustedSigning -ErrorAction Stop

# Un passage PAR DOSSIER, et tous les dossiers. La première version signait le dossier du
# premier binaire puis sautait le premier élément de la liste triée des dossiers : les deux
# « premiers » n'étaient pas le même, donc un dossier était signé deux fois et l'autre jamais.
# Mesuré sur le run 38247618443 — les sidecars de `src-tauri/binaries`, ceux que Tauri installe
# réellement, ressortaient NotSigned.
# DÉLAI du service de signature. Le défaut de 300 s a expiré deux fois d'affilée sur main les
# 2026-10-14 et 15 — runs 38636832622 et 38639353939 — en signant les deux sidecars, et le
# service lui-même indique le paramètre à augmenter. Ce n'est pas une attente ajoutée : c'est
# la patience accordée à un service distant avant de déclarer l'échec. Un build qui tombe pour
# cause de lenteur du signeur ne dit rien de notre code, et il coûte une passe entière.
$dossiers = $cibles | ForEach-Object { $_.DirectoryName } | Sort-Object -Unique
foreach ($d in $dossiers) {
  Write-Host "  dossier : $d"
  Invoke-TrustedSigning `
    -Endpoint $env:AZURE_ENDPOINT `
    -CodeSigningAccountName $env:AZURE_CODE_SIGNING_ACCOUNT `
    -CertificateProfileName $env:AZURE_CERT_PROFILE `
    -FilesFolder $d `
    -FilesFolderFilter "exe" `
    -FileDigest "SHA256" `
    -TimestampRfc3161 "http://timestamp.acs.microsoft.com" `
    -TimestampDigest "SHA256" `
    -Timeout 900
}

# Contrôle immédiat : on ne quitte pas ce script sur une promesse.
foreach ($f in $cibles) {
  $s = Get-AuthenticodeSignature $f.FullName
  if ($s.Status -ne "Valid") { Write-Error "non signe apres signature : $($f.Name) -> $($s.Status)" }
  if ($s.SignerCertificate.Subject -notlike "*DAZEAS CORP*") {
    Write-Error "signataire inattendu sur $($f.Name) : $($s.SignerCertificate.Subject)"
  }
  Write-Host "  signe : $($f.Name)"
}
