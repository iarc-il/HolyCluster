@echo off
echo Starting HolyCluster...

echo Starting Docker services...
cd /d D:\holyclusterD\HolyCluster\backend
docker compose up -d postgres valkey collector api

echo Starting CAT server...
start "" "C:\Program Files (x86)\HolyCluster\HolyCluster.exe"

echo Starting frontend...
cd /d D:\holyclusterD\HolyCluster\ui
start "" cmd /k "npm run dev"

echo Waiting for frontend to start...
timeout /t 8 /nobreak >nul

echo Opening browser...
start "" http://localhost:5173

echo Done! HolyCluster is running.
