# Main Process | 主进程

**官方文档**: https://www.electronjs.org/zh/docs/latest/,


## Instructions

This example demonstrates main process concepts and usage in Electron.

### Key Concepts

- Main process role
- App lifecycle events
- Creating windows
- Managing application state

### Example: App Lifecycle

```javascript
// main.js
const { app, BrowserWindow } = require('electron')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile('index.html')
  
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// App ready
app.whenReady().then(() => {
  createWindow()
})

// macOS: Re-open window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

### Example: App Events

```javascript
const { app } = require('electron')

// Before app quits
app.on('before-quit', (event) => {
  console.log('App is about to quit')
})

// Will quit
app.on('will-quit', (event) => {
  console.log('App will quit')
})

// Quit
app.on('quit', () => {
  console.log('App quit')
})

// Second instance
app.on('second-instance', () => {
  // Focus existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
```

### Example: Single Instance App

```javascript
const { app } = require('electron')

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Handle second instance
  })
  
  // Continue with app initialization
  app.whenReady().then(() => {
    createWindow()
  })
}
```

### Key Points

- Main process manages app lifecycle
- Use app.whenReady() before creating windows
- Handle window-all-closed for proper quit behavior
- macOS requires special handling for dock icon
- Use requestSingleInstanceLock() for single instance apps
- Main process has full Node.js access
