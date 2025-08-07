@echo off
echo ========================================
echo   Complete Build Process for Void
echo ========================================
echo.

cd /d C:\dsCodeAssistant

echo [1/4] Installing dependencies...
call npm install

echo.
echo [2/4] Building React components...
call npm run buildreact

echo.
echo [3/4] Compiling main project...
call npm run compile

echo.
echo [4/4] Build complete!
echo ========================================
echo   Run: .\scripts\code.bat to start Void
echo ========================================
pause