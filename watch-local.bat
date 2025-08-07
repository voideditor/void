@echo off
echo ========================================
echo   Windows Local Watch Mode
echo ========================================
echo.

cd /d C:\dsCodeAssistant

echo Starting watch mode...
echo Press Ctrl+C to stop
echo.

call npm run watch

pause