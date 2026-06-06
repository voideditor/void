/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';

export const IOrkideContextAwarenessService = createDecorator<IOrkideContextAwarenessService>('orkideContextAwarenessService');

export interface IContextData {
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

export interface IFileChange {
	file: URI;
	type: 'added' | 'modified' | 'deleted';
	timestamp: number;
	lines?: { added: number; removed: number };
}

export interface IDependency {
	name: string;
	version: string;
	type: 'npm' | 'pip' | 'maven' | 'nuget' | 'other';
}

export interface IProjectStructure {
	directories: string[];
	fileTypes: { [extension: string]: number };
	totalFiles: number;
	languages: string[];
}

export interface IOrkideContextAwarenessService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when context data changes
	 */
	readonly onDidChangeContext: Event<IContextData>;

	/**
	 * Get current context data
	 */
	getContextData(): Promise<IContextData>;

	/**
	 * Update context data manually
	 */
	updateContext(data: Partial<IContextData>): void;

	/**
	 * Start monitoring context changes
	 */
	startMonitoring(): IDisposable;

	/**
	 * Get context for a specific file
	 */
	getFileContext(uri: URI): Promise<IFileContext>;

	/**
	 * Get semantic context (symbols, imports, etc.)
	 */
	getSemanticContext(uri: URI): Promise<ISemanticContext>;
}

export interface IFileContext {
	uri: URI;
	language: string;
	size: number;
	lastModified: number;
	imports: string[];
	exports: string[];
	functions: ISymbolInfo[];
	classes: ISymbolInfo[];
	variables: ISymbolInfo[];
}

export interface ISemanticContext {
	symbols: ISymbolInfo[];
	references: IReference[];
	dependencies: string[];
	relatedFiles: URI[];
}

export interface ISymbolInfo {
	name: string;
	kind: string;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	documentation?: string;
}

export interface IReference {
	uri: URI;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	isDefinition: boolean;
}