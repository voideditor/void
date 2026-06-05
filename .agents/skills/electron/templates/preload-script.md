# Preload Script Template | Preload 脚本模板

## Basic Preload Script

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Get app version
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  
  // File operations
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (data) => ipcRenderer.invoke('dialog:saveFile', data),
  
  // Listen to main process
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, data) => callback(data))
  },
  
  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
```

## Advanced Preload Script

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron')

// Expose API with error handling
contextBridge.exposeInMainWorld('electronAPI', {
  // Safe IPC invoke
  invoke: async (channel, ...args) => {
    const validChannels = [
      'get-app-version',
      'dialog:openFile',
      'dialog:saveFile'
    ]
    
    if (validChannels.includes(channel)) {
      return await ipcRenderer.invoke(channel, ...args)
    }
    throw new Error(`Invalid channel: ${channel}`)
  },
  
  // Safe IPC send
  send: (channel, ...args) => {
    const validChannels = [
      'window-minimize',
      'window-maximize',
      'window-close'
    ]
    
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },
  
  // Safe event listener
  on: (channel, callback) => {
    const validChannels = ['update-available', 'app-version']
    
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args))
    }
  },
  
  // Remove listener
  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback)
  }
})
```
