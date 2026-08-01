@echo off
title Inventory Tracker
echo ============================================================
echo   Takaro Inventory Tracker - Starting Server
echo ============================================================
echo.

cd /d %~dp0

echo Starting server on port 5555...
echo [URL] http://SERVER:5555
echo [Login] http://SERVER:5555/login
echo.
node server.js
