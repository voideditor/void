# Packaging | 打包

**官方文档**: https://www.electronjs.org/zh/docs/latest/,


## Instructions

This example demonstrates how to package Electron applications for distribution.

### Key Concepts

- Using Electron Forge
- Using electron-builder
- Platform-specific builds
- Code signing
- Auto-updater integration

### Example: Electron Forge Setup

```bash
# Initialize with Electron Forge
npm create electron-app@latest my-app

# Or add to existing project
npx @electron-forge/cli import
```

### Example: Electron Forge Configuration

```json
// package.json
{
  "name": "my-app",
  "version": "1.0.0",
  "main": ".vite/build/main.js",
  "scripts": {
    "start": "electron-forge start",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "publish": "electron-forge publish"
  },
  "config": {
    "forge": {
      "packagerConfig": {
        "name": "My App",
        "icon": "./assets/icon"
      },
      "makers": [
        {
          "name": "@electron-forge/maker-squirrel",
          "config": {
            "name": "my_app"
          }
        },
        {
          "name": "@electron-forge/maker-zip",
          "platforms": ["darwin"]
        },
        {
          "name": "@electron-forge/maker-deb",
          "config": {}
        },
        {
          "name": "@electron-forge/maker-rpm",
          "config": {}
        }
      ]
    }
  }
}
```

### Example: electron-builder Setup

```json
// package.json
{
  "name": "my-app",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "build": "electron-builder",
    "build:win": "electron-builder --win",
    "build:mac": "electron-builder --mac",
    "build:linux": "electron-builder --linux"
  },
  "build": {
    "appId": "com.example.myapp",
    "productName": "My App",
    "directories": {
      "output": "dist"
    },
    "files": [
      "main.js",
      "preload.js",
      "renderer/**/*",
      "package.json"
    ],
    "win": {
      "target": "nsis",
      "icon": "build/icon.ico"
    },
    "mac": {
      "target": "dmg",
      "icon": "build/icon.icns",
      "category": "public.app-category.utilities"
    },
    "linux": {
      "target": "AppImage",
      "icon": "build/icon.png"
    }
  }
}
```

### Example: Build Commands

```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:win
npm run build:mac
npm run build:linux

# Build all platforms
npm run build -- --win --mac --linux
```

### Key Points

- Electron Forge is recommended for new projects
- electron-builder is popular and flexible
- Configure platform-specific settings
- Include only necessary files in build
- Set proper app ID and product name
- Use icons for each platform
- Code signing required for distribution
- Test builds on target platforms
