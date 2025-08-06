# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Building and Compilation
- `npm run compile` - Compile TypeScript to JavaScript using Gulp
- `npm run watch` - Watch for changes and recompile (parallel client + extensions)
- `npm run watch-client` - Watch and compile client code only
- `npm run watch-extensions` - Watch and compile extensions only

### React Development (Void UI Components)
- `npm run buildreact` - Build React components for Void UI
- `npm run watchreact` - Watch and rebuild React components
- `npm run watchreactd` - Run React watch with daemon (using deemon)

### Testing
- `npm run test-node` - Run Node.js unit tests with Mocha
- `npm run test-browser` - Run browser-based tests with Playwright
- `npm run test-extension` - Run extension tests with vscode-test
- `npm run smoketest` - Run smoke tests for end-to-end validation

### Code Quality
- `npm run eslint` - Run ESLint for JavaScript/TypeScript linting
- `npm run stylelint` - Run Stylelint for CSS/SCSS linting
- `npm run hygiene` - Run code hygiene checks
- `npm run precommit` - Pre-commit hygiene checks

### CLI and Web Development
- `npm run compile-cli` - Compile CLI components
- `npm run watch-cli` - Watch CLI components
- `npm run compile-web` - Compile web version
- `npm run watch-web` - Watch web version

## Architecture Overview

### Core Structure
This is **Void**, a fork of VSCode that integrates AI coding assistance. The codebase follows VSCode's architecture with Void-specific functionality in `src/vs/workbench/contrib/void/`.

### Key Directories
- **`src/vs/workbench/contrib/void/`** - All Void-specific code
  - `browser/` - Browser process code (UI, React components, services)
  - `common/` - Shared code between browser and main processes  
  - `electron-main/` - Main process code (LLM communication, native operations)

### Void Architecture Components

#### Process Architecture
- **Browser Process**: UI, React components, editor widgets, settings
- **Main Process**: LLM providers, file operations, MCP (Model Context Protocol)
- **Communication**: Services bridge browser/main via channels

#### Core Services
- **`sendLLMMessageService`** - Handles LLM provider communication
- **`editCodeService`** - Manages code editing and diff application
- **`voidSettingsService`** - Provider/model configuration management
- **`chatThreadService`** - Chat conversation management
- **`toolsService`** - LLM tool calling (file operations, terminal, etc.)
- **`mcpService`** - Model Context Protocol integration

#### UI Components (React)
- **Sidebar**: Main chat interface (`SidebarChat.tsx`)
- **Quick Edit**: Inline editing widget (`QuickEdit.tsx`)
- **Settings**: Provider/model configuration (`Settings.tsx`)
- **Command Bar**: Context-aware command suggestions (`VoidCommandBar.tsx`)

### LLM Integration Pipeline
1. User input → `chatThreadService`
2. Context gathering → `contextGatheringService`
3. Message formatting → `convertToLLMMessageService`
4. Provider communication → `sendLLMMessageService` (main process)
5. Response processing → `editCodeService` or UI update

### Apply System
- **Fast Apply**: Uses search/replace blocks for targeted edits
- **Slow Apply**: Rewrites entire files
- **DiffZones**: Visual regions showing proposed changes
- **Streaming**: Real-time diff updates during LLM responses

### Key Files for AI Integration
- **`modelCapabilities.ts`** - Model-specific capabilities and limits
- **`prompts.ts`** - System prompts and templates
- **`extractCodeFromResult.ts`** - Parsing LLM responses for code blocks
- **`toolsServiceTypes.ts`** - Available tools for LLM function calling

## Development Workflow

### Setting Up Development Environment
1. `npm install` - Install dependencies
2. `npm run compile` - Initial compilation
3. `npm run watch` - Start file watching for development

### Working with React Components
1. Navigate to `src/vs/workbench/contrib/void/browser/react/`
2. Use `npm run watchreact` for live rebuilding
3. React components are bundled to browser process

### Testing Strategy
- **Unit Tests**: `npm run test-node` for service logic
- **Browser Tests**: `npm run test-browser` for UI components
- **Smoke Tests**: `npm run smoketest` for end-to-end workflows

### Code Style and Quality
- TypeScript strict mode enabled
- ESLint configuration for code consistency
- Pre-commit hooks run hygiene checks
- Follow VSCode contribution patterns for services and actions

## VSCode Integration Patterns

### Services
- Register with `registerSingleton()` for dependency injection
- Use `@IServiceName` in constructors for automatic injection
- Services are singletons available throughout the application

### Actions/Commands
- Register with `registerAction()` for user-accessible commands
- Commands appear in Command Palette (Cmd+Shift+P)
- Use `commandService.executeCommand()` for programmatic execution

### Editor Integration
- **ITextModel**: File content representation
- **ICodeEditor**: Editor instance for text manipulation
- **URI**: Resource identifiers for files and models
- **DiffEditor**: Side-by-side change visualization