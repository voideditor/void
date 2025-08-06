# IMPORTANT RULES FOR THIS PROJECT - MUST READ

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
```

## Development Workflow

### 1. Making Changes
- NEVER edit files in `src/` directory directly
- Create override files in `okds/overrides/`
- Use patch scripts in `okds/patches/` to apply changes

### 2. Applying Changes
```bash
cd okds
npm run apply-patches
cd ..
npm run compile
.\scripts\code.bat
```

### 3. Testing Without Compilation
Use runtime patches in browser console:
1. Open VS Code/Void
2. Press Ctrl+Shift+I (Developer Tools)
3. Paste code from `okds/runtime-patches/*.js`

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
- Always work in okds folder, never in src folder