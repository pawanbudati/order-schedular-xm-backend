# ==============================================================================
# XM360 Order Scheduler Backend - Automated Setup Script for Windows
# ==============================================================================

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   XM360 Order Scheduler Backend Setup Engine" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# Helper to refresh PATH in current environment
function Refresh-EnvPath {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ------------------------------------------------------------------------------
# 1. Administrator Rights Check
# ------------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "[OK] Running with Administrator privileges." -ForegroundColor Green
} else {
    Write-Host "[INFO] Running as standard user. (Firewall configuration requires Admin)" -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# 2. Check Node.js
# ------------------------------------------------------------------------------
$nodeCmd = Get-Command "node" -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVer = & node -v
    Write-Host "[OK] Node.js is installed: $nodeVer" -ForegroundColor Green
} else {
    Write-Host "[WAIT] Node.js not found in PATH. Attempting automatic installation..." -ForegroundColor Yellow
    $installedNode = $false
    
    $wingetCmd = Get-Command "winget" -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        try {
            winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
            $installedNode = $true
        } catch {
            Write-Host "[WARN] winget installation failed, falling back to direct download..." -ForegroundColor Yellow
        }
    }
    
    if (-not $installedNode) {
        $nodeMsi = "$env:TEMP\node-lts.msi"
        Write-Host "[WAIT] Downloading Node.js LTS installer to $nodeMsi..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -OutFile $nodeMsi
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /quiet /qn" -Wait
    }
    Refresh-EnvPath
}

# ------------------------------------------------------------------------------
# 3. Check Git
# ------------------------------------------------------------------------------
$gitCmd = Get-Command "git" -ErrorAction SilentlyContinue
if ($gitCmd) {
    $gitVer = & git --version
    Write-Host "[OK] Git is installed: $gitVer" -ForegroundColor Green
} else {
    Write-Host "[WAIT] Git not found. Attempting automatic installation..." -ForegroundColor Yellow
    $installedGit = $false
    
    $wingetCmd = Get-Command "winget" -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        try {
            winget install Git.Git --source winget --accept-package-agreements --accept-source-agreements
            $installedGit = $true
        } catch {
            Write-Host "[WARN] winget installation failed, falling back to direct download..." -ForegroundColor Yellow
        }
    }
    
    if (-not $installedGit) {
        $gitExe = "$env:TEMP\git-setup.exe"
        Write-Host "[WAIT] Downloading Git installer to $gitExe..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.2/Git-2.47.0.2-64-bit.exe" -OutFile $gitExe
        Start-Process $gitExe -ArgumentList "/VERYSILENT /NORESTART" -Wait
    }
    Refresh-EnvPath
}

# ------------------------------------------------------------------------------
# 4. Check Python & Install MT5 Bridge Dependencies
# ------------------------------------------------------------------------------
$pythonCmd = $null
$pyPath = (Get-Command "python" -ErrorAction SilentlyContinue).Source
if (-not $pyPath) {
    $pyPath = (Get-Command "py" -ErrorAction SilentlyContinue).Source
}

if ($pyPath) {
    $pythonCmd = $pyPath
    $env:PYTHON_EXECUTABLE = $pyPath
    $pyVer = & $pythonCmd --version 2>&1
    Write-Host "[OK] Python is installed ($pyVer) at $pyPath." -ForegroundColor Green
    
    $reqPath = Join-Path -Path $PSScriptRoot -ChildPath "mt5-local-bridge\requirements.txt"
    if (Test-Path -Path $reqPath) {
        Write-Host "[WAIT] Installing MT5 Local Bridge Python dependencies..." -ForegroundColor Yellow
        & $pythonCmd -m pip install --upgrade pip --quiet
        & $pythonCmd -m pip install -r $reqPath
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] MT5 Bridge Python dependencies installed successfully." -ForegroundColor Green
        } else {
            Write-Host "[WARN] Some Python dependencies failed to install." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "[WARN] Python was not detected in PATH." -ForegroundColor Yellow
    Write-Host "       (Note: Install Python 64-bit if using MetaTrader 5 local bridge)." -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# 5. Check & Install PM2 Process Manager
# ------------------------------------------------------------------------------
Refresh-EnvPath
$pm2Cmd = Get-Command "pm2" -ErrorAction SilentlyContinue
if ($pm2Cmd) {
    Write-Host "[OK] PM2 process manager is installed globally." -ForegroundColor Green
} else {
    Write-Host "[WAIT] Installing PM2 process manager globally via npm..." -ForegroundColor Yellow
    & npm install -g pm2
    Refresh-EnvPath
}

# Set PM2 Home Location
if ($isAdmin) {
    [Environment]::SetEnvironmentVariable("PM2_HOME", "C:\pm2", "Machine")
    $env:PM2_HOME = "C:\pm2"
} else {
    $env:PM2_HOME = "$env:LOCALAPPDATA\pm2"
}

# ------------------------------------------------------------------------------
# 6. Configure Environment File (.env)
# ------------------------------------------------------------------------------
$envFile = Join-Path -Path $PSScriptRoot -ChildPath ".env"
$envExample = Join-Path -Path $PSScriptRoot -ChildPath ".env.example"

if (-not (Test-Path -Path $envFile)) {
    if (Test-Path -Path $envExample) {
        Copy-Item -Path $envExample -Destination $envFile
        Write-Host "[OK] Created .env file from .env.example" -ForegroundColor Green
    } else {
        Set-Content -Path $envFile -Value "PORT=8444`nADMIN_PASSWORD=1234`nLOCAL_MT5_BRIDGE_URL=http://127.0.0.1:8555"
        Write-Host "[OK] Created default .env file." -ForegroundColor Green
    }
} else {
    Write-Host "[OK] .env file already exists." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 7. Install Node Dependencies & Build Project
# ------------------------------------------------------------------------------
Write-Host "[WAIT] Installing Node.js packages (npm install)..." -ForegroundColor Yellow
& npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js dependencies installed." -ForegroundColor Green

Write-Host "[WAIT] Building TypeScript project (npm run build)..." -ForegroundColor Yellow
& npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] TypeScript build failed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Project compiled successfully to /dist." -ForegroundColor Green

# ------------------------------------------------------------------------------
# 8. Configure Windows Defender Firewall Rules (Admin Only)
# ------------------------------------------------------------------------------
if ($isAdmin) {
    Write-Host "[WAIT] Configuring Windows Firewall rules for Ports 8444 and 8555..." -ForegroundColor Yellow
    try {
        New-NetFirewallRule -DisplayName "XM Scheduler Backend Port 8444" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8444 -ErrorAction SilentlyContinue | Out-Null
        New-NetFirewallRule -DisplayName "XM MT5 Local Bridge Port 8555" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8555 -ErrorAction SilentlyContinue | Out-Null
        Write-Host "[OK] Windows Firewall rules added." -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Firewall rules could not be set automatically." -ForegroundColor Yellow
    }
}

# ------------------------------------------------------------------------------
# 8.5 Auto-Launch Configured MT5 Instances from .env
# ------------------------------------------------------------------------------
Write-Host "[WAIT] Scanning .env file for configured MT5 terminal paths and custom names..." -ForegroundColor Yellow

$mt5TerminalsToLaunch = @() # objects with Path and Name
$envPathMap = @{}
$envNameMap = @{}

if (Test-Path -Path $envFile) {
    $envLines = Get-Content -Path $envFile
    foreach ($line in $envLines) {
        $line = $line.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim().Trim('"').Trim("'")

            if ($key -eq "MT5_PATH" -or $key -like "MT5_PATH_*") {
                if ($val) {
                    $envPathMap[$key] = $val
                }
            }
            elseif ($key -eq "MT5_NAME" -or $key -like "MT5_NAME_*") {
                if ($val) {
                    $envNameMap[$key] = $val
                }
            }
            elseif ($key -eq "MT5_TERMINAL_PATHS") {
                if ($val) {
                    $envPathMap["MT5_TERMINAL_PATHS"] = $val
                }
            }
            elseif ($key -eq "MT5_TERMINAL_NAMES") {
                if ($val) {
                    $envNameMap["MT5_TERMINAL_NAMES"] = $val
                }
            }
        }
    }

    # Process indexed MT5_PATH_N
    foreach ($k in $envPathMap.Keys) {
        if ($k -like "MT5_PATH_*") {
            $suffix = $k.Substring("MT5_PATH_".Length)
            $p = $envPathMap[$k]
            $nKey = "MT5_NAME_$suffix"
            $n = if ($envNameMap.ContainsKey($nKey)) { $envNameMap[$nKey] } else { "MT5 Instance $suffix" }
            if ($p) {
                $mt5TerminalsToLaunch += [PSCustomObject]@{ Path = $p; Name = $n }
            }
        }
    }

    # Process MT5_TERMINAL_PATHS
    if ($envPathMap.ContainsKey("MT5_TERMINAL_PATHS")) {
        $pList = $envPathMap["MT5_TERMINAL_PATHS"].Split(",")
        $nList = if ($envNameMap.ContainsKey("MT5_TERMINAL_NAMES")) { $envNameMap["MT5_TERMINAL_NAMES"].Split(",") } else { @() }
        for ($i = 0; $i -lt $pList.Count; $i++) {
            $p = $pList[$i].Trim().Trim('"').Trim("'")
            $n = if ($i -lt $nList.Count) { $nList[$i].Trim().Trim('"').Trim("'") } else { "MT5 Instance $($i+1)" }
            if ($p -and -not ($mt5TerminalsToLaunch | Where-Object { $_.Path -eq $p })) {
                $mt5TerminalsToLaunch += [PSCustomObject]@{ Path = $p; Name = $n }
            }
        }
    }

    # Process MT5_PATH
    if ($envPathMap.ContainsKey("MT5_PATH")) {
        $p = $envPathMap["MT5_PATH"]
        $n = if ($envNameMap.ContainsKey("MT5_NAME")) { $envNameMap["MT5_NAME"] } else { "MT5 Default" }
        if ($p -and -not ($mt5TerminalsToLaunch | Where-Object { $_.Path -eq $p })) {
            $mt5TerminalsToLaunch += [PSCustomObject]@{ Path = $p; Name = $n }
        }
    }
}

if ($mt5TerminalsToLaunch.Count -gt 0) {
    Write-Host "[INFO] Found $($mt5TerminalsToLaunch.Count) configured MT5 terminal instance(s) in .env:" -ForegroundColor Cyan
    
    # Get currently running process executable paths
    $runningExePaths = @()
    try {
        $runningProcesses = Get-Process -Name "terminal64", "terminal" -ErrorAction SilentlyContinue
        foreach ($proc in $runningProcesses) {
            try {
                if ($proc.Path) {
                    $runningExePaths += $proc.Path.ToLower()
                }
            } catch {}
        }
    } catch {}

    foreach ($item in $mt5TerminalsToLaunch) {
        $exePath = $item.Path
        $instName = $item.Name

        if (Test-Path -Path $exePath) {
            $normalizedPath = (Get-Item $exePath).FullName.ToLower()
            $isAlreadyRunning = $runningExePaths -contains $normalizedPath

            if ($isAlreadyRunning) {
                Write-Host "       [OK] '$instName' is already running: $exePath" -ForegroundColor Green
            } else {
                Write-Host "       [WAIT] Launching '$instName': $exePath..." -ForegroundColor Yellow
                try {
                    Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Path $exePath -Parent)
                    Write-Host "       [OK] '$instName' launched successfully." -ForegroundColor Green
                    Start-Sleep -Seconds 2
                } catch {
                    Write-Host "       [WARN] Failed to launch '$instName' at $exePath : $_" -ForegroundColor Yellow
                }
            }
        } else {
            Write-Host "       [WARN] Configured MT5 path for '$instName' does not exist on disk: $exePath" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "[INFO] No specific MT5 terminal paths configured in .env." -ForegroundColor Gray
}

# ------------------------------------------------------------------------------
# 9. Launch Services with PM2
# ------------------------------------------------------------------------------
Write-Host "[WAIT] Starting application processes using PM2..." -ForegroundColor Yellow

# Delete previous processes if running to ensure fresh start
& pm2 delete order-schedular-xm-backend 2>$null
& pm2 delete mt5-local-bridge 2>$null

# Start processes from pm2.config.js
& pm2 start pm2.config.js
& pm2 save

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "   SETUP COMPLETED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""

Write-Host "Process Status:" -ForegroundColor Cyan
& pm2 status

Write-Host ""
Write-Host "Health Check Endpoint:" -ForegroundColor Cyan
Write-Host "  http://localhost:8444/health" -ForegroundColor White

Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor Cyan
Write-Host "  - View Logs:    pm2 logs" -ForegroundColor White
Write-Host "  - Stop Server:  pm2 stop all" -ForegroundColor White
Write-Host "  - Restart:      pm2 restart all" -ForegroundColor White
Write-Host ""
