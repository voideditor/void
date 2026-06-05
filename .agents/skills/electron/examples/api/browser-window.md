# BrowserWindow | 窗口

**官方文档**: https://www.electronjs.org/zh/docs/latest/,


## Instructions

This example demonstrates how to use BrowserWindow to create and manage application windows.

### Key Concepts

- Creating windows
- Window options
- Loading content
- Window events
- Window methods

### Example: Basic Window

```javascript
const { BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile('index.html')
}

createWindow()
```

### Example: Window Options

```javascript
const win = new BrowserWindow({
  width: 1200,
  height: 800,
  minWidth: 400,
  minHeight: 300,
  maxWidth: 1920,
  maxHeight: 1080,
  resizable: true,
  movable: true,
  minimizable: true,
  maximizable: true,
  closable: true,
  focusable: true,
  alwaysOnTop: false,
  fullscreen: false,
  fullscreenable: true,
  simpleFullscreen: false,
  skipTaskbar: false,
  kiosk: false,
  title: 'My App',
  icon: path.join(__dirname, 'icon.png'),
  show: false, // Don't show until ready
  frame: true,
  titleBarStyle: 'default',
  backgroundColor: '#ffffff',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false
  }
})

// Show when ready
win.once('ready-to-show', () => {
  win.show()
})
```

### Example: Loading Content

```javascript
const win = new BrowserWindow({ width: 800, height: 600 })

// Load local file
win.loadFile('index.html')

// Load URL
win.loadURL('https://example.com')

// Load with options
win.loadFile('index.html', {
  query: { key: 'value' },
  hash: 'section'
})
```

### Example: Window Events

```javascript
const win = new BrowserWindow({ width: 800, height: 600 })

win.on('ready-to-show', () => {
  win.show()
})

win.on('closed', () => {
  win = null
})

win.on('focus', () => {
  console.log('Window focused')
})

win.on('blur', () => {
  console.log('Window blurred')
})

win.on('maximize', () => {
  console.log('Window maximized')
})

win.on('unmaximize', () => {
  console.log('Window unmaximized')
})

win.on('minimize', () => {
  console.log('Window minimized')
})

win.on('restore', () => {
  console.log('Window restored')
})
```

### Example: Window Methods

```javascript
const win = new BrowserWindow({ width: 800, height: 600 })

// Show/Hide
win.show()
win.hide()

// Minimize/Maximize/Restore
win.minimize()
win.maximize()
win.restore()

// Close
win.close()

// Focus
win.focus()
win.blur()

// Position
win.setPosition(100, 100)
const [x, y] = win.getPosition()

// Size
win.setSize(1200, 800)
const [width, height] = win.getSize()

// Center
win.center()

// DevTools
win.webContents.openDevTools()
win.webContents.closeDevTools()
```

### Key Points

- BrowserWindow creates application windows
- Use show: false and ready-to-show event for smooth loading
- webPreferences should have contextIsolation: true
- Never set nodeIntegration: true in renderer
- Use loadFile() for local files, loadURL() for remote
- Handle closed event to clean up references
