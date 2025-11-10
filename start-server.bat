@echo off
echo Stopping any existing server...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Takaro Inventory Tracker...
cd /d C:\GameServers\Takaro-Inventory-Tracking
start /B cmd /c "node server.js > server.log 2>&1"

echo Waiting for server to start...
timeout /t 3 /nobreak >nul

echo Checking if server is listening on port 5555...
netstat -an | findstr ":5555" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo SUCCESS: Server is running on port 5555
    echo Access at: http://192.168.1.27:5555
    echo ============================================
) else (
    echo.
    echo ============================================
    echo ERROR: Server is NOT listening on port 5555
    echo Check server.log for errors
    echo ============================================
    type server.log
)

echo.
pause
