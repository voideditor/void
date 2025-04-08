/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { endsWithAnyPrefixOf } from '../../common/helpers/extractCodeFromResult.js'
import { availableTools, InternalToolInfo, ToolName } from '../../common/prompt/prompts.js'
import { OnFinalMessage, OnText, RawToolCallObj } from '../../common/sendLLMMessageTypes.js'
import { ChatMode } from '../../common/voidSettingsTypes.js'
import { createSaxParser } from './sax.js'


// =============== reasoning ===============

// could simplify this - this assumes we can never add a tag without committing it to the user's screen, but that's not true
export const extractReasoningWrapper = (
	onText: OnText, onFinalMessage: OnFinalMessage, thinkTags: [string, string]
): { newOnText: OnText, newOnFinalMessage: OnFinalMessage } => {
	let latestAddIdx = 0 // exclusive index in fullText_
	let foundTag1 = false
	let foundTag2 = false

	let fullTextSoFar = ''
	let fullReasoningSoFar = ''

	let onText_ = onText
	onText = (params) => {
		onText_(params)
	}

	const newOnText: OnText = ({ fullText: fullText_, ...p }) => {
		// until found the first think tag, keep adding to fullText
		if (!foundTag1) {
			const endsWithTag1 = endsWithAnyPrefixOf(fullText_, thinkTags[0])
			if (endsWithTag1) {
				// console.log('endswith1', { fullTextSoFar, fullReasoningSoFar, fullText_ })
				// wait until we get the full tag or know more
				return
			}
			// if found the first tag
			const tag1Index = fullText_.indexOf(thinkTags[0])
			if (tag1Index !== -1) {
				// console.log('tag1Index !==1', { tag1Index, fullTextSoFar, fullReasoningSoFar, thinkTags, fullText_ })
				foundTag1 = true
				// Add text before the tag to fullTextSoFar
				fullTextSoFar += fullText_.substring(0, tag1Index)
				// Update latestAddIdx to after the first tag
				latestAddIdx = tag1Index + thinkTags[0].length
				onText({ ...p, fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar })
				return
			}

			// console.log('adding to text A', { fullTextSoFar, fullReasoningSoFar })
			// add the text to fullText
			fullTextSoFar = fullText_
			latestAddIdx = fullText_.length
			onText({ ...p, fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar })
			return
		}

		// at this point, we found <tag1>

		// until found the second think tag, keep adding to fullReasoning
		if (!foundTag2) {
			const endsWithTag2 = endsWithAnyPrefixOf(fullText_, thinkTags[1])
			if (endsWithTag2) {
				// console.log('endsWith2', { fullTextSoFar, fullReasoningSoFar })
				// wait until we get the full tag or know more
				return
			}

			// if found the second tag
			const tag2Index = fullText_.indexOf(thinkTags[1], latestAddIdx)
			if (tag2Index !== -1) {
				// console.log('tag2Index !== -1', { fullTextSoFar, fullReasoningSoFar })
				foundTag2 = true
				// Add everything between first and second tag to reasoning
				fullReasoningSoFar += fullText_.substring(latestAddIdx, tag2Index)
				// Update latestAddIdx to after the second tag
				latestAddIdx = tag2Index + thinkTags[1].length
				onText({ ...p, fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar })
				return
			}

			// add the text to fullReasoning (content after first tag but before second tag)
			// console.log('adding to text B', { fullTextSoFar, fullReasoningSoFar })

			// If we have more text than we've processed, add it to reasoning
			if (fullText_.length > latestAddIdx) {
				fullReasoningSoFar += fullText_.substring(latestAddIdx)
				latestAddIdx = fullText_.length
			}

			onText({ ...p, fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar })
			return
		}

		// at this point, we found <tag2> - content after the second tag is normal text
		// console.log('adding to text C', { fullTextSoFar, fullReasoningSoFar })

		// Add any new text after the closing tag to fullTextSoFar
		if (fullText_.length > latestAddIdx) {
			fullTextSoFar += fullText_.substring(latestAddIdx)
			latestAddIdx = fullText_.length
		}

		onText({ ...p, fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar })
	}


	const getOnFinalMessageParams = () => {
		const fullText_ = fullTextSoFar
		const tag1Idx = fullText_.indexOf(thinkTags[0])
		const tag2Idx = fullText_.indexOf(thinkTags[1])
		if (tag1Idx === -1) return { fullText: fullText_, fullReasoning: '' } // never started reasoning
		if (tag2Idx === -1) return { fullText: '', fullReasoning: fullText_ } // never stopped reasoning

		const fullReasoning = fullText_.substring(tag1Idx + thinkTags[0].length, tag2Idx)
		const fullText = fullText_.substring(0, tag1Idx) + fullText_.substring(tag2Idx + thinkTags[1].length, Infinity)

		return { fullText, fullReasoning }
	}

	const newOnFinalMessage: OnFinalMessage = (params) => {

		// treat like just got text before calling onFinalMessage (or else we sometimes miss the final chunk that's new to finalMessage)
		newOnText({ ...params })

		const { fullText, fullReasoning } = getOnFinalMessageParams()
		onFinalMessage({ ...params, fullText, fullReasoning })
	}

	return { newOnText, newOnFinalMessage }
}


// =============== tools ===============

type ToolsState = {
	level: 'normal',
} | {
	level: 'tool',
	toolName: string,
	currentToolCall: RawToolCallObj,
} | {
	level: 'param',
	toolName: string,
	paramName: string,
	currentToolCall: RawToolCallObj,
}

export const extractToolsWrapper = (
	onText: OnText, onFinalMessage: OnFinalMessage, chatMode: ChatMode
): { newOnText: OnText, newOnFinalMessage: OnFinalMessage } => {
	const tools = availableTools(chatMode)
	if (!tools) return { newOnText: onText, newOnFinalMessage: onFinalMessage }

	const toolOfToolName: { [toolName: string]: InternalToolInfo | undefined } = {}
	for (const t of tools) { toolOfToolName[t.name] = t }

	// detect <availableTools[0]></availableTools[0]>, etc
	let fullText = '';
	let trueFullText = ''
	const currentToolCalls: RawToolCallObj[] = []; // the answer

	let state: ToolsState = { level: 'normal' }


	const getRawNewText = () => {
		return trueFullText.substring(parser.startTagPosition, parser.position + 1)
	}
	const parser = createSaxParser({ lowercase: true })

	// when see open tag <tagName>
	parser.onopentag = (node) => {
		const rawNewText = getRawNewText()
		const tagName = node.name;
		console.log('OPENING', tagName)
		console.log('state0:', state.level, { toolName: (state as any).toolName, paramName: (state as any).paramName })

		if (state.level === 'normal') {
			if (tagName in toolOfToolName) { // valid toolName
				state = {
					level: 'tool',
					toolName: tagName,
					currentToolCall: { name: tagName as ToolName, rawParams: {}, doneParams: [], isDone: false }
				}
			}
			else {
				fullText += rawNewText // count as plaintext
				console.log('adding raw a', rawNewText)

			}
		}
		else if (state.level === 'tool') {
			if (tagName in (toolOfToolName[state.toolName]?.params ?? {})) { // valid param
				state = {
					level: 'param',
					toolName: state.toolName,
					paramName: tagName,
					currentToolCall: state.currentToolCall,
				}
			}
			else {
				// would normally be rawNewText, but we ignore all text inside tools
			}
		}
		else if (state.level === 'param') { // cannot double nest
			fullText += rawNewText // count as plaintext
			console.log('adding raw b', rawNewText)

		}

		console.log('state1:', state.level, { toolName: (state as any).toolName, paramName: (state as any).paramName })

	};

	parser.onclosetag = (tagName) => {
		const rawNewText = getRawNewText()
		console.log('CLOSING', tagName)
		console.log('state0:', state.level, { toolName: (state as any).toolName, paramName: (state as any).paramName })


		if (state.level === 'normal') {
			fullText += rawNewText
			console.log('adding raw A', rawNewText)
		}
		else if (state.level === 'tool') {
			if (tagName === state.toolName) { // closed the tool
				state.currentToolCall.isDone = true
				currentToolCalls.push(state.currentToolCall)
				state = {
					level: 'normal',
				}
			}
			else { // add as text
				fullText += rawNewText
				console.log('adding raw B', rawNewText)
			}
		}
		else if (state.level === 'param') {
			if (tagName === state.paramName) { // closed the param
				state.currentToolCall.doneParams.push(state.paramName)
				state = {
					level: 'tool',
					toolName: state.toolName,
					currentToolCall: state.currentToolCall,
				}
			}
			else {
				fullText += rawNewText
				console.log('adding raw C', rawNewText)

			}
		}
		console.log('state1:', state.level, { toolName: (state as any).toolName, paramName: (state as any).paramName })


	};


	parser.ontext = (text) => {
		if (state.level === 'normal') {
			fullText += text
		}
		// start param
		else if (state.level === 'tool') {
			// ignore all text in a tool, all text should go in the param tags inside it
		}
		else if (state.level === 'param') {
			if (!(state.paramName in state.currentToolCall.rawParams)) state.currentToolCall.rawParams[state.paramName] = ''
			state.currentToolCall.rawParams[state.paramName] += text
		}
	}



	let prevFullTextLen = 0
	const newOnText: OnText = (params) => {
		const newText = params.fullText.substring(prevFullTextLen)
		prevFullTextLen = params.fullText.length
		trueFullText = params.fullText

		parser.write(newText)

		onText({
			...params,
			fullText,
			toolCall: currentToolCalls.length > 0 ? currentToolCalls[0] : undefined
		});
	};


	const newOnFinalMessage: OnFinalMessage = (params) => {
		// treat like just got text before calling onFinalMessage (or else we sometimes miss the final chunk that's new to finalMessage)
		newOnText({ ...params })

		console.log('final message!!!', trueFullText)
		console.log('----- returning ----\n', fullText)
		console.log('----- tools ----\n', JSON.stringify(currentToolCalls, null, 2))

		fullText = fullText.trimEnd()
		const toolCall = currentToolCalls[0]
		if (toolCall) {
			// trim off all whitespace at and before first \n and after last \n for each param
			for (const paramName in toolCall.rawParams) {
				const orig = toolCall.rawParams[paramName]
				if (orig === undefined) continue
				toolCall.rawParams[paramName] = trimBeforeAndAfterNewLines(orig)
			}
		}
		onFinalMessage({ ...params, fullText, toolCall: currentToolCalls.length > 0 ? currentToolCalls[0] : undefined })
	}
	return { newOnText, newOnFinalMessage };
}



// trim all whitespace up until the first newline, and all whitespace after the last newline
const trimBeforeAndAfterNewLines = (s: string) => {
	if (!s) return s;

	const firstNewLineIndex = s.indexOf('\n');

	if (firstNewLineIndex !== -1 && s.substring(0, firstNewLineIndex).trim() === '') {
		s = s.substring(firstNewLineIndex + 1, Infinity)
	}

	const lastNewLineIndex = s.lastIndexOf('\n');
	if (lastNewLineIndex !== -1 && s.substring(lastNewLineIndex + 1, Infinity).trim() === '') {
		s = s.substring(0, lastNewLineIndex)
	}

	return s
}
