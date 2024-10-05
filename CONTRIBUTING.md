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

2. Open the folder `/extensions/void` in VS Code (open it in a new workspace, *don't* just cd into it):

```
open /extensions/void
```

3. Install dependencies:

```
npm install
```

4. Build the project. We created this build command so that we could run React in vscode - it converts `sidebar/index.tsx` into a CSS/JS bundle in `dist/`.

```
npm run build
```

5. Run the project by pressing <kbd>F5</kbd>.

This will start a new instance of VS Code with the extension enabled. If this does not work, you can press <kbd>Ctrl+Shift+P</kbd>, select "Debug: Start Debugging", and select "VS Code Extension Development".

If you would like to use AI features, you need to provide an API key. You can do that by going to Settings (Ctrl+,) typing in "void", and adding the API key you want to use (eg. the `"Anthropic Api Key"` environment variable). The "Which API" environment variable controls the provider and defaults to "anthropic".

Now that you're set up, feel free to check out our [Issues](https://github.com/voideditor/void/issues) page!

## 2. Building the full IDE

Beyond the extension, we very occasionally edit the IDE when we need to access more functionality. If you want to work on the full IDE, please follow the steps below, or see VS Code's full [how to contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page.

Before starting, make sure you've built the extension (by running `cd .\extensions\void\` and `npm run build`).

Make sure you're on the correct NodeJS version as per `.nvmrc`.

1. Install all dependencies.

```
npm install
```

2. In VS Code, press <kbd>Ctrl+Shift+B</kbd> to start the build process - this can take some time. If you're not using VS Code, run `npm run watch` instead.

3. Run `./scripts/code.sh` in your terminal.

This should open up the built IDE after loading for some time. To see new changes without restarting the build, use <kbd>Ctrl+Shift+P</kbd> and run "Reload Window".

To bundle the IDE, run `npm run gulp vscode-darwin-arm64`. Here are the full options: `vscode-{win32-ia32 | win32-x64 | darwin-x64 | darwin-arm64 | linux-ia32 | linux-x64 | linux-arm}(-min)`

If you're on Windows, we recommend running the project inside a dev container. VSCode should prompt you to do this automatically.

Now that you're set up, feel free to check out our [Issues](https://github.com/voideditor/void/issues) page!

## Roadmap

Here are the most important topics on our Roadmap. More ⭐'s = more important.

## ⭐⭐⭐ Improve diffs.

We define a "diff" as a single green/red pair that denotes a change. Here are improvements to make:

1. Show deletion (-) diffs. Right now we're only showing insertion (+) diffs. Diffs currently work by highlighting all of the new code in green with a simple text decoration. Instead, we would like to use code from VS Code's native diffEditor to show the diffs ("inline" mode). We could alternatively keep what we have and add red zones of the deleted code to indicate a deletion diff (-).

2. Fix bugginess when the user presses "Accept" or "Reject" on a diff. One issue is that when a diff is accepted/rejected all of the diffs below should be updated (because they are now on different line numbers). There are other miscellaneous issues too.

3. Make diff highlighting dynamic. Right now when the user edits text, all of the diffs and their highlights are cleared. Instead, we should update the highlighting of the diff. Each diff lives on a range of lines, and all changes inside that range or intersecting with it should update its highlighting.

## ⭐⭐⭐ Build Cursor-style quick edits (ctrl+k).

When the user presses ctrl+k, an input box should appear inline with the code that they were selecting. This is somewhat difficult to do because an extension alone cannot do this, and it requires creating a new component in the IDE. We think you can modify vscode's built-in "codelens" or "zone widget" components, but we are open to alternatives.

## ⭐⭐⭐ Make History work well.

When the user submits a response or presses the apply/accept/reject button, we should add these events to the history, allowing the user to undo/redo them. Right now there is unexpected behavior if the user tries to undo or redo their changes.

## ⭐⭐⭐ Improve Ctrl+L backend.

Right now, the model outputs entire files. Instead, we should change the prompt so that the model outputs partial changes like `// ... rest of file`. When the user clicks the "Apply" button, the model should rewrite the file and apply the partial changes in the correct locations.

## ⭐⭐ Integrate with Ollama.

We have an Ollama integration coded up in the extension, but it breaks. This is because Ollama has Node.js dependencies like 'path' and 'os' which cannot run in extensions (extensions have to be able to run in the browser). To fix this, we need to migrate Void's extension so that it runs natively into the VS Code editor so that we can access Node.js.

## ⭐⭐⭐ Creative.

Feel free to build AI features beyond the standard Cursor ones. For example, creating better code search, or supporting AI agents that can edit across files and make multiple LLM calls.

Eventually, we want to build a convenient API for creating AI tools. The API will provide methods for creating the UI (showing an autocomplete suggestion, or creating a new diff), detecting event changes (like `onKeystroke` or `onFileOpen`), and modifying the user's file-system (storing indexes associated with each file), making it much easier to make your own AI plugin. We plan on building these features further along in timeline, but we wanted to list them for completeness.

## ⭐ One-stars.

⭐ When user presses ctrl+L it should clear the sidebar's state.

⭐ Let the user accept / reject all Diffs in an entire file via the sidebar.

⭐ Allow the user to make multiple selections of code or files at once.

⭐ Allow user to X out of their current selection.

# Guidelines

Please don't make big refactors without speaking with us first. We'd like to keep the codebase similar to vscode so we can periodically rebase, and if we have big changes that gets complicated.

# Submitting a Pull Request

Please submit a pull request once you've made a change. Here are a few guidelines:

- A PR should be about one *single* feature change. The fewer items you change, the more likely the PR is to be accepted.

- Your PR should contain a description that first explains at a high level what you did, and then describes the exact changes you made (and to which files). Please don't use vague statements like "refactored code" or "improved types" (instead, describe what code you refactored, or what types you changed). 

- Your title should clearly describe the change you made.

- Add tags to help us stay organized!

- Please don't open a new Issue for your PR. Just submit the PR.

- Avoid refactoring and making feature changes in the same PR. 

- Write good code. For example, a common mistake when people edit Void's config is to hard-code a default value like `'claude-3.5'` in 2+ separate places. Please follow best practices or describe your thought process if you had to compromise.

# Relevant files

We keep track of all the files we've changed with Void so it's easy to rebase:


- README.md
- CONTRIBUTING.md
- VOID_USEFUL_LINKS.md
- product.json

- src/vs/workbench/api/common/{extHost.api.impl.ts | extHostApiCommands.ts}
- src/vs/workbench/workbench.common.main.ts
- src/vs/workbench/contrib/void
- extensions/void

- .github/
- .vscode/settings
- .eslintrc.json
- build/hygiene.js
- build/lib/i18n.resources.json
- build/npm/dirs.js
