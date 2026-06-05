#!/usr/bin/env bash

# This script provides an easy way to run and build Hypno for various platforms.
# It wraps the inner core npm/gulp scripts.

set -e

# Change to the root of the repo
cd "$(dirname "$0")/.."

echo "=========================================="
echo "          HYPNO DEVELOPER CLI             "
echo "=========================================="
echo ""
echo "Please select an action:"
echo "  1) Run locally (Development Mode)"
echo "  2) Build for macOS (ARM64)"
echo "  3) Build for macOS (x64)"
echo "  4) Build for Windows (x64)"
echo "  5) Build for Linux (x64)"
echo "  q) Quit"
echo ""

read -p "Enter choice [1-5, or q]: " choice

case $choice in
  1)
    echo "Starting local development mode..."
    echo "Tip: Make sure you have another terminal open running 'npm run watch'"
    ./scripts/code.sh
    ;;
  2)
    echo "Building for macOS ARM64 (Apple Silicon)..."
    npm run gulp vscode-darwin-arm64-min
    echo "Build complete. Check the parent directory (e.g., ../VSCode-darwin-arm64)."
    ;;
  3)
    echo "Building for macOS x64 (Intel)..."
    npm run gulp vscode-darwin-x64-min
    echo "Build complete. Check the parent directory (e.g., ../VSCode-darwin-x64)."
    ;;
  4)
    echo "Building for Windows x64..."
    npm run gulp vscode-win32-x64-min
    echo "Build complete. Check the parent directory (e.g., ../VSCode-win32-x64)."
    ;;
  5)
    echo "Building for Linux x64..."
    npm run gulp vscode-linux-x64-min
    echo "Build complete. Check the parent directory (e.g., ../VSCode-linux-x64)."
    ;;
  q|Q)
    echo "Exiting."
    exit 0
    ;;
  *)
    echo "Invalid choice. Exiting."
    exit 1
    ;;
esac
