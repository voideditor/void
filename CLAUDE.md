# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About Void

Void is an open-source AI code editor forked from VSCode. It provides AI agents, checkpoint/visualize changes, and supports any model or local hosting. Most Void-specific code lives in `src/vs/workbench/contrib/void/`.

## Development Commands

### Setup and Build
```bash
# Install dependencies
npm install
# Note: This automatically runs 'npm run postinstall' which installs
# dependencies in subdirectories (build/, extensions/, remote/, etc.)
# If builds fail with missing dependencies, manually run: npm run postinstall

# Start Developer Mode (watch mode for development)
# Press Ctrl+Shift+B (Windows/Linux) or Cmd+Shift+B (Mac) in VSCode/Void
# Or run from terminal:
npm run watch

# Watch only client code
npm run watch-client

# Watch only extensions
npm run watch-extensions

# Build React components (required before running)
npm run buildreact

# Watch React components during development
npm run watchreact

# Background watch modes (run in daemon)
npm run watchd              # Watch all in background
npm run watchreactd         # Watch React in background
npm run kill-watchd         # Stop background watch
npm run restart-watchd      # Restart background watch
```

### Running Void
```bash
# Launch Developer Mode window (after build completes)
./scripts/code.sh         # Mac/Linux
./scripts/code.bat        # Windows

# Launch with isolated user data (recommended for testing)
./scripts/code.sh --user-data-dir ./.tmp/user-data --extensions-dir ./.tmp/extensions
```

### Testing
```bash
# Run browser tests
npm run test-browser

# Run Node tests
npm run test-node

# Run smoke tests
npm run smoketest
```

### Code Quality
```bash
# Run ESLint
npm run eslint

# Run style checks
npm run stylelint

# Run hygiene checks
npm run hygiene
```

## Architecture

### VSCode Foundation

Void is built on VSCode's Electron architecture with two processes:

- **Main Process** (`electron-main/`): Node.js environment, can import node_modules
- **Browser Process** (`browser/`): Renderer process, HTML/DOM access, cannot directly import node_modules
- **Common** (`common/`): Shared code usable by both processes

### Core Void Structure

```
src/vs/workbench/contrib/void/
├── browser/              # UI, services, React components
│   ├── react/           # React UI components (built separately)
│   ├── helpers/         # Browser-side utilities (e.g., findDiffs.ts)
│   ├── helperServices/  # Browser-side helper services (e.g., consistentItemService.ts)
│   ├── actionIDs.ts     # Centralized action/command IDs (prevents import order errors)
│   └── void.contribution.ts  # Entry point - registers all services and features
├── common/              # Shared services and types
│   ├── prompt/          # LLM prompt construction (prompts.ts - 38KB of all prompts)
│   ├── helpers/         # Common utilities (extractCodeFromResult, languageHelpers, etc.)
│   └── modelCapabilities.ts  # Model configuration (57KB - update when new models release)
└── electron-main/       # Main process services
    ├── llmMessage/      # LLM communication handlers
    ├── sendLLMMessageChannel.ts  # IPC channel for LLM communication
    └── mcpChannel.ts    # IPC channel for MCP communication
```

**Key architectural files:**
- `void.contribution.ts`: Entry point that imports and registers all Void features (import order matters!)
- `actionIDs.ts`: Centralized action IDs to prevent import order errors
- `_dummyContrib.ts`: Template for creating new services

### Key Services

Services are singletons registered with `registerSingleton`. Major services include:

- **`voidSettingsService`**: Manages all Void settings (providers, models, features)
- **`chatThreadService`**: Handles chat conversations and message history
- **`editCodeService`**: Manages code edits, diffs, and Apply functionality
- **`toolsService`**: Handles LLM tool execution
- **`terminalToolService`**: Handles terminal command execution with persistent terminals
- **`sendLLMMessageService`**: Communicates with LLM providers
- **`mcpService`**: MCP (Model Context Protocol) server integration
- **`autocompleteService`**: AI-powered code autocomplete
- **`voidModelService`**: Text model and URI management
- **`contextGatheringService`**: Gathers context for LLM requests
- **`convertToLLMMessageService`**: Formats messages for LLM providers

### Creating New Services

Reference `browser/_dummyContrib.ts` as a template for creating services:

1. **Define the interface** with `createDecorator()`:
   ```typescript
   const IMyService = createDecorator<IMyService>('myService');
   ```

2. **Implement the service** extending `Disposable`:
   ```typescript
   class MyService extends Disposable implements IMyService {
     constructor(@IOtherService otherService: IOtherService) {
       super();
     }
   }
   ```

3. **Register the service** (choose one):
   - `registerSingleton(IMyService, MyService, InstantiationType.Delayed)` - Lazy-loaded when first used
   - `registerWorkbenchContribution2(MyService.ID, MyService, WorkbenchPhase.*)` - Early initialization

4. **Import in `void.contribution.ts`** - Import order matters!

**Important**: Many services have companion `*Types.ts` files (e.g., `mcpService.ts` + `mcpServiceTypes.ts`) to keep types separate from implementation.

### IPC/Channel Architecture

Browser and main processes communicate via **Channels** (not direct imports):

- **`sendLLMMessageChannel`** (`electron-main/sendLLMMessageChannel.ts`): LLM API communication
- **`mcpChannel`** (`electron-main/mcpChannel.ts`): MCP server communication

**How Channels work:**
```typescript
// Main process: implements IServerChannel
channel.call('methodName', args)  // Call from browser to main
channel.listen('eventName')       // Listen to events from main

// Events: onText_sendLLMMessage, onFinalMessage_sendLLMMessage, onError_sendLLMMessage
```

This architecture allows the browser process to access node_modules functionality (e.g., API calls) via the main process, bypassing Content Security Policy restrictions.

### LLM Message Pipeline

Messages flow from sidebar → browser process → main process → provider:

1. User sends message in React UI (sidebar)
2. `chatThreadService` processes the message
3. `convertToLLMMessageService` formats for the provider
4. `sendLLMMessageChannel` communicates browser ↔ main process (via IPC)
5. Main process sends to LLM provider (bypasses CSP, uses node_modules)

**Important**: Update `modelCapabilities.ts` when new models are released. This file contains:
- `defaultModelsOfProvider` - all supported models by provider
- Model capabilities and overrides
- Supported providers: Anthropic, OpenAI, Deepseek, Ollama, vLLM, OpenRouter, Gemini, Groq, xAI, Mistral, LM Studio, LiteLLM, Google Vertex, Azure, AWS Bedrock, and more

### MCP Integration

Void supports **Model Context Protocol (MCP)** for extending tool capabilities:

- **`mcpService`** (`common/mcpService.ts`): Main MCP service managing server connections
- **`mcpChannel`** (`electron-main/mcpChannel.ts`): IPC channel for MCP communication with main process
- **Tool name prefixes**: MCP tools have special name prefixes; use `removeMCPToolNamePrefix()` to handle them
- **Configuration**: MCP servers are configured in Void settings

MCP allows Void to integrate external tools and data sources beyond built-in capabilities.

### Apply System

Two Apply modes:

1. **Fast Apply** (Search/Replace): LLM outputs search/replace blocks for targeted edits:
   ```
   <<<<<<< ORIGINAL
   // original code
   =======
   // replaced code
   >>>>>>> UPDATED
   ```
   - Parsed by `extractCodeFromResult.ts` (`common/helpers/`)
   - Retries up to N times if matching fails
   - Falls back to Slow Apply on failure

2. **Slow Apply**: Rewrites entire file

The `editCodeService` handles both modes and is also used for:
- LLM Edit tool calls
- Cmd+K/Ctrl+K quick edits

**DiffZone**: Region tracking red/green diffs with {startLine, endLine}. Streams changes and refreshes when file changes.

### React Components

React code lives in `src/vs/workbench/contrib/void/browser/react/`:

**Build system:**
- Custom build pipeline: `build.js` (supports `--watch` flag)
- Bundler: tsup (configured in `tsup.config.js`)
- Styling: Tailwind CSS with `scope-tailwind` to avoid conflicts with VSCode styles
- Build commands: `npm run buildreact` or `npm run watchreact`
- Compiled output goes to `out/` directory

**Critical rules:**
- ALL imports from outside `react/src/` MUST end with `.js` or build fails
  ```typescript
  import { URI } from '../../../../../../../base/common/uri.js'  // Correct
  import { URI } from '../../../../../../../base/common/uri'     // Will fail
  ```
- Source files must be exactly 1 level deep in `src/` for external detection
- May need increased memory: `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`

## Development Guidelines

### Code Modification Rules

1. **Never modify files outside `src/vs/workbench/contrib/void/`** without consulting the user first
2. **Follow existing conventions**:
   - Use tabs for indentation (not spaces) - see `.editorconfig`
   - Don't add/remove semicolons arbitrarily
   - Follow existing code style in the file you're modifying
3. **Type safety**: Don't cast to `any`. Find and use correct types
4. **Naming convention**: Maps from A→B should be named `bOfA` (e.g., `toolNameOfToolId`, `idOfPersistentTerminalName`)
5. **Action IDs**: Never inline action ID strings
   - Always import from `actionIDs.ts`: `import { VOID_CTRL_L_ACTION_ID } from './actionIDs.js'`
   - This prevents import order errors
   - Available IDs: `VOID_CTRL_L_ACTION_ID`, `VOID_CTRL_K_ACTION_ID`, `VOID_ACCEPT_DIFF_ACTION_ID`, `VOID_REJECT_DIFF_ACTION_ID`, etc.
6. **No validation**: Don't run builds or tests yourself—tell the user what to run

### Prerequisites

- **Node version**: `20.18.2` (see `.nvmrc`)
- **Mac**: Python and XCode (usually pre-installed)
- **Windows**: Visual Studio 2022 with C++ build tools
- **Linux**: `build-essential`, `libx11-dev`, `libxkbfile-dev`, `libsecret-1-dev`, `libkrb5-dev`, `python-is-python3`

### Common Issues

- **Ensure no spaces in path to Void folder** - Build may fail with paths containing spaces
- **Missing dependencies in subdirectories**: If builds fail with module errors, run `npm run postinstall` manually
- **React out of memory**: `NODE_OPTIONS="--max-old-space-size=8192" npm run buildreact`
- **Missing styles after changes**: Wait a few seconds and reload window
- **`Failed to fetch dynamically imported module`**: React imports must end with `.js`
- **Kill build scripts properly**: Use `Ctrl+D` (not `Ctrl+C` which leaves processes running)
  - Alternative: Use daemon commands (`npm run kill-watchd`)
- **Import order errors**: Use centralized `actionIDs.ts` instead of inlining action ID strings

For more detailed troubleshooting, see [BUILD_TROUBLESHOOTING.md](BUILD_TROUBLESHOOTING.md)

### Reloading Changes

After code changes in Developer Mode:
- Press `Ctrl+R` (Windows/Linux) or `Cmd+R` (Mac) to reload the window
- Or `Ctrl+Shift+P` → "Reload Window"

## VSCode Concepts

- **Editor**: The code editing area (one editor can have multiple tabs)
- **Model** (`ITextModel`): Internal representation of file contents, shared between editors
- **URI**: File path/resource identifier
- **Workbench**: Container for editors, terminal, file tree, etc.
- **Actions/Commands**: Registered functions callable via Cmd+Shift+P or `commandService`
- **Services**: Singletons registered with `registerSingleton`, injectable via `@<Service>` in constructors

## Resources

- [VOID_CODEBASE_GUIDE.md](VOID_CODEBASE_GUIDE.md) - Detailed architecture diagrams
- [HOW_TO_CONTRIBUTE.md](HOW_TO_CONTRIBUTE.md) - Setup and contribution guide
- [VSCode Source Code Organization](https://github.com/microsoft/vscode/wiki/Source-Code-Organization)
- [VSCode UI Guide](https://code.visualstudio.com/docs/getstarted/userinterface)
