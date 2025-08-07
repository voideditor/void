@echo off
setlocal

title VSCode Dev

pushd %~dp0\..

:: Get electron, compile, built-in extensions
if "%VSCODE_SKIP_PRELAUNCH%"=="" node build/lib/preLaunch.js

:: Check if OKDS-AI-Assistant.exe exists, otherwise use Void.exe
if exist ".build\electron\OKDS-AI-Assistant.exe" (
	set CODE=.build\electron\OKDS-AI-Assistant.exe
) else (
	set CODE=.build\electron\Void.exe
)

:: Manage built-in extensions
if "%~1"=="--builtin" goto builtin

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

set DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
for %%A in (%*) do (
	if "%%~A"=="--extensionTestsPath" (
		set DISABLE_TEST_EXTENSION=""
	)
)

:: Launch Code

"%CODE%" . %DISABLE_TEST_EXTENSION% %*
goto end

:builtin
"%CODE%" build/builtin

:end

popd

endlocal
