
# Welcome!

Welcome! This file is where we track our TODOs. Feel free to add to the list or help us knock out some bullet points. Cheers!

## Core

- Migrate the void extension to live natively in VS Code. There's initial work here at `glass.contribution.ts`.

- Allow access to the VS Code extension marketplace.

- Re-write the whole file when the user clicks "Apply" and show a gray progress indicator in the BG.



## Diffs

- "Diffs" are the inline green/red highlights you see to approve or reject a change.

- Diffs are not responsive to edits right now. To make them responsive, we need to update all Diffs' ranges every time there's a change.

- Right now Diffs are only shown in green as a simple text decoration. We'd like to have them work better by stealing code from VS Code's native diffEditor ("inline" mode).

- **Events:** On many types of event, we should reject all the current Diffs (user submits a new chat message, clicks Apply, etc).



## Ctrl+L (chat)

- We should let the user accept / reject all Diffs in an entire file.

- We should automatically select the file the user is currently in.

- The user should be able to make multiple selections of code/files at once.



## Ctrl+K (inline edits)

- Create a new input box that takes in the user's description.

- Make it appear above each.

- The input box should appear directly above the code selection - this requires using a Zone widget.



## Ollama

- Ollama doesn't work now because its JS library depends on Node.js and uses imports like 'path', 'os', while extensions must be able to run in the browser. When we migrate the extension into the VS Code codebase, we'll be able to access Node.js and will uncomment the Ollama integration.

## Greptile

- Ideally we'd auto-detect

## Design principles

- Least amount of eye movement necessary; if user presses submit, show them the message where they submitted


# Run

To run this extension alone, open the repo in a new workspace, `npm run build`, and hit `F5`.


## Note on using React

To support React, we build all our React code into native javascript build time (`npm run build`). For example, the sidebar is written in React `sidebar/index.tsx` but compiled into `dist/sidebar/index.js` and `dist/sidebar/styles.css` on build.


