# Menu | 菜单

**官方文档**: https://www.electronjs.org/zh/docs/latest/,


## Instructions

This example demonstrates how to use Menu to create application menus and context menus.

### Key Concepts

- Application menu
- Context menu
- Menu items
- Menu roles
- Menu accelerators

### Example: Application Menu

```javascript
const { app, Menu } = require('electron')

const template = [
  {
    label: 'File',
    submenu: [
      {
        label: 'New',
        accelerator: 'CmdOrCtrl+N',
        click: () => {
          console.log('New file')
        }
      },
      {
        label: 'Open',
        accelerator: 'CmdOrCtrl+O',
        click: () => {
          console.log('Open file')
        }
      },
      { type: 'separator' },
      {
        label: 'Exit',
        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
        click: () => {
          app.quit()
        }
      }
    ]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo', label: 'Undo' },
      { role: 'redo', label: 'Redo' },
      { type: 'separator' },
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload', label: 'Reload' },
      { role: 'forceReload', label: 'Force Reload' },
      { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Actual Size' },
      { role: 'zoomIn', label: 'Zoom In' },
      { role: 'zoomOut', label: 'Zoom Out' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Toggle Fullscreen' }
    ]
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize', label: 'Minimize' },
      { role: 'close', label: 'Close' }
    ]
  }
]

// macOS: Add app menu
if (process.platform === 'darwin') {
  template.unshift({
    label: app.getName(),
    submenu: [
      { role: 'about', label: 'About' },
      { type: 'separator' },
      { role: 'services', label: 'Services' },
      { type: 'separator' },
      { role: 'hide', label: 'Hide' },
      { role: 'hideOthers', label: 'Hide Others' },
      { role: 'unhide', label: 'Show All' },
      { type: 'separator' },
      { role: 'quit', label: 'Quit' }
    ]
  })
}

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)
```

### Example: Context Menu

```javascript
const { Menu, MenuItem } = require('electron')

// In preload.js
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  showContextMenu: () => {
    const menu = new Menu()
    
    menu.append(new MenuItem({
      label: 'Copy',
      role: 'copy'
    }))
    
    menu.append(new MenuItem({
      label: 'Paste',
      role: 'paste'
    }))
    
    menu.append(new MenuItem({
      type: 'separator'
    }))
    
    menu.append(new MenuItem({
      label: 'Custom Action',
      click: () => {
        console.log('Custom action clicked')
      }
    }))
    
    menu.popup()
  }
})
```

### Example: Dynamic Menu

```javascript
const { Menu } = require('electron')

function updateMenu(hasFile) {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          enabled: true,
          click: () => createNewFile()
        },
        {
          label: 'Open',
          enabled: true,
          click: () => openFile()
        },
        {
          label: 'Save',
          enabled: hasFile,
          click: () => saveFile()
        }
      ]
    }
  ]
  
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
```

### Key Points

- Use Menu.buildFromTemplate() to create menus
- Use Menu.setApplicationMenu() for app menu
- Use menu.popup() for context menus
- Use role property for standard menu items
- Use accelerator for keyboard shortcuts
- macOS requires special app menu structure
- Context menus should be created in preload or main process
