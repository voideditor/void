# Useful links

LineMage put together this list of links to learn about VSCode. We hope it's helpful!

## Beginners / Getting started

- [VSCode UI guide](https://code.visualstudio.com/docs/getstarted/userinterface)  - covers auxbar, panels, etc.
 
- [UX guide](https://code.visualstudio.com/api/ux-guidelines/overview) - covers Containers, Views, Items, etc.

## Contributing

- [How VS Code's sourcecode is organized](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) - this explains where the entry point files are, what `browser/` and `common/` mean, etc. **The most important read in this list.**

- Don't forget [the bottom](https://code.visualstudio.com/api/references/vscode-api#api-patterns) of the page - cancellation tokens, events, disposables.

- [Every command](https://code.visualstudio.com/api/references/commands) built-in to VSCode - sometimes useful to reference.


## VSCode's Extension API

- [Files you need in an extension](https://code.visualstudio.com/api/get-started/extension-anatomy).

The `"contributes"` part of `package.json` is how an extension mounts.
- [Contributes Guide](https://code.visualstudio.com/api/references/contribution-points).

- [package.json schema](https://code.visualstudio.com/api/references/extension-manifest).

- [activation events](https://code.visualstudio.com/api/references/activation-events) in `package.json`.

- [Full VSCode Extension API](https://code.visualstudio.com/api/references/vscode-api) - look on the right side for organization.


