# Building Void

This guide covers the two ways to build and run Void from source:

- **Live-edit mode** - runs Void from the repo with a watch build, so you can edit the code and reload to see your changes. Use this while developing.
- **Build** - produces a local executable (desktop app or REH server package) that runs on its own.

If you want a guide to the codebase instead, see [VOID_CODEBASE_GUIDE](./VOID_CODEBASE_GUIDE.md).

## Prerequisites

### Mac

If you're using a Mac, you need Python and XCode. You probably have these by default.

### Windows

If you're using a Windows computer, first get [Visual Studio 2022](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community) (recommended) or [VS Build Tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools) (not recommended). If you already have both, you might need to run the next few steps on both of them.

Go to the "Workloads" tab and select:
- `Desktop development with C++`
- `Node.js build tools`

Go to the "Individual Components" tab and select:
- `MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)`
- `C++ ATL for latest build tools with Spectre Mitigations`
- `C++ MFC for latest build tools with Spectre Mitigations`

Finally, click Install.

### Linux

First, run `npm install -g node-gyp`. Then:

- Debian (Ubuntu, etc): `sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3`.

- Red Hat (Fedora, etc): `sudo dnf install @development-tools gcc gcc-c++ make libsecret-devel krb5-devel libX11-devel libxkbfile-devel`.

- SUSE (openSUSE, etc): `sudo zypper install patterns-devel-C-C++-devel_C_C++  krb5-devel libsecret-devel libxkbfile-devel libX11-devel`.

### Node version && Node install

Make sure you have Node version `22.23.2` (the version in `.nvmrc`).

wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
source /home/user/.bashrc
nvm install 22.23.2
nvm use 22.23.2

## Compile and tests

1. `git clone https://github.com/Vai3soh/void` (or your fork) to clone the repo.
2. `npm install` to install all dependencies.
3. `NODE_OPTIONS='--max-old-space-size=8192' npm run buildreact && npm run compile`
4. `npm run -s test-browser-void-quick`

## Live-Edit Mode

Use this mode while changing Void's code - it runs Void from the repo, rebuilds on save, and you reload the window to pick up changes.

1. Start the watch build (it's done when 2 of the 3 spinners turn to check marks):
   - From inside Void or VSCode: press <kbd>Ctrl+Shift+B</kbd> (<kbd>Cmd+Shift+B</kbd> on Mac).
   - From the terminal: run `npm run watch`. The build is done when you see something like this:

   ```
   [watch-extensions] [00:37:39] Finished compilation extensions with 0 errors after 19303 ms
   [watch-client    ] [00:38:06] Finished compilation with 0 errors after 46248 ms
   [watch-client    ] [00:38:07] Starting compilation...
   [watch-client    ] [00:38:07] Finished compilation with 0 errors after 5 ms
   ```

2. Open the Void Developer Mode window:
   - Windows: `./scripts/code.bat`.
   - Mac: `./scripts/code.sh`.
   - Linux: `./scripts/code.sh`.

3. You're good to start editing Void's code!
   - You won't see your changes unless you press <kbd>Ctrl+R</kbd> (<kbd>Cmd+R</kbd>) inside the new window to reload. Alternatively, press <kbd>Ctrl+Shift+P</kbd> and `Reload Window`.
   - You might want to add the flags `--user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions` to the command in step 2, which lets you reset any IDE changes you made by deleting the `.tmp` folder.
   - You can kill any of the build scripts by pressing `Ctrl+D` in its terminal. If you press `Ctrl+C` the script will close but will keep running in the background.

If you get any errors, see [Common Fixes](#common-fixes) below.

## Building a Local Executable

If you want a standalone executable of Void, follow these steps. For day-to-day development use [Live-Edit Mode](#live-edit-mode) instead, and for complete distributables see [Distributing](#distributing) below.

Make sure you've already started the watch build (see [Live-Edit Mode](#live-edit-mode)) first, then run one of the following commands. This will create a folder named `VSCode-darwin-arm64` or similar outside of the void/ repo (see below).

You can optionally tune the local executable build with these environment variables:

- `VSCODE_MANGLE_MAX_WORKERS` (default: `4`) controls how many parallel mangler workers are used during build. Lower it on low-memory machines.
- `VSCODE_TSC_IGNORE_UNUSED` (set to any non-empty value, for example `1`) disables `noUnusedLocals` and `noUnusedParameters` checks for faster local builds.

Example:

- `VSCODE_MANGLE_MAX_WORKERS=2 VSCODE_TSC_IGNORE_UNUSED=1 npm run gulp vscode-linux-x64`

### Mac

- `npm run gulp vscode-darwin-arm64` - most common (Apple Silicon)
- `npm run gulp vscode-darwin-x64` (Intel)

### Windows

- `npm run gulp vscode-win32-x64` - most common
- `npm run gulp vscode-win32-arm64`

### Linux

- `npm run gulp vscode-linux-x64` - most common
- `npm run gulp vscode-linux-arm64`

### Linux: `vscode-reh-linux-x64` Component

`vscode-reh-linux-x64` builds the server-side REH package (Remote Extension Host), not the full desktop app UI.

- Use it when you only need the server component (for remote/SSH-style setups).
- Output folder: `../vscode-reh-linux-x64/`
- Main server launcher inside that folder: `bin/void-server`
- Useful variant for faster packaging in CI flows:

`VSCODE_MANGLE_MAX_WORKERS=8 VSCODE_TSC_IGNORE_UNUSED=1 npm run gulp vscode-reh-linux-x64 --max-old-space-size=48000`

### Local Executable Output

The local executable will be located in a folder outside of `void/`:
```bash
workspace/
├── void/   # Your Void fork
└── VSCode-darwin-arm64/ # Generated output
```

## Common Fixes

- Make sure you followed the prerequisite steps above.
- Make sure you have Node version `22.23.2` (the version in `.nvmrc`).
- Make sure the path to your Void folder does not have any spaces in it.
- If you get `"TypeError: Failed to fetch dynamically imported module"`, make sure all imports end with `.js`.
- If you get an error with React, try running `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`.
- If you see missing styles, wait a few seconds and then reload.
- If you get errors like `npm error libtool:   error: unrecognised option: '-static'`,  when running ./scripts/code.sh, make sure you have GNU libtool instead of BSD libtool (BSD is the default in macos)
- If you get errors like `The SUID sandbox helper binary was found, but is not configured correctly` when running ./scripts/code.sh, run `sudo chown root:root .build/electron/chrome-sandbox && sudo chmod 4755 .build/electron/chrome-sandbox` and then run `./scripts/code.sh` again.
- If the built-in ACP agent cannot start because the default port is already in use, launch Void with an alternate loopback address, for example `./scripts/code.sh --acp-agent-addr=127.0.0.1:8720`. The first version only accepts loopback hosts such as `127.0.0.1`, `localhost`, or `::1`, and it does not auto-select a free port. The `acpAgentUrl` settings still configure external ACP `websocket` mode; they do not configure built-in ACP mode.

