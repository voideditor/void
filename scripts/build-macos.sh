#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo "Building Void/Hypno for macOS (ARM64)..."
npm run gulp vscode-darwin-arm64-min

echo "Build complete."
echo "The built application can typically be found in the parent directory (e.g. '../VSCode-darwin-arm64')."
