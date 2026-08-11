@echo off
title XM360 Order Scheduler Backend Setup
echo.
echo ========================================================
echo   XM360 Order Scheduler Backend Setup Launcher
echo ========================================================
echo.

:: Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% == 0 (
    echo [INFO] Running with Administrator privileges.
) else (
    echo [NOTICE] Running with standard privileges.
    echo          If you wish to configure Firewall rules automatically,
    echo          right-click setup.bat and select "Run as administrator".
    echo.
)

echo Starting automated setup via PowerShell...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

if %errorLevel% neq 0 (
    echo.
    echo [ERROR] Setup encountered an error. Please check the messages above.
)

echo.
pause
