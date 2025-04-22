# Contributing to Void
### Welcome! 👋
This is the official guide on how to contribute to Void. We want to make it as easy as possible to contribute, so if you have any questions or comments, reach out via email or discord!

There are a few ways to contribute:

- 💫 Complete items on the [Roadmap](https://github.com/orgs/voideditor/projects/2).
- 💡 Make suggestions in our [Discord](https://discord.gg/RSNjgaugJs).
- 🪴 Start new Issues - see [Issues](https://github.com/voideditor/void/issues).



### Codebase Guide

We [highly recommend reading this](https://github.com/voideditor/void/blob/main/VOID_CODEBASE_GUIDE.md) guide that we put together on Void's sourcecode if you'd like to contribute!

The repo is not as intimidating as it first seems if you read the guide!

Most of Void's code lives in the folder `src/vs/workbench/contrib/void/`.




## Building Void

### a. Build Prerequisites - Mac

If you're using a Mac, you need Python and XCode. You probably have these by default.

### b. Build Prerequisites - Windows

If you're using a Windows computer, first get [Visual Studio 2022](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community) (recommended) or [VS Build Tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools) (not recommended). If you already have both, you might need to run the next few steps on both of them.

Go to the "Workloads" tab and select:
- `Desktop development with C++`
- `Node.js build tools`

Go to the "Individual Components" tab and select:
- `MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)`
- `C++ ATL for latest build tools with Spectre Mitigations`
- `C++ MFC for latest build tools with Spectre Mitigations`

Finally, click Install.

### c. Linux - Build Prerequisites

First, run `npm install -g node-gyp`. Then:

- Debian (Ubuntu, etc): `sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3`.
- Red Hat (Fedora, etc): `sudo dnf install @development-tools gcc gcc-c++ make libsecret-devel krb5-devel libX11-devel libxkbfile-devel`.
- Others: see [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute).

### d. Building Void from Visual Studio Code

To build Void, open `void/` inside VSCode. Then open your terminal and run:

1. `npm install` to install all dependencies.
2. `npm run watchreact` to build Void's browser dependencies like React. (If this doesn't work, try `npm run buildreact`). If you get an error, try running it with `NODE_OPTIONS="--max-old-space-size=8192`, for example `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`.
3. Build Void.
	 - Press <kbd>Cmd+Shift+B</kbd> (Mac).
   - Press <kbd>Ctrl+Shift+B</kbd> (Windows/Linux).
   - This step can take ~5 min. The build is done when you see two check marks (one of the items will continue spinning indefinitely - it compiles our React code).
4. Run Void.
   - Run `./scripts/code.sh` (Mac/Linux).
   - Run `./scripts/code.bat` (Windows).
6. Nice-to-knows.
   - You can always press <kbd>Ctrl+R</kbd> (<kbd>Cmd+R</kbd>) inside the new window to reload and see your new changes. It's faster than <kbd>Ctrl+Shift+P</kbd> and `Reload Window`.
   - You might want to add the flags `--user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions` to the above run command, which lets you delete the `.tmp` folder to reset any IDE changes you made when testing.
	- You can kill any of the build scripts by pressing `Ctrl+D` in VSCode terminal. If you press `Ctrl+C` the script will close but will keep running in the background (to open all background scripts, just re-build).

#### Building Void from Terminal

Alternatively, if you want to build Void from the terminal, you can follow these steps.
1. Clone this repo with `git clone https://github.com/voideditor/void/`.
2. Go inside the "void" folder with `cd void` and then run `npm install`. This will install all dependencies. It can take a few minutes.
3. Now run `npm run buildreact`). If you get an error, try running it with `NODE_OPTIONS="--max-old-space-size=8192`, for example `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`.
The build is done when you see something like this:

```
[watch-extensions] [00:37:39] Finished compilation extensions with 0 errors after 19303 ms
[watch-client    ] [00:38:06] Finished compilation with 0 errors after 46248 ms
[watch-client    ] [00:38:07] Starting compilation...
[watch-client    ] [00:38:07] Finished compilation with 0 errors after 5 ms
```

5. Now you can run void by simply typing the following commands (the first time you run, it can take several minutes to load):
   - Mac/Linux: Run `./scripts/code.sh` .
   - Windows: Run `./scripts/code.bat`.



#### Common Fixes

- Make sure you followed the prerequisite steps.
- Make sure you have Node version `20.18.2` (the version in `.nvmrc`)!
- If you get `"TypeError: Failed to fetch dynamically imported module"`, make sure all imports end with `.js`.
- If you see missing styles, wait a few seconds and then reload.
- If you have any questions, feel free to [submit an issue](https://github.com/voideditor/void/issues/new). You can also refer to VSCode's complete [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page.
- If you get errors like `npm error libtool:   error: unrecognised option: '-static'`, make sure you have GNU libtool instead of BSD libtool (BSD is the default in macos)


## Packaging

We don't usually recommend packaging. Instead, you should probably just build. If you're sure you want to package Void into an executable app, make sure you've built first, then run one of the following commands. This will create a folder named `VSCode-darwin-arm64` or similar outside of the void/ repo (see below). Be patient - packaging can take ~25 minutes.


### Mac
- `npm run gulp vscode-darwin-arm64` - most common (Apple Silicon)
- `npm run gulp vscode-darwin-x64` (Intel)

### Windows
- `npm run gulp vscode-win32-x64` - most common
- `npm run gulp vscode-win32-arm64`

### Linux
- `npm run gulp vscode-linux-x64` - most common
- `npm run gulp vscode-linux-arm64`


### Output

This will generate a folder outside of `void/`:
```bash
workspace/
├── void/   # Your Void fork
└── VSCode-darwin-arm64/ # Generated output
```

### Distributing
Void's maintainers distribute Void on our website and in releases. Our build pipeline is a fork of VSCodium, and it works by running GitHub Actions which create the downloadables. The build repo with more instructions lives [here](https://github.com/voideditor/void-builder).

## Pull Request Guidelines


- Please submit a pull request once you've made a change.
- No need to submit an Issue unless you're creating a new feature that might involve multiple PRs.
- Please don't use AI to write your PR 🙂





<!--
# Relevant files

We keep track of all the files we've changed with Void so it's easy to rebase:

Edit: far too many changes to track... this is old

- README.md
- CONTRIBUTING.md
- VOID_USEFUL_LINKS.md
- product.json
- package.json

- src/vs/workbench/api/common/{extHost.api.impl.ts | extHostApiCommands.ts}
- src/vs/workbench/workbench.common.main.ts
- src/vs/workbench/contrib/void/\*
- extensions/void/\*

- .github/\*
- .vscode/settings/\*
- .eslintrc.json
- build/hygiene.js
- build/lib/i18n.resources.json
- build/npm/dirs.js

- vscode.proposed.editorInsets.d.ts - not modified, but code copied

-->
