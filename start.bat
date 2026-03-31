@echo off
echo Starting HolyCluster...

echo Copying frontend build...
if not exist "C:\tmp\ui" mkdir "C:\tmp\ui"
xcopy /E /Y /Q "%~dp0ui\dist\*" "C:\tmp\ui\"

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
