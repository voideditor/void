# Contributing to Void

Welcome! 👋 This is the official guide on how to contribute to Void. We want to make it as easy as possible to contribute, so if you have any questions or comments, reach out via email or discord!

There are a few ways to contribute:

- Suggest New Features ([Discord](https://discord.gg/RSNjgaugJs))
- Build New Features ([Project](https://github.com/orgs/voideditor/projects/2/views/3))
- Submit Issues/Docs/Bugs ([Issues](https://github.com/voideditor/void/issues))


## Building the full IDE

Please follow the steps below to build the IDE. If you have any questions, feel free to [submit an issue](https://github.com/voideditor/void/issues/new) with any build errors, or refer to VSCode's full [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page.

Most of Void's code lives in `src/vs/workbench/contrib/void/browser/` and `src/vs/platform/void/`.

### a. Build Prerequisites - Mac

If you're using a Mac, make sure you have Python and XCode installed (you probably do by default).

### b. Build Prerequisites - Windows

If you're using a Windows computer, first get [Visual Studio 2022](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community) (recommended) or [VS Build Tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools) (not recommended). If you already have both, you might need to run the next few steps on both of them.

Go to the "Workloads" tab and select:
- `Desktop development with C++`
- `Node.js build tools`

Go to the "Individual Components" tab and select:
- `MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)`,
- `C++ ATL for latest build tools with Spectre Mitigations`,
- `C++ MFC for latest build tools with Spectre Mitigations`.

Finally, click Install.

### c. Build Prerequisites - Linux

First, make sure you've installed NodeJS and run `npm install -g node-gyp`. Then:
- Debian (Ubuntu, etc) - `sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3`.
- Red Hat (Fedora, etc) - `sudo dnf install @development-tools gcc gcc-c++ make libsecret-devel krb5-devel libX11-devel libxkbfile-devel`.
- Others - see [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute).

### Build instructions

To build Void, first follow the prerequisite steps above for your operating system and open `void/` inside VSCode. Then:

1. Install all dependencies.

```
npm install
```

2. Run `cd ./src/vs/workbench/contrib/void/browser/react/` and then `node ./build.js` to build Void's external dependencies (our React components, etc).

3. Press <kbd>Ctrl+Shift+B</kbd>, or if you prefer using the terminal run `npm run watch`.

This can take ~5 min.

If you ran <kbd>Ctrl+Shift+B</kbd>, the build is done when you see two check marks.

If you ran `npm run watch`, the build is done when you see something like this:

```
[watch-extensions] [00:37:39] Finished compilation extensions with 0 errors after 19303 ms
[watch-client    ] [00:38:06] Finished compilation with 0 errors after 46248 ms
[watch-client    ] [00:38:07] Starting compilation...
[watch-client    ] [00:38:07] Finished compilation with 0 errors after 5 ms
```

<!-- 3. Press <kbd>Ctrl+Shift+B</kbd> to start the build process. -->

4. In a new terminal, run `./scripts/code.sh` (Mac/Linux) or `./scripts/code.bat` (Windows). This should open up the built IDE.
You can always press <kbd>Ctrl+Shift+P</kbd> and run "Reload Window" inside the new window to see changes without re-building.

Now that you're set up, feel free to check out our [Issues](https://github.com/voideditor/void/issues) page.

### Common Fixes

- Make sure you have the same NodeJS version as `.nvmrc`.

- If you see `[ERROR] Cannot start service: Host version "0.23.1" does not match binary version "0.23.0"`, run `npm i -D esbuild@0.23.0` or do a clean install of your npm dependencies.


## Bundling

To bundle Void into an executable app, run one of the following commands:

### Mac
- `npm run gulp vscode-darwin-arm64` - most common (Apple Silicon)
- `npm run gulp vscode-darwin-x64` (Intel)

### Windows
- `npm run gulp vscode-win32-x64` - most common
- `npm run gulp vscode-win32-ia32`

### Linux
- `npm run gulp vscode-linux-x64` - most common
- `npm run gulp vscode-linux-arm`
- `npm run gulp vscode-linux-ia32`

## Roadmap

Please refer to our [Issues](https://github.com/voideditor/void/issues) page for the latest issues.


## ⭐⭐⭐ Creative.

Examples: creating better code search, or supporting AI agents that can edit across files and make multiple LLM calls.

Eventually, we want to build a convenient API for creating AI tools. The API will provide methods for creating the UI (showing an autocomplete suggestion, or creating a new diff), detecting event changes (like `onKeystroke` or `onFileOpen`), and modifying the user's file-system (storing indexes associated with each file), making it much easier to make your own AI plugin. We plan on building these features further along in timeline, but we wanted to list them for completeness.

# Guidelines

We're always glad to talk about new ideas, help you get set up, and make sure your changes align with our vision for the project. Feel free to shoot us a message in the #general channel of the [Discord](https://discord.gg/RSNjgaugJs) for any reason. Please check in especially if you want to make a lot of changes or build a large new feature.



## Submitting a Pull Request

Please submit a pull request once you've made a change. You don't need to submit an issue.

Please don't use AI to write your PR 🙂.

# Relevant files

We keep track of all the files we've changed with Void so it's easy to rebase:

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


## References

For some useful links we've compiled on VSCode, see [`VOID_USEFUL_LINKS.md`](https://github.com/voideditor/void/blob/main/VOID_USEFUL_LINKS.md).
