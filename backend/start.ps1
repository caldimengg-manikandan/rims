Set-Location $PSScriptRoot

$PORT = 10000
$PID_FILE = ".\.backend.pid"

# trigger redeploy 2026-06-24: 16:21

# ---------------------------------------------------------------------------
# Aggressively free port 10000 regardless of whether the process is alive.
# Strategy:
#   1. Kill the saved PID from the last run (full process tree via taskkill /T)
#   2. Kill every PID netstat finds on the port (catches orphans)
#   3. Wait up to 30 s for the OS to release the socket (TIME_WAIT)
# ---------------------------------------------------------------------------
function Clear-Port {
    Write-Host "Clearing port $PORT..." -ForegroundColor Cyan

    # -- Step 1: kill the saved PID from the previous run -------------------
    if (Test-Path $PID_FILE) {
        $savedPid = Get-Content $PID_FILE -ErrorAction SilentlyContinue
        if ($savedPid -match '^\d+$') {
            Write-Host "  Killing saved PID $savedPid and its children..."
            taskkill /PID $savedPid /F /T 2>$null | Out-Null
            Stop-Process -Id ([int]$savedPid) -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $PID_FILE -Force -ErrorAction SilentlyContinue
    }

    # -- Step 2: kill any remaining process found via netstat ---------------
    $netstatLines = netstat -ano 2>$null | Select-String ":$PORT\s"
    $netPids = @()
    foreach ($line in $netstatLines) {
        $parts = ($line.ToString().Trim()) -split '\s+'
        $netPid = $parts[-1]
        if ($netPid -match '^\d+$' -and [int]$netPid -gt 0) {
            $netPids += [int]$netPid
        }
    }
    foreach ($netPid in ($netPids | Sort-Object -Unique)) {
        Write-Host "  Killing netstat PID $netPid on port $PORT..."
        taskkill /PID $netPid /F /T 2>$null | Out-Null
        Stop-Process -Id ([int]$netPid) -Force -ErrorAction SilentlyContinue
    }

    # -- Step 3: wait up to 30 s for the OS to release the socket ----------
    $waited = 0
    while ($waited -lt 20) {
        $still = netstat -ano 2>$null | Select-String ":$PORT\s.*LISTENING"
        if (-not $still) { break }
        Start-Sleep -Seconds 1
        $waited++
        if ($waited % 5 -eq 0) {
            Write-Host "  Waiting for port $PORT to free... ($waited/20 s)" -ForegroundColor Yellow
        }
    }

    $final = netstat -ano 2>$null | Select-String ":$PORT\s"
    if ($final) {
        Write-Host "  Note: Port $PORT may still show in netstat (TIME_WAIT) but SO_REUSEADDR will bypass it." -ForegroundColor Yellow
    }
    else {
        Write-Host "  Port $PORT is free." -ForegroundColor Green
    }
}

function Stop-Backend {
    Write-Host "Stopping backend on port $PORT..."
    Clear-Port
    Write-Host "Backend stopped."
}

function Test-Environment {
    param([switch]$Deep)

    Write-Host "Checking environment health..."
    
    if (!(Test-Path ".\venv")) {
        Write-Host "Warning: No virtual environment found! Please run '.\start.ps1 repair' to set it up." -ForegroundColor Yellow
        return $false
    }

    try {
        $pyVersion = & ".\venv\Scripts\python.exe" -c "import sys; print(f'{sys.version_info.major}{sys.version_info.minor}')"
    }
    catch {
        Write-Host "Error: Failed to run python from venv." -ForegroundColor Red
        return $false
    }
    
    if ($Deep) {
        $expectedSuffix = "cp$pyVersion"
        $pydFiles = Get-ChildItem -Path ".\venv\Lib\site-packages" -Filter "*.pyd" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 20
        $mismatched = $pydFiles | Where-Object { $_.Name -match "cp\d+" -and $_.Name -notmatch $expectedSuffix }

        if ($mismatched) {
            $foundVersion = ($mismatched[0].Name -replace ".*cp(\d+).*", '$1')
            Write-Host "CRITICAL: Detected Python version mismatch in venv components!" -ForegroundColor Red
            Write-Host "Environment packages are for CP$foundVersion but you are running CP$pyVersion." -ForegroundColor Red
            Write-Host "ACTION REQUIRED: Run '.\start.ps1 repair' to fix your environment." -ForegroundColor Yellow
            return $false
        }
    }

    Write-Host "Environment health check passed." -ForegroundColor Green
    return $true
}

function Repair-Environment {
    Write-Host "Starting environment repair... This may take several minutes." -ForegroundColor Cyan
    Stop-Backend

    if (!(Test-Path ".\requirements_core.txt")) {
        Write-Host "Generating core requirements file..."
        if (Test-Path ".\requirements.txt") {
            Get-Content requirements.txt | Where-Object { $_ -notmatch 'chromadb' } | Set-Content requirements_core.txt
        }
        else {
            Write-Host "Error: requirements.txt not found. Cannot proceed." -ForegroundColor Red
            return
        }
    }

    Write-Host "Cleaning up corrupted and mismatched packages..."
    Remove-Item -Path ".\venv\Lib\site-packages\~*" -Recurse -Force -ErrorAction SilentlyContinue
    
    $pyVersion = & ".\venv\Scripts\python.exe" -c "import sys; print(f'{sys.version_info.major}{sys.version_info.minor}')"
    $expectedSuffix = "cp$pyVersion"
    $mismatchedPyds = Get-ChildItem -Path ".\venv\Lib\site-packages" -Filter "*.pyd" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "cp\d+" -and $_.Name -notmatch $expectedSuffix }
    
    if ($mismatchedPyds) {
        Write-Host "Removing $($mismatchedPyds.Count) mismatched compiled extensions..." -ForegroundColor Yellow
        $mismatchedPyds | Remove-Item -Force -ErrorAction SilentlyContinue
    }
    
    Write-Host "Force-reinstalling dependencies for the current Python version..."
    & ".\venv\Scripts\python.exe" -m pip install --force-reinstall -r requirements_core.txt

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Repair complete! Your environment is now healthy." -ForegroundColor Green
    }
    else {
        Write-Host "Repair failed. Please check the logs above." -ForegroundColor Red
    }
}

function Start-Backend {
    if (!(Test-Environment)) { exit 1 }

    # Kill any orphaned processes — TIME_WAIT zombies will be bypassed by
    # SO_REUSEADDR in run_server.py, so we don't abort if the port "looks" busy.
    Clear-Port

    # Guard: backend must only be started via this script.
    $env:BACKEND_START_MODE = "script"

    if (Test-Path ".\venv\Scripts\Activate.ps1") {
        & ".\venv\Scripts\Activate.ps1"
    }

    Write-Host "Starting backend on port $PORT..." -ForegroundColor Green

    # Set UTF-8 encoding so emoji/Unicode in log lines don't crash the process on Windows
    $env:PYTHONIOENCODING = "utf-8"

    Write-Host "Server running on http://127.0.0.1:$PORT"
    # Run python directly so all logs and traceback output are displayed in the console
    & ".\venv\Scripts\python.exe" run_server.py
}

function Restart-Backend {
    Stop-Backend
    Start-Sleep -Seconds 1
    Start-Backend
}

$action = if ($args.Count -gt 0) { $args[0] } else { "start" }

switch ($action) {
    "start" { Start-Backend }
    "stop" { Stop-Backend }
    "restart" { Restart-Backend }
    "repair" { Repair-Environment }
    "check" { Test-Environment -Deep }
    default { Write-Host "Usage: .\start.ps1 [start|stop|restart|repair|check]" }
}
