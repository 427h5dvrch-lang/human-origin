# Signe UN fichier, désigné par %1. C'est la commande que Tauri appelle lui-même.
#
# Deux choses en dépendent, et c'est pour cela qu'elle existe :
#   · `uninstall.exe`, que NSIS écrit à la compilation et que Tauri fait signer par
#     `!uninstfinalize ${UNINSTALLERSIGNCOMMAND}` — il n'y a pas d'autre fenêtre pour le
#     signer, puisqu'il n'existe pas avant et qu'il est embarqué dans l'installeur ensuite ;
#   · l'installeur final, que Tauri signe par `try_sign`.
#
# Sans HO_SIGN, le script ne fait rien et rend 0 : un build local reste possible.
$ErrorActionPreference = "Stop"
$cible = $args[0]

if ($env:HO_SIGN -ne "1") {
  Write-Host "signer-un-fichier : HO_SIGN absent, $cible laisse tel quel (build local)."
  exit 0
}
if (-not $cible -or -not (Test-Path $cible)) { Write-Error "signer-un-fichier : fichier absent : $cible" }

Import-Module TrustedSigning -ErrorAction Stop
$p = @{
  Endpoint               = $env:AZURE_ENDPOINT
  CodeSigningAccountName = $env:AZURE_CODE_SIGNING_ACCOUNT
  CertificateProfileName = $env:AZURE_CERT_PROFILE
  FileDigest             = "SHA256"
  TimestampRfc3161       = "http://timestamp.acs.microsoft.com"
  TimestampDigest        = "SHA256"
}
# Le module accepte soit une liste de fichiers, soit un dossier et un filtre. On préfère la
# liste : signer un dossier entier toucherait des fichiers que cet appel ne désigne pas.
$cmd = Get-Command Invoke-TrustedSigning
if ($cmd.Parameters.ContainsKey("Files")) {
  Invoke-TrustedSigning @p -Files @($cible)
} else {
  $f = Get-Item $cible
  Invoke-TrustedSigning @p -FilesFolder $f.DirectoryName -FilesFolderFilter $f.Extension.TrimStart(".")
}

$s = Get-AuthenticodeSignature $cible
if ($s.Status -ne "Valid") { Write-Error "signature invalide sur $cible : $($s.Status)" }
if ($s.SignerCertificate.Subject -notlike "*DAZEAS CORP*") {
  Write-Error "signataire inattendu sur $cible : $($s.SignerCertificate.Subject)"
}
Write-Host "signe : $(Split-Path $cible -Leaf)"
