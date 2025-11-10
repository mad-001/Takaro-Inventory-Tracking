@echo off
echo Stopping Takaro Inventory Tracker Server...
echo.

REM Use PowerShell to find and kill process on port 5555
powershell -Command "Get-NetTCPConnection -LocalPort 5555 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"

REM Also kill any remaining node.exe processes
taskkill /F /IM node.exe >nul 2>&1

echo.
echo Server stopped
echo.
echo You can now run start-server.bat
echo.
pause
