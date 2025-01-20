# Do not run this unless you know what you're doing.

set -e


npm run gulp vscode-darwin-arm64-min
./mac-sign.sh sign arm64
./mac-sign.sh notarize arm64
./mac-sign.sh updater arm64
./mac-sign.sh computehash arm64

npm run gulp vscode-darwin-x64-min
./mac-sign.sh sign x64
./mac-sign.sh notarize x64
./mac-sign.sh updater x64
./mac-sign.sh computehash x64
