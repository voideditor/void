@echo off
echo Docker 수동 빌드 시작...
echo.

cd /d C:\dsCodeAssistant

REM 간단한 이미지 빌드 (buildx 없이)
echo 1. Docker 이미지 빌드 중...
docker build -t void-editor-dev -f .devcontainer\Dockerfile .devcontainer

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo 빌드 실패! 대체 방법 시도...
    echo.
    
    REM 더 간단한 Dockerfile로 시도
    echo FROM mcr.microsoft.com/devcontainers/typescript-node:20-bookworm > .devcontainer\Dockerfile.simple
    echo WORKDIR /workspace >> .devcontainer\Dockerfile.simple
    echo RUN npm install -g node-gyp >> .devcontainer\Dockerfile.simple
    
    docker build -t void-editor-simple -f .devcontainer\Dockerfile.simple .devcontainer
)

echo.
echo 2. 컨테이너 실행...
docker run -it --rm ^
    -v "%CD%:/workspace" ^
    -w /workspace ^
    -p 6080:6080 ^
    -p 5901:5901 ^
    --name void-dev ^
    void-editor-dev ^
    bash -c "npm install && npm run watch"

pause