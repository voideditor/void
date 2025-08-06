@echo off
echo Starting Void Editor in Docker...
echo.

REM Docker Compose로 컨테이너 시작
docker-compose up -d --build

echo.
echo Void Editor is starting...
echo.
echo Access points:
echo - VNC Web Client: http://localhost:6080
echo - VNC Direct: localhost:5901
echo.
echo To enter the container:
echo   docker exec -it void-editor bash
echo.
echo To run Void Editor inside container:
echo   docker exec -it void-editor bash -c "cd /workspaces/void && ./scripts/code.sh"
echo.
echo To stop:
echo   docker-compose down
echo.