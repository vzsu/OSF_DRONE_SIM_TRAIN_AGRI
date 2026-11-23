<#
  OSF Agri Flight Trainer - one-click launcher (Windows PowerShell 5.1+)

  What it does, in order:
    1. Checks Node.js is installed (v18+).
    2. Runs "npm install" when dependencies are missing or package.json changed.
    3. Rebuilds (WASM + Next.js) only when source files changed since the last build.
    4. Checks the Windows Firewall rule for ports 3000/3443 (adds it with -SetupFirewall, asks for admin once).
    5. Stops an old copy of this sim server if one is still holding the ports.
    6. Starts the server on the local network and opens the browser.

  Usage:
    .\start-sim.ps1                 normal start
    .\start-sim.ps1 -Rebuild        force a clean rebuild
    .\start-sim.ps1 -SetupFirewall  allow other PCs to connect (one UAC prompt)
    .\start-sim.ps1 -Dev            development mode (hot reload)
    .\start-sim.ps1 -NoBrowser      do not open the browser
  Or double-click start-sim.cmd.
#>
param(
  [switch]$Rebuild,
  [switch]$SetupFirewall,
  [switch]$Dev,
  [switch]$NoBrowser,
  [int]$HttpPort = 3000,
  [int]$HttpsPort = 3443
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$RuleName = 'OSF Agri Flight Trainer'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    $msg" -ForegroundColor Yellow }
function Stop-WithError($msg) { Write-Host "`nERROR: $msg" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

# ---------- 1. Node.js ----------
Write-Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-WithError 'Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.' }
$ver = (& node -v).TrimStart('v')
if ([int]($ver.Split('.')[0]) -lt 18) { Stop-WithError "Node.js $ver is too old. Install v18 or newer from https://nodejs.org" }
Write-Ok "Node.js $ver"

# ---------- 2. Dependencies ----------
Write-Step 'Checking dependencies'
$lockMarker = Join-Path $PSScriptRoot 'node_modules\.package-lock.json'
$needInstall = -not (Test-Path $lockMarker)
if (-not $needInstall) {
  $needInstall = (Get-Item 'package.json').LastWriteTime -gt (Get-Item $lockMarker).LastWriteTime
}
if ($needInstall) {
  Write-Warn2 'Installing packages (first run can take a few minutes)...'
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'npm install failed. Check the internet connection and try again.' }
}
Write-Ok 'Dependencies ready'

# ---------- 3. Build ----------
if (-not $Dev) {
  Write-Step 'Checking build'
  $buildId = Join-Path $PSScriptRoot '.next\BUILD_ID'
  $needBuild = $Rebuild -or -not (Test-Path $buildId)
  if (-not $needBuild) {
    $built = (Get-Item $buildId).LastWriteTime
    $newer = Get-ChildItem -Path 'src', 'assembly', 'scripts', 'public' -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne 'sim.wasm' -and $_.LastWriteTime -gt $built } | Select-Object -First 1
    $cfgNewer = Get-ChildItem 'package.json', 'next.config.mjs', 'tsconfig.json' | Where-Object { $_.LastWriteTime -gt $built }
    $needBuild = [bool]$newer -or [bool]$cfgNewer
  }
  if ($needBuild) {
    Write-Warn2 'Building simulator (WASM physics + web app)...'
    if (Test-Path '.next') { Remove-Item '.next' -Recurse -Force }
    & npm run build
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'Build failed. See the messages above.' }
    Write-Ok 'Build complete'
  } else {
    Write-Ok 'Build is up to date'
  }
}

# ---------- 4. Firewall ----------
Write-Step 'Checking Windows Firewall'
$rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
# older versions added a Private-only rule; phone hotspots and many Wi-Fi networks are 'Public'
if ($rule -and ("$($rule.Profile)" -notmatch 'Public|Any')) {
  if ($SetupFirewall) { $rule = $null } else { Write-Warn2 'Firewall rule only covers Private networks. Run: .\start-sim.ps1 -SetupFirewall' }
}
if ($rule) {
  Write-Ok 'Firewall rule present: other PCs on the network can connect'
} elseif ($SetupFirewall) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  # Private + Public (phone hotspots are 'Public'), but only devices on the same local subnet
  $cmd = "Remove-NetFirewallRule -DisplayName '$RuleName' -ErrorAction SilentlyContinue; New-NetFirewallRule -DisplayName '$RuleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $HttpPort,$HttpsPort -Profile Private,Public -RemoteAddress LocalSubnet | Out-Null"
  if ($isAdmin) {
    Invoke-Expression $cmd
  } else {
    Write-Warn2 'Windows will ask for administrator permission once to add the firewall rule...'
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $cmd
  }
  if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) { Write-Ok "Firewall rule added (TCP $HttpPort, $HttpsPort, same-subnet devices, Private + Public networks)" }
  else { Write-Warn2 'Firewall rule was not added. Other PCs may not be able to connect.' }
} else {
  Write-Warn2 "No firewall rule yet. Only this PC can connect for sure."
  Write-Warn2 "For trainee PCs run once:  .\start-sim.ps1 -SetupFirewall"
}

# ---------- 5. Free the ports (only stops an old copy of THIS server) ----------
Write-Step 'Checking ports'
foreach ($port in @($HttpPort, $HttpsPort)) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server\.mjs') {
      Write-Warn2 "Stopping old simulator server (PID $($proc.ProcessId)) on port $port"
      Stop-Process -Id $proc.ProcessId -Force
      Start-Sleep -Milliseconds 500
    } elseif ($proc) {
      Stop-WithError "Port $port is used by another program ($($proc.Name), PID $($proc.ProcessId)). Close it or start with -HttpPort / -HttpsPort."
    }
  }
}
Write-Ok "Ports $HttpPort and $HttpsPort are free"

# ---------- 6. Start ----------
Write-Step 'Starting server (press Ctrl+C in this window to stop)'
if (-not $NoBrowser) {
  # open the browser as soon as the server answers
  Start-Job -ArgumentList $HttpPort -ScriptBlock {
    param($p)
    for ($i = 0; $i -lt 120; $i++) {
      try { Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$p/" -TimeoutSec 2 | Out-Null; Start-Process "http://localhost:$p/"; return } catch { Start-Sleep -Milliseconds 500 }
    }
  } | Out-Null
}
$serverArgs = @('server.mjs', '--http-port', "$HttpPort", '--https-port', "$HttpsPort")
if ($Dev) { & npm run build:wasm; $serverArgs += '--dev' }
& node @serverArgs
