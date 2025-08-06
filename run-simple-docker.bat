@echo off
echo 가장 간단한 Docker 실행 방법
echo ==============================
echo.

cd /d C:\dsCodeAssistant

echo Node.js 20 공식 이미지로 직접 실행...
docker run -it --rm ^
    -v "%CD%:/app" ^
    -w /app ^
    -p 3000:3000 ^
    -p 9229:9229 ^
    --name void-simple ^
    node:20-bookworm ^
    bash -c "apt-get update && apt-get install -y build-essential python3 make g++ && npm install && npm run watch"

pause