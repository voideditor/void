/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { 
	IOrkideRAGService, 
	IKnowledgeBase, 
	IKnowledgeSource,
	IDocument,
	IDocumentChunk,
	IRetrievalQuery,
	IRetrievalResult,
	IRetrievedChunk,
	IGenerationContext,
	IGenerationResult,
	IGenerationConstraints,
	IRetrievalFilters,
	KnowledgeBaseType,
	SourceType,
	IndexStatus,
	ChunkType
} from './ragService';

export class OrkideRAGService extends Disposable implements IOrkideRAGService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeKnowledgeBases = this._register(new Emitter<IKnowledgeBase[]>());
	readonly onDidChangeKnowledgeBases: Event<IKnowledgeBase[]> = this._onDidChangeKnowledgeBases.event;

	private readonly _onDidChangeIndexingStatus = this._register(new Emitter<{ sourceId: string; status: IndexStatus }>());
	readonly onDidChangeIndexingStatus: Event<{ sourceId: string; status: IndexStatus }> = this._onDidChangeIndexingStatus.event;

	private _knowledgeBases: IKnowledgeBase[] = [];
	private _documents: Map<string, IDocument> = new Map();
	private _indexingQueue: Set<string> = new Set();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super();
		this._initializeDefaultKnowledgeBase();
	}

	getKnowledgeBases(): IKnowledgeBase[] {
		return [...this._knowledgeBases];
	}

	async createKnowledgeBase(name: string, description: string, type: KnowledgeBaseType): Promise<IKnowledgeBase> {
		const knowledgeBase: IKnowledgeBase = {
			id: generateUuid(),
			name,
			description,
			type,
			sources: [],
			lastUpdated: Date.now(),
			documentCount: 0,
			isIndexed: false
		};

		this._knowledgeBases.push(knowledgeBase);
		this._onDidChangeKnowledgeBases.fire(this._knowledgeBases);

		return knowledgeBase;
	}

	async deleteKnowledgeBase(id: string): Promise<void> {
		const index = this._knowledgeBases.findIndex(kb => kb.id === id);
		if (index >= 0) {
			const kb = this._knowledgeBases[index];
			
			// Remove associated documents
			kb.sources.forEach(source => {
				this._documents.forEach((doc, docId) => {
					if (doc.metadata.source === source.id) {
						this._documents.delete(docId);
					}
				});
			});

			this._knowledgeBases.splice(index, 1);
			this._onDidChangeKnowledgeBases.fire(this._knowledgeBases);
		}
	}

	async addSource(knowledgeBaseId: string, sourceData: Omit<IKnowledgeSource, 'id' | 'status'>): Promise<IKnowledgeSource> {
		const kb = this._knowledgeBases.find(kb => kb.id === knowledgeBaseId);
		if (!kb) {
			throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
		}

		const source: IKnowledgeSource = {
			...sourceData,
			id: generateUuid(),
			status: IndexStatus.Pending
		};

		kb.sources.push(source);
		kb.lastUpdated = Date.now();
		this._onDidChangeKnowledgeBases.fire(this._knowledgeBases);

		return source;
	}

	async removeSource(knowledgeBaseId: string, sourceId: string): Promise<void> {
		const kb = this._knowledgeBases.find(kb => kb.id === knowledgeBaseId);
		if (!kb) {
			throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
		}

		const sourceIndex = kb.sources.findIndex(s => s.id === sourceId);
		if (sourceIndex >= 0) {
			// Remove associated documents
			this._documents.forEach((doc, docId) => {
				if (doc.metadata.source === sourceId) {
					this._documents.delete(docId);
				}
			});

			kb.sources.splice(sourceIndex, 1);
			kb.lastUpdated = Date.now();
			this._onDidChangeKnowledgeBases.fire(this._knowledgeBases);
		}
	}

	async indexKnowledgeBase(knowledgeBaseId: string, sourceIds?: string[]): Promise<void> {
		const kb = this._knowledgeBases.find(kb => kb.id === knowledgeBaseId);
		if (!kb) {
			throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
		}

		const sourcesToIndex = sourceIds 
			? kb.sources.filter(s => sourceIds.includes(s.id))
			: kb.sources;

		for (const source of sourcesToIndex) {
			if (this._indexingQueue.has(source.id)) {
				continue; // Already indexing
			}

			this._indexingQueue.add(source.id);
			source.status = IndexStatus.Indexing;
			this._onDidChangeIndexingStatus.fire({ sourceId: source.id, status: IndexStatus.Indexing });

			try {
				await this._indexSource(source);
				source.status = IndexStatus.Indexed;
				source.lastIndexed = Date.now();
			} catch (error) {
				source.status = IndexStatus.Failed;
				console.error(`Failed to index source ${source.id}:`, error);
			} finally {
				this._indexingQueue.delete(source.id);
				this._onDidChangeIndexingStatus.fire({ sourceId: source.id, status: source.status });
			}
		}

		kb.isIndexed = kb.sources.every(s => s.status === IndexStatus.Indexed);
		kb.documentCount = this._getDocumentCountForKnowledgeBase(kb.id);
		kb.lastUpdated = Date.now();
		this._onDidChangeKnowledgeBases.fire(this._knowledgeBases);
	}

	async retrieve(query: IRetrievalQuery): Promise<IRetrievalResult> {
		const startTime = Date.now();
		const maxResults = query.maxResults || 10;
		const threshold = query.threshold || 0.5;

		// Simple text-based retrieval (in production, this would use embeddings)
		const results: IRetrievedChunk[] = [];
		const queryLower = query.query.toLowerCase();

		this._documents.forEach(document => {
			if (this._shouldIncludeDocument(document, query.filters)) {
				document.chunks.forEach(chunk => {
					const score = this._calculateRelevanceScore(chunk.content, queryLower);
					if (score >= threshold) {
						results.push({
							chunk,
							document,
							score,
							relevanceReason: this._getRelevanceReason(chunk.content, queryLower)
						});
					}
				});
			}
		});

		// Sort by score and limit results
		results.sort((a, b) => b.score - a.score);
		const limitedResults = results.slice(0, maxResults);

		return {
			chunks: limitedResults,
			totalResults: results.length,
			queryTime: Date.now() - startTime
		};
	}

	async generate(context: IGenerationContext): Promise<IGenerationResult> {
		const startTime = Date.now();

		// Simulate generation (in production, this would call an LLM)
		const relevantContent = context.retrievedChunks
			.map(chunk => chunk.chunk.content)
			.join('\n\n');

		const generatedContent = this._simulateGeneration(context.query, relevantContent, context.constraints);

		const references = context.retrievedChunks.map(chunk => ({
			source: chunk.document.metadata.source,
			uri: chunk.document.metadata.uri,
			title: chunk.document.metadata.title,
			excerpt: chunk.chunk.content.substring(0, 200) + '...',
			relevance: chunk.score
		}));

		return {
			content: generatedContent,
			references,
			confidence: 0.85, // Simulated confidence
			metadata: {
				model: 'orkide-rag-v1',
				tokensUsed: generatedContent.length / 4, // Rough estimate
				processingTime: Date.now() - startTime,
				retrievalTime: 0, // Would be measured separately
				chunksUsed: context.retrievedChunks.length
			}
		};
	}

	async ragQuery(query: string, filters?: IRetrievalFilters, constraints?: IGenerationConstraints): Promise<IGenerationResult> {
		// Retrieve relevant chunks
		const retrievalResult = await this.retrieve({ query, filters });

		// Generate response using retrieved context
		const generationContext: IGenerationContext = {
			query,
			retrievedChunks: retrievalResult.chunks,
			constraints
		};

		const result = await this.generate(generationContext);
		result.metadata.retrievalTime = retrievalResult.queryTime;

		return result;
	}

	async getIndexingStatus(): Promise<{ [sourceId: string]: IndexStatus }> {
		const status: { [sourceId: string]: IndexStatus } = {};
		
		this._knowledgeBases.forEach(kb => {
			kb.sources.forEach(source => {
				status[source.id] = source.status;
			});
		});

		return status;
	}

	async findSimilar(content: string, type: ChunkType, maxResults: number = 5): Promise<IRetrievedChunk[]> {
		const results: IRetrievedChunk[] = [];
		const contentLower = content.toLowerCase();

		this._documents.forEach(document => {
			document.chunks.forEach(chunk => {
				if (chunk.metadata.type === type) {
					const score = this._calculateRelevanceScore(chunk.content, contentLower);
					if (score > 0.3) { // Minimum similarity threshold
						results.push({
							chunk,
							document,
							score,
							relevanceReason: 'Similar content structure and keywords'
						});
					}
				}
			});
		});

		return results
			.sort((a, b) => b.score - a.score)
			.slice(0, maxResults);
	}

	async getDocument(id: string): Promise<IDocument | undefined> {
		return this._documents.get(id);
	}

	async updateDocumentMetadata(id: string, metadata: Partial<IDocumentMetadata>): Promise<void> {
		const document = this._documents.get(id);
		if (document) {
			document.metadata = { ...document.metadata, ...metadata, updatedAt: Date.now() };
		}
	}

	private async _indexSource(source: IKnowledgeSource): Promise<void> {
		if (source.type === SourceType.File) {
			await this._indexFile(source);
		} else if (source.type === SourceType.Directory) {
			await this._indexDirectory(source);
		}
		// Add more source types as needed
	}

	private async _indexFile(source: IKnowledgeSource): Promise<void> {
		try {
			const content = await this.fileService.readFile(source.uri);
			const text = content.value.toString();
			const language = this.languageService.guessLanguageIdByFilepathOrFirstLine(source.uri);

			const document: IDocument = {
				id: generateUuid(),
				content: text,
				metadata: {
					source: source.id,
					uri: source.uri,
					title: source.uri.path.split('/').pop(),
					language,
					createdAt: Date.now(),
					updatedAt: Date.now()
				},
				chunks: this._chunkDocument(text, language || 'plaintext')
			};

			this._documents.set(document.id, document);
		} catch (error) {
			console.error(`Failed to index file ${source.uri.toString()}:`, error);
			throw error;
		}
	}

	private async _indexDirectory(source: IKnowledgeSource): Promise<void> {
		try {
			const stat = await this.fileService.resolve(source.uri);
			if (stat.children) {
				for (const child of stat.children) {
					if (!child.isDirectory) {
						const fileSource: IKnowledgeSource = {
							...source,
							id: generateUuid(),
							type: SourceType.File,
							uri: child.resource
						};
						await this._indexFile(fileSource);
					}
				}
			}
		} catch (error) {
			console.error(`Failed to index directory ${source.uri.toString()}:`, error);
			throw error;
		}
	}

	private _chunkDocument(content: string, language: string): IDocumentChunk[] {
		const chunks: IDocumentChunk[] = [];
		const lines = content.split('\n');
		const chunkSize = 100; // Lines per chunk

		for (let i = 0; i < lines.length; i += chunkSize) {
			const chunkLines = lines.slice(i, Math.min(i + chunkSize, lines.length));
			const chunkContent = chunkLines.join('\n');
			
			chunks.push({
				id: generateUuid(),
				content: chunkContent,
				startIndex: i,
				endIndex: Math.min(i + chunkSize, lines.length),
				metadata: {
					type: this._determineChunkType(chunkContent, language),
					importance: this._calculateChunkImportance(chunkContent),
					symbols: this._extractSymbols(chunkContent, language)
				}
			});
		}

		return chunks;
	}

	private _determineChunkType(content: string, language: string): ChunkType {
		if (content.includes('test') || content.includes('spec')) {
			return ChunkType.Test;
		}
		if (content.includes('//') || content.includes('/*') || content.includes('#')) {
			return ChunkType.Comment;
		}
		if (language === 'json' || language === 'yaml' || language === 'xml') {
			return ChunkType.Configuration;
		}
		return ChunkType.Code;
	}

	private _calculateChunkImportance(content: string): number {
		// Simple heuristic based on content characteristics
		let importance = 0.5;
		
		if (content.includes('class ') || content.includes('function ')) {
			importance += 0.3;
		}
		if (content.includes('export ') || content.includes('public ')) {
			importance += 0.2;
		}
		if (content.includes('TODO') || content.includes('FIXME')) {
			importance += 0.1;
		}

		return Math.min(importance, 1.0);
	}

	private _extractSymbols(content: string, language: string): string[] {
		const symbols: string[] = [];
		
		// Simple symbol extraction (would be more sophisticated in production)
		const symbolRegex = /(?:class|function|const|let|var)\s+(\w+)/g;
		let match;
		while ((match = symbolRegex.exec(content)) !== null) {
			symbols.push(match[1]);
		}

		return symbols;
	}

	private _shouldIncludeDocument(document: IDocument, filters?: IRetrievalFilters): boolean {
		if (!filters) {
			return true;
		}

		if (filters.languages && filters.languages.length > 0) {
			if (!document.metadata.language || !filters.languages.includes(document.metadata.language)) {
				return false;
			}
		}

		if (filters.sources && filters.sources.length > 0) {
			if (!filters.sources.includes(document.metadata.source)) {
				return false;
			}
		}

		if (filters.dateRange) {
			const docTime = document.metadata.updatedAt;
			if (docTime < filters.dateRange.start || docTime > filters.dateRange.end) {
				return false;
			}
		}

		return true;
	}

	private _calculateRelevanceScore(content: string, query: string): number {
		const contentLower = content.toLowerCase();
		const queryWords = query.split(/\s+/);
		
		let score = 0;
		let totalWords = queryWords.length;

		queryWords.forEach(word => {
			if (contentLower.includes(word)) {
				score += 1;
			}
		});

		return totalWords > 0 ? score / totalWords : 0;
	}

	private _getRelevanceReason(content: string, query: string): string {
		const queryWords = query.split(/\s+/);
		const matchedWords = queryWords.filter(word => content.toLowerCase().includes(word));
		
		if (matchedWords.length > 0) {
			return `Contains keywords: ${matchedWords.join(', ')}`;
		}
		
		return 'Contextually relevant';
	}

	private _simulateGeneration(query: string, context: string, constraints?: IGenerationConstraints): string {
		// Simple template-based generation (would use actual LLM in production)
		const maxLength = constraints?.maxLength || 1000;
		
		let response = `Based on the available context, here's a response to "${query}":\n\n`;
		
		if (context.trim()) {
			response += `The relevant information shows:\n${context.substring(0, maxLength - response.length - 100)}\n\n`;
		}
		
		response += 'This response was generated using retrieval-augmented generation from your codebase and documentation.';
		
		return response.substring(0, maxLength);
	}

	private _getDocumentCountForKnowledgeBase(knowledgeBaseId: string): number {
		let count = 0;
		this._documents.forEach(doc => {
			const kb = this._knowledgeBases.find(kb => 
				kb.sources.some(s => s.id === doc.metadata.source)
			);
			if (kb && kb.id === knowledgeBaseId) {
				count++;
			}
		});
		return count;
	}

	private async _initializeDefaultKnowledgeBase(): Promise<void> {
		const defaultKB = await this.createKnowledgeBase(
			'Workspace',
			'Current workspace files and documentation',
			KnowledgeBaseType.Codebase
		);

		// This would be populated with actual workspace files
		// For now, it's just a placeholder
	}
}