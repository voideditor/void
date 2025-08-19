/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';

export const IOrkideRAGService = createDecorator<IOrkideRAGService>('orkideRAGService');

export interface IKnowledgeBase {
	id: string;
	name: string;
	description: string;
	type: KnowledgeBaseType;
	sources: IKnowledgeSource[];
	lastUpdated: number;
	documentCount: number;
	isIndexed: boolean;
}

export enum KnowledgeBaseType {
	Codebase = 'codebase',
	Documentation = 'documentation',
	External = 'external',
	Custom = 'custom'
}

export interface IKnowledgeSource {
	id: string;
	type: SourceType;
	uri: URI;
	metadata: ISourceMetadata;
	lastIndexed?: number;
	status: IndexStatus;
}

export enum SourceType {
	File = 'file',
	Directory = 'directory',
	Git = 'git',
	Web = 'web',
	API = 'api',
	Database = 'database'
}

export enum IndexStatus {
	Pending = 'pending',
	Indexing = 'indexing',
	Indexed = 'indexed',
	Failed = 'failed',
	Outdated = 'outdated'
}

export interface ISourceMetadata {
	language?: string;
	fileType?: string;
	size?: number;
	lastModified?: number;
	tags?: string[];
	priority?: number;
}

export interface IDocument {
	id: string;
	content: string;
	metadata: IDocumentMetadata;
	embedding?: number[];
	chunks: IDocumentChunk[];
}

export interface IDocumentMetadata {
	source: string;
	uri: URI;
	title?: string;
	author?: string;
	language?: string;
	tags?: string[];
	createdAt: number;
	updatedAt: number;
}

export interface IDocumentChunk {
	id: string;
	content: string;
	startIndex: number;
	endIndex: number;
	embedding?: number[];
	metadata: IChunkMetadata;
}

export interface IChunkMetadata {
	type: ChunkType;
	importance: number;
	context?: string;
	symbols?: string[];
}

export enum ChunkType {
	Code = 'code',
	Comment = 'comment',
	Documentation = 'documentation',
	Test = 'test',
	Configuration = 'configuration'
}

export interface IRetrievalQuery {
	query: string;
	context?: string;
	filters?: IRetrievalFilters;
	maxResults?: number;
	threshold?: number;
}

export interface IRetrievalFilters {
	knowledgeBases?: string[];
	sources?: string[];
	languages?: string[];
	fileTypes?: string[];
	tags?: string[];
	dateRange?: { start: number; end: number };
}

export interface IRetrievalResult {
	chunks: IRetrievedChunk[];
	totalResults: number;
	queryTime: number;
}

export interface IRetrievedChunk {
	chunk: IDocumentChunk;
	document: IDocument;
	score: number;
	relevanceReason: string;
}

export interface IGenerationContext {
	query: string;
	retrievedChunks: IRetrievedChunk[];
	userContext?: any;
	constraints?: IGenerationConstraints;
}

export interface IGenerationConstraints {
	maxLength?: number;
	style?: 'formal' | 'casual' | 'technical';
	includeReferences?: boolean;
	language?: string;
}

export interface IGenerationResult {
	content: string;
	references: IReference[];
	confidence: number;
	metadata: IGenerationMetadata;
}

export interface IReference {
	source: string;
	uri: URI;
	title?: string;
	excerpt: string;
	relevance: number;
}

export interface IGenerationMetadata {
	model: string;
	tokensUsed: number;
	processingTime: number;
	retrievalTime: number;
	chunksUsed: number;
}

export interface IOrkideRAGService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when knowledge bases change
	 */
	readonly onDidChangeKnowledgeBases: Event<IKnowledgeBase[]>;

	/**
	 * Event fired when indexing status changes
	 */
	readonly onDidChangeIndexingStatus: Event<{ sourceId: string; status: IndexStatus }>;

	/**
	 * Get all knowledge bases
	 */
	getKnowledgeBases(): IKnowledgeBase[];

	/**
	 * Create a new knowledge base
	 */
	createKnowledgeBase(name: string, description: string, type: KnowledgeBaseType): Promise<IKnowledgeBase>;

	/**
	 * Delete a knowledge base
	 */
	deleteKnowledgeBase(id: string): Promise<void>;

	/**
	 * Add a source to a knowledge base
	 */
	addSource(knowledgeBaseId: string, source: Omit<IKnowledgeSource, 'id' | 'status'>): Promise<IKnowledgeSource>;

	/**
	 * Remove a source from a knowledge base
	 */
	removeSource(knowledgeBaseId: string, sourceId: string): Promise<void>;

	/**
	 * Index a knowledge base or specific sources
	 */
	indexKnowledgeBase(knowledgeBaseId: string, sourceIds?: string[]): Promise<void>;

	/**
	 * Retrieve relevant chunks for a query
	 */
	retrieve(query: IRetrievalQuery): Promise<IRetrievalResult>;

	/**
	 * Generate content using retrieved context
	 */
	generate(context: IGenerationContext): Promise<IGenerationResult>;

	/**
	 * Perform RAG (retrieve + generate) in one call
	 */
	ragQuery(query: string, filters?: IRetrievalFilters, constraints?: IGenerationConstraints): Promise<IGenerationResult>;

	/**
	 * Get indexing status for all sources
	 */
	getIndexingStatus(): Promise<{ [sourceId: string]: IndexStatus }>;

	/**
	 * Search for similar code or documentation
	 */
	findSimilar(content: string, type: ChunkType, maxResults?: number): Promise<IRetrievedChunk[]>;

	/**
	 * Get document by ID
	 */
	getDocument(id: string): Promise<IDocument | undefined>;

	/**
	 * Update document metadata
	 */
	updateDocumentMetadata(id: string, metadata: Partial<IDocumentMetadata>): Promise<void>;
}