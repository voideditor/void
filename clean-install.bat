@echo off
echo ========================================
echo   Clean Install - Removing all modules
echo ========================================
echo.

cd /d C:\dsCodeAssistant

echo Removing node_modules...
rmdir /s /q node_modules 2>nul
rmdir /s /q build\node_modules 2>nul

echo Cleaning npm cache...
call npm cache clean --force

echo Installing fresh dependencies...
call npm install

echo.
echo ========================================
echo   Installation Complete!
echo   Now run: npm run compile
echo ========================================
pause