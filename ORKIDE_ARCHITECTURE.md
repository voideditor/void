# Orkide IDE Architecture Documentation

## Overview

Orkide IDE is a comprehensive AI-powered code editor built on the VS Code foundation, featuring advanced context awareness, multi-agent orchestration, retrieval-augmented generation (RAG), and intelligent planning capabilities. This document outlines the architectural design, implementation details, and integration patterns for the Orkide-specific features.

## Table of Contents

1. [Rebranding Changes](#rebranding-changes)
2. [Core Architecture](#core-architecture)
3. [Advanced Context Awareness](#advanced-context-awareness)
4. [Multi-Agent Orchestration](#multi-agent-orchestration)
5. [RAG (Retrieval-Augmented Generation)](#rag-retrieval-augmented-generation)
6. [Planning Mode](#planning-mode)
7. [Service Registration](#service-registration)
8. [Integration Patterns](#integration-patterns)
9. [Implementation Roadmap](#implementation-roadmap)
10. [File Structure](#file-structure)

## Rebranding Changes

### Completed Rebranding Tasks

1. **Directory Structure**
   - Renamed `src/vs/workbench/contrib/void/` → `src/vs/workbench/contrib/orkide/`
   - Updated all import paths and references

2. **Product Configuration**
   - Updated `product.json`:
     - `nameShort`: "Orkide"
     - `nameLong`: "Orkide IDE"
     - `applicationName`: "orkide"
     - `dataFolderName`: ".orkide"
     - `serverDataFolderName`: ".orkide-server"
     - `downloadUrl`: Updated to Orkide URLs
     - `updateUrl`: Updated to Orkide URLs

3. **Service Interfaces and Classes**
   - Renamed all service interfaces: `IVoid*` → `IOrkide*`
   - Renamed all service classes: `Void*` → `Orkide*`
   - Updated service identifiers and registration names

4. **CSS and Styling**
   - Renamed `void.css` → `orkide.css`
   - Updated CSS class prefixes: `void-*` → `orkide-*`
   - Updated CSS custom properties: `--vscode-void-*` → `--vscode-orkide-*`

5. **Storage Keys and Constants**
   - Updated storage keys: `void.*` → `orkide.*`
   - Updated constant names: `VOID_*` → `ORKIDE_*`

6. **Resource Files**
   - Renamed icon files: `void-icon-sm.png` → `orkide-icon-sm.png`
   - Renamed image assets: `slice_of_void.png` → `slice_of_orkide.png`
   - Updated desktop files and AppImage resources
   - Renamed icon directory: `void_icons/` → `orkide_icons/`

7. **Build Configuration**
   - Updated `package.json` scripts for React build paths
   - Updated resource references in CSS files

## Core Architecture

### Service-Based Architecture

Orkide follows VS Code's service-based architecture pattern, where each major feature is implemented as a service that can be injected into other components. The core services are:

1. **IOrkideContextAwarenessService** - Manages context data and monitoring
2. **IOrkideMultiAgentService** - Orchestrates AI agents for task execution
3. **IOrkideRAGService** - Handles knowledge base management and retrieval
4. **IOrkidePlanningService** - Manages project planning and execution

### Dependency Graph

```
IOrkidePlanningService
├── IOrkideContextAwarenessService
└── IOrkideMultiAgentService
    └── IOrkideContextAwarenessService

IOrkideRAGService
├── IFileService
└── ILanguageService

IOrkideContextAwarenessService
├── IEditorService
├── IWorkspaceContextService
├── IFileService
└── ILanguageService
```

## Advanced Context Awareness

### Purpose
The Context Awareness service provides intelligent understanding of the current development context, including active files, project structure, recent changes, and semantic relationships.

### Key Components

#### IContextData Interface
```typescript
interface IContextData {
    activeFile?: URI;
    selectedText?: string;
    cursorPosition?: { line: number; column: number };
    openFiles: URI[];
    workspaceRoot?: URI;
    gitBranch?: string;
    recentChanges: IFileChange[];
    dependencies: IDependency[];
    projectStructure: IProjectStructure;
}
```

#### Core Capabilities
- **Real-time Context Monitoring**: Tracks editor changes, file operations, and workspace modifications
- **Semantic Analysis**: Extracts symbols, imports, exports, and relationships from code files
- **Project Structure Analysis**: Analyzes directory structure, file types, and language distribution
- **Change Tracking**: Monitors recent file modifications and their impact

#### Integration Points
- **Editor Service**: Monitors active editor and selection changes
- **Workspace Service**: Tracks workspace folder changes
- **File Service**: Monitors file system operations
- **Language Service**: Provides language-specific analysis

### Implementation Details

**File Location**: `src/vs/workbench/contrib/orkide/browser/contextAwareness/`

**Key Files**:
- `contextAwarenessService.ts` - Service interface definitions
- `contextAwarenessServiceImpl.ts` - Implementation with VS Code integration
- `contextAwarenessServiceRegistration.ts` - Service registration

**Service Registration**:
```typescript
registerSingleton(IOrkideContextAwarenessService, OrkideContextAwarenessService, InstantiationType.Eager);
```

## Multi-Agent Orchestration

### Purpose
The Multi-Agent service coordinates multiple AI agents to work collaboratively on complex development tasks, each specialized for different aspects of software development.

### Key Components

#### Agent System
```typescript
interface IAgent {
    id: string;
    name: string;
    specialization: AgentSpecialization;
    capabilities: string[];
    status: AgentStatus;
    priority: number;
}
```

#### Task Management
```typescript
interface ITask {
    id: string;
    type: TaskType;
    priority: TaskPriority;
    context: ITaskContext;
    assignedAgents: string[];
    status: TaskStatus;
    result?: ITaskResult;
}
```

#### Default Agents
1. **Code Generator** - Specializes in creating new code
2. **Code Reviewer** - Reviews code quality and best practices
3. **Test Engineer** - Creates and maintains test suites
4. **Debugger** - Identifies and fixes bugs
5. **Documentation Specialist** - Creates and maintains documentation

#### Orchestration Strategy
- **Agent Selection**: Matches agents to tasks based on specialization and availability
- **Task Coordination**: Manages task dependencies and execution order
- **Result Aggregation**: Combines outputs from multiple agents

### Implementation Details

**File Location**: `src/vs/workbench/contrib/orkide/browser/multiAgent/`

**Key Files**:
- `multiAgentService.ts` - Service interface and type definitions
- `multiAgentServiceImpl.ts` - Implementation with orchestration logic
- `multiAgentServiceRegistration.ts` - Service registration

**Dependencies**:
- IOrkideContextAwarenessService for task context

## RAG (Retrieval-Augmented Generation)

### Purpose
The RAG service provides intelligent knowledge retrieval and generation capabilities, allowing the IDE to leverage existing codebase knowledge and documentation for enhanced AI responses.

### Key Components

#### Knowledge Base Management
```typescript
interface IKnowledgeBase {
    id: string;
    name: string;
    type: KnowledgeBaseType;
    sources: IKnowledgeSource[];
    isIndexed: boolean;
}
```

#### Document Processing
- **Chunking Strategy**: Breaks documents into semantic chunks
- **Embedding Generation**: Creates vector embeddings for similarity search
- **Metadata Extraction**: Extracts symbols, imports, and structural information

#### Retrieval System
- **Semantic Search**: Finds relevant code and documentation
- **Context Filtering**: Applies filters based on language, file type, and recency
- **Relevance Scoring**: Ranks results by relevance to the query

#### Generation Pipeline
- **Context Assembly**: Combines retrieved chunks with user query
- **Response Generation**: Generates contextually-aware responses
- **Reference Tracking**: Maintains links to source materials

### Implementation Details

**File Location**: `src/vs/workbench/contrib/orkide/browser/rag/`

**Key Files**:
- `ragService.ts` - Service interface and type definitions
- `ragServiceImpl.ts` - Implementation with indexing and retrieval logic
- `ragServiceRegistration.ts` - Service registration

**Dependencies**:
- IFileService for file operations
- ILanguageService for language detection

## Planning Mode

### Purpose
The Planning service provides intelligent project planning capabilities, breaking down complex development tasks into manageable steps with proper dependency management and execution tracking.

### Key Components

#### Plan Structure
```typescript
interface IPlan {
    id: string;
    title: string;
    objective: string;
    status: PlanStatus;
    steps: IPlanStep[];
    context: IPlanContext;
    metadata: IPlanMetadata;
}
```

#### Step Management
```typescript
interface IPlanStep {
    id: string;
    type: StepType;
    status: StepStatus;
    dependencies: string[];
    validation: IStepValidation;
    resources: IStepResource[];
}
```

#### Plan Templates
- **Feature Development**: Standard template for new features
- **Bug Fix**: Template for debugging and fixing issues
- **Refactoring**: Template for code improvement tasks
- **Testing**: Template for test creation and maintenance

#### Execution Engine
- **Dependency Resolution**: Ensures proper step execution order
- **Progress Tracking**: Monitors plan execution progress
- **Validation**: Verifies step completion criteria
- **Agent Integration**: Delegates steps to appropriate agents

### Implementation Details

**File Location**: `src/vs/workbench/contrib/orkide/browser/planning/`

**Key Files**:
- `planningService.ts` - Service interface and type definitions
- `planningServiceImpl.ts` - Implementation with planning logic
- `planningServiceRegistration.ts` - Service registration

**Dependencies**:
- IOrkideContextAwarenessService for context information
- IOrkideMultiAgentService for step execution

## Service Registration

### Registration Pattern
All Orkide services follow VS Code's service registration pattern:

```typescript
import { registerSingleton, InstantiationType } from 'vs/platform/instantiation/common/extensions';
import { IServiceInterface } from './serviceInterface';
import { ServiceImplementation } from './serviceImplementation';

registerSingleton(IServiceInterface, ServiceImplementation, InstantiationType.Eager);
```

### Service Lifecycle
- **Eager Instantiation**: Services are created immediately when the workbench starts
- **Singleton Pattern**: Only one instance of each service exists
- **Dependency Injection**: Services receive their dependencies through constructor injection

### Registration Files
- `contextAwarenessServiceRegistration.ts`
- `multiAgentServiceRegistration.ts`
- `ragServiceRegistration.ts`
- `planningServiceRegistration.ts`

## Integration Patterns

### Event-Driven Communication
Services communicate through VS Code's event system:

```typescript
readonly onDidChangeContext: Event<IContextData>;
readonly onDidChangeAgents: Event<IAgent[]>;
readonly onDidChangePlans: Event<IPlan[]>;
```

### Service Injection
Services are injected using VS Code's dependency injection system:

```typescript
constructor(
    @IOrkideContextAwarenessService private readonly contextService: IOrkideContextAwarenessService,
    @IOrkideMultiAgentService private readonly multiAgentService: IOrkideMultiAgentService
) {
    super();
}
```

### Cross-Service Integration
- **Context → Multi-Agent**: Provides task context for agent execution
- **Multi-Agent → Planning**: Executes plan steps through agent orchestration
- **RAG → All Services**: Provides knowledge retrieval for enhanced responses
- **Planning → Context**: Uses workspace context for plan generation

## Implementation Roadmap

### Phase 1: Rebranding (✅ Completed)
- [x] Rename directories and files
- [x] Update service interfaces and classes
- [x] Modify product configuration
- [x] Update CSS and styling
- [x] Rename resource files
- [x] Update storage keys and constants

### Phase 2: Advanced Context Awareness (✅ Completed)
- [x] Implement context data structures
- [x] Create context monitoring service
- [x] Integrate with editor and workspace services
- [x] Add semantic analysis capabilities
- [x] Register service in contribution system

### Phase 3: Multi-Agent Orchestration (✅ Completed)
- [x] Define agent and task interfaces
- [x] Implement agent management system
- [x] Create orchestration strategies
- [x] Add default agent implementations
- [x] Integrate with context service

### Phase 4: RAG Implementation (✅ Completed)
- [x] Design knowledge base structure
- [x] Implement document indexing system
- [x] Create retrieval algorithms
- [x] Add generation pipeline
- [x] Integrate with file and language services

### Phase 5: Planning Mode (✅ Completed)
- [x] Define plan and step structures
- [x] Implement plan generation logic
- [x] Create execution engine
- [x] Add plan templates
- [x] Integrate with multi-agent system

### Phase 6: UI Integration (Pending)
- [ ] Create context awareness panel
- [ ] Add multi-agent dashboard
- [ ] Implement RAG knowledge base UI
- [ ] Create planning mode interface
- [ ] Add settings and configuration panels

### Phase 7: Testing and Optimization (Pending)
- [ ] Unit tests for all services
- [ ] Integration tests
- [ ] Performance optimization
- [ ] Memory usage optimization
- [ ] Error handling improvements

## File Structure

```
src/vs/workbench/contrib/orkide/
├── browser/
│   ├── contextAwareness/
│   │   ├── contextAwarenessService.ts
│   │   ├── contextAwarenessServiceImpl.ts
│   │   └── contextAwarenessServiceRegistration.ts
│   ├── multiAgent/
│   │   ├── multiAgentService.ts
│   │   ├── multiAgentServiceImpl.ts
│   │   └── multiAgentServiceRegistration.ts
│   ├── rag/
│   │   ├── ragService.ts
│   │   ├── ragServiceImpl.ts
│   │   └── ragServiceRegistration.ts
│   ├── planning/
│   │   ├── planningService.ts
│   │   ├── planningServiceImpl.ts
│   │   └── planningServiceRegistration.ts
│   ├── media/
│   │   └── orkide.css
│   └── orkide.contribution.ts
├── common/
│   ├── storageKeys.ts
│   └── [existing common files...]
└── electron-main/
    └── [existing electron-main files...]
```

## Configuration and Settings

### Storage Keys
All Orkide-specific storage uses the `orkide.*` prefix:
- `orkide.settingsServiceStorageII` - Settings storage
- `orkide.chatThreadStorageII` - Chat thread storage
- `orkide.app.optOutAll` - Opt-out preferences

### CSS Classes
All CSS classes use the `orkide-*` prefix:
- `.orkide-sidebar` - Main sidebar styling
- `.orkide-chat-container` - Chat interface styling
- `.orkide-settings-pane` - Settings panel styling

### Service Identifiers
All service identifiers follow the pattern:
- `orkideContextAwarenessService`
- `orkideMultiAgentService`
- `orkideRAGService`
- `orkidePlanningService`

## Conclusion

The Orkide IDE architecture provides a comprehensive foundation for AI-powered development tools. The modular service-based design ensures maintainability and extensibility, while the integration with VS Code's existing systems provides a solid foundation for advanced features.

The rebranding from Void to Orkide has been completed successfully, and the four core advanced features (Context Awareness, Multi-Agent Orchestration, RAG, and Planning Mode) have been implemented with proper service registration and integration patterns.

Future development should focus on UI implementation, testing, and performance optimization to create a production-ready AI-powered IDE experience.