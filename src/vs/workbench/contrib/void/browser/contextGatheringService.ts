/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Position } from '../../../../editor/common/language/core/position.js';
import { DocumentSymbol, SymbolKind } from '../../../../editor/common/language/languages.js';
import { ITextModel } from '../../../../editor/common/language/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/language/services/languageFeatures.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Range, IRange } from '../../../../editor/common/language/core/range.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IModelService } from '../../../../editor/common/language/services/model.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { URI } from '../../../../base/common/uri.js';


// make sure snippet logic works
// change logic for `visited` to intervals
// atomically set new snippets at end
// throttle cache setting

interface IVisitedInterval {
	uri: string;
	startLine: number;
	endLine: number;
}

type DefinitionSymbol = DocumentSymbol & { uri: URI };

export interface IContextGatheringService {
	readonly _serviceBrand: undefined;
	updateCache(model: ITextModel, pos: Position): Promise<void>;
	getCachedSnippets(): string[];
}

export const IContextGatheringService = createDecorator<IContextGatheringService>('contextGatheringService');

class ContextGatheringService extends Disposable implements IContextGatheringService {
	_serviceBrand: undefined;
	private readonly _NUM_LINES = 3;
	private readonly _MAX_SNIPPET_LINES = 7;  // Reasonable size for context
	// Cache holds the most recent list of snippets.
	private _cache: string[] = [];
	private _snippetIntervals: IVisitedInterval[] = [];

	constructor(
		@ILanguageFeaturesService private readonly _langFeaturesService: ILanguageFeaturesService,
		@IModelService private readonly _modelService: IModelService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService
	) {
		super();
		this._modelService.getModels().forEach(model => this._subscribeToModel(model));
		this._register(this._modelService.onModelAdded(model => this._subscribeToModel(model)));
	}

	private _subscribeToModel(model: ITextModel): void {
		console.log('Subscribing to model:', model.uri.toString());
		this._register(model.onDidChangeContent(() => {
			const editor = this._codeEditorService.getFocusedCodeEditor();
			if (editor && editor.getModel() === model) {
				const pos = editor.getPosition();
				console.log('updateCache called at position:', pos);
				if (pos) {
					this.updateCache(model, pos);
				}
			}
		}));
	}

	public async updateCache(model: ITextModel, pos: Position): Promise<void> {
		const snippets = new Set<string>();
		const visitedDefinitionKeys = new Set<string>();
		this._snippetIntervals = []; // Reset intervals for new cache update

		await this._gatherNearbySnippets(model, pos, this._NUM_LINES, 3, snippets, this._snippetIntervals, visitedDefinitionKeys);
		await this._gatherParentSnippets(model, pos, this._NUM_LINES, 3, snippets, this._snippetIntervals, visitedDefinitionKeys);

		// Convert to array and filter overlapping snippets
		this._cache = Array.from(snippets);
		console.log('Cache updated:', this._cache);
	}

	public getCachedSnippets(): string[] {
		return this._cache;
	}

	// Basic snippet extraction.
	private _getSnippetForRange(model: ITextModel, range: IRange, numLines: number): string {
		const startLine = Math.max(range.startLineNumber - numLines, 1);
		const endLine = Math.min(range.endLineNumber + numLines, model.getLineCount());

		// Enforce maximum snippet size
		const totalLines = endLine - startLine + 1;
		const adjustedStartLine = totalLines > this._MAX_SNIPPET_LINES
			? endLine - this._MAX_SNIPPET_LINES + 1
			: startLine;

		const snippetRange = new Range(adjustedStartLine, 1, endLine, model.getLineMaxColumn(endLine));
		return this._cleanSnippet(model.getValueInRange(snippetRange));
	}

	private _cleanSnippet(snippet: string): string {
		return snippet
			.split('\n')
			// Remove empty lines and lines with only comments
			.filter(line => {
				const trimmed = line.trim();
				return trimmed && !/^\/\/+$/.test(trimmed);
			})
			// Rejoin with newlines
			.join('\n')
			// Remove excess whitespace
			.trim();
	}

	private _normalizeSnippet(snippet: string): string {
		return snippet
			// Remove multiple newlines
			.replace(/\n{2,}/g, '\n')
			// Remove trailing whitespace
			.trim();
	}

	private _addSnippetIfNotOverlapping(
		model: ITextModel,
		range: IRange,
		snippets: Set<string>,
		visited: IVisitedInterval[]
	): void {
		const startLine = range.startLineNumber;
		const endLine = range.endLineNumber;
		const uri = model.uri.toString();

		if (!this._isRangeVisited(uri, startLine, endLine, visited)) {
			visited.push({ uri, startLine, endLine });
			const snippet = this._normalizeSnippet(this._getSnippetForRange(model, range, this._NUM_LINES));
			if (snippet.length > 0) {
				snippets.add(snippet);
			}
		}
	}

	private async _gatherNearbySnippets(
		model: ITextModel,
		pos: Position,
		numLines: number,
		depth: number,
		snippets: Set<string>,
		visited: IVisitedInterval[],
		visitedDefinitionKeys: Set<string>
	): Promise<void> {
		if (depth <= 0) return;

		const startLine = Math.max(pos.lineNumber - numLines, 1);
		const endLine = Math.min(pos.lineNumber + numLines, model.getLineCount());
		const range = new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));

		this._addSnippetIfNotOverlapping(model, range, snippets, visited);

		const symbols = await this._getSymbolsNearPosition(model, pos, numLines);
		const seenSymbolKeys = new Set<string>();
		for (const sym of symbols) {
			const symbolKey = this._symbolKey(model.uri, sym);
			if (seenSymbolKeys.has(symbolKey)) continue;
			seenSymbolKeys.add(symbolKey);

			const defs = await this._getDefinitionSymbols(model, sym);
			for (const def of defs) {
				const definitionKey = this._definitionKey(def);
				if (visitedDefinitionKeys.has(definitionKey)) continue;
				visitedDefinitionKeys.add(definitionKey);

				const defModel = this._modelService.getModel(def.uri);
				if (defModel) {
					const defPos = new Position(def.range.startLineNumber, def.range.startColumn);
					this._addSnippetIfNotOverlapping(defModel, def.range, snippets, visited);
					await this._gatherNearbySnippets(defModel, defPos, numLines, depth - 1, snippets, visited, visitedDefinitionKeys);
				}
			}
		}
	}

	private async _gatherParentSnippets(
		model: ITextModel,
		pos: Position,
		numLines: number,
		depth: number,
		snippets: Set<string>,
		visited: IVisitedInterval[],
		visitedDefinitionKeys: Set<string>
	): Promise<void> {
		if (depth <= 0) return;

		const container = await this._findContainerFunction(model, pos);
		if (!container) return;

		const containerRange = container.kind === SymbolKind.Method ? container.selectionRange : container.range;
		this._addSnippetIfNotOverlapping(model, containerRange, snippets, visited);

		const symbols = await this._getSymbolsNearRange(model, containerRange, numLines);
		const seenSymbolKeys = new Set<string>();
		for (const sym of symbols) {
			const symbolKey = this._symbolKey(model.uri, sym);
			if (seenSymbolKeys.has(symbolKey)) continue;
			seenSymbolKeys.add(symbolKey);

			const defs = await this._getDefinitionSymbols(model, sym);
			for (const def of defs) {
				const definitionKey = this._definitionKey(def);
				if (visitedDefinitionKeys.has(definitionKey)) continue;
				visitedDefinitionKeys.add(definitionKey);

				const defModel = this._modelService.getModel(def.uri);
				if (defModel) {
					const defPos = new Position(def.range.startLineNumber, def.range.startColumn);
					this._addSnippetIfNotOverlapping(defModel, def.range, snippets, visited);
					await this._gatherNearbySnippets(defModel, defPos, numLines, depth - 1, snippets, visited, visitedDefinitionKeys);
				}
			}
		}

		const containerPos = new Position(containerRange.startLineNumber, containerRange.startColumn);
		await this._gatherParentSnippets(model, containerPos, numLines, depth - 1, snippets, visited, visitedDefinitionKeys);
	}

	private _isRangeVisited(uri: string, startLine: number, endLine: number, visited: IVisitedInterval[]): boolean {
		return visited.some(interval =>
			interval.uri === uri &&
			!(endLine < interval.startLine || startLine > interval.endLine)
		);
	}

	private async _getSymbolsNearPosition(model: ITextModel, pos: Position, numLines: number): Promise<DocumentSymbol[]> {
		const startLine = Math.max(pos.lineNumber - numLines, 1);
		const endLine = Math.min(pos.lineNumber + numLines, model.getLineCount());
		const range = new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
		return this._getSymbolsInRange(model, range);
	}

	private async _getSymbolsNearRange(model: ITextModel, range: IRange, numLines: number): Promise<DocumentSymbol[]> {
		const centerLine = Math.floor((range.startLineNumber + range.endLineNumber) / 2);
		const startLine = Math.max(centerLine - numLines, 1);
		const endLine = Math.min(centerLine + numLines, model.getLineCount());
		const searchRange = new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
		return this._getSymbolsInRange(model, searchRange);
	}

	private async _getSymbolsInRange(model: ITextModel, range: IRange): Promise<DocumentSymbol[]> {
		const symbols: DocumentSymbol[] = [];
		const providers = this._langFeaturesService.documentSymbolProvider.ordered(model);
		for (const provider of providers) {
			try {
				const result = await provider.provideDocumentSymbols(model, CancellationToken.None);
				if (result) {
					const flat = this._flattenSymbols(result);
					const intersecting = flat.filter(sym => this._rangesIntersect(sym.range, range));
					symbols.push(...intersecting);
				}
			} catch (e) {
				console.warn('Symbol provider error:', e);
			}
		}
		// Also check reference providers.
		const refProviders = this._langFeaturesService.referenceProvider.ordered(model);
		if (!refProviders.length) return symbols;

		const seenRefSymbols = new Set<string>();
		for (let line = range.startLineNumber; line <= range.endLineNumber; line++) {
			const content = model.getLineContent(line);
			const wordsWithColumn = this._getDistinctWordPositions(content);
			for (const { word, startColumn } of wordsWithColumn) {
				const pos = new Position(line, startColumn);
				if (!this._positionInRange(pos, range)) continue;
				for (const provider of refProviders) {
					try {
						const refs = await provider.provideReferences(model, pos, { includeDeclaration: true }, CancellationToken.None);
						if (!refs) continue;

						for (const ref of refs) {
							if (!this._rangesIntersect(ref.range, range)) continue;

							const refKey = this._referenceKey(model.uri, ref.range, word);
							if (seenRefSymbols.has(refKey)) continue;
							seenRefSymbols.add(refKey);

							symbols.push({
								name: word,
								detail: '',
								kind: SymbolKind.Variable,
								range: ref.range,
								selectionRange: ref.range,
								children: [],
								tags: []
							});
						}
					} catch (e) {
						console.warn('Reference provider error:', e);
					}
				}
			}
		}
		return symbols;
	}

	private _flattenSymbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
		const flat: DocumentSymbol[] = [];
		for (const sym of symbols) {
			flat.push(sym);
			if (sym.children && sym.children.length > 0) {
				flat.push(...this._flattenSymbols(sym.children));
			}
		}
		return flat;
	}

	private _rangesIntersect(a: IRange, b: IRange): boolean {
		return !(
			a.endLineNumber < b.startLineNumber ||
			a.startLineNumber > b.endLineNumber ||
			(a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) ||
			(a.startLineNumber === b.endLineNumber && a.endColumn > b.endColumn)
		);
	}

	private _positionInRange(pos: Position, range: IRange): boolean {
		return pos.lineNumber >= range.startLineNumber &&
			pos.lineNumber <= range.endLineNumber &&
			(pos.lineNumber !== range.startLineNumber || pos.column >= range.startColumn) &&
			(pos.lineNumber !== range.endLineNumber || pos.column <= range.endColumn);
	}

	private _getDistinctWordPositions(content: string): { word: string; startColumn: number }[] {
		const wordPositions: { word: string; startColumn: number }[] = [];
		const seenWords = new Set<string>();
		const wordRegex = /[a-zA-Z_]\w*/g;

		let match: RegExpExecArray | null;
		while ((match = wordRegex.exec(content)) !== null) {
			const word = match[0];
			if (seenWords.has(word)) continue;
			seenWords.add(word);

			wordPositions.push({
				word,
				startColumn: match.index + 1
			});
		}
		return wordPositions;
	}

	private _rangeKey(range: IRange): string {
		return `${range.startLineNumber}:${range.startColumn}:${range.endLineNumber}:${range.endColumn}`;
	}

	private _symbolKey(uri: URI, symbol: DocumentSymbol): string {
		return `${uri.toString()}#${symbol.name}#${this._rangeKey(symbol.range)}`;
	}

	private _definitionKey(def: DefinitionSymbol): string {
		return `${def.uri.toString()}#${this._rangeKey(def.range)}`;
	}

	private _referenceKey(uri: URI, range: IRange, word: string): string {
		return `${uri.toString()}#${word}#${this._rangeKey(range)}`;
	}

	// Get definition symbols for a given symbol.
	private async _getDefinitionSymbols(model: ITextModel, symbol: DocumentSymbol): Promise<DefinitionSymbol[]> {
		const pos = new Position(symbol.range.startLineNumber, symbol.range.startColumn);
		const providers = this._langFeaturesService.definitionProvider.ordered(model);
		const defs: DefinitionSymbol[] = [];
		const seenDefinitionKeys = new Set<string>();
		for (const provider of providers) {
			try {
				const res = await provider.provideDefinition(model, pos, CancellationToken.None);
				if (res) {
					const links = Array.isArray(res) ? res : [res];
					for (const link of links) {
						const definitionKey = `${link.uri.toString()}#${this._rangeKey(link.range)}`;
						if (seenDefinitionKeys.has(definitionKey)) continue;
						seenDefinitionKeys.add(definitionKey);

						defs.push({
							name: symbol.name,
							detail: symbol.detail,
							kind: symbol.kind,
							range: link.range,
							selectionRange: link.range,
							children: [],
							tags: symbol.tags || [],
							uri: link.uri  // Now keeping it as URI instead of converting to string
						});
					}
				}
			} catch (e) {
				console.warn('Definition provider error:', e);
			}
		}
		return defs;
	}

	private async _findContainerFunction(model: ITextModel, pos: Position): Promise<DocumentSymbol | null> {
		const searchRange = new Range(
			Math.max(pos.lineNumber - 1, 1), 1,
			Math.min(pos.lineNumber + 1, model.getLineCount()),
			model.getLineMaxColumn(pos.lineNumber)
		);
		const symbols = await this._getSymbolsInRange(model, searchRange);
		const funcs = symbols.filter(s =>
			(s.kind === SymbolKind.Function || s.kind === SymbolKind.Method) &&
			this._positionInRange(pos, s.range)
		);
		if (!funcs.length) return null;
		return funcs.reduce((innermost, current) => {
			if (!innermost) return current;
			const moreInner =
				(current.range.startLineNumber > innermost.range.startLineNumber ||
					(current.range.startLineNumber === innermost.range.startLineNumber &&
						current.range.startColumn > innermost.range.startColumn)) &&
				(current.range.endLineNumber < innermost.range.endLineNumber ||
					(current.range.endLineNumber === innermost.range.endLineNumber &&
						current.range.endColumn < innermost.range.endColumn));
			return moreInner ? current : innermost;
		}, null as DocumentSymbol | null);
	}
}

registerSingleton(IContextGatheringService, ContextGatheringService, InstantiationType.Eager);
