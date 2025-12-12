@echo off
echo ============================================================
echo   Takaro Inventory Tracker - Starting Server
echo ============================================================
echo.

cd /d %~dp0

:: Kill any existing node processes first
echo Checking for existing Node.js processes...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel%==0 (
    echo   - Killed existing node.exe processes
    timeout /t 2 /nobreak >nul
) else (
    echo   - No existing processes found
)

:: Clear old logs
if exist output.log del output.log
if exist error.log del error.log

echo.
echo Starting server on port 5555...
start "Takaro Inventory Tracker" node server.js

:: Wait for server to start
timeout /t 3 /nobreak >nul

:: Check if it started
echo.
echo Checking server status...
tasklist | find /i "node.exe" >nul
if %errorlevel%==0 (
    echo.
    echo [SUCCESS] Server started!
    echo [URL] http://SERVER:5555
    echo [Login] http://SERVER:5555/login
    echo.
    echo The server is running in a background window.
    echo See SOLUTION.txt for inventory tracking fix details.
) else (
    echo.
    echo [ERROR] Server failed to start!
    echo Check the console window for errors.
)

echo.
pause
