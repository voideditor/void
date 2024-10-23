# Contributing to Void

Welcome! 👋 This is a guide on how to contribute to Void. We want to make it as easy as possible to contribute, so if you have any questions or comments, reach out via email or discord!

There are two main ways to contribute:

- Suggest New Features ([discord](https://discord.gg/RSNjgaugJs))
- Build New Features ([project](https://github.com/orgs/voideditor/projects/2/views/3))

We use a [VSCode extension](https://code.visualstudio.com/api/get-started/your-first-extension) to implement most of Void's functionality. Scroll down to see 1. How to build/contribute to the Extension, or 2. How to build/contribute to the full IDE (for more native changes).

For some useful links we've compiled see [`VOID_USEFUL_LINKS.md`](https://github.com/voideditor/void/blob/main/VOID_USEFUL_LINKS.md).

## 1. Building the Extension

Here's how you can start contributing to the Void extension. This is where you should get started if you're new.

1. Clone the repository:

```
git clone https://github.com/voideditor/void
```

2. Open the folder `/extensions/void` in VSCode (open it in a new workspace, _don't_ just cd into it):

3. Install dependencies:

```
npm install
```

4. Build the project. We created this build command so that we could run React in vscode - it converts `sidebar/index.tsx` into a CSS/JS bundle in `dist/`.

```
npm run build
```

5. Run the project by pressing <kbd>F5</kbd>.

This will start a new instance of VSCode with the extension enabled. If this doesn't work, you can press <kbd>Ctrl+Shift+P</kbd>, select "Debug: Start Debugging", and select "VSCode Extension Development".

## 2. Building the full IDE

If you want to work on the full IDE, please follow the steps below. If you have any questions/issues, you can refer to VSCode's full [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page, which is where the steps below come from. Also feel free to submit an issue or get in touch with us with any build errors.

### a. Building on a Mac

To build on a Mac, open `void/` in VSCode. Make sure you've built the extension by following the steps above (or just run `cd ./extensions/void && npm install && npm run build && npm run compile && cd ../..`). Also make sure you have Python and XCode installed on your system (you probably do by default).

1. Install all dependencies.

```
npm install
```

2. Run `npm run watch`.

This can take ~5 min. It's done when you see something like:

```
[watch-extensions] [00:37:39] Finished compilation extensions with 0 errors after 19303 ms
[watch-client    ] [00:38:06] Finished compilation with 0 errors after 46248 ms
[watch-client    ] [00:38:07] Starting compilation...
[watch-client    ] [00:38:07] Finished compilation with 0 errors after 5 ms
```

<!-- 3. Press <kbd>Ctrl+Shift+B</kbd> to start the build process. -->

3. In a new terminal, run `scripts/code.sh`.

This should open up the built IDE after loading for some time. To see new changes without restarting the build, use <kbd>Ctrl+Shift+P</kbd> and run "Reload Window".

To bundle the IDE, run `npm run gulp vscode-darwin-arm64`. Here are the full options: `vscode-{win32-ia32 | win32-x64 | darwin-x64 | darwin-arm64 | linux-ia32 | linux-x64 | linux-arm}(-min)`

Now that you're set up, feel free to check out our [Issues](https://github.com/voideditor/void/issues) page!

**Common Fixes:**

- Make sure you have the same NodeJS version as `.nvmrc`.

### b. Building on Windows

To build on Windows, please refer to [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute). We recommend building on Mac; we're Windows users who switch to Mac to build right now.
If you're on Windows, we recommend running the project inside a dev container. VSCode should prompt you to do this automatically.

## Roadmap

Here are the most important topics on our Roadmap. More ⭐'s = more important.

These sometimes get outdated - please refer to our Issues page for the latest issues.

## ⭐⭐⭐ Make History work well.

When the user submits a response or presses the apply/accept/reject button, we should add these events to the history, allowing the user to undo/redo them. Right now there is unexpected behavior if the user tries to undo or redo their changes.

## ⭐⭐⭐ Build Cursor-style quick edits (ctrl+k).

When the user presses ctrl+k, an input box should appear inline with the code that they were selecting. This is somewhat difficult to do because an extension alone cannot do this, and it requires creating a new component in the IDE. We think you can modify vscode's built-in "codelens" or "zone widget" components, but we are open to alternatives.

## ⭐⭐⭐ Creative.

Examples: creating better code search, or supporting AI agents that can edit across files and make multiple LLM calls.

Eventually, we want to build a convenient API for creating AI tools. The API will provide methods for creating the UI (showing an autocomplete suggestion, or creating a new diff), detecting event changes (like `onKeystroke` or `onFileOpen`), and modifying the user's file-system (storing indexes associated with each file), making it much easier to make your own AI plugin. We plan on building these features further along in timeline, but we wanted to list them for completeness.

## ⭐ One-stars.

⭐ Let the user accept / reject all Diffs in an entire file via the sidebar.

# Guidelines

Please don't make big refactors without speaking with us first. We'd like to keep the codebase similar to vscode so we can periodically rebase, and if we have big changes that gets complicated.

# Submitting a Pull Request

Please submit a pull request once you've made a change. Here are a few guidelines:

- A PR should be about one _single_ feature change. The fewer items you change, the more likely the PR is to be accepted.

- Your PR should contain a description that first explains at a high level what you did, and then describes the exact changes you made (and to which files). Please don't use vague statements like "refactored code" or "improved types" (instead, describe what code you refactored, or what types you changed).

- Try to avoid refactoring and making feature changes in the same PR.

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
