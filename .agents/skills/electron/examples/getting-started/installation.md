# Installation | 安装

**官方文档**: https://www.electronjs.org/zh/docs/latest/,


## Instructions

This example demonstrates how to install Electron and set up a basic project.

### Key Concepts

- Installing Electron
- Project structure
- package.json configuration
- Running Electron app

### Example: Installation

```bash
# Using npm
npm install electron --save-dev

# Using yarn
yarn add electron --dev

# Using pnpm
pnpm add electron --save-dev
```

### Example: Basic package.json

```json
{
  "name": "my-electron-app",
  "version": "1.0.0",
  "description": "My Electron app",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron ."
  },
  "devDependencies": {
    "electron": "^latest"
  }
}
```

### Example: Project Structure

```
my-electron-app/
├── main.js          # Main process entry point
├── preload.js       # Preload script (optional)
├── renderer/
│   ├── index.html   # Renderer HTML
│   └── renderer.js  # Renderer script
├── package.json
└── README.md
```

### Example: Running the App

```bash
# Start the app
npm start

# Or directly
npx electron .
```

### Example: Using Electron Forge

```bash
# Create new project with Electron Forge
npm create electron-app@latest my-app

# Or add to existing project
npx @electron-forge/cli import
```

### Key Points

- Install Electron as dev dependency
- Set `main` field in package.json to main process file
- Use `electron .` to run the app
- Main process file (main.js) is required
- Electron Forge can scaffold projects automatically
- Works on Windows, macOS, and Linux
