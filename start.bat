@echo off
echo Starting HolyCluster...

echo Copying frontend build to Docker volume...
for /f %%i in ('wsl wslpath "%~dp0ui/dist"') do set WSL_DIST_PATH=%%i
wsl bash -c "mkdir -p /tmp/ui && cp -r %WSL_DIST_PATH%/. /tmp/ui/"

echo Starting Docker services...
cd /d "%~dp0backend"
docker compose up -d postgres valkey collector api

echo Starting CAT server...
start "" "C:\Program Files (x86)\HolyCluster\HolyCluster.exe"

echo Starting frontend...
cd /d "%~dp0ui"
start "" cmd /k "npm run dev"

echo Waiting for frontend to start...
timeout /t 4 /nobreak >nul

echo Opening browser...
start "" http://localhost:5173

echo Done! HolyCluster is running.
