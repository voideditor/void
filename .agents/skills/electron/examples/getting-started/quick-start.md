# Quick Start | 快速开始

**官方文档**: https://www.electronjs.org/zh/docs/latest/,


## Instructions

This example demonstrates how to create a basic Electron application.

### Key Concepts

- Main process setup
- Creating BrowserWindow
- Loading HTML content
- App lifecycle

### Example: Basic main.js

```javascript
// main.js
const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

### Example: Basic index.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Hello Electron</title>
</head>
<body>
  <h1>Hello Electron!</h1>
  <p>Welcome to Electron</p>
  <script src="renderer.js"></script>
</body>
</html>
```

### Example: Basic preload.js

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile')
})
```

### Example: Basic renderer.js

```javascript
// renderer.js
document.addEventListener('DOMContentLoaded', () => {
  console.log('Renderer process loaded')
  
  // Use exposed API from preload
  window.electronAPI.openFile().then(result => {
    console.log('File selected:', result)
  })
})
```

### Key Points

- Main process (main.js) controls app lifecycle
- BrowserWindow creates application windows
- loadFile() loads local HTML files
- Preload scripts bridge main and renderer safely
- Renderer process runs web content
- Use contextBridge for secure IPC exposure
