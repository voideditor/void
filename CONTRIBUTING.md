
# Contributing to LineMage

This is a guide on how to contribute to LineMage. We want to make it as easy to contribute as possible, so if you have any questions or comments please reach out via email or discord.

LineMage is a fork of the of [vscode](https://github.com/microsoft/vscode) repository.
# Ways to Contribute

## 1. Getting started with the Extension

We use a [VS Code extension](https://code.visualstudio.com/api/get-started/your-first-extension) to create most of LineMage's functionality.
Here's how you can start contributing to the extension:

1. Clone the repository

`git clone https://github.com/linemagedev/linemage`

2. Open the extension folder

`cd /extensions/linemage`

3. Install dependencies

`npm run install`

4. Build the project.

`npm run build`

We're using React to build the sidebar `sidebar/index.tsx` and other parts of the extension. We use this command to compile all of the react components into raw javascript and css in the `dist/...` folder so that we can use them in vscode.

5. Run the project by pressing `F5`.

This will start a new instance of VS Code with the extension enabled. If this does not work, you can press `f1 > type "Debug: Start Debugging" > press Enter > type "VS Code Extension Development"`.

If you would like to use AI features, you need to insert an API key. You can do that by going to `settings (ctrl + ,) > linemage > "Anthropic Api Key"`. The provider is chosen based on the "Which API" environment variable, and defaults to "anthropic".

## 2. Editing the IDE

Beyond the extension, we edit parts of the IDE in cases where we need more functionality. See below for instructions on how to contribute to the extension. If you want to make a change to the entire IDE please see VS Code's [how to contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page, which goes over how to install dependencies and run the VS Code IDE, which works the same way as our IDE (you can often skip to the "How to Contribute" section).


# Submitting a pull request

When you've made changes and want to submit them, please submit a pull request.





[[TODO!!!]]




## What to work on


Here are the most important topics we think you can contribute.

Feel free to contribute anything you like.

Full list [here]([[TODO!!!]])

More ⭐'s = more important.

⭐⭐⭐ Add LineMage changes to the history. When the user submits a response, or presses the apply/accept/reject buttons, we should add these events to the history and allow the user to use undo/redo on them. Right now there is unexpected behavior if the user tries to undo or redo their changes related to LineMage.

⭐⭐⭐ Improve diffs. We define a "diff" as a single green/red codeblock that denotes a change. Here are improvements to make:

1. Show deletion (-) diffs. Right now we're only showing insertion (+) diffs. We do this by highlighting all of the new code in green using a simple text decoration. We would like to instead use code from VS Code's native diffEditor to show the diffs ("inline" mode). We could also keep what we have and add red boxes of the deletions inline with the code.

2. Make diffs responsive to edits. When a user accepts a diff, all of the diffs below it should be updated (because they are now on different line numbers). We're not doing this, so there is a lot of unexpected behavior. We should the Diffs' ranges every time there's a change.

3. Implement "Diff Range". When the user makes a change (either in ctrl+k or ctrl+L) we should track the range that they changed (the "Diff Range"). All changes made inside of this range should appear as a diff. The range should disappear when all of the diffs inside of it have either been accepted or rejected.

⭐⭐⭐ Build Cursor-style quick edits (ctrl+k). When the user presses ctrl+k, an input box should appear inline with the code that they were selecting. This is somewhat difficult to do because an extension alone cannot do this, and it requires creating a new component in the IDE. We think you can modify vscode's built-in "codelens" or "zone widget" components, but we are open to alternatives.

⭐⭐⭐ Improve ctrl+L. One improvement is to make the model output diffs, instead of outputting the entire file. When the user clicks "apply" on a diff, the model should go through the entire file and apply the diff in the correct location.


⭐⭐ Integrate with Ollama. We have an Ollama integration coded up in the extension, but it breaks. This is because Ollama has Node.js dependencies like 'path' and 'os' which cannot run in extensions (extensions have to be able to run in the browser). To fix this, we need to migrate LineMage's extension so that it runs natively into the VS Code editor so that we can access Node.js.

⭐ When user presses ctrl+l it should reset from last time.

⭐ Let the user accept / reject all Diffs in an entire file.

⭐ Allow the user to make multiple selections of code or files at once.

⭐ Allow user to X out of their current selection.




## Links

[[TODO!!!]]


- TODO list


<!--

### Design principles

- Least amount of eye movement necessary; if user presses submit, show them the message where they submitted


### Ctrl+L (chat)




### Ctrl+K (inline edits)

- Create a new input box that takes in the user's description.

- Make it appear above each.

- The input box should appear directly above the code selection - this requires using a Zone widget.


### Core

- Migrate the LineMage extension to live natively in VS Code. There's initial work here at `linemage.contribution.ts`.

- Allow access to the VS Code extension marketplace.

- Re-write the whole file when the user clicks "Apply" and show a gray progress indicator in the BG.



### Diffs

"Diffs" are the inline green/red highlights you see to approve or reject a change.

- Diffs are not responsive to edits right now. To make them responsive, we need to update all Diffs' ranges every time there's a change.

- Right now Diffs are only shown in green as a simple text decoration. We'd like to have them work better by using code from VS Code's native diffEditor ("inline" mode).

- **Events:** On many types of events, we should reject all the current Diffs (user submits a new chat message, clicks Apply, etc).






### Ollama

- Ollama doesn't work now because its JS library depends on Node.js and uses imports like 'path', 'os', while extensions must be able to run in the browser. When we migrate the extension into the VS Code codebase, we'll be able to access Node.js and will uncomment the Ollama integration.

### Greptile

- Ideally we'd auto-detect -->
