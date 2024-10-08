# Prerequisites

- Node js 20.6 : https://nodejs.org/en/download/
- Python 3.12 : https://www.python.org/downloads/release/python-31211/
- Xcode CLI : https://developer.apple.com/xcode/
- Code command installed and working on your mac : https://code.visualstudio.com/docs/setup/mac
- A Working API Key form the AI provider you want to use (OpenAI, Anthropic, Groq, Mistral, Gemini, ...)


# 1.Extention build process
## 1.1 Clone the repository and setup the PR-BRANCH

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

## 1.2 Build extension :

``
code extensions/void
``
Visual Studio Code will open, then install the dependencies and build the extension

In VSCode Terminal
```
npm install
npm run build
npm run watch
```

Build the extension inside vscode using the command `fn+F5`

SET YOUR API KEY IN SETTINGS to activate AI features

Close the extention

# 2. IDE build process
Follow the steps Extention build process, then follow thses steps to build the IDE

## 2.1 Build Editor (watch mode) :

In MacOS Terminal (in the void root folder)

The terminal should remain in the void root folder
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

## 2.2 Prepare compilation and check in bundle mode

```
chmod +x scripts/code.sh
scripts/code.sh
```

- Check the watched compilation in bundle mode,
- Test this is working,
- Clode void IDE

Then in MacOS Terminal (in the void root folder)

```
npm run gulp vscode-darwin-arm64 (on an Apple Sillicon computer)
````

You now have a Void IDE in the parent void folder

# 3. Test the IDE
In MacOS Terminal (in the void root folder)
```
npm run gulp vscode-darwin-arm64 (on an Apple Sillicon computer)
```
