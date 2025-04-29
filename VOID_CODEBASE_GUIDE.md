# Void Codebase Guide

The Void codebase is not as intimidating as it seems!

Most of Void's code lives in the folder `src/vs/workbench/contrib/void/`.

The purpose of this document is to explain how Void's codebase works. If you want build instructions instead, see [Contributing](https://github.com/voideditor/void/blob/main/HOW_TO_CONTRIBUTE.md).









## Void Codebase Guide

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

Here's a picture of all the dependencies that are relevent between the time you first send a message through Void's sidebar, and the time a request is sent to your provider.
Sending LLM messages from the main process avoids CSP issues with local providers and lets us use node_modules more easily.


<div align="center">
	<img width="100%" src="https://github.com/user-attachments/assets/9cf54dbb-82c4-4488-97a2-bd8dea890b50">
</div>



**Notes:** `modelCapabilities` is an important file that must be updated when new models come out!


### Apply

Void has two types of Apply: **Fast Apply** (uses Search/Replace, see below), and **Slow Apply** (rewrites whole file).

When you click Apply and Fast Apply is enabled, we prompt the LLM to output Search/Replace block(s) like this:
```
<<<<<<< ORIGINAL
// original code goes here
=======
// replaced code goes here
>>>>>>> UPDATED
```
This is what allows Void to quickly apply code even on 1000-line files. It's the same as asking the LLM to press Ctrl+F and enter in a search/replace query.

### Apply Inner Workings

The `editCodeService` file runs Apply. The same exact code is also used when the LLM calls the Edit tool, and when you submit Cmd+K. Just different versions of Fast/Slow Apply mode.

Here is some important terminology:
- A **DiffZone** is a {startLine, endLine} region of text where we compute and show red/green areas, or **Diffs**. When any changes are made to a file, we loop through all the DiffAreas on that file and refresh its Diffs.
- A **DiffArea** is a generalization that just tracks line numbers like a DiffZone.
- The only type of DiffArea that can "stream" is a DiffZone. Each DiffZone has an llmCancelToken if it's streaming.

How Apply works:
- When you click Apply, we create a **DiffZone** over that the full file so that any changes that the LLM makes will show up in red/green. We then stream the change.
- When an LLM calls Edit, it's really calling Apply.
- When you submit Cmd+K, it's the same as Apply except we create a smaller DiffZone (not on the whole file).


### Writing Files Inner Workings
When Void wants to change your code, it just writes to a text model. This means all you need to know to write to a file is its URI - you don't have to load it, save it, etc. There are some annoying background URI/model things to think about to get this to work, but we handled them all in `voidModelService`.

### Void Settings Inner Workings
We have a service `voidSettingsService` that stores all your Void settings (providers, models, global Void settings, etc). Imagine this as an implicit dependency for any of the core Void services:

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



### Approval State
`editCodeService`'s data structures contain all the information about changes that the user needs to review. However, they don't store that information in a useful format. We wrote the following service to get a more useful derived state:

<div align="center">
	<img width="600" src="https://github.com/user-attachments/assets/f3645355-dff6-467c-bc38-ffe52077c08b">
</div>



### Build process
If you want to know how our build pipeline works, see our build repo [here](https://github.com/voideditor/void-builder).



## VSCode Codebase Guide

The Void team put together this list of links (optional reading) to get up and running with VSCode, the foundation of Void. We hope it's helpful!
<details>
	

#### Links for Beginners

- [VSCode UI guide](https://code.visualstudio.com/docs/getstarted/userinterface)  - covers auxbar, panels, etc.
- [UX guide](https://code.visualstudio.com/api/ux-guidelines/overview) - covers Containers, Views, Items, etc.

#### Links for Contributors

- [How VSCode's sourcecode is organized](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) - this explains where the entry point files are, what `browser/` and `common/` mean, etc. This is the most important read on this whole list! We recommend reading the whole thing.
- [Built-in VSCode styles](https://code.visualstudio.com/api/references/theme-color) - CSS variables that are built into VSCode. Use `var(--vscode-{theme but replacing . with -})`. You can also see their [Webview theming guide](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content).


#### Misc

- [Every command](https://code.visualstudio.com/api/references/commands) built-in to VSCode - not used often, but here for reference.
- Note: VSCode's repo is the source code for the Monaco editor! An "editor" is a Monaco editor, and it shares the code for ITextModel, etc.


#### VSCode's Extension API

Void is no longer an extension, so these links are no longer required, but they might be useful if we ever build an extension again.

- [Files you need in an extension](https://code.visualstudio.com/api/get-started/extension-anatomy).
- [An extension's `package.json` schema](https://code.visualstudio.com/api/references/extension-manifest).
- ["Contributes" Guide](https://code.visualstudio.com/api/references/contribution-points) - the `"contributes"` part of `package.json` is how an extension mounts.
- [The Full VSCode Extension API](https://code.visualstudio.com/api/references/vscode-api) - look on the right side for organization. The [bottom](https://code.visualstudio.com/api/references/vscode-api#api-patterns) of the page is easy to miss but is useful - cancellation tokens, events, disposables.
- [Activation events](https://code.visualstudio.com/api/references/activation-events) you can define in `package.json` (not the most useful).


</details>
