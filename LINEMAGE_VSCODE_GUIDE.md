# Useful links

LineMage put together this list of links to learn about VSCode. We hope it's helpful!

## Beginners / Getting started

- [VSCode UI guide](https://code.visualstudio.com/docs/getstarted/userinterface)  - covers auxbar, panels, etc.
 
- [UX guide](https://code.visualstudio.com/api/ux-guidelines/overview) - covers Containers, Views, Items, etc.

## Contributing

- [How VS Code's sourcecode is organized](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) - this explains where the entry point files are, what `browser/` and `common/` mean, etc. **This is the most important read on this whole list!** We recommend reading the whole thing.


- [Every command](https://code.visualstudio.com/api/references/commands) built-in to VSCode - sometimes useful to reference.


## VSCode's Extension API

LineMage is mostly an extension right now, and these links were very useful for us to get set up.

- [Files you need in an extension](https://code.visualstudio.com/api/get-started/extension-anatomy).

- [An extension's `package.json` schema](https://code.visualstudio.com/api/references/extension-manifest).

- ["Contributes" Guide](https://code.visualstudio.com/api/references/contribution-points) - the `"contributes"` part of `package.json` is how an extension mounts.

- [Activation events](https://code.visualstudio.com/api/references/activation-events) you can define in `package.json`.

- [The Full VSCode Extension API](https://code.visualstudio.com/api/references/vscode-api) - look on the right side for organization. The [bottom](https://code.visualstudio.com/api/references/vscode-api#api-patterns) of the page is easy to miss but is useful - cancellation tokens, events, disposables.


