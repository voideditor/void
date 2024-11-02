# Contributing to Void

Welcome! 👋 This is the official guide on how to contribute to Void. We want to make it as easy as possible to contribute, so if you have any questions or comments, reach out via email or discord!

There are a few ways to contribute:

- Suggest New Features ([Discord](https://discord.gg/RSNjgaugJs))
- Build New Features ([Project](https://github.com/orgs/voideditor/projects/2/views/3))
- Submit Issues/Docs/Bugs ([Issues](https://github.com/voideditor/void/issues))


## 1. Building the Extension

Here's how you can start contributing to the Void extension. This is where you should get started if you're new.

1. Clone the repository:

```
git clone https://github.com/voideditor/void
```

2. Open the folder `/extensions/void` in VSCode (open it in a new workspace, _don't_ just cd into it).

3. Install dependencies:

```
npm install
```

1. Compile the React files by running `npm run build`. This build command converts all the Tailwind/React entrypoint files into raw .css and .js files in `dist/`.

```
npm run build
```

5. Run the extension in a new window by pressing <kbd>F5</kbd>.

This will start a new instance of VSCode with the extension enabled. If this doesn't work, you can press <kbd>Ctrl+Shift+P</kbd>, select "Debug: Start Debugging", and select "VSCode Extension Development".

## 2. Building the full IDE

If you want to work on the full IDE, please follow the steps below. If you have any questions/issues, you can refer to VSCode's full [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page. Also feel free to submit an issue or get in touch with us with any build errors.

<!-- TODO say whether you can build each distribution on any Operating System, or if you need to build Windows on Windows, etc -->

### a. Build Prerequisites - Mac

If you're using a Mac, make sure you have Python and XCode installed (you probably do by default).

### b. Build Prerequisites - Windows

If you're using a Windows computer, first get [Visual Studio 2022](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community) (recommended) or [VS Build Tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools) (not recommended). If you already have both, you might need to run the next few steps on both of them.

Find the box for Visual Studio 2022 (or VS Build Tools) and click Install/Modify.

Under Workloads, select "Desktop development with C++" and "Node.js build tools".

Under Individual components, select every item under:

- `MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)`,
- `C++ ATL for latest build tools with Spectre Mitigations`,
- `C++ MFC for latest build tools with Spectre Mitigations`.

Finally, click Install/Modify.

### c. Build Prerequisites - Linux

We haven't created prerequisite steps for building on Linux yet, but you can follow [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute).

### Build instructions

Before building Void, please follow the prerequisite steps above for your operating system. Also make sure you've already built the Void extension (or just run `cd ./extensions/void && npm install && npm run build && npm run compile && cd ../..`).

To build Void, first open `void/` in VSCode. Then:

1. Install all dependencies.

```
npm install
```

2. Press <kbd>Ctrl+Shift+B</kbd>, or if you prefer using the terminal run `npm run watch`.

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

1. In a new terminal, run `./scripts/code.sh` (Mac/Linux) or `/.scripts/code.bat` (Windows). This should open up the built IDE!
You can always press <kbd>Ctrl+Shift+P</kbd> and run "Reload Window" inside the new window to see changes without re-building.

Now that you're set up, feel free to check out our [Issues](https://github.com/voideditor/void/issues) page!


### Common Fixes

- Make sure you have the same NodeJS version as `.nvmrc`.

- If you see `[ERROR] Cannot start service: Host version "0.23.1" does not match binary version "0.23.0"`, run `npm i -D esbuild@0.23.0` or do a clean install of your npm dependencies.


## Bundling

To bundle the IDE into an executable, run `npm run gulp vscode-darwin-arm64`.

Here are the full options: `vscode-{win32-ia32 | win32-x64 | darwin-x64 | darwin-arm64 | linux-ia32 | linux-x64 | linux-arm}(-min)`


## Roadmap

Here are the most important topics on our Roadmap. More ⭐'s = more important. Please refer to our [Issues](https://github.com/voideditor/void/issues) page for the latest issues.

## ⭐⭐⭐ Make History work well.

When the user submits a response or presses the apply/accept/reject button, we should add these events to the history, allowing the user to undo/redo them. Right now there is unexpected behavior if the user tries to undo or redo their changes.

## ⭐⭐⭐ Build Cursor-style quick edits (Ctrl+K).

When the user presses Ctrl+K, an input box should appear inline with the code that they were selecting. This is somewhat difficult to do because an extension alone cannot do this, and it requires creating a new component in the IDE. We think you can modify vscode's built-in "codelens" or "zone widget" components, but we are open to alternatives.

## ⭐⭐⭐ Creative.

Examples: creating better code search, or supporting AI agents that can edit across files and make multiple LLM calls.

Eventually, we want to build a convenient API for creating AI tools. The API will provide methods for creating the UI (showing an autocomplete suggestion, or creating a new diff), detecting event changes (like `onKeystroke` or `onFileOpen`), and modifying the user's file-system (storing indexes associated with each file), making it much easier to make your own AI plugin. We plan on building these features further along in timeline, but we wanted to list them for completeness.

## ⭐ One-stars.

⭐ Let the user Accept / Reject all Diffs in an entire file via the sidebar.

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
