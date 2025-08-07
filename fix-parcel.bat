@echo off
echo ========================================
echo   Fixing @parcel/watcher issue
echo ========================================
echo.

cd /d C:\dsCodeAssistant

echo [1/3] Removing problematic modules...
rmdir /s /q extensions\node_modules\@parcel 2>nul
rmdir /s /q node_modules\@parcel 2>nul

echo.
echo [2/3] Reinstalling in extensions folder...
cd extensions
call npm install
cd ..

echo.
echo [3/3] Testing installation...
node -e "console.log('Node modules OK')"

echo.
echo ========================================
echo   Fix complete! Try running watch again
echo ========================================
pause