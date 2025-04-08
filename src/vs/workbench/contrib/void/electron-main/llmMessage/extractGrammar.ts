import { endsWithAnyPrefixOf } from '../../common/helpers/extractCodeFromResult.js'
import { availableTools, InternalToolInfo, ToolName } from '../../common/prompt/prompts.js'
import { OnText, RawToolCallObj } from '../../common/sendLLMMessageTypes.js'
import { ChatMode } from '../../common/voidSettingsTypes.js'
import sax from 'sax'


// =============== reasoning ===============

// could simplify this - this assumes we can never add a tag without committing it to the user's screen, but that's not true
export const extractReasoningOnTextWrapper = (onText: OnText, thinkTags: [string, string]): OnText => {
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

	return newOnText
}


export const extractReasoningOnFinalMessage = (fullText_: string, thinkTags: [string, string]): { fullText: string, fullReasoning: string } => {
	const tag1Idx = fullText_.indexOf(thinkTags[0])
	const tag2Idx = fullText_.indexOf(thinkTags[1])
	if (tag1Idx === -1) return { fullText: fullText_, fullReasoning: '' } // never started reasoning
	if (tag2Idx === -1) return { fullText: '', fullReasoning: fullText_ } // never stopped reasoning

	const fullReasoning = fullText_.substring(tag1Idx + thinkTags[0].length, tag2Idx)
	const fullText = fullText_.substring(0, tag1Idx) + fullText_.substring(tag2Idx + thinkTags[1].length, Infinity)
	return { fullText, fullReasoning }
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

export const extractToolsOnTextWrapper = (onText: OnText, chatMode: ChatMode) => {
	const tools = availableTools(chatMode)
	if (!tools) return onText

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
	const parser = sax.parser(false, {
		lowercase: true,
	});


	// when see open tag <tagName>
	parser.onopentag = (node) => {
		const rawNewText = getRawNewText()
		console.log('raw new text a', rawNewText)
		console.log('OPEN!', node.name)
		const tagName = node.name;
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
		else if (state.level === 'param') {
			fullText += rawNewText // count as plaintext
		}
	};

	parser.ontext = (text) => {
		console.log('TEXT!', JSON.stringify(text))
		if (state.level === 'normal') {
			fullText += text
		}
		// start param
		else if (state.level === 'tool') {
			// ignore all text in a tool, all text should go in the param tags inside it
		}
		else if (state.level === 'param') {
			state.currentToolCall.rawParams[state.currentToolCall.name] += text
		}
	}

	parser.onclosetag = (tagName) => {
		const rawNewText = getRawNewText()
		console.log('raw new text b', rawNewText)
		console.log('CLOSE!', tagName)
		if (state.level === 'normal') {
			fullText += rawNewText
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
			}
		}

	};

	let prevFullTextLen = 0
	const newOnText: OnText = (params) => {
		const newText = params.fullText.substring(prevFullTextLen)
		prevFullTextLen = params.fullText.length
		trueFullText = params.fullText

		console.log('newText', newText.length)
		parser.write(newText)

		console.log('calling ontext...')
		onText({
			...params,
			fullText,
			toolCall: currentToolCalls.length > 0 ? currentToolCalls[0] : undefined
		});
	};

	return newOnText;
}





