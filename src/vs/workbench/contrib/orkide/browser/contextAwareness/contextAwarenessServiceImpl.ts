/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IFileService } from 'vs/platform/files/common/files';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { 
	IOrkideContextAwarenessService, 
	IContextData, 
	IFileContext, 
	ISemanticContext,
	IFileChange,
	IDependency,
	IProjectStructure,
	ISymbolInfo,
	IReference
} from './contextAwarenessService';

export class OrkideContextAwarenessService extends Disposable implements IOrkideContextAwarenessService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeContext = this._register(new Emitter<IContextData>());
	readonly onDidChangeContext: Event<IContextData> = this._onDidChangeContext.event;

	private _contextData: IContextData = {
		openFiles: [],
		recentChanges: [],
		dependencies: [],
		projectStructure: {
			directories: [],
			fileTypes: {},
			totalFiles: 0,
			languages: []
		}
	};

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super();
		this._initialize();
	}

	private _initialize(): void {
		// Listen to editor changes
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this._updateActiveFileContext();
		}));

		// Listen to workspace changes
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._updateWorkspaceContext();
		}));

		// Initial context update
		this._updateActiveFileContext();
		this._updateWorkspaceContext();
	}

	async getContextData(): Promise<IContextData> {
		await this._refreshContextData();
		return { ...this._contextData };
	}

	updateContext(data: Partial<IContextData>): void {
		this._contextData = { ...this._contextData, ...data };
		this._onDidChangeContext.fire(this._contextData);
	}

	startMonitoring() {
		// Already monitoring through constructor listeners
		return this;
	}

	async getFileContext(uri: URI): Promise<IFileContext> {
		const stat = await this.fileService.stat(uri);
		const content = await this.fileService.readFile(uri);
		const language = this.languageService.guessLanguageIdByFilepathOrFirstLine(uri);

		// Basic parsing for imports/exports (simplified)
		const text = content.value.toString();
		const imports = this._extractImports(text, language || '');
		const exports = this._extractExports(text, language || '');
		const functions = this._extractFunctions(text, language || '');
		const classes = this._extractClasses(text, language || '');
		const variables = this._extractVariables(text, language || '');

		return {
			uri,
			language: language || 'plaintext',
			size: stat.size,
			lastModified: stat.mtime,
			imports,
			exports,
			functions,
			classes,
			variables
		};
	}

	async getSemanticContext(uri: URI): Promise<ISemanticContext> {
		// This would integrate with language servers for real semantic analysis
		// For now, return basic structure
		return {
			symbols: [],
			references: [],
			dependencies: [],
			relatedFiles: []
		};
	}

	private async _refreshContextData(): Promise<void> {
		const activeEditor = this.editorService.activeEditor;
		const workspace = this.workspaceContextService.getWorkspace();

		this._contextData.activeFile = activeEditor?.resource;
		this._contextData.workspaceRoot = workspace.folders[0]?.uri;
		this._contextData.openFiles = this.editorService.editors.map(e => e.resource).filter(r => !!r) as URI[];

		// Update project structure
		if (this._contextData.workspaceRoot) {
			this._contextData.projectStructure = await this._analyzeProjectStructure(this._contextData.workspaceRoot);
		}
	}

	private _updateActiveFileContext(): void {
		const activeEditor = this.editorService.activeEditor;
		if (activeEditor?.resource) {
			this._contextData.activeFile = activeEditor.resource;
			this._onDidChangeContext.fire(this._contextData);
		}
	}

	private _updateWorkspaceContext(): void {
		const workspace = this.workspaceContextService.getWorkspace();
		this._contextData.workspaceRoot = workspace.folders[0]?.uri;
		this._onDidChangeContext.fire(this._contextData);
	}

	private async _analyzeProjectStructure(workspaceRoot: URI): Promise<IProjectStructure> {
		try {
			const children = await this.fileService.resolve(workspaceRoot);
			const structure: IProjectStructure = {
				directories: [],
				fileTypes: {},
				totalFiles: 0,
				languages: []
			};

			if (children.children) {
				for (const child of children.children) {
					if (child.isDirectory) {
						structure.directories.push(child.name);
					} else {
						structure.totalFiles++;
						const ext = child.name.split('.').pop() || '';
						structure.fileTypes[ext] = (structure.fileTypes[ext] || 0) + 1;
						
						const language = this.languageService.guessLanguageIdByFilepathOrFirstLine(child.resource);
						if (language && !structure.languages.includes(language)) {
							structure.languages.push(language);
						}
					}
				}
			}

			return structure;
		} catch (error) {
			return {
				directories: [],
				fileTypes: {},
				totalFiles: 0,
				languages: []
			};
		}
	}

	private _extractImports(text: string, language: string): string[] {
		const imports: string[] = [];
		
		if (language === 'typescript' || language === 'javascript') {
			const importRegex = /import\s+.*?\s+from\s+['"`]([^'"`]+)['"`]/g;
			let match;
			while ((match = importRegex.exec(text)) !== null) {
				imports.push(match[1]);
			}
		} else if (language === 'python') {
			const importRegex = /(?:from\s+(\S+)\s+)?import\s+([^\n]+)/g;
			let match;
			while ((match = importRegex.exec(text)) !== null) {
				imports.push(match[1] || match[2]);
			}
		}

		return imports;
	}

	private _extractExports(text: string, language: string): string[] {
		const exports: string[] = [];
		
		if (language === 'typescript' || language === 'javascript') {
			const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g;
			let match;
			while ((match = exportRegex.exec(text)) !== null) {
				exports.push(match[1]);
			}
		}

		return exports;
	}

	private _extractFunctions(text: string, language: string): ISymbolInfo[] {
		const functions: ISymbolInfo[] = [];
		
		if (language === 'typescript' || language === 'javascript') {
			const functionRegex = /(?:function\s+(\w+)|(\w+)\s*:\s*\([^)]*\)\s*=>|(\w+)\s*\([^)]*\)\s*\{)/g;
			let match;
			while ((match = functionRegex.exec(text)) !== null) {
				const name = match[1] || match[2] || match[3];
				if (name) {
					functions.push({
						name,
						kind: 'function',
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
					});
				}
			}
		}

		return functions;
	}

	private _extractClasses(text: string, language: string): ISymbolInfo[] {
		const classes: ISymbolInfo[] = [];
		
		if (language === 'typescript' || language === 'javascript') {
			const classRegex = /class\s+(\w+)/g;
			let match;
			while ((match = classRegex.exec(text)) !== null) {
				classes.push({
					name: match[1],
					kind: 'class',
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
				});
			}
		}

		return classes;
	}

	private _extractVariables(text: string, language: string): ISymbolInfo[] {
		const variables: ISymbolInfo[] = [];
		
		if (language === 'typescript' || language === 'javascript') {
			const varRegex = /(?:const|let|var)\s+(\w+)/g;
			let match;
			while ((match = varRegex.exec(text)) !== null) {
				variables.push({
					name: match[1],
					kind: 'variable',
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
				});
			}
		}

		return variables;
	}
}