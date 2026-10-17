<#
  Site do Data Gateway - gera a configuracao do Caddy e inclui no Caddyfile principal.

  Uso (PowerShell como Administrador, na pasta site):
    .\deploy\adicionar-ao-caddy.ps1
    .\deploy\adicionar-ao-caddy.ps1 -Dominio api2dev.com.br -Caddyfile "C:\Caddy\Caddyfile"
    .\deploy\adicionar-ao-caddy.ps1 -SemWww                 (nao cria o redirecionamento do www)
    .\deploy\adicionar-ao-caddy.ps1 -CorrigirAcentos        (conserta acentos estragados no Caddyfile, ex.: "IdentificaA+simbolos")
    .\deploy\adicionar-ao-caddy.ps1 -SemRecarregar          (so gera o arquivo)

  O que faz:
    1. Gera caddy\site-datagateway.caddy  (https://<dominio>  ->  127.0.0.1:<porta>)
    2. Confere se o dominio ja esta em outro bloco do Caddy (evita "ambiguous site definition").
    3. Garante a linha  import "<...>/caddy/site-datagateway.caddy"  no Caddyfile principal (com backup).
    4. Valida e recarrega o Caddy (caddy validate + caddy reload).

  O Caddyfile e lido e gravado SEMPRE em UTF-8 sem BOM (nao estraga acentos de outros blocos).
#>
param(
  [string]$Dominio = "api2dev.com.br",
  [switch]$SemWww,                  # nao cria www.<dominio> -> <dominio>
  [string]$Caddyfile = "",          # vazio = procura em locais comuns / pergunta
  [string]$CaddyExe = "",           # vazio = procura no PATH / locais comuns
  [int]$Porta = 5010,
  [switch]$CorrigirAcentos,         # conserta acentos estragados (mojibake) no Caddyfile principal
  [switch]$Forcar,                  # inclui mesmo se o dominio ja aparecer em outro bloco
  [switch]$SemRecarregar            # so gera o arquivo, nao mexe no Caddy
)

$ErrorActionPreference = "Stop"
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RaizCaddy = $Raiz -replace '\\', '/'
$NomeArquivo = "site-datagateway.caddy"
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Dominio = $Dominio.Trim().ToLower()

function Escrever($cor, $txt) { Write-Host $txt -ForegroundColor $cor }

# ---------------------------------------------------------------- gera caddy\site-datagateway.caddy
$pastaCaddy = Join-Path $Raiz "caddy"
$pastaLogs = Join-Path $Raiz "logs"
New-Item -ItemType Directory -Force -Path $pastaCaddy, $pastaLogs | Out-Null
$arquivoSite = Join-Path $pastaCaddy $NomeArquivo
$agora = Get-Date -Format "dd/MM/yyyy HH:mm"

$cloudflare = "173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"

$blocoWww = ""
if (-not $SemWww -and -not $Dominio.StartsWith('www.')) {
  $blocoWww = "`n# www redireciona para o endereco principal`nwww.$Dominio {`n`tredir https://$Dominio{uri} permanent`n}"
}

$conteudo = @"
# Site do Data Gateway (download) - gerado por deploy\adicionar-ao-caddy.ps1 em $agora. Para mudar, rode o script de novo.
# Endereco: https://$Dominio   ->   servico SiteDataGateway em 127.0.0.1:$Porta

$Dominio {
	encode zstd gzip

	# Cloudflare (nuvem laranja): o IP real do visitante vem no CF-Connecting-IP.
	@cloudflare remote_ip $cloudflare

	# O site so aceita GET/HEAD (sem envio de arquivos)
	request_body {
		max_size 1MB
	}

	header {
		defer
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
		-X-Powered-By
	}

	# Paginas, imagens e downloads dos executaveis -> Node (servico SiteDataGateway)
	route {
		request_header -X-Cliente-IP
		request_header @cloudflare X-Cliente-IP {http.request.header.CF-Connecting-IP}
		reverse_proxy 127.0.0.1:$Porta {
			# downloads de ~100 MB em conexoes lentas
			transport http {
				read_timeout 600s
				write_timeout 600s
			}
		}
	}

	log {
		output file "$RaizCaddy/logs/caddy-acesso.log" {
			roll_size 20MiB
			roll_keep 10
		}
	}
}
$blocoWww
"@

[System.IO.File]::WriteAllText($arquivoSite, $conteudo.Replace("`r`n", "`n"), $Utf8)
Escrever Green "OK  Gerado: $arquivoSite  (https://$Dominio -> 127.0.0.1:$Porta)"

if ($SemRecarregar) { exit 0 }

# ---------------------------------------------------------------- localiza caddy.exe
if (-not $CaddyExe) {
  $cmd = Get-Command caddy -ErrorAction SilentlyContinue
  if ($cmd) { $CaddyExe = $cmd.Source }
}
if (-not $CaddyExe) {
  foreach ($c in @("C:\Caddy\caddy.exe", "C:\caddy\caddy.exe", "C:\Program Files\Caddy\caddy.exe", "C:\tools\caddy\caddy.exe")) {
    if (Test-Path $c) { $CaddyExe = $c; break }
  }
}
if (-not $CaddyExe) {
  $svc = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'caddy' -or $_.PathName -match 'caddy' } | Select-Object -First 1
  if ($svc -and $svc.PathName -match '"?([^"]*caddy[^"]*\.exe)"?') { $CaddyExe = $Matches[1] }
}
if (-not $CaddyExe -or -not (Test-Path $CaddyExe)) {
  Escrever Yellow "!   caddy.exe nao encontrado. Informe com -CaddyExe ""C:\caminho\caddy.exe"" ou inclua manualmente:"
  Escrever Yellow "    import ""$RaizCaddy/caddy/$NomeArquivo"""
  exit 1
}

# ---------------------------------------------------------------- localiza o Caddyfile principal
if (-not $Caddyfile) {
  $candidatos = @((Join-Path (Split-Path $CaddyExe) "Caddyfile"), "C:\Caddy\Caddyfile", "C:\caddy\Caddyfile")
  foreach ($c in $candidatos) { if (Test-Path $c) { $Caddyfile = $c; break } }
}
if (-not $Caddyfile) { $Caddyfile = Read-Host "Caminho do Caddyfile principal" }
if (-not (Test-Path $Caddyfile)) { Escrever Red "X   Caddyfile nao encontrado: $Caddyfile"; exit 1 }

# Le SEMPRE como UTF-8 (Get-Content sem -Encoding le como ANSI no PowerShell 5 e estraga os acentos)
$atual = [System.IO.File]::ReadAllText($Caddyfile, $Utf8)
$original = $atual

# ---------------------------------------------------------------- conserta acentos estragados (opcional)
if ($CorrigirAcentos -and $atual -match '\u00C3[\u0080-\u00BF]') {
  # texto UTF-8 que foi lido como Windows-1252 e regravado: desfaz a conversao
  $cp1252 = [System.Text.Encoding]::GetEncoding(1252)
  $tentativa = $atual
  for ($i = 0; $i -lt 3 -and $tentativa -match '\u00C3[\u0080-\u00BF]'; $i++) {
    $tentativa = $Utf8.GetString($cp1252.GetBytes($tentativa))
  }
  if ($tentativa -notmatch [char]0xFFFD) {
    $atual = $tentativa
    Escrever Green "OK  Acentos do Caddyfile corrigidos."
  } else {
    Escrever Yellow "!   Nao foi possivel corrigir os acentos automaticamente (nada alterado neles)."
  }
}

# ---------------------------------------------------------------- confere conflito de dominio
# Procura o dominio como endereco de site no Caddyfile e nos arquivos importados (menos o nosso).
$arquivosVerificar = @(@{ Caminho = $Caddyfile; Texto = $atual })
foreach ($m in [regex]::Matches($atual, '(?m)^\s*import\s+"?([^"\r\n]+?)"?\s*$')) {
  $imp = $m.Groups[1].Value.Trim()
  if ($imp -like "*$NomeArquivo") { continue }
  if ($imp -match '[\*\?]') { continue }
  $impCaminho = if ([System.IO.Path]::IsPathRooted($imp)) { $imp } else { Join-Path (Split-Path $Caddyfile) $imp }
  if (Test-Path $impCaminho -PathType Leaf) {
    $arquivosVerificar += @{ Caminho = $impCaminho; Texto = [System.IO.File]::ReadAllText($impCaminho, $Utf8) }
  }
}
$nomes = @($Dominio)
if ($blocoWww) { $nomes += "www.$Dominio" }
$conflitos = @()
foreach ($a in $arquivosVerificar) {
  foreach ($linha in ($a.Texto -split "`n")) {
    $l = ($linha -replace '#.*$', '').Trim()
    if (-not $l.EndsWith('{')) { continue }
    $enderecos = $l.TrimEnd('{').Trim() -split '[,\s]+' | ForEach-Object { ($_ -replace '^https?://', '' -replace ':\d+$', '').ToLower() }
    foreach ($n in $nomes) { if ($enderecos -contains $n) { $conflitos += "$($a.Caminho): $l" } }
  }
}
if ($conflitos.Count -gt 0) {
  Escrever Yellow "!   O endereco $Dominio ja esta configurado em outro bloco do Caddy:"
  $conflitos | Select-Object -Unique | ForEach-Object { Escrever Yellow "      $_" }
  if (-not $Forcar) {
    Escrever Yellow "    Remova/comente esse bloco (o site do Data Gateway passa a responder por ele) e rode de novo,"
    Escrever Yellow "    ou use -Forcar. Nada foi alterado no Caddyfile."
    exit 1
  }
}

# ---------------------------------------------------------------- inclui o import
$linhaImport = "import ""$RaizCaddy/caddy/$NomeArquivo"""
if ($atual -notmatch [regex]::Escape("$RaizCaddy/caddy/$NomeArquivo")) {
  $atual = $atual.TrimEnd() + "`n`n# Site do Data Gateway - download (api2dev.com.br)`n$linhaImport`n"
  Escrever Green "OK  Import incluido no $Caddyfile"
} else {
  Escrever Green "OK  O Caddyfile ja importa o site do Data Gateway."
}

if ($atual -ne $original) {
  $backup = "$Caddyfile.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $Caddyfile $backup
  [System.IO.File]::WriteAllText($Caddyfile, $atual, $Utf8)
  Escrever Gray "    Backup: $backup"
}

# ---------------------------------------------------------------- valida e recarrega
& $CaddyExe validate --config $Caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  Escrever Red "X   O Caddyfile tem erro (veja acima). Nada foi recarregado."
  if ($backup) { Escrever Yellow "    Para voltar ao anterior: copie $backup sobre $Caddyfile" }
  exit 1
}

& $CaddyExe reload --config $Caddyfile --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  Escrever Yellow "!   'caddy reload' falhou (o Caddy esta rodando?). Reinicie o servico do Caddy manualmente."
  exit 1
}
Escrever Green "OK  Caddy recarregado. Acesse: https://$Dominio"
Escrever Gray  "    Lembre: o DNS de $Dominio (e www) precisa apontar para este servidor (ou para a Cloudflare)."
exit 0
