# Void Codebase Guide

The Void codebase is not as intimidating as it seems!

Most of Void's code lives in the folder `src/vs/workbench/contrib/void/`.

The purpose of this document is to explain how Void works. If you want build instructions, see [Contributing](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md).

## Void Codebase Guide

#### Internal LLM Message Pipeline
![image](https://github.com/user-attachments/assets/86f94214-ff12-4870-9b45-9dd6c5ac7070)

**Notes:** modelCapabilities is an important file that must be updated when new models come out! 

#### Terminology

- A **URI** is a path to a file (also called a resource).
- An **editor** is the thing that you type your code in. IMPORTANT: If you have 10 tabs open, that's just one editor! Editors contain tabs (or "models").
- A **model** is an internal representation of a file's contents. It's shared between editors (for example, if you press `Cmd+\` to make a new editor, then the model of a file like `A.ts` is shared between them. Two editors, one model. That's how changes sync.).


#### Approval State

 (An editor is really a Monaco editor - VSCode's repo is the source for Monaco!)


- Terminology for `editCodeService`:
- A **DiffZone** is a {startLine, endLine} region in which we show Diffs (red/green areas).
- A **DiffArea** is a generalization just used to track line numbers like a DiffZone.
- A DiffZone has an llmCancelToken (is streaming) if and only if we are Applying in its file's URI.


#### Apply

- When you click Apply, we create a **DiffZone** so that any changes that the LLM makes will show up in red/green. We then stream the change.
- There are two types of Apply: **Fast Apply** (uses Search/Replace, see below), and **Slow Apply** (rewrites whole file).
- Apply is also used when 1. you click Apply, 2. the LLM calls the Edit tool, and 3. you submit Cmd+K.

#### Fast Apply

When you click Apply and Fast Apply is enabled, we prompt the LLM to output Search/Replace block(s) like this:
```
<<<<<<< ORIGINAL
// original code goes here 
=======
// replaced code goes here
>>>>>>> UPDATED
```
This is what allows Void to quickly apply code even on 1000-line files. It's the same as asking the LLM to press Ctrl+F and enter in a search/replace query. 



#### Void Terminology
Here's a guide to some of the terminology we invented:
- **featureName** = autocomplete | chat | ctrlK | apply
- **providerName** = Ollama, openAI, etc
- **chatMode** = normal | gather | agent

Feel free to ask us any clarifying questions in our Discord!



#### VSCode Rundown

- VSCode is (and therefore Void is) an Electron app. Electron runs two processes: a **main** process (for internal workings) and a **browser** process (browser means HTML in general, not just "web browser").
- Code in a  `browser/` folder lives in the browser, so it can use window and other browser items
- Code in an `electron-main/` lives on the main process, so it can import node_modules.
- Code in `common/` can be imported by either one.
- There are a few others, see here for more:  [How VSCode's sourcecode is organized](https://github.com/microsoft/vscode/wiki/Source-Code-Organization).
- The browser environment is not allowed to import `node_modules`, but there are two workarounds:
  1. Bundle the node_module code and ship it in the browser - we're doing this for React.
  2. Implement the code on `electron-main/` and set up a channel - we're doing this for sendLLMMessage.





## VSCode Codebase Guide (Not Void)

The Void team put together this list of links to get up and running with VSCode's sourcecode, the foundation of Void. We hope it's helpful!

#### Links for Beginners

- [VSCode UI guide](https://code.visualstudio.com/docs/getstarted/userinterface)  - covers auxbar, panels, etc.

- [UX guide](https://code.visualstudio.com/api/ux-guidelines/overview) - covers Containers, Views, Items, etc.



#### Links for Contributors

- [How VSCode's sourcecode is organized](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) - this explains where the entry point files are, what `browser/` and `common/` mean, etc. This is the most important read on this whole list! We recommend reading the whole thing.

- [Built-in VSCode styles](https://code.visualstudio.com/api/references/theme-color) - CSS variables that are built into VSCode. Use `var(--vscode-{theme but replacing . with -})`. You can also see their [Webview theming guide](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content).


#### Misc

- [Every command](https://code.visualstudio.com/api/references/commands) built-in to VSCode - not used often, but here for reference.


#### VSCode's Extension API

Void is no longer an extension, so these links are no longer required, but they might be useful if we ever build an extension again.

- [Files you need in an extension](https://code.visualstudio.com/api/get-started/extension-anatomy).

- [An extension's `package.json` schema](https://code.visualstudio.com/api/references/extension-manifest).

- ["Contributes" Guide](https://code.visualstudio.com/api/references/contribution-points) - the `"contributes"` part of `package.json` is how an extension mounts.

- [The Full VSCode Extension API](https://code.visualstudio.com/api/references/vscode-api) - look on the right side for organization. The [bottom](https://code.visualstudio.com/api/references/vscode-api#api-patterns) of the page is easy to miss but is useful - cancellation tokens, events, disposables.

- [Activation events](https://code.visualstudio.com/api/references/activation-events) you can define in `package.json` (not the most useful).


