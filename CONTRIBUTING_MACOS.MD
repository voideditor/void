# Prerequisites

- Node js 20.6
- Python
- Code command installed and working on your mac : https://code.visualstudio.com/docs/setup/mac
- A Working API form the IA provider you want to use.

# INSTALLATION PROCESS

## 1. ClONE AND SETUP PR-BRANCH

Using macOS terminal

```
git clone https://github.com/voideditor/void
cd void
git config --add remote.origin.fetch "+refs/pull/_/head:refs/remotes/origin/pr/_"
git fetch --all
git checkout pr/92
cd void
npm install
```

### 1.1 Build extension :

````
code extensions/void
npm install
npm run build
npm run watch
```

Build the extension inside vscode
`fn+F5`

SET YOUR API KEY IN SETTINGS to activate IA

### 1.2 Build Editor :

Build in watch mode to relect the changes

```
npm run watch
```

Wait until the last lines are

```
[watch-extensions] [*YOUR LOCAL HOUR*] Finished compilation extensions with 0 errors after 103780 ms
[watch-client ] [*YOUR LOCAL HOUR*] Finished compilation with 0 errors after 176591 ms
[watch-client ] [*YOUR LOCAL HOUR*] Starting compilation...
[watch-client ] [*YOUR LOCAL HOUR*] Finished compilation with 0 errors after 28 ms
```

Then`CTRL+C` to kill the process

Prepare compilation and check in bundle mode

```
chmod +x scripts/code.sh
scripts/code.sh
```
-> Check the watched compilation in bundle mode,
-> Test this is working,
-> Quit void

Then
```
npm run gulp vscode-darwin-arm64 (on an Apple Sillicon computer)
````
