# Contributing to Void

Welcome! 👋 This is the official guide on how to contribute to Void. We want to make it as easy as possible to contribute, so if you have any questions or comments, reach out via email or discord!

There are a few ways to contribute:

- 👨‍💻 Refer to our [Issues](https://github.com/voideditor/void/issues) page for the latest issues!
- 💡 Suggest New Features in our [Discord](https://discord.gg/RSNjgaugJs).
- ⭐️ If you want to build your AI tool into Void, feel free to get in touch! It's very easy to extend Void, and the UX you create will be much more natural than a VSCode Extension.

Most of Void's code lives in `src/vs/workbench/contrib/void/browser/` and `src/vs/platform/void/`. 



## Building the full IDE

### a. Build Prerequisites - Mac

If you're using a Mac, you need Python and XCode. You probably have these by default.

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

First, run `npm install -g node-gyp`. Then:

- Debian (Ubuntu, etc): `sudo apt-get install build-essential g++ libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev python-is-python3`.
- Red Hat (Fedora, etc): `sudo dnf install @development-tools gcc gcc-c++ make libsecret-devel krb5-devel libX11-devel libxkbfile-devel`.
- Others: see [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute).

### Building Void

To build Void, open `void/` inside VSCode. Then:

1. `npm install` to install all dependencies.
2. `npm run buildreact` to build Void's browser dependencies like React.
3. Build.
	 - Press <kbd>Cmd+Shift+B</kbd> (Mac).
   - Press <kbd>Ctrl+Shift+B</kbd> (Windows/Linux).
   - This step can take ~5 min. The build is done when you see two check marks.
4. Run.
	 - Run `./scripts/code.sh` (Mac/Linux).
   - Run `./scripts/code.bat` (Windows).
   - This command should open up the built IDE. You can always press <kbd>Ctrl+Shift+P</kbd> and run "Reload Window" inside the new window to see changes without re-building, unless they're React changes.


#### Building Void from Terminal

Alternatively, if you want to build Void from the terminal, instead of pressing <kbd>Cmd+Shift+B</kbd> you can run `npm run watch`. The build is done when you see something like this:

```
[watch-extensions] [00:37:39] Finished compilation extensions with 0 errors after 19303 ms
[watch-client    ] [00:38:06] Finished compilation with 0 errors after 46248 ms
[watch-client    ] [00:38:07] Starting compilation...
[watch-client    ] [00:38:07] Finished compilation with 0 errors after 5 ms
```



### Common Fixes

- Make sure you follow the prerequisite steps.
- Make sure you have the same NodeJS version as `.nvmrc`.
- If you make any React changes, you must re-run `npm run buildreact` and re-build.
- If you have any questions, feel free to [submit an issue](https://github.com/voideditor/void/issues/new). For building questions, you can also refer to VSCode's full [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page.




## Bundling

We don't usually recommend bundling. Instead, you should probably just build. If you're sure you want to bundle Void into an executable app, run one of the following commands. This will create a folder named `VSCode-darwin-arm64` (or similar) in the repo's parent's directory. Be patient - compiling can take ~25 minutes.

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



# Guidelines

We're always glad to talk about new ideas, help you get set up, and make sure your changes align with our vision for the project! Feel free to shoot Mat or Andrew a message, or start chatting with us in the `#contributing` channel of our [Discord](https://discord.gg/RSNjgaugJs). 


## Submitting a Pull Request

- Please submit a pull request once you've made a change. You don't need to submit an issue.
- Please don't use AI to write your PR 🙂.


<!--
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
-->

## References

For some useful links we've compiled on VSCode, see [`VOID_USEFUL_LINKS.md`](https://github.com/voideditor/void/blob/main/VOID_USEFUL_LINKS.md).
