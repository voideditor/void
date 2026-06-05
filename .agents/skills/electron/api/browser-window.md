# BrowserWindow API | BrowserWindow API

## API Reference

BrowserWindow API for creating and controlling application windows.

### Constructor Options

**Basic:**
- `width`, `height` - Window size
- `minWidth`, `minHeight` - Minimum size
- `maxWidth`, `maxHeight` - Maximum size
- `resizable` - Whether window is resizable
- `movable` - Whether window is movable

**Display:**
- `show` - Show window when created
- `frame` - Show window frame
- `titleBarStyle` - Title bar style (macOS)
- `backgroundColor` - Background color
- `opacity` - Window opacity

**Behavior:**
- `alwaysOnTop` - Keep window on top
- `fullscreen` - Start fullscreen
- `skipTaskbar` - Skip taskbar (Linux/Windows)
- `kiosk` - Kiosk mode

**webPreferences:**
- `preload` - Preload script path
- `nodeIntegration` - Enable Node.js (not recommended)
- `contextIsolation` - Enable context isolation (recommended)
- `sandbox` - Enable sandbox

### Instance Methods

**Content:**
- `loadURL(url[, options])` - Load URL
- `loadFile(filePath[, options])` - Load local file
- `reload()` - Reload window

**Window Control:**
- `show()` - Show window
- `hide()` - Hide window
- `close()` - Close window
- `focus()` - Focus window
- `blur()` - Remove focus

**Size/Position:**
- `setSize(width, height)` - Set size
- `getSize()` - Get size
- `setPosition(x, y)` - Set position
- `getPosition()` - Get position
- `center()` - Center window

**State:**
- `minimize()` - Minimize
- `maximize()` - Maximize
- `restore()` - Restore
- `setFullScreen(flag)` - Set fullscreen

**DevTools:**
- `webContents.openDevTools()` - Open DevTools
- `webContents.closeDevTools()` - Close DevTools

### Instance Events

- `ready-to-show` - Emitted when window is ready
- `closed` - Emitted when window is closed
- `focus` - Emitted when window gains focus
- `blur` - Emitted when window loses focus
- `maximize` - Emitted when maximized
- `unmaximize` - Emitted when unmaximized
- `minimize` - Emitted when minimized
- `restore` - Emitted when restored

### Key Points

- Always set contextIsolation: true
- Never set nodeIntegration: true
- Use preload script for IPC
- Handle ready-to-show for smooth loading
- Clean up window references on closed
- Use webContents for DevTools access
