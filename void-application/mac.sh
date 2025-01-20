# Do not run this unless you know what you're doing.

set -e


npm run vscode-darwin-arm64-min
./mac-sign.sh sign arm64
./mac-sign.sh notarize arm64
./mac-sign.sh updater arm64

npm run vscode-darwin-x64-min
./mac-sign.sh sign x64
./mac-sign.sh notarize x64
./mac-sign.sh updater x64
