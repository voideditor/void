# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚨 CRITICAL: DO NOT MODIFY ORIGINAL VOID FILES

This is a FORK of Void (VS Code) open source project. The original files MUST NOT be modified directly because:
1. Void is regularly updated from upstream
2. Direct modifications will cause merge conflicts
3. All customizations must be in the `okds` folder

## Project Structure

```
dsCodeAssistant/
├── src/                    # ⛔ DO NOT MODIFY - Original Void source
├── out/                    # ⛔ DO NOT MODIFY - Compiled output
├── okds/                   # ✅ ALL CUSTOMIZATIONS GO HERE
│   ├── overrides/          # Override files that replace originals
│   ├── patches/            # Patch scripts to apply overrides
│   ├── runtime-patches/    # Browser console patches for testing
│   └── scripts/            # Build and apply scripts
├── build/                  # Build system (Gulp-based)
├── extensions/             # Built-in VS Code extensions
└── scripts/                # Launch scripts (code.bat, code.sh)
```

## Essential Build Commands

### Complete Build Process
```bash
# 1. Install dependencies (if needed)
npm install

# 2. Build React components (REQUIRED for UI)
npm run buildreact

# 3. Compile the main project
npm run compile

# 4. Run Void
.\scripts\code.bat  # Windows
./scripts/code.sh   # Unix
```

### Development Workflow

#### Watch Mode (Auto-rebuild on changes)
```bash
# Terminal 1: Watch React components
npm run watchreact

# Terminal 2: Watch main code
npm run watch

# Terminal 3: Run Void
.\scripts\code.bat
```

#### Common Build Issues and Solutions

1. **UI/Chat panel broken**: React components not built
   ```bash
   npm run buildreact
   ```

2. **source-map module errors**: Version incompatibility in build/
   ```bash
   cd build && npm install source-map@0.6.1
   ```

3. **@parcel/watcher errors**: Native module issues
   ```bash
   # Remove and reinstall
   rmdir /s /q node_modules\@parcel
   npm install
   ```

4. **Memory errors during build**: Increase Node memory
   ```bash
   node --max-old-space-size=8192 ./node_modules/gulp/bin/gulp.js compile
   ```

## React Components Architecture

Located in `src/vs/workbench/contrib/void/browser/react/`:

- **Build System**: TSUP bundler with Tailwind CSS (scoped with "void-" prefix)
- **Build Output**: `src/vs/workbench/contrib/void/browser/react/out/`
- **Components**: sidebar-tsx, quick-edit-tsx, void-settings-tsx, void-editor-widgets-tsx

React build process:
1. Tailwind processes src/ → src2/ with void-scoped classes
2. TSUP bundles from src2/ → out/
3. Output integrated into VS Code's module system

## Key Void Services

Main Void functionality in `src/vs/workbench/contrib/void/`:

- **browser/**: Frontend services and UI
  - `editCodeService.ts`: Code modification engine
  - `sendLLMMessageService.ts`: AI provider communication
  - `voidSettingsService.ts`: Configuration management
- **common/**: Shared utilities and types
- **electron-main/**: Main process services (LLM communication)

## Development Tips

### Making Changes (okds System)
- NEVER edit files in `src/` directory directly
- Create override files in `okds/overrides/`
- Use patch scripts in `okds/patches/` to apply changes

### Testing Without Full Rebuild
Use runtime patches in browser console:
1. Open Void (.\scripts\code.bat)
2. Press Ctrl+Shift+I (Developer Tools)
3. Paste code from `okds/runtime-patches/*.js`

### Running Tests
```bash
npm run test-node        # Node.js tests
npm run test-browser     # Browser tests
npm run test-extension   # Extension tests
```

## Platform-Specific Notes

### Windows
- Use `.bat` scripts in scripts/ folder
- PowerShell may require execution policy changes
- Use `rmdir /s /q` for removing directories

### WSL/Docker
- DevContainer configuration available but may have issues
- Ensure sufficient memory allocation (10GB+ recommended)
- File system permissions can cause npm install failures

## Current Customizations

### Drag & Drop File Attachments
- Goal: Make drag & drop work like @ mentions (actual attachments, not text)
- Files:
  - `okds/overrides/chatDragAndDrop.ts` - Main implementation
  - `okds/patches/chatDragAndDrop.patch.cjs` - Applies the override
  - `okds/runtime-patches/void-dragdrop-attachment.js` - Quick testing

## Remember
- okds = "OK's Customizations" 
- This keeps customizations separate from upstream Void updates
- Always run `npm run buildreact` after fresh clone or when UI appears broken
- Check `src/vs/workbench/contrib/void/browser/react/out/` exists for working UI