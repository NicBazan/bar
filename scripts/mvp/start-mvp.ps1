# Arranca el MVP completo en esta PC y deja una página con links y QR para el celular.
#   Uso: doble clic en INICIAR-MVP.cmd (o: powershell -ExecutionPolicy Bypass -File scripts\mvp\start-mvp.ps1)
#   Opciones: -SkipBuild (no recompila los front)  -NoTunnel (solo red local)  -NoBrowser (no abre la página)
param([switch]$SkipBuild, [switch]$NoTunnel, [switch]$NoBrowser)

# "Continue": en PowerShell 5.1, con "Stop" redirigir el stderr de un .exe (docker, pnpm) lanza
# excepción aunque el comando funcione. Los errores se controlan con $LASTEXITCODE y Fail.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$State = Join-Path $Root ".mvp"
$Logs = Join-Path $State "logs"
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"

function Say($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) }
function Fail($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; Write-Host "Mirá los logs en $Logs"; exit 1 }

function Wait-Http($url, $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -lt 500) { return $true }
    } catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { return $true }
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

Write-Host ""
Write-Host "  BAR MVP - arranque" -ForegroundColor Yellow
Write-Host ""

# ── 0. Apagar una instancia anterior ──
& (Join-Path $PSScriptRoot "stop-mvp.ps1") -Quiet

# ── 1. Docker + base de datos ──
Say "Verificando Docker..."
$dockerOk = $false
docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
$dockerOk = ($LASTEXITCODE -eq 0)
if (-not $dockerOk) {
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
    "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
  )
  $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { Fail "No encontré Docker Desktop. Instalalo o abrilo a mano." }
  Say "Abriendo Docker Desktop (puede tardar 1-2 minutos)..."
  Start-Process $exe
  $deadline = (Get-Date).AddMinutes(4)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 4
    docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break }
  }
  if (-not $dockerOk) { Fail "Docker no arrancó a tiempo." }
}
Say "Levantando Postgres y Redis..."
docker compose -f (Join-Path $Root "infra\docker\docker-compose.yml") up -d *> (Join-Path $Logs "docker.log")
for ($i = 0; $i -lt 30; $i++) {
  docker exec bar-postgres-1 pg_isready -U bar -d bar 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}

# ── 2. Secretos (.env) ──
$envFile = Join-Path $Root ".env"
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $Root ".env.example") $envFile }
$envText = Get-Content $envFile -Raw
function New-Hex($bytes) { $b = New-Object byte[] $bytes; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString("x2") }) -join "" }
$added = @()
if ($envText -notmatch "(?m)^JWT_SECRET=") { $added += "JWT_SECRET=$(New-Hex 32)" }
if ($envText -notmatch "(?m)^NFC_MASTER_KEY=") { $added += "NFC_MASTER_KEY=$(New-Hex 16)" }
if ($added.Count -gt 0) {
  Add-Content -Path $envFile -Value ("`r`n# Generados por start-mvp.ps1 (no compartir)`r`n" + ($added -join "`r`n")) -Encoding ASCII
  Say "Secretos generados en .env"
}
# Variables del .env para este proceso (las heredan la API y los front)
Get-Content $envFile | Where-Object { $_ -match "^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$" } | ForEach-Object {
  $k = $Matches[1]; $v = $Matches[2].Trim('"')
  Set-Item -Path "env:$k" -Value $v
}

# ── 3. Dependencias, base y build ──
Push-Location $Root
try {
  Say "Instalando dependencias (rápido si ya están)..."
  corepack pnpm install --frozen-lockfile *> (Join-Path $Logs "install.log")
  if ($LASTEXITCODE -ne 0) { Fail "Falló pnpm install" }
  Say "Base de datos: cliente y migraciones..."
  corepack pnpm --filter @bar/db generate *> (Join-Path $Logs "db.log")
  corepack pnpm --filter @bar/db run migrate:deploy *>> (Join-Path $Logs "db.log")
  if ($LASTEXITCODE -ne 0) { Fail "Fallaron las migraciones" }
  # SQL por stdin: PowerShell 5.1 rompe las comillas dobles al pasarlas como argumento a un .exe
  $hasDemo = "select count(*) from `"Tenant`" where slug = 'bar-demo';" | docker exec -i bar-postgres-1 psql -U bar -d bar -tA
  if ("$hasDemo".Trim() -eq "0") {
    Say "Cargando datos demo (primera vez)..."
    corepack pnpm --filter @bar/db seed *>> (Join-Path $Logs "db.log")
  }
  if (-not $SkipBuild) {
    Say "Compilando la carta y el panel en modo producción (1-2 minutos)..."
    $env:NODE_ENV = "production"
    corepack pnpm --filter @bar/guest-web build *> (Join-Path $Logs "build-guest.log")
    if ($LASTEXITCODE -ne 0) { Fail "Falló el build de la carta" }
    corepack pnpm --filter @bar/staff-web build *> (Join-Path $Logs "build-staff.log")
    if ($LASTEXITCODE -ne 0) { Fail "Falló el build del panel" }
  }
} finally { Pop-Location }

# ── 4. Red: IP local y túneles HTTPS ──
$lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
  Select-Object -First 1).IPv4Address.IPAddress
$pids = @{}
$cartaTunnel = $null; $panelTunnel = $null
$cloudflared = @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $NoTunnel -and $cloudflared) {
  Say "Abriendo túneles HTTPS (Cloudflare)..."
  foreach ($t in @(@{ name = "carta"; port = 3000 }, @{ name = "panel"; port = 3001 })) {
    $log = Join-Path $Logs "tunnel-$($t.name).log"
    Remove-Item $log -ErrorAction SilentlyContinue
    $p = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://localhost:$($t.port)") `
      -RedirectStandardError $log -RedirectStandardOutput "$log.out" -WindowStyle Hidden -PassThru
    $pids["tunnel-$($t.name)"] = $p.Id
  }
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and (-not $cartaTunnel -or -not $panelTunnel)) {
    Start-Sleep -Seconds 2
    foreach ($n in @("carta", "panel")) {
      $f = Join-Path $Logs "tunnel-$n.log"
      if (Test-Path $f) {
        $m = Select-String -Path $f -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches | Where-Object { $_.Line -notmatch "api\.trycloudflare" } | Select-Object -First 1
        if ($m) {
          $url = $m.Matches[0].Value
          if ($n -eq "carta") { $cartaTunnel = $url } else { $panelTunnel = $url }
        }
      }
    }
  }
  if (-not $cartaTunnel) { Say "No se pudo abrir el túnel (¿DNS?). Sigo con la red local." }
} elseif (-not $NoTunnel) {
  Say "cloudflared no está instalado: solo red local (winget install Cloudflare.cloudflared)"
}

# ── 5. Servidores ──
$guestPublic = if ($cartaTunnel) { $cartaTunnel } elseif ($lanIp) { "http://${lanIp}:3000" } else { "http://localhost:3000" }
$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"            # la API solo la ven los front de esta PC
$env:PORT = "4000"
$env:PUBLIC_GUEST_URL = $guestPublic
$env:UPLOADS_DIR = Join-Path $Root "apps\api\uploads"
$env:API_INTERNAL_URL = "http://127.0.0.1:4000"

Say "Arrancando la API..."
$api = Start-Process -FilePath "node" -ArgumentList @("--import", "tsx", "src/server.ts") -WorkingDirectory (Join-Path $Root "apps\api") `
  -RedirectStandardOutput (Join-Path $Logs "api.log") -RedirectStandardError (Join-Path $Logs "api.err.log") -WindowStyle Hidden -PassThru
$pids["api"] = $api.Id
if (-not (Wait-Http "http://127.0.0.1:4000/health" 60)) { Fail "La API no respondió" }

Say "Arrancando la carta (3000) y el panel (3001)..."
foreach ($w in @(@{ name = "guest"; dir = "apps\guest-web"; port = 3000 }, @{ name = "staff"; dir = "apps\staff-web"; port = 3001 })) {
  $next = Join-Path $Root "$($w.dir)\node_modules\next\dist\bin\next"
  $p = Start-Process -FilePath "node" -ArgumentList @("`"$next`"", "start", "-p", "$($w.port)", "-H", "0.0.0.0") -WorkingDirectory (Join-Path $Root $w.dir) `
    -RedirectStandardOutput (Join-Path $Logs "$($w.name).log") -RedirectStandardError (Join-Path $Logs "$($w.name).err.log") -WindowStyle Hidden -PassThru
  $pids[$w.name] = $p.Id
}
if (-not (Wait-Http "http://127.0.0.1:3000/" 90)) { Fail "La carta no respondió" }
if (-not (Wait-Http "http://127.0.0.1:3001/login" 90)) { Fail "El panel no respondió" }

# ── 5.b HTTPS local (Caddy): cámara y AR en el celular por el Wi-Fi, sin túnel ni internet ──
# Caddy emite certificados con su propia autoridad local. El celular instala ese certificado
# (bar-mvp-ca.crt) una sola vez. La clave privada de la autoridad queda solo en .mvp/caddy.
$localHttps = $null
$caddy = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\caddy.exe", "$env:ProgramFiles\Caddy\caddy.exe") +
  @(Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\CaddyServer.Caddy*\caddy.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) |
  Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($caddy -and $lanIp) {
  Say "Abriendo HTTPS local (https://${lanIp}:3443)..."
  $caddyDir = Join-Path $State "caddy"; $caDir = Join-Path $State "ca"
  New-Item -ItemType Directory -Force -Path $caddyDir, $caDir | Out-Null
  $fwd = $State -replace "\\", "/"
  $caddyfile = @"
{
	skip_install_trust
	admin off
	storage file_system "$fwd/caddy"
	auto_https disable_redirects
}

https://${lanIp}:3443, https://localhost:3443 {
	tls internal
	reverse_proxy 127.0.0.1:3000
}

https://${lanIp}:3444, https://localhost:3444 {
	tls internal
	reverse_proxy 127.0.0.1:3001
}

# Solo el certificado PUBLICO de la autoridad local, para instalarlo en el celular
http://${lanIp}:3480, http://localhost:3480 {
	root * "$fwd/ca"
	file_server
}
"@
  $caddyfile | Set-Content -Path (Join-Path $State "Caddyfile") -Encoding ASCII
  $c = Start-Process -FilePath $caddy -ArgumentList @("run", "--config", "`"$(Join-Path $State 'Caddyfile')`"", "--adapter", "caddyfile") `
    -RedirectStandardError (Join-Path $Logs "caddy.log") -RedirectStandardOutput (Join-Path $Logs "caddy.out.log") -WindowStyle Hidden -PassThru
  $pids["caddy"] = $c.Id
  $rootCrt = Join-Path $caddyDir "pki\authorities\local\root.crt"
  for ($i = 0; $i -lt 20 -and -not (Test-Path $rootCrt); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Path $rootCrt) {
    Copy-Item $rootCrt (Join-Path $caDir "bar-mvp-ca.crt") -Force
    $localHttps = @{ carta = "https://${lanIp}:3443"; panel = "https://${lanIp}:3444"; ca = "http://${lanIp}:3480/bar-mvp-ca.crt" }
  } else {
    Say "Caddy no generó el certificado: sigo sin HTTPS local (ver logs\caddy.log)"
  }
} elseif (-not $caddy) {
  Say "Caddy no está instalado: sin HTTPS local (winget install CaddyServer.Caddy)"
}

$pids | ConvertTo-Json | Set-Content -Path (Join-Path $State "pids.json") -Encoding UTF8

# ── 6. Página con links y QR ──
$sql = "select d.label, t.code from `"TableTag`" t join `"DiningTable`" d on d.id = t.`"tableId`" join `"Tenant`" n on n.id = t.`"tenantId`" where n.slug = 'bar-demo' and t.active and t.type = 'QR' and d.active order by d.label;"
$rows = $sql | docker exec -i bar-postgres-1 psql -U bar -d bar -tA -F "|"
$tables = @($rows | Where-Object { $_ -match "\|" } | ForEach-Object { $a = $_ -split "\|"; @{ label = $a[0]; code = $a[1] } })
$info = @{ lanIp = $lanIp; cartaTunnel = $cartaTunnel; panelTunnel = $panelTunnel; localHttps = $localHttps; tables = $tables; startedAt = (Get-Date).ToString("o") }
$infoFile = Join-Path $State "info.json"
$info | ConvertTo-Json -Depth 4 | Set-Content -Path $infoFile -Encoding UTF8
$html = Join-Path $State "LINKS.html"
node (Join-Path $Root "scripts\mvp\links.mjs") $infoFile $html | Out-Null

Write-Host ""
Write-Host "  LISTO: el MVP está andando" -ForegroundColor Green
Write-Host ""
if ($localHttps) { Write-Host "  Carta (HTTPS Wi-Fi): $($localHttps.carta)/t/$($tables[0].code)" }
if ($cartaTunnel) { Write-Host "  Carta (HTTPS):     $cartaTunnel/t/$($tables[0].code)" }
if ($lanIp) { Write-Host "  Carta (Wi-Fi):     http://${lanIp}:3000/t/$($tables[0].code)" }
if ($panelTunnel) { Write-Host "  Panel (HTTPS):     $panelTunnel/login" }
if ($lanIp) { Write-Host "  Panel (Wi-Fi):     http://${lanIp}:3001/login" }
Write-Host "  Links y QR:        $html"
Write-Host ""
if (-not $NoBrowser) { Start-Process $html }
