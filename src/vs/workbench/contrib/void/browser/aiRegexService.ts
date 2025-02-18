/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
// import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
// import { IToolService, ToolService } from '../common/toolsService.js';



export type ChatMessageLocation = {
	threadId: string;
	messageIdx: number;
}


export type SearchAndReplaceBlock = {
	search: string;
	replace: string;
}

// service that manages state
export type ApplyState = {
	[applyBoxId: string]: {
		searchAndReplaceBlocks: SearchAndReplaceBlock;
	}
}

// the purpose of this service is to generate search and replace blocks for a given codeblock `codeblockId` and on a file `fileName` and version `fileVersion`

export interface IFastApplyService {
	readonly _serviceBrand: undefined;

	// readonly state: ApplyState; // readonly to the user
	// setState(newState: Partial<ApplyState>): void;
	// onDidChangeState: Event<void>;
}

export const IVoidFastApplyService = createDecorator<IFastApplyService>('voidFastApplyService');
class VoidFastApplyService extends Disposable implements IFastApplyService {
	_serviceBrand: undefined;

	// static readonly ID = 'voidFastApplyService';

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;


	// state
	// state: ApplyState

	constructor(
		// @IToolService private readonly toolService: ToolService
	) {
		super()

		// initial state
		// this.state = { currentUri: undefined }
	}

	setState(newState: Partial<ApplyState>) {

		// this.state = { ...this.state, ...newState }
		this._onDidChangeState.fire()
	}

	aiSearch(searchStr: string) {

	}

	aiReplace(searchStr: string, replaceStr: string) {

	}


	// 1. search(ai)
	// - tool use to find all possible changes
	// - if search only: is this file related to the search?
	// - if search + replace: should I modify this file?
	// 2. replace(ai)
	// - what changes to make?
	// 3. postprocess errors
	// -fastapply changes simultaneously
	// -iterate on syntax errors (all files can be changed from a syntax error, not just the one with the error)


	// private async _searchUsingAI({ searchClause }: { searchClause: string }) {

	// 	// 		const relevantURIs: URI[] = []
	// 	// 		const gatherPrompt = `\
	// 	// asdasdas
	// 	// `
	// 	// 		const filterPrompt = `\
	// 	// Is this file relevant?
	// 	// `


	// 	// 		// optimizations (DO THESE LATER!!!!!!)
	// 	// 		// if tool includes a uri in uriSet, skip it obviously
	// 	// 		let uriSet = new Set<URI>()
	// 	// 		// gather
	// 	// 		let messages = []
	// 	// 		while (true) {
	// 	// 			const result = await new Promise((res, rej) => {
	// 	// 				sendLLMMessage({
	// 	// 					messages,
	// 	// 					tools: ['search'],
	// 	// 					onFinalMessage: ({ result: r, }) => {
	// 	// 						res(r)
	// 	// 					},
	// 	// 					onError: (error) => {
	// 	// 						rej(error)
	// 	// 					}
	// 	// 				})
	// 	// 			})

	// 	// 			messages.push({ role: 'tool', content: turnToString(result) })

	// 	// 			sendLLMMessage({
	// 	// 				messages: { 'Output ': result },
	// 	// 				onFinalMessage: (r) => {
	// 	// 					// output is file1\nfile2\nfile3\n...
	// 	// 				}
	// 	// 			})

	// 	// 			uriSet.add(...)
	// 	// 		}

	// 	// 		// writes
	// 	// 		if (!replaceClause) return

	// 	// 		for (const uri of uriSet) {
	// 	// 			// in future, batch these
	// 	// 			applyWorkflow({ uri, applyStr: replaceClause })
	// 	// 		}






	// 	// while (true) {
	// 	// 	const result = new Promise((res, rej) => {
	// 	// 		sendLLMMessage({
	// 	// 			messages,
	// 	// 			tools: ['search'],
	// 	// 			onResult: (r) => {
	// 	// 				res(r)
	// 	// 			}
	// 	// 		})
	// 	// 	})

	// 	// 	messages.push(result)

	// 	// }


	// }


	// private async _replaceUsingAI({ searchClause, replaceClause, relevantURIs }: { searchClause: string, replaceClause: string, relevantURIs: URI[] }) {

	// 	for (const uri of relevantURIs) {

	// 		uri

	// 	}



	// 	// should I change this file?
	// 	// if so what changes to make?



	// 	// fast apply the changes
	// }



}

registerSingleton(IVoidFastApplyService, VoidFastApplyService, InstantiationType.Eager);
