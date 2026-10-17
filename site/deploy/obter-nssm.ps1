<#
  Baixa o NSSM 2.24-101 (win64) para deploy\tools\nssm.exe.
  Tenta mais de uma fonte e confere o SHA256 do zip oficial antes de usar:
    1. https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip           (site oficial - as vezes fora do ar)
    2. pacote Chocolatey "nssm" 2.24.101 (contem o mesmo zip oficial, mesmo hash)
#>
param([string]$Destino = (Join-Path $PSScriptRoot "tools\nssm.exe"))

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$HashZip = "99F5045FFFBFFB745D67FE3A065A953C4A3D9C253B868892D9B685B0EE7D07B8"
$NomeZip = "nssm-2.24-101-g897c7ad.zip"
$tmp = Join-Path $env:TEMP ("nssm-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp, (Split-Path $Destino) | Out-Null

function Extrair-Exe($zip) {
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
  if ($hash -ne $HashZip) { throw "SHA256 diferente do esperado ($hash)" }
  $dst = Join-Path $tmp "extr"
  Expand-Archive $zip $dst -Force
  $exe = Get-ChildItem $dst -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match '\\win64\\' } | Select-Object -First 1
  if (-not $exe) { throw "nssm.exe (win64) nao encontrado no zip" }
  Copy-Item $exe.FullName $Destino -Force
}

$fontes = @(
  @{ Nome = "nssm.cc"; Url = "https://nssm.cc/ci/$NomeZip"; Tipo = "zip" },
  @{ Nome = "Chocolatey"; Url = "https://community.chocolatey.org/api/v2/package/nssm/2.24.101.20180116"; Tipo = "nupkg" }
)

foreach ($f in $fontes) {
  try {
    Write-Host "    Tentando $($f.Nome)..."
    $arq = Join-Path $tmp "download.$($f.Tipo)"
    Invoke-WebRequest -UseBasicParsing -Uri $f.Url -OutFile $arq -TimeoutSec 60
    if ($f.Tipo -eq "nupkg") {
      $pac = Join-Path $tmp "pacote"
      Copy-Item $arq "$arq.zip"
      Expand-Archive "$arq.zip" $pac -Force
      $arq = Join-Path $pac "tools\$NomeZip"
    }
    Extrair-Exe $arq
    Write-Host "    OK: NSSM obtido de $($f.Nome) (SHA256 conferido)" -ForegroundColor Green
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  } catch {
    Write-Host "    Falhou ($($f.Nome)): $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
exit 1
