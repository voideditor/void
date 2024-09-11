

















# Useful links

Useful links when learning about the VS Code sourcecode:

## Getting started

- VSCode UI guide (describes what sidebar, aux bar, panels, etc are. intended for general public), and UX guide (for developers)
https://code.visualstudio.com/docs/getstarted/userinterface
https://code.visualstudio.com/api/ux-guidelines/overview


- Files you need in an extension
https://code.visualstudio.com/api/get-started/extension-anatomy


## Contributing

VERY USEFUL - How VS Code's sourcecode is organized (describes entry point files, what browser/ and common/ mean, etc, read the whole thing!)
- https://github.com/microsoft/vscode/wiki/Source-Code-Organization


- Full VSCode API (all functions/events/variables available in extension api - look on right hand side for organization)
https://code.visualstudio.com/api/references/vscode-api
(don't miss this part on cancellation tokens, how events and disposables work) https://code.visualstudio.com/api/references/vscode-api#api-patterns


- Guide on contributes ("contributes": part of package.json) - a "contribute" is how your extension mounts - it's all the things your extension actually contributes
https://code.visualstudio.com/api/references/contribution-points
(full package.json schema) https://code.visualstudio.com/api/references/extension-manifest
(activation events you can define in package.json) https://code.visualstudio.com/api/references/activation-events


- Every command built-in to VSCode (e.g. 'workbench.action.openWalkthrough')
https://code.visualstudio.com/api/references/commands


## Building VS Code's source

https://github.com/microsoft/vscode/wiki/How-to-Contribute


## Summary

Editor:
/vs/editor/contrib = allowed to depend on browser env
/vs/editor/{common|browser} = core code ('common' and 'browser' are the only two envs that are allowed here)
/vs/editor/{standalone} = seems unimportant - something about the standalone editor


Workbench:
/vs/workbench/contrib:
    - no deps from outside here are allowed
    - each contrib needs a single contribname.contribution.ts which serves as the entrypoint (eg /search/browser/search.contribution.ts)
    - the contribution should expose its internal api from only 1 entrypoint and only be accessed from there, nowhere else (eg /search/common/search.ts)
      - sounds like all services, etc should be managed by that one entrypoint
/vs/workbench/api = provides vscode.d.ts to iinterface with stuff outside of /workbench/contrib
/vs/workbench/{common|browser|electron-sandbox} = core code, "as minimal as possible"

TODO andrew finish writing the summary from written notes (some visuals...)
