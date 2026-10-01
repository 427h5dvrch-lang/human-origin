<#
    HumanOrigin — collecte de qualification Windows

    Ramasse ce qui sert a comprendre un echec, et RIEN d'autre. Ce script ne lit jamais
    le Gestionnaire d'identifiants, ou vit la capability, et ne touche a aucun document.
    Tout ce qu'il ecrit passe par un filtre de caviardage avant d'atterrir sur le disque.

    Usage :  .\collecte_logs.ps1 -Etape avant
             .\collecte_logs.ps1 -Etape finalisation
             .\collecte_logs.ps1 -Etape apres
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('avant', 'finalisation', 'apres')]
    [string]$Etape
)

$ErrorActionPreference = 'Continue'

$horodatage = Get-Date -Format 'yyyyMMdd-HHmmss'
$sortie = Join-Path (Get-Location) "HO_Qualification_${horodatage}_${Etape}"
New-Item -ItemType Directory -Path $sortie -Force | Out-Null

# ---------------------------------------------------------------- caviardage
# Tout texte ecrit passe par ici. Les motifs couvrent ce qui pourrait porter un secret :
# un porteur HTTP, une clé dans un fragment d'URL, une suite base64 assez longue pour
# etre une clé, une adresse e-mail. Mieux vaut caviarder a tort que laisser fuir.
$motifs = @(
    @{ Motif = '(?i)(authorization\s*:\s*bearer\s+)\S+';         Par = '$1<CAVIARDE>' },
    @{ Motif = '(?i)(capability["'':\s=]+)[A-Za-z0-9_\-\.]{12,}'; Par = '$1<CAVIARDE>' },
    @{ Motif = '#k=[A-Za-z0-9_\-]+';                              Par = '#k=<CAVIARDE>' },
    @{ Motif = '(?i)(token["'':\s=]+)[A-Za-z0-9_\-\.]{12,}';      Par = '$1<CAVIARDE>' },
    # Une suite longue n'est caviardee que si elle n'est PAS purement hexadecimale :
    # une empreinte SHA-256 fait 64 caracteres hex et doit rester lisible, c'est du
    # diagnostic. Sans cette reserve, le filtre detruisait les empreintes collectees.
    @{ Motif = '\b(?![0-9a-fA-F]{40,}\b)[A-Za-z0-9+/]{40,}={0,2}'; Par = '<BASE64-CAVIARDE>' },
    @{ Motif = '[\w\.\-\+]+@[\w\.\-]+\.\w{2,}';                   Par = '<EMAIL-CAVIARDE>' }
)

function Protege([string]$texte) {
    if ([string]::IsNullOrEmpty($texte)) { return $texte }
    foreach ($m in $motifs) { $texte = [regex]::Replace($texte, $m.Motif, $m.Par) }
    return $texte
}

function Ecris([string]$nom, $contenu) {
    $texte = ($contenu | Out-String)
    Protege $texte | Set-Content -Path (Join-Path $sortie $nom) -Encoding UTF8
    Write-Host "  ecrit : $nom"
}

Write-Host ""
Write-Host "HumanOrigin — collecte ($Etape)"
Write-Host "Dossier : $sortie"
Write-Host ""

# ---------------------------------------------------------------- la machine
Ecris 'systeme.txt' @(
    "Etape de collecte : $Etape"
    "Horodatage        : $(Get-Date -Format o)"
    ""
    "--- Windows ---"
    (Get-CimInstance Win32_OperatingSystem |
        Select-Object Caption, Version, BuildNumber, OSArchitecture | Format-List | Out-String)
    "--- Processeur ---"
    (Get-CimInstance Win32_Processor | Select-Object Name, Architecture | Format-List | Out-String)
    "--- PowerShell ---"
    ($PSVersionTable | Out-String)
)

# ---------------------------------------------------------------- WebView2
# Une fenetre blanche au lancement vient presque toujours de la.
$webview = @()
foreach ($cle in @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    if (Test-Path $cle) {
        $v = (Get-ItemProperty $cle -ErrorAction SilentlyContinue).pv
        if ($v) { $webview += "$cle -> $v" }
    }
}
if (-not $webview) { $webview = @('WebView2 Runtime : INTROUVABLE') }
Ecris 'webview2.txt' $webview

# ---------------------------------------------------------------- Word
$word = @()
foreach ($cle in @('HKLM:\SOFTWARE\Microsoft\Office\16.0\Common\InstallRoot',
                   'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Office\16.0\Common\InstallRoot')) {
    if (Test-Path $cle) { $word += "$cle -> $((Get-ItemProperty $cle).Path)" }
}
$exeWord = Get-ChildItem "$env:ProgramFiles\Microsoft Office\root\Office16\WINWORD.EXE",
                         "${env:ProgramFiles(x86)}\Microsoft Office\root\Office16\WINWORD.EXE" `
                         -ErrorAction SilentlyContinue
foreach ($w in $exeWord) {
    $word += "WINWORD : $($w.FullName)  version $($w.VersionInfo.ProductVersion)"
}
if (-not $word) { $word = @('Microsoft Word : INTROUVABLE') }
Ecris 'word.txt' $word

# ---------------------------------------------------------------- catalogue du complement
# C'est le mecanisme Windows que HumanOrigin declare. Deux entrees ici signaleraient que
# la reinstallation en a empile une seconde, ce que la cle fixe doit empecher.
$cat = @()
$racine = 'HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs'
if (Test-Path $racine) {
    foreach ($c in Get-ChildItem $racine) {
        $p = Get-ItemProperty $c.PSPath
        $cat += "--- $($c.PSChildName) ---"
        $cat += "  Id    : $($p.Id)"
        $cat += "  Url   : $($p.Url)"
        $cat += "  Flags : $($p.Flags)"
    }
    $cat += ""
    $cat += "Nombre total de catalogues declares : $((Get-ChildItem $racine).Count)"
} else {
    $cat = @("$racine : ABSENT (aucun catalogue de complement declare)")
}
Ecris 'catalogue_word.txt' $cat

# ---------------------------------------------------------------- fichiers de HumanOrigin
$donnees = Join-Path $env:LOCALAPPDATA 'HumanOrigin'
$fichiers = @()
if (Test-Path $donnees) {
    $fichiers += "--- $donnees ---"
    $fichiers += (Get-ChildItem $donnees -Recurse -File -ErrorAction SilentlyContinue |
        Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize | Out-String)
} else {
    $fichiers += "$donnees : ABSENT"
}
foreach ($p in @("$env:LOCALAPPDATA\Programs\HumanOrigin", "$env:ProgramFiles\HumanOrigin")) {
    if (Test-Path $p) {
        $fichiers += "--- $p ---"
        $fichiers += (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue |
            Select-Object Name, Length | Format-Table -AutoSize | Out-String)
    }
}
Ecris 'fichiers_installes.txt' $fichiers

# ---------------------------------------------------------------- diagnostic de finalisation
# Fichier typé ecrit par l'application quand une finalisation echoue. Il ne contient par
# construction ni capability, ni corps de reponse, ni chemin complet — on le caviarde quand
# meme avant de l'emporter.
$incident = Join-Path $donnees 'finalizer_incident.json'
if (Test-Path $incident) {
    Ecris 'finalizer_incident.json' (Get-Content $incident -Raw)
} else {
    Ecris 'finalizer_incident.json' 'aucun incident enregistre'
}

$sentinelle = Join-Path $donnees 'word_setup.json'
if (Test-Path $sentinelle) {
    Ecris 'word_setup.json' (Get-Content $sentinelle -Raw)
} else {
    Ecris 'word_setup.json' 'complement jamais installe depuis cette machine'
}

# ---------------------------------------------------------------- manifeste depose
$manifeste = Join-Path $donnees 'WordAddin'
if (Test-Path $manifeste) {
    $m = Get-ChildItem $manifeste -Filter *.xml -ErrorAction SilentlyContinue
    $lignes = @()
    foreach ($f in $m) {
        $lignes += "$($f.Name)  $($f.Length) octets"
        $lignes += "  SHA256 : $((Get-FileHash $f.FullName -Algorithm SHA256).Hash)"
    }
    if (-not $lignes) { $lignes = @('dossier present mais aucun manifeste') }
    Ecris 'manifeste_complement.txt' $lignes
} else {
    Ecris 'manifeste_complement.txt' "$manifeste : ABSENT"
}

# ---------------------------------------------------------------- entree de desinstallation
$desinst = @()
foreach ($r in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
                 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path $r) {
        foreach ($c in Get-ChildItem $r -ErrorAction SilentlyContinue) {
            $p = Get-ItemProperty $c.PSPath -ErrorAction SilentlyContinue
            if ($p.DisplayName -like '*HumanOrigin*') {
                $desinst += "$($p.DisplayName)  v$($p.DisplayVersion)"
                $desinst += "  emplacement  : $($p.InstallLocation)"
                $desinst += "  desinstalleur: $($p.UninstallString)"
            }
        }
    }
}
if (-not $desinst) { $desinst = @('aucune entree de desinstallation HumanOrigin') }
Ecris 'desinstallation.txt' $desinst

# ---------------------------------------------------------------- plantages
$evt = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddDays(-1) } `
        -ErrorAction SilentlyContinue |
       Where-Object { $_.Message -match 'HumanOrigin|humanorigin' } |
       Select-Object TimeCreated, Id, LevelDisplayName, Message -First 40
if ($evt) { Ecris 'journal_application.txt' ($evt | Format-List | Out-String) }
else       { Ecris 'journal_application.txt' 'aucun evenement HumanOrigin en 24 h' }

# ---------------------------------------------------------------- controle du caviardage
# Un filtre qu'on ne verifie pas est un filtre auquel on ne peut pas se fier.
$suspects = @()
foreach ($f in Get-ChildItem $sortie -File) {
    $t = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($t -match '(?i)bearer\s+[A-Za-z0-9]' -or $t -match '#k=[A-Za-z0-9]') {
        $suspects += "SUSPECT : $($f.Name)"
    }
}
if ($suspects) {
    $suspects | Set-Content (Join-Path $sortie 'ALERTE_CAVIARDAGE.txt') -Encoding UTF8
    Write-Warning "Des traces suspectes subsistent — lire ALERTE_CAVIARDAGE.txt AVANT d'envoyer quoi que ce soit."
} else {
    'controle passe : aucun porteur ni cle de fragment detecte' |
        Set-Content (Join-Path $sortie 'caviardage_verifie.txt') -Encoding UTF8
}

Write-Host ""
Write-Host "Termine. Dossier a renvoyer : $sortie"
Write-Host "Relire son contenu avant envoi : il est lisible, c'est voulu."
Write-Host ""
