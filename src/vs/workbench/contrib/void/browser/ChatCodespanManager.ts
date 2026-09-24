/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { shorten } from '../../../../base/common/labels.js';
import { Position } from '../../../../editor/common/language/core/position.js';
import { ILanguageFeaturesService } from '../../../../editor/common/language/services/languageFeatures.js';
import { IToolsService } from '../common/toolsService.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { CodespanLocationLink, ChatMessage, } from '../../../../platform/void/common/chatThreadServiceTypes.js';
import { ToolCallParams, } from '../../../../platform/void/common/toolsServiceTypes.js';


export class ChatCodespanManager {
	constructor(
		@IToolsService private readonly _toolsService: IToolsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService
	) { }

	public async generateCodespanLink(
		opts: { codespanStr: string, threadId: string },
		getThreadMessages: () => ChatMessage[]
	): Promise<CodespanLocationLink | null> {

		const { codespanStr: targetStr } = opts;
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/;

		let target = targetStr;
		let codespanType: 'file-or-folder' | 'function-or-class';

		if (target.includes('.') || target.includes('/')) {
			codespanType = 'file-or-folder';
		} else if (functionOrMethodPattern.test(target)) {
			codespanType = 'function-or-class';
		} else if (functionParensPattern.test(target)) {
			const match = target.match(functionParensPattern);
			if (match && match[1]) {
				codespanType = 'function-or-class';
				target = match[1];
			} else { return null; }
		} else {
			return null;
		}

		const prevUris = this._getAllSeenFileURIs(getThreadMessages()).reverse();

		// 1. Search Files
		if (codespanType === 'file-or-folder') {
			const doesUriMatchTarget = (uri: URI) => uri.path.includes(target);

			// A. Check seen files
			for (const [idx, uri] of prevUris.entries()) {
				if (doesUriMatchTarget(uri)) {
					return this._createLinkResult(uri, prevUris, idx);
				}
			}

			// B. Search codebase
			try {
				const { result } = await this._toolsService.callTool['search_pathnames_only']({ query: target, includePattern: null, pageNumber: 0 });
				const { uris } = await result;
				for (const uri of uris) {
					if (doesUriMatchTarget(uri)) {
						// find relative idx in uris is tricky for shorten, using 0 for simplicity or logic from main
						return { uri, displayText: target }; // Simplified for extraction
					}
				}
			} catch (e) { return null; }
		}

		// 2. Search Symbols
		if (codespanType === 'function-or-class') {
			for (const uri of prevUris) {
				const modelRef = await this._voidModelService.getModelSafe(uri);
				const { model } = modelRef;
				if (!model) continue;
				const definitionProviders = this._languageFeaturesService.definitionProvider.ordered(model);
				if (!definitionProviders.length) continue;

				const matches = model.findMatches(target, false, false, true, null, true);
				const firstThree = matches.slice(0, 3);
				const seenMatchPositions = new Set<string>();

				for (const match of firstThree) {
					const matchKey = `${match.range.startLineNumber}:${match.range.startColumn}`;
					if (seenMatchPositions.has(matchKey)) continue;
					seenMatchPositions.add(matchKey);

					const position = new Position(match.range.startLineNumber, match.range.startColumn);

					for (const provider of definitionProviders) {
						const _definitions = await provider.provideDefinition(model, position, CancellationToken.None);
						if (!_definitions) continue;
						const definitions = Array.isArray(_definitions) ? _definitions : [_definitions];
						const definition = definitions[0];
						if (!definition) continue;

						return {
							uri: definition.uri,
							selection: {
								startLineNumber: definition.range.startLineNumber,
								startColumn: definition.range.startColumn,
								endLineNumber: definition.range.endLineNumber,
								endColumn: definition.range.endColumn,
							},
							displayText: targetStr,
						};
					}
				}
			}
		}
		return null;
	}

	private _createLinkResult(uri: URI, allUris: URI[], idx: number) {
		const prevUriStrs = allUris.map(u => u.fsPath);
		const shortenedUriStrs = shorten(prevUriStrs);
		let displayText = shortenedUriStrs[idx];
		const ellipsisIdx = displayText.lastIndexOf('…/');
		if (ellipsisIdx >= 0) {
			displayText = displayText.slice(ellipsisIdx + 2);
		}
		return { uri, displayText };
	}

	private _getAllSeenFileURIs(messages: ChatMessage[]): URI[] {
		const fsPathsSet = new Set<string>();
		const uris: URI[] = [];
		const addURI = (uri: URI) => {
			if (fsPathsSet.has(uri.fsPath)) return;
			fsPathsSet.add(uri.fsPath);
			uris.push(uri);
		};

		for (const m of messages) {
			if (m.role === 'user') {
				for (const sel of m.selections ?? []) addURI(sel.uri);
				for (const att of m.attachments ?? []) addURI(att.uri);
			} else if (m.role === 'tool' && m.type === 'success' && m.name === 'read_file') {
				const params = m.params as ToolCallParams['read_file'];
				addURI(params.uri);
			}
		}
		return uris;
	}
}
