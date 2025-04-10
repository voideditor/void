# Void Codebase Guide

The Void codebase is not as intimidating as it seems!

Most of Void's code lives in the folder `src/vs/workbench/contrib/void/`.

The purpose of this document is to explain how Void works. If you want build instructions, see [Contributing](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md).


Each section below contains an overview of a core part of Void's sourcecode. You might want to scroll to find the item that's relevant to you.

## Void Codebase Guide


### Internal LLM Message Pipeline

Here's a picture of all the dependencies that are relevent between the time you first send a message through Void's sidebar, and the time a request is sent to your provider.
Sending LLM messages from the main process avoids CSP issues with local providers and lets us use node_modules more easily.


<div align="center">
	<img width="100%" src="https://github.com/user-attachments/assets/9cf54dbb-82c4-4488-97a2-bd8dea890b50">
</div>



**Notes:** `modelCapabilities` is an important file that must be updated when new models come out! 

### Terminology

Here is some important terminology you should know if you're working inside VSCode:
- A **URI** is a path to a file. Often URIs are named **resource**.
- An **Editor** is the thing that you type your code in. If you have 10 tabs open, that's just one editor! Editors contain tabs (or "models").
- A **Model** is an internal representation of a file's contents. It's shared between editors (for example, if you press `Cmd+\` to make a new editor, then the model of a file like `A.ts` is shared between them. Two editors, one model. That's how changes sync.).


### Apply

There are two types of Apply: **Fast Apply** (uses Search/Replace, see below), and **Slow Apply** (rewrites whole file).

When you click Apply and Fast Apply is enabled, we prompt the LLM to output Search/Replace block(s) like this:
```
<<<<<<< ORIGINAL
// original code goes here 
=======
// replaced code goes here
>>>>>>> UPDATED
```
This is what allows Void to quickly apply code even on 1000-line files. It's the same as asking the LLM to press Ctrl+F and enter in a search/replace query. 


### Void Settings Inner Workings
We have a service `voidSettingsService` that stores all your Void settings (providers, models, global Void settings, etc). Imagine this as an implicit dependency on this for any of the other core Void services:

<div align="center">
	<img width="800" src="https://github.com/user-attachments/assets/9f3cb68c-a61b-4810-8429-bb90b992b3fa">
</div>

Here's a guide to some of the terminology we're using:
- **FeatureName**: Autocomplete | Chat | CtrlK | Apply
- **ModelSelection**: a {providerName, modelName} pair.
- **ProviderName**: The name of a provider: `'ollama'`, `'openAI'`, etc.
- **ModelName**: The name of a model (string type, eg `'gpt-4o'`). 
- **RefreshProvider**: a provider that we ping repeatedly to update the models list.
- **ChatMode** = normal | gather | agent


### Apply Inner Workings

The `editCodeService` file runs Apply. The same exact code is also used when the LLM calls the Edit tool, and when you submit Cmd+K. Just different versions of Fast/Slow Apply mode.

Here is some important terminology:
- A **DiffZone** is a {startLine, endLine} region in which we show Diffs (red/green areas).
- A **DiffArea** is a generalization just used to track line numbers like a DiffZone.
- A DiffZone has an llmCancelToken (is streaming) if and only if we are Applying in its file's URI.
- When you click Apply, we create a **DiffZone** so that any changes that the LLM makes will show up in red/green. We then stream the change.


### Approval State
`editCodeService` fundamentally contains all the state about changes that the user needs to review, but it doesn't store that information in a useful format. We wrote the following service to get a more useful derived state from it:

<div align="center">
	<img width="600" src="https://github.com/user-attachments/assets/f3645355-dff6-467c-bc38-ffe52077c08b">
</div>




### Minimal VSCode Rundown
Here's a minimal VSCode rundown if you're just getting started with Void:

- VSCode is (and therefore Void is) an Electron app. Electron runs two processes: a **main** process (for internal workings) and a **browser** process (browser means HTML in general, not just "web browser").
- Code in a  `browser/` folder lives in the browser, so it can use window and other browser items
- Code in an `electron-main/` lives on the main process, so it can import node_modules.
- Code in `common/` can be imported by either one.
- There are a few others, see here for more:  [How VSCode's sourcecode is organized](https://github.com/microsoft/vscode/wiki/Source-Code-Organization).
- The browser environment is not allowed to import `node_modules`, but there are two workarounds:
  1. Bundle the node_module code and ship it in the browser - we're doing this for React.
  2. Implement the code on `electron-main/` and set up a channel - we're doing this for sendLLMMessage.



### Misc

- VSCode's repo is the source for Monaco. An "editor" is a Monaco editor, and it shares the code for ITextModel, etc.


## VSCode Codebase Guide (Not Void)

The Void team put together this list of links to get up and running with VSCode's sourcecode, the foundation of Void. We hope it's helpful!

### Links for Beginners

- [VSCode UI guide](https://code.visualstudio.com/docs/getstarted/userinterface)  - covers auxbar, panels, etc.

- [UX guide](https://code.visualstudio.com/api/ux-guidelines/overview) - covers Containers, Views, Items, etc.



### Links for Contributors

- [How VSCode's sourcecode is organized](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) - this explains where the entry point files are, what `browser/` and `common/` mean, etc. This is the most important read on this whole list! We recommend reading the whole thing.

- [Built-in VSCode styles](https://code.visualstudio.com/api/references/theme-color) - CSS variables that are built into VSCode. Use `var(--vscode-{theme but replacing . with -})`. You can also see their [Webview theming guide](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content).


### Misc

- [Every command](https://code.visualstudio.com/api/references/commands) built-in to VSCode - not used often, but here for reference.


### VSCode's Extension API

Void is no longer an extension, so these links are no longer required, but they might be useful if we ever build an extension again.

- [Files you need in an extension](https://code.visualstudio.com/api/get-started/extension-anatomy).

- [An extension's `package.json` schema](https://code.visualstudio.com/api/references/extension-manifest).

- ["Contributes" Guide](https://code.visualstudio.com/api/references/contribution-points) - the `"contributes"` part of `package.json` is how an extension mounts.

- [The Full VSCode Extension API](https://code.visualstudio.com/api/references/vscode-api) - look on the right side for organization. The [bottom](https://code.visualstudio.com/api/references/vscode-api#api-patterns) of the page is easy to miss but is useful - cancellation tokens, events, disposables.

- [Activation events](https://code.visualstudio.com/api/references/activation-events) you can define in `package.json` (not the most useful).


