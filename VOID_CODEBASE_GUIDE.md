# Void Codebase Guide

The Void codebase is not as intimidating as it seems!

Most of Void's code lives in the folder `src/vs/workbench/contrib/void/` (platform-level code lives in `src/vs/platform/void/`).

The purpose of this document is to explain how Void's codebase works. If you want build instructions instead, see [BUILD](./BUILD.md).


### VSCode Rundown
Here's a VSCode rundown if you're just getting started with Void. You can also see Microsoft's [wiki](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) for some pictures. VSCode is an Electron app. Electron runs two processes: a **main** process (for internals) and a **browser** process (browser means HTML in general, not just "web browser").
<p align="center" >
<img src="https://github.com/user-attachments/assets/eef80306-2bfe-4cac-ba15-6156f65ab3bb" alt="Credit - https://github.com/microsoft/vscode/wiki/Source-Code-Organization" width="700px">
</p>

- Code in a  `browser/` folder always lives on the browser process, and it can use `window` and other browser items.
- Code in an `electron-main/` folder always lives on the main process, and it can import `node_modules`.
- Code in `common/` can be used by either process, but doesn't get any special imports.
- The browser environment is not allowed to import `node_modules`. We came up with two workarounds:
  1. Bundle the raw node_module code to the browser - we're doing this for React.
  2. Implement the code on `electron-main/` and set up a channel between main/browser - we're doing this for sendLLMMessage.


### Terminology

Here's some terminology you might want to know about when working inside VSCode:
- An **Editor** is the thing that you type your code in. If you have 10 tabs open, that's just one editor! Editors contain tabs (or "models").
- A **Model** is an internal representation of a file's contents. It's shared between editors (for example, if you press `Cmd+\` to make a new editor, then the model of a file like `A.ts` is shared between them. Two editors, one model. That's how changes sync.).
- Each model has a **URI** it represents, like `/Users/.../my_file.txt`. (A URI or "resource" is generally just a path).
- The **Workbench** is the wrapper that contains all the editors, the terminal, the file system tree, etc.
- Usually you use the `ITextModel` type for models and the `ICodeEditor` type for editors. There aren't that many other types.
<p align="center" >
<img src="https://github.com/user-attachments/assets/6521c228-dc96-4cf5-a673-6b9ca78b9b06" alt="Credit - https://code.visualstudio.com/docs/getstarted/userinterface" width="400px">
</p>



- VSCode is organized into "**Services**". A service is just a class that mounts a single time (in computer science theory this is called a "singleton"). You can register services with `registerSingleton` so that you can easily use them in any constructor with `@<Service>`. See _dummyContrib for an example we put together on how to register them. The registration is the same every time.

- "**Actions**" are functions you register on VSCode so that either you or the user can call them later. They're also called "**Commands**".
	- You can run actions as a user by pressing Cmd+Shift+P (opens the command pallete), or you can run them internally by using the commandService to call them by ID. We use actions to register keybinding listeners like Cmd+L, Cmd+K, etc. The nice thing about actions is the user can change the keybindings.


### Internal LLM Message Pipeline

LLM messages are sent from the **main** process, not the browser process. This avoids CSP issues with local providers and lets us use `node_modules` freely.

`common/sendLLMMessageService.ts` defines `ILLMMessageService`, a browser-side service that forwards requests to the main process over an IPC channel (see `llmMessageChannel` on the electron-main side). Each request registers hooks - `onText` (streaming tokens), `onFinalMessage`, `onError`, and `onAbort` - and the main process streams results back through the channel. Model lists are fetched the same way (`ollamaList`, `openAICompatibleList`).

Model capabilities come from `getModelCapabilities` (`src/vs/platform/void/common/modelInference.ts`). Capabilities are looked up dynamically (models are fetched automatically from OpenRouter and other providers), with sensible defaults for unrecognized models, and optional per-model overrides from settings - no manual updates needed when new models come out.


### Chat and the Agent Loop

`browser/chatThreadService.ts` owns chat threads. A thread stores its messages, the files the user has changed, and state like the current checkpoint index and staged selections. The service is a shell around several managers, each in its own file:

- `ChatExecutionEngine` (`browser/ChatExecutionEngine.ts`) drives the LLM <-> tools loop: it streams responses, executes tool calls through `ToolTurnCoordinator`, enforces tool approval (`getToolApprovalRequirement`), detects infinite loops (`LLMLoopDetector`), compresses old history (`ChatHistoryCompressor`), and rotates to fallback models when a provider fails (`chatModelFallbackPolicy`).
- `ChatAcpHandler` (`browser/ChatAcpHandler.ts`) bridges ACP agents (both the built-in one and external ones) into the same thread model, normalizing paths and message shapes.
- `ChatCheckpointManager` (`browser/ChatCheckpointManager.ts`) records checkpoints after tool edits and user edits, so you can jump back to any point in a thread.
- `ChatCodespanManager` links `codespans` in chat messages to editor locations.
- `ChatNotificationManager` and `ChatToolOutputManager` handle notifications and tool output bookkeeping.


### Tools

`common/toolsService.ts` defines every tool the model can call - reading files page-by-page, searching, editing files, running terminal commands, and more. Each tool has a validator that sanitizes the LLM's output before anything runs, and `isDangerousTerminalCommand` guards the terminal tool. Tools support parallel calls, MCP servers (`common/mcpService.ts`), and Agent Skills (`common/skills/`), which are markdown-defined skills the agent can activate.


### Apply and Quick Edit

`browser/editCodeService.ts` (interface in `editCodeServiceInterface.ts`) renders and applies code changes:

- A **DiffArea** tracks a {startLine, endLine} region of a file. **DiffZone** and **CtrlKZone** are the two concrete types - a DiffZone computes and shows red/green diffs, a CtrlKZone powers the Quick Edit (Ctrl+K) selection.
- `startApplying` streams an edit into a DiffZone. It's called either from `ClickApply` (an apply box in the chat) or from `QuickEdit` (Ctrl+K), and takes a `startBehavior` (`accept-conflicts` / `reject-conflicts` / `keep-conflicts`) describing what to do when it conflicts with your own concurrent edits.
- `previewEditFileSimple` creates a preview DiffZone from an ORIGINAL/UPDATED snippet pair - this is what the `edit_file` tool uses, so edits show up as accept/reject diffs in the editor instead of being written silently.
- `instantlyRewriteFile` replaces the whole file content.
- `inferSelectionForApply` picks the best location for an Apply snippet - AST-first (tree-sitter) with a heuristic fallback (`react/src/markdown/inferSelection.ts`).
- Apply boxes in the chat are bound to files with `bindApplyBoxUri` / `applyBoxId`, so each box knows which URI its diffs belong to.
- If an instant apply can't locate the ORIGINAL snippet, it falls back to re-locating it and retries (`onDidUseFallback`).


### Writing Files

Void writes changes directly to text models, so all you need to know to change a file is its URI - no need to load or save it yourself. `common/voidModelService.ts` handles creating model references, getting models by URI or fsPath, and saving them.


### Settings

`voidSettingsService` (in `src/vs/platform/void/common/`) stores your providers, models, and Void settings, and is an implicit dependency of the core Void services. A **ModelSelection** is a {providerName, modelName} pair. Custom OpenAI-compatible providers are supported through the dynamic provider registry, with optional per-model config. Model capabilities (tool support, reasoning, etc.) come from `getModelCapabilities` in `modelInference.ts`.


### React UI

Most of Void's UI is React, compiled separately from the rest of VSCode. It lives in `browser/react/` - the sidebar (`sidebar-tsx`), Quick Edit (`quick-edit-tsx`), settings (`void-settings-tsx`), and diff rendering (`diff/`). Run `node build.js` in that folder to compile it into `out/`. See `browser/react/README.md` for the two rules that matter: external imports must end with `.js`, and `src/` must stay one folder deep.


### Build process

For how to build and run Void, see [BUILD](./BUILD.md). The original distribution build pipeline lives in the [void-builder](https://github.com/voideditor/void-builder) repo.


## VSCode Codebase Guide

For additional references, the Void team put together this list of links to get up and running with VSCode.


