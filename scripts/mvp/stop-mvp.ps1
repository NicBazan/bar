# Apaga los procesos del MVP (API, carta, panel y túneles). Docker queda prendido.
param([switch]$Quiet)
$ErrorActionPreference = "SilentlyContinue"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pidsFile = Join-Path $Root ".mvp\pids.json"

if (Test-Path $pidsFile) {
  $pids = Get-Content $pidsFile -Raw | ConvertFrom-Json
  foreach ($prop in $pids.PSObject.Properties) {
    # /T: también los hijos (next start levanta workers)
    taskkill /PID $prop.Value /T /F 2>$null | Out-Null
  }
  Remove-Item $pidsFile -ErrorAction SilentlyContinue
}

# Por si quedó algo escuchando en los puertos del MVP (por ejemplo, de una corrida anterior)
foreach ($port in 3000, 3001, 4000) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    taskkill /PID $_.OwningProcess /T /F 2>$null | Out-Null
  }
}

if (-not $Quiet) { Write-Host "MVP detenido." }
