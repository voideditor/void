# app Module API | app 模块 API

## API Reference

Electron app module API for application lifecycle management.

### app Methods

**Lifecycle:**
- `app.whenReady()` - Returns Promise when app is ready
- `app.quit()` - Quit the application
- `app.exit(exitCode)` - Exit immediately
- `app.relaunch([options])` - Relaunch the app

**Window Management:**
- `app.getPath(name)` - Get system path
- `app.setPath(name, path)` - Set system path
- `app.getVersion()` - Get app version
- `app.getName()` - Get app name
- `app.setName(name)` - Set app name

**Platform:**
- `app.getLocale()` - Get locale
- `app.getLocaleCountryCode()` - Get country code
- `app.isReady()` - Check if app is ready
- `app.isPackaged` - Check if app is packaged

### app Events

- `ready` - Emitted when Electron has finished initializing
- `window-all-closed` - Emitted when all windows are closed
- `before-quit` - Emitted before app quits
- `will-quit` - Emitted when app will quit
- `quit` - Emitted when app quits
- `activate` - Emitted when app is activated (macOS)
- `second-instance` - Emitted when second instance is launched

### Example: Basic Usage

```javascript
const { app, BrowserWindow } = require('electron')

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

### Example: Single Instance

```javascript
const { app } = require('electron')

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Focus existing window
  })
}
```

### Key Points

- Use app.whenReady() before creating windows
- Handle window-all-closed for proper quit
- macOS requires activate event handling
- Use requestSingleInstanceLock() for single instance
- app has full Node.js access
- Get system paths with app.getPath()
