@echo off
echo ========================================
echo   Fixing Build Dependencies
echo ========================================
echo.

cd /d C:\dsCodeAssistant\build

echo [1/3] Cleaning build folder...
if exist package-lock.json del /f package-lock.json
if exist node_modules rmdir /s /q node_modules

echo.
echo [2/3] Installing build dependencies...
call npm install

echo.
echo [3/3] Verifying installation...
call npm list --depth=0

cd ..
echo.
echo ========================================
echo   Build dependencies fixed!
echo   Now run: npm run compile
echo ========================================
pause