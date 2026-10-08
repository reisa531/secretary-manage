# Secretary Manage Platform - one-click launcher
# 1) check server health 2) start server if down 3) open browser
$WarningPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'

$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$url    = 'http://127.0.0.1:8081'
$health = "$url/api/health"

function Test-Healthy {
    try {
        $r = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 3
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

if (-not (Test-Healthy)) {
    Write-Host "Server is not running, starting it ..."
    Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Minimized

    $tries = 0
    while ($tries -lt 30 -and -not (Test-Healthy)) {
        Start-Sleep -Seconds 1
        $tries++
    }

    if (-not (Test-Healthy)) {
        Write-Host "Server did not become ready within 30 seconds. Please run start.bat manually to troubleshoot." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Server started."
}

Start-Process $url
