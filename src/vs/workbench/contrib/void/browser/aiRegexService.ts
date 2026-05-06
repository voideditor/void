/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

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
// 	// 					tools: ['search_for_files'],
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
// 	// 			tools: ['search_for_files'],
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

