@echo off
echo ============================================================
echo   Takaro Inventory Tracker - Restarting Server
echo ============================================================
echo.

cd /d %~dp0

echo Stopping all Node.js processes...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel%==0 (
    echo   - Killed node.exe processes
) else (
    echo   - No node.exe processes running
)

echo Stopping any Takaro Inventory processes...
tasklist | find /i "Takaro Inventory" >nul
if %errorlevel%==0 (
    for /f "tokens=2" %%i in ('tasklist ^| find /i "Takaro Inventory"') do taskkill /F /PID %%i >nul 2>&1
    echo   - Killed Takaro Inventory processes
)

echo.
echo Waiting for processes to fully terminate...
timeout /t 3 /nobreak >nul

echo.
echo Starting server on port 5555...
start "Takaro Inventory Tracker" node server.js

echo.
echo Waiting for server to initialize...
timeout /t 4 /nobreak >nul

echo.
echo Checking server status...
tasklist | find /i "node.exe" >nul
if %errorlevel%==0 (
    echo.
    echo [SUCCESS] Server restarted successfully!
    echo [URL] http://SERVER:5555
    echo [Login] http://SERVER:5555/login
    echo.
    echo The server console window is running in the background.
    echo Check SOLUTION.txt for details on the fix.
) else (
    echo.
    echo [ERROR] Server failed to start!
    echo.
    echo Troubleshooting:
    echo 1. Check if port 5555 is already in use
    echo 2. Verify Node.js is installed: node --version
    echo 3. Check for errors in the console window
)

echo.
pause
