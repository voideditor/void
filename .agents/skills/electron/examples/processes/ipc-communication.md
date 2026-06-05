# IPC Communication | IPC 通信

**官方文档**: https://www.electronjs.org/zh/docs/latest/,


## Instructions

This example demonstrates IPC (Inter-Process Communication) between main and renderer processes.

### Key Concepts

- ipcMain in main process
- ipcRenderer in renderer process
- contextBridge for secure exposure
- Two-way communication

### Example: Basic IPC Setup

```javascript
// main.js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile('index.html')
}

// Handle IPC from renderer
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

ipcMain.on('window-minimize', () => {
  mainWindow.minimize()
})

app.whenReady().then(() => {
  createWindow()
})
```

### Example: Preload Script

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron')

// Expose safe API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  
  // Two-way communication
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  
  // Listen to main process
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, data) => callback(data))
  }
})
```

### Example: Renderer Process

```javascript
// renderer.js
document.addEventListener('DOMContentLoaded', () => {
  // Get app version
  window.electronAPI.getVersion().then(version => {
    console.log('App version:', version)
  })
  
  // Minimize window
  document.getElementById('minimize-btn').addEventListener('click', () => {
    window.electronAPI.minimizeWindow()
  })
  
  // Open file dialog
  document.getElementById('open-file-btn').addEventListener('click', async () => {
    const result = await window.electronAPI.openFile()
    console.log('Selected file:', result)
  })
  
  // Listen for updates
  window.electronAPI.onUpdateAvailable((data) => {
    console.log('Update available:', data)
  })
})
```

### Example: Advanced IPC Patterns

```javascript
// main.js
const { ipcMain, dialog } = require('electron')

// Handle with async response
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile']
  })
  
  if (!canceled) {
    return filePaths[0]
  }
  return null
})

// Send to renderer
ipcMain.on('check-updates', () => {
  // Simulate update check
  setTimeout(() => {
    mainWindow.webContents.send('update-available', {
      version: '1.0.1',
      url: 'https://example.com/update'
    })
  }, 2000)
})
```

### Key Points

- Use ipcMain.handle() for request-response pattern
- Use ipcMain.on() for one-way communication
- Use contextBridge.exposeInMainWorld() for secure API exposure
- Never expose ipcRenderer directly to renderer
- Use contextIsolation: true and nodeIntegration: false
- IPC enables safe communication between processes
