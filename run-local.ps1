<#
.SYNOPSIS
  Bring up the Ask Alex local stack (steps 1-3): backend (read-only against the
  shared prod DB) + golden suite + frontend wired to the local backend.

.EXAMPLE
  .\run-local.ps1                 # backend + golden + frontend, all up
  .\run-local.ps1 -BackendOnly    # just the backend (+ golden)
  .\run-local.ps1 -SkipGolden     # don't run the golden suite
  .\run-local.ps1 -Stop           # stop both servers + remove the dev env file

  If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\run-local.ps1
#>
[CmdletBinding()]
param(
  [int]$Port = 8787,
  [string]$BackendDir  = "C:\Users\AlexHuang\projects\genai-kb-agent",
  [string]$FrontendDir = "C:\Users\AlexHuang\projects\alex-huang.dev",
  [switch]$SkipGolden,
  [switch]$BackendOnly,
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$envFile = Join-Path $FrontendDir ".env.development.local"

# Kill anything listening on a port (so re-runs restart cleanly, no "port in use").
function Stop-Port([int]$p) {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
  $killed = $false
  foreach ($c in $conns) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "  freed :$p (pid $($c.OwningProcess))" -ForegroundColor DarkYellow
    $killed = $true
  }
  if ($killed) { Start-Sleep -Milliseconds 600 }  # let the socket release
}

# --- Stop mode: kill servers on $Port + 4321 and remove the dev env file ---
if ($Stop) {
  Stop-Port $Port
  Stop-Port 4321
  if (Test-Path $envFile) { Remove-Item $envFile; Write-Host "removed $envFile" -ForegroundColor Yellow }
  Write-Host "Local stack stopped." -ForegroundColor Green
  exit 0
}

# Auto-restart guard: free both ports first so a plain re-run always works.
Write-Host "Clearing any existing local servers..." -ForegroundColor DarkGray
Stop-Port $Port
Stop-Port 4321

# --- 1. Backend in its own window (read-only: no schema DDL, no conversation writes) ---
$beCmd = "`$env:SKIP_SCHEMA_INIT='1'; `$env:DISABLE_CONVERSATION_LOG='1'; `$env:PORT='$Port'; " +
         "Set-Location '$BackendDir'; " +
         "Write-Host 'Ask Alex backend (read-only) :$Port  -  watch the {kind:turn} log lines' -ForegroundColor Cyan; " +
         "npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $beCmd | Out-Null
Write-Host "Backend launching in a new window on http://localhost:$Port ..." -ForegroundColor Cyan

# wait for /health
$healthy = $false
for ($i = 0; $i -lt 45; $i++) {
  try {
    if ((Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 3).ok) { $healthy = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
if (-not $healthy) {
  Write-Host "Backend did not become healthy on :$Port (check the backend window; is ADC set? gcloud auth application-default login)" -ForegroundColor Red
  exit 1
}
Write-Host "Backend healthy." -ForegroundColor Green

# --- 2. Golden suite (acceptance criteria) ---
if (-not $SkipGolden) {
  Write-Host "`nRunning golden suite..." -ForegroundColor Cyan
  Push-Location $BackendDir
  $env:BASE = "http://localhost:$Port"
  node test/golden.mjs
  Pop-Location
}

# --- 3. Frontend wired to the local backend (dev-only, gitignored) ---
if (-not $BackendOnly) {
  # UTF-8 without BOM so dotenv parses the first line cleanly
  [System.IO.File]::WriteAllText($envFile, "PUBLIC_ASK_ALEX_API=http://localhost:$Port`n")
  Write-Host "`nWrote $envFile" -ForegroundColor Green
  $feCmd = "Set-Location '$FrontendDir'; " +
           "Write-Host 'Ask Alex frontend -> http://localhost:4321/ask' -ForegroundColor Cyan; " +
           "npm run dev"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $feCmd | Out-Null
  Write-Host "Frontend launching in a new window -> http://localhost:4321/ask" -ForegroundColor Green
}

Write-Host "`n--------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "Stack up.  Backend :$Port (read-only)$(if (-not $BackendOnly) { ", Frontend :4321" })" -ForegroundColor Green
Write-Host "Open:  http://localhost:4321/ask"
Write-Host "Logs:  watch the {`"kind`":`"turn`"} JSON lines in the backend window"
Write-Host "Stop:  .\run-local.ps1 -Stop   (or close the windows)" -ForegroundColor Yellow
