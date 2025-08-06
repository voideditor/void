@echo off
echo Starting Docker development environment...

docker run -it --rm ^
  --name vscode-dev ^
  -v "%CD%:/workspace" ^
  -w /workspace ^
  -p 5901:5901 ^
  -p 6080:6080 ^
  mcr.microsoft.com/devcontainers/typescript-node:20-bookworm ^
  bash -c "npm install && npm run compile && bash"

echo Container stopped.
pause