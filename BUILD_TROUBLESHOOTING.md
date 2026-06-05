# Build Troubleshooting Guide

This guide covers common build issues and their solutions when developing Void.

## Table of Contents

1. [Installation Issues](#installation-issues)
2. [Build Issues](#build-issues)
3. [React Build Issues](#react-build-issues)
4. [Runtime Issues](#runtime-issues)
5. [Process Management](#process-management)

---

## Installation Issues

### npm install fails or postinstall doesn't run

**Symptoms:**
- Build fails with "Cannot find module" errors
- Missing dependencies in subdirectories
- Errors about missing native modules

**What happens during npm install:**
The `npm install` command automatically runs `npm run postinstall`, which:
1. Installs dependencies in multiple subdirectories:
   - `build/` - Build tools and scripts
   - `extensions/*/` - All extension directories
   - `remote/` - Remote development dependencies
   - `test/*/` - Test framework dependencies
2. Configures git settings (`pull.rebase merges`, blame ignore file)
3. Removes prebuilt Parcel watcher modules to ensure proper compilation

**Solution:**
```bash
# Manually run postinstall if it didn't complete
npm run postinstall

# If that fails, check for permission issues or interrupted installations
# and try a clean reinstall:
rm -rf node_modules
npm install
```

**Common causes:**
- Network interruption during installation
- Insufficient disk space
- Permission issues in subdirectories
- Antivirus software blocking file operations

---

### Node version mismatch

**Symptoms:**
- Native module compilation errors
- Unexpected build failures
- "Unsupported engine" warnings

**Solution:**
```bash
# Check your Node version
node --version

# Should be 20.18.2 (see .nvmrc)
# Use nvm to switch to the correct version:
nvm install
nvm use
```

---

### Native module compilation fails

**Symptoms:**
- Errors mentioning `node-gyp`, `python`, or C++ compiler
- Build fails during installation phase

**Solution by platform:**

**Mac:**
```bash
# Install XCode Command Line Tools
xcode-select --install
```

**Windows:**
- Install [Visual Studio 2022](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community)
- Select "Desktop development with C++" workload
- Select these individual components:
  - `MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)`
  - `C++ ATL for latest build tools with Spectre Mitigations`
  - `C++ MFC for latest build tools with Spectre Mitigations`

**Linux (Debian/Ubuntu):**
```bash
sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3
```

---

## Build Issues

### Developer Mode build fails to start

**Symptoms:**
- Pressing Ctrl+Shift+B (Cmd+Shift+B) does nothing
- Build task not found error

**Solution:**
```bash
# Run watch mode from terminal instead
npm run watch

# Wait for build to complete - you'll see output like:
# [watch-extensions] Finished compilation extensions with 0 errors
# [watch-client    ] Finished compilation with 0 errors
```

---

### Build completes but changes aren't reflected

**Symptoms:**
- Code changes don't appear in Developer Mode window
- Old behavior persists after edits

**Solution:**
1. Reload the Developer Mode window:
   - Press `Ctrl+R` (Windows/Linux) or `Cmd+R` (Mac)
   - Or: `Ctrl+Shift+P` → "Reload Window"

2. If that doesn't work, check that watch mode is running:
   - Look for the terminal running `npm run watch`
   - Verify it's not showing errors
   - Check that it recompiled after your changes

3. For React changes specifically:
   ```bash
   # React must be built separately
   npm run buildreact

   # Or run in watch mode for continuous builds
   npm run watchreact
   ```

---

### Module resolution errors during build

**Symptoms:**
- "Cannot find module" errors during compilation
- TypeScript errors about missing types

**Solution:**
```bash
# 1. Verify postinstall completed
npm run postinstall

# 2. Clean build artifacts and rebuild
rm -rf out/
npm run watch

# 3. For React-specific module errors
cd src/vs/workbench/contrib/void/browser/react/
rm -rf out/
npm run buildreact
cd ../../../../../../../
```

---

## React Build Issues

### React build fails with "Failed to fetch dynamically imported module"

**Symptoms:**
- Error when loading Void sidebar or React components
- Console shows module fetch errors

**Root cause:**
React imports from outside the `react/src/` directory must end with `.js` extension.

**Solution:**
```typescript
// ❌ Wrong - will fail at runtime
import { URI } from '../../../../../../../base/common/uri'

// ✅ Correct - include .js extension
import { URI } from '../../../../../../../base/common/uri.js'
```

Check all imports in your React code and add `.js` to external imports.

---

### React build runs out of memory

**Symptoms:**
- Build process crashes
- "JavaScript heap out of memory" error
- Build freezes or becomes extremely slow

**Solution:**
```bash
# Increase Node memory limit
NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact

# For watch mode
NODE_OPTIONS="--max-old-space-size=8192" npm run watchreact
```

---

### Missing styles in React components

**Symptoms:**
- Components render but have no styling
- Tailwind classes don't apply

**Solution:**
1. Wait a few seconds - styles may be loading
2. Reload the window: `Ctrl+R` (Windows/Linux) or `Cmd+R` (Mac)
3. Rebuild React components:
   ```bash
   npm run buildreact
   ```
4. Check that Tailwind build completed without errors

---

## Runtime Issues

### Developer Mode window won't launch

**Symptoms:**
- `./scripts/code.sh` or `./scripts/code.bat` fails
- Window opens but immediately crashes

**Solution:**

**Check sandbox permissions (Linux):**
```bash
# SUID sandbox error
sudo chown root:root .build/electron/chrome-sandbox
sudo chmod 4755 .build/electron/chrome-sandbox
./scripts/code.sh
```

**Use isolated user data directory:**
```bash
# Prevents conflicts with your main Void/VSCode installation
./scripts/code.sh --user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions

# To reset settings, delete the temp directory:
rm -rf .tmp/
```

**Check build completion:**
Make sure the watch build finished before launching. Look for:
```
[watch-extensions] Finished compilation extensions with 0 errors
[watch-client    ] Finished compilation with 0 errors
```

---

### Path contains spaces error

**Symptoms:**
- Build fails with path-related errors
- Native modules fail to compile
- Mysterious file not found errors

**Solution:**
Move your Void repository to a path without spaces:
```bash
# ❌ Bad
/Users/john/My Projects/void/

# ✅ Good
/Users/john/projects/void/
```

---

## Process Management

### Background processes still running after stopping build

**Symptoms:**
- Port conflicts when trying to rebuild
- Multiple watch processes consuming resources
- Changes building multiple times

**Solution:**

**Stop with Ctrl+D (recommended):**
```bash
# In the terminal running the build, press:
Ctrl+D  # Cleanly stops the process
```

**Never use Ctrl+C:**
```bash
Ctrl+C  # ❌ This closes terminal but leaves processes running!
```

**Kill daemon processes:**
```bash
# If using background watch modes
npm run kill-watchd        # Kill all background watches
npm run kill-watch-clientd # Kill only client watch
npm run kill-watch-extensionsd # Kill only extensions watch
```

**Find and kill orphaned processes:**
```bash
# Find Node processes
ps aux | grep node

# Kill specific process by PID
kill <PID>

# Nuclear option - kill all Node processes (careful!)
killall node
```

---

### Build watch mode becomes unresponsive

**Symptoms:**
- Changes no longer trigger rebuilds
- Terminal shows no activity
- High CPU usage but no progress

**Solution:**
```bash
# 1. Stop current watch (Ctrl+D)
# 2. Restart watch
npm run watch

# Or use daemon restart
npm run restart-watchd
```

---

## Advanced Troubleshooting

### Clean everything and start fresh

When all else fails:

```bash
# 1. Stop all running processes
npm run kill-watchd

# 2. Clean all build artifacts
rm -rf out/
rm -rf .build/
rm -rf node_modules/

# 3. Clean React build
rm -rf src/vs/workbench/contrib/void/browser/react/out/

# 4. Reinstall dependencies
npm install

# 5. Verify postinstall completed
npm run postinstall

# 6. Build React
npm run buildreact

# 7. Start watch mode
npm run watch

# 8. In another terminal, launch Void
./scripts/code.sh --user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions
```

---

### Still having issues?

1. Check the [HOW_TO_CONTRIBUTE.md](HOW_TO_CONTRIBUTE.md) for prerequisite setup
2. Verify your system meets all requirements in [CLAUDE.md](CLAUDE.md)
3. Search existing [GitHub Issues](https://github.com/voideditor/void/issues)
4. Create a new issue with:
   - Your operating system and version
   - Node version (`node --version`)
   - Full error message and stack trace
   - Steps to reproduce

---

## Quick Reference

### Essential Commands
```bash
npm install                # Install dependencies (runs postinstall automatically)
npm run postinstall        # Manually run postinstall script
npm run watch              # Start watch mode (client + extensions)
npm run buildreact         # Build React components once
npm run watchreact         # Watch React components for changes
./scripts/code.sh          # Launch Developer Mode window (Mac/Linux)
./scripts/code.bat         # Launch Developer Mode window (Windows)
```

### Common Workflows

**First time setup:**
```bash
git clone https://github.com/voideditor/void
cd void
npm install
npm run buildreact
npm run watch  # In one terminal
./scripts/code.sh --user-data-dir ./.tmp/user-data  # In another terminal
```

**Daily development:**
```bash
npm run watchd       # Start background watch
npm run watchreactd  # Start background React watch
./scripts/code.sh --user-data-dir ./.tmp/user-data
# Make changes, reload window with Ctrl+R
```

**Before submitting PR:**
```bash
npm run eslint       # Check for linting errors
npm run hygiene      # Check code style
npm run test-node    # Run Node tests
```
