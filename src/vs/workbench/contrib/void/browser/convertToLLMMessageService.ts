/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { AnyToolName, ChatAttachment, ChatMessage } from '../../../../platform/void/common/chatThreadServiceTypes.js';
import {
	getIsReasoningEnabledState,
	setDynamicModelService,
	getModelCapabilities,
	VoidStaticModelInfo,
	getReservedOutputTokenSpace,
	getModelApiConfiguration
} from '../../../../platform/void/common/modelInference.js';
import { isAToolName, reParsedToolXMLString, chat_systemMessage, ToolName, SYSTEM_PROMPT_OVERRIDE } from '../common/prompt/prompts.js';
import {
	AnthropicLLMChatMessage,
	AnthropicReasoning,
	AnthropicUserBlock,
	GeminiLLMChatMessage,
	LLMChatMessage,
	LLMFIMMessage,
	OpenAILLMChatMessage,
	OpenAITextPart,
	OpenAIImageURLPart,
	RawToolParamsObj
} from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import {
	ChatMode,
	specialToolFormat,
	supportsSystemMessage,
	FeatureName,
	ModelSelection,
	ProviderName
} from '../../../../platform/void/common/voidSettingsTypes.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { URI } from '../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../editor/common/language/model.js';
import { ILocalPtyService } from '../../../../platform/terminal/common/terminal.js'
import { IDynamicProviderRegistryService } from '../../../../platform/void/common/providerReg.js';
import { IDynamicModelService } from '../../../../platform/void/common/dynamicModelService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export const EMPTY_MESSAGE = ''

type ResolvedChatAttachment = ChatAttachment & { dataBase64?: string };

type SimpleLLMMessage = {
	role: 'tool';
	content: string;
	id: string;
	name: AnyToolName;
	rawParams: RawToolParamsObj;
} | {
	role: 'user';
	content: string;
	attachments?: ResolvedChatAttachment[];
} | {
	role: 'assistant';
	content: string;
	anthropicReasoning: AnthropicReasoning[] | null;
}

const CHARS_PER_TOKEN = 4 // assume abysmal chars per token
const TRIM_TO_LEN = 120

// convert messages as if about to send to openai
/*
reference - https://platform.openai.com/docs/guides/function-calling#function-calling-steps
openai MESSAGE (role=assistant):
"tool_calls":[{
	"type": "function",
	"id": "call_12345xyz",
	"function": {
	"name": "get_weather",
	"arguments": "{\"latitude\":48.8566,\"longitude\":2.3522}"
}]

openai RESPONSE (role=user):
{   "role": "tool",
	"tool_call_id": tool_call.id,
	"content": str(result)    }

also see
openai on prompting - https://platform.openai.com/docs/guides/reasoning#advice-on-prompting
openai on developer system message - https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command
*/


const buildOpenAIUserContent = (msg: Extract<SimpleLLMMessage, { role: 'user' }>): string | (OpenAITextPart | OpenAIImageURLPart)[] => {
	const atts = msg.attachments ?? [];
	if (!atts.length) return msg.content;

	const parts: (OpenAITextPart | OpenAIImageURLPart)[] = [];
	const trimmed = msg.content.trim();
	if (trimmed) {
		parts.push({ type: 'text', text: trimmed });
	}
	for (const att of atts) {
		if (!att.dataBase64) continue;
		const mime = att.mimeType || 'image/png';
		const dataUrl = `data:${mime};base64,${att.dataBase64}`;
		parts.push({ type: 'image_url', image_url: { url: dataUrl } });
	}
	return parts.length ? parts : msg.content;
};

const prepareOpenAIToolsMessages = (messages: SimpleLLMMessage[]): AnthropicOrOpenAILLMMessage[] => {

	const newMessages: OpenAILLMChatMessage[] = [];

	for (let i = 0; i < messages.length; i += 1) {
		const currMsg = messages[i]

		if (currMsg.role !== 'tool') {
			if (currMsg.role === 'user') {
				newMessages.push({ role: 'user', content: buildOpenAIUserContent(currMsg) });
			} else if (currMsg.role === 'assistant') {
				newMessages.push({ role: 'assistant', content: currMsg.content });
			} else {
				// allow-any-unicode-next-line
				// Fallback for unexpected roles – treat as simple user message
				newMessages.push({ role: 'user', content: (currMsg as any).content });
			}
			continue
		}

		// edit previous assistant message to have called the tool
		const prevMsg = 0 <= i - 1 && i - 1 <= newMessages.length ? newMessages[i - 1] : undefined
		if (prevMsg?.role === 'assistant') {
			prevMsg.tool_calls = [{
				type: 'function',
				id: currMsg.id,
				function: {
					name: currMsg.name,
					arguments: JSON.stringify(currMsg.rawParams)
				}
			}]
		}

		// add the tool
		newMessages.push({
			role: 'tool',
			tool_call_id: currMsg.id,
			content: currMsg.content,
		})
	}
	return newMessages

}



// convert messages as if about to send to anthropic
/*
https://docs.anthropic.com/en/docs/build-with-claude/tool-use#tool-use-examples
anthropic MESSAGE (role=assistant):
"content": [{
	"type": "text",
	"text": "<thinking>I need to call the get_weather function, and the user wants SF, which is likely San Francisco, CA.</thinking>"
}, {
	"type": "tool_use",
	"id": "toolu_01A09q90qw90lq917835lq9",
	"name": "get_weather",
	"input": { "location": "San Francisco, CA", "unit": "celsius" }
}]
anthropic RESPONSE (role=user):
"content": [{
	"type": "tool_result",
	"tool_use_id": "toolu_01A09q90qw90lq917835lq9",
	"content": "15 degrees"
}]


Converts:
assistant: ...content
tool: (id, name, params)
->
assistant: ...content, call(name, id, params)
user: ...content, result(id, content)
*/

type AnthropicOrOpenAILLMMessage = AnthropicLLMChatMessage | OpenAILLMChatMessage

const buildAnthropicUserContent = (msg: Extract<SimpleLLMMessage, { role: 'user' }>): string | AnthropicUserBlock[] => {
	const atts = msg.attachments ?? [];
	if (!atts.length) return msg.content;

	const parts: AnthropicUserBlock[] = [];
	const trimmed = msg.content.trim();
	if (trimmed) {
		parts.push({ type: 'text', text: trimmed });
	}
	for (const att of atts) {
		if (!att.dataBase64) continue;
		// Restrict to Anthropic-allowed image media types
		let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
		if (att.mimeType === 'image/jpeg' || att.mimeType === 'image/jpg') mediaType = 'image/jpeg';
		else if (att.mimeType === 'image/gif') mediaType = 'image/gif';
		else if (att.mimeType === 'image/webp') mediaType = 'image/webp';
		parts.push({
			type: 'image',
			source: { type: 'base64', media_type: mediaType, data: att.dataBase64 },
		});
	}
	return parts.length ? parts : msg.content;
};

const prepareAnthropicToolsMessages = (messages: SimpleLLMMessage[], supportsAnthropicReasoning: boolean): AnthropicOrOpenAILLMMessage[] => {
	const newMessages: AnthropicLLMChatMessage[] = [];

	for (let i = 0; i < messages.length; i += 1) {
		const currMsg = messages[i];

		if (currMsg.role === 'assistant') {
			if (currMsg.anthropicReasoning && supportsAnthropicReasoning) {
				const content = currMsg.content;
				newMessages.push({
					role: 'assistant',
					content: content
						? [...currMsg.anthropicReasoning, { type: 'text' as const, text: content }]
						: currMsg.anthropicReasoning
				});
			} else {
				newMessages.push({ role: 'assistant', content: currMsg.content });
			}
			continue;
		}

		if (currMsg.role === 'user') {
			newMessages.push({
				role: 'user',
				content: buildAnthropicUserContent(currMsg),
			});
			continue;
		}

		if (currMsg.role === 'tool') {
			const prevMsg = newMessages.length ? newMessages[newMessages.length - 1] : undefined;

			if (prevMsg?.role === 'assistant') {
				if (typeof prevMsg.content === 'string') {
					prevMsg.content = [{ type: 'text', text: prevMsg.content }];
				}
				(prevMsg.content as any[]).push({
					type: 'tool_use',
					id: currMsg.id,
					name: currMsg.name as string,
					input: currMsg.rawParams,
				});
			}

			newMessages.push({
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: currMsg.id, content: currMsg.content }],
			});
			continue;
		}
	}

	return newMessages;
}


const prepareXMLToolsMessages = (messages: SimpleLLMMessage[], supportsAnthropicReasoning: boolean): AnthropicOrOpenAILLMMessage[] => {

	const llmChatMessages: AnthropicOrOpenAILLMMessage[] = [];
	for (let i = 0; i < messages.length; i += 1) {

		const c = messages[i]
		const next = 0 <= i + 1 && i + 1 <= messages.length - 1 ? messages[i + 1] : null

		if (c.role === 'assistant') {
			// if called a tool (message after it), re-add its XML to the message
			// alternatively, could just hold onto the original output, but this way requires less piping raw strings everywhere
			let content: AnthropicOrOpenAILLMMessage['content'] = c.content
			if (next?.role === 'tool' && isAToolName(next.name)) {
				content = `${content}\n\n${reParsedToolXMLString(next.name, next.rawParams)}`
			}

			// anthropic reasoning
			if (c.anthropicReasoning && supportsAnthropicReasoning) {
				content = content ? [...c.anthropicReasoning, { type: 'text' as const, text: content }] : c.anthropicReasoning
			}
			llmChatMessages.push({
				role: 'assistant',
				content
			})
		}
		// add user or tool to the previous user message
		else if (c.role === 'user' || c.role === 'tool') {
			if (c.role === 'tool')
				c.content = `<${c.name}_result>\n${c.content}\n</${c.name}_result>`

			// NOTE: For XML tool format we cannot send true image parts, so we append
			// a lightweight textual placeholder for any attachments.
			if (c.role === 'user' && (c as any).attachments && (c as any).attachments.length) {
				const atts = (c as any).attachments as ResolvedChatAttachment[];
				const placeholderLines = atts.map(att => `Attached image: ${att.name}`);
				c.content = c.content
					? `${c.content}\n\n${placeholderLines.join('\n')}`
					: placeholderLines.join('\n');
			}

			if (llmChatMessages.length === 0 || llmChatMessages[llmChatMessages.length - 1].role !== 'user')
				llmChatMessages.push({
					role: 'user',
					content: c.content
				})
			else
				llmChatMessages[llmChatMessages.length - 1].content += '\n\n' + c.content
		}
	}
	return llmChatMessages
}


// --- CHAT ---

const prepareOpenAIOrAnthropicMessages = ({
	messages: messages_,
	systemMessage,
	aiInstructions,
	supportsSystemMessage,
	specialToolFormat,
	supportsAnthropicReasoning,
	contextWindow,
	reservedOutputTokenSpace,
}: {
	messages: SimpleLLMMessage[],
	systemMessage: string,
	aiInstructions: string,
	supportsSystemMessage: supportsSystemMessage,
	specialToolFormat: specialToolFormat,
	supportsAnthropicReasoning: boolean,
	contextWindow: number,
	reservedOutputTokenSpace: number | null | undefined,
}): { messages: AnthropicOrOpenAILLMMessage[], separateSystemMessage: string | undefined } => {

	reservedOutputTokenSpace = Math.max(
		contextWindow * 1 / 2, // reserve at least 1/4 of the token window length
		reservedOutputTokenSpace ?? 4_096 // defaults to 4096
	)
	let messages: (SimpleLLMMessage | { role: 'system', content: string })[] = deepClone(messages_)

	// ================ system message ================
	// A COMPLETE HACK: last message is system message for context purposes

	const sysMsgParts: string[] = []
	if (aiInstructions) sysMsgParts.push(`GUIDELINES (from the user's .voidrules file):\n${aiInstructions}`)
	if (systemMessage) sysMsgParts.push(systemMessage)
	const combinedSystemMessage = sysMsgParts.join('\n\n')

	messages.unshift({ role: 'system', content: combinedSystemMessage })

	// ================ trim ================
	messages = messages.map(m => ({ ...m, content: m.role !== 'tool' ? m.content.trim() : m.content }))

	type MesType = (typeof messages)[0]

	// ================ fit into context ================

	// the higher the weight, the higher the desire to truncate - TRIM HIGHEST WEIGHT MESSAGES
	const alreadyTrimmedIdxes = new Set<number>()
	const weight = (message: MesType, messages: MesType[], idx: number) => {
		const base = message.content.length

		let multiplier: number
		multiplier = 1 + (messages.length - 1 - idx) / messages.length // slow rampdown from 2 to 1 as index increases
		if (message.role === 'user') {
			multiplier *= 1
		}
		else if (message.role === 'system') {
			multiplier *= .01 // very low weight
		}
		else {
			multiplier *= 10 // llm tokens are far less valuable than user tokens
		}

		// any already modified message should not be trimmed again
		if (alreadyTrimmedIdxes.has(idx)) {
			multiplier = 0
		}
		// 1st and last messages should be very low weight
		if (idx <= 1 || idx >= messages.length - 1 - 3) {
			multiplier *= .05
		}
		return base * multiplier
	}

	const _findLargestByWeight = (messages_: MesType[]) => {
		let largestIndex = -1
		let largestWeight = -Infinity
		for (let i = 0; i < messages.length; i += 1) {
			const m = messages[i]
			const w = weight(m, messages_, i)
			if (w > largestWeight) {
				largestWeight = w
				largestIndex = i
			}
		}
		return largestIndex
	}

	let totalLen = 0
	for (const m of messages) { totalLen += m.content.length }
	const charsNeedToTrim = totalLen - Math.max(
		(contextWindow - reservedOutputTokenSpace) * CHARS_PER_TOKEN, // can be 0, in which case charsNeedToTrim=everything, bad
		5_000 // ensure we don't trim at least 5k chars (just a random small value)
	)


	// <----------------------------------------->
	// 0                      |    |             |
	//                        |    contextWindow |
	//                     contextWindow - maxOut|putTokens
	//                                          totalLen
	let remainingCharsToTrim = charsNeedToTrim
	let i = 0

	while (remainingCharsToTrim > 0) {
		i += 1
		if (i > 100) break

		const trimIdx = _findLargestByWeight(messages)
		const m = messages[trimIdx]

		// if can finish here, do
		const numCharsWillTrim = m.content.length - TRIM_TO_LEN
		if (numCharsWillTrim > remainingCharsToTrim) {
			// trim remainingCharsToTrim + '...'.length chars
			m.content = m.content.slice(0, m.content.length - remainingCharsToTrim - '...'.length).trim() + '...'
			break
		}

		remainingCharsToTrim -= numCharsWillTrim
		m.content = m.content.substring(0, TRIM_TO_LEN - '...'.length) + '...'
		alreadyTrimmedIdxes.add(trimIdx)
	}

	// ================ system message hack ================
	const newSysMsg = messages.shift()!.content


	// ================ tools and anthropicReasoning ================
	// SYSTEM MESSAGE HACK: we shifted (removed) the system message role, so now SimpleLLMMessage[] is valid

	let llmChatMessages: AnthropicOrOpenAILLMMessage[] = []
	if (specialToolFormat === 'disabled') { // XML tool behavior
		llmChatMessages = prepareXMLToolsMessages(messages as SimpleLLMMessage[], supportsAnthropicReasoning)
	}
	else if (specialToolFormat === 'anthropic-style') {
		llmChatMessages = prepareAnthropicToolsMessages(messages as SimpleLLMMessage[], supportsAnthropicReasoning)
	}
	else if (specialToolFormat === 'openai-style') {
		llmChatMessages = prepareOpenAIToolsMessages(messages as SimpleLLMMessage[])
	}
	const llmMessages = llmChatMessages


	// ================ system message add as first llmMessage ================

	let separateSystemMessageStr: string | undefined = undefined

	// if supports system message
	if (supportsSystemMessage) {
		if (supportsSystemMessage === 'separated')
			separateSystemMessageStr = newSysMsg
		else if (supportsSystemMessage === 'system-role')
			llmMessages.unshift({ role: 'system', content: newSysMsg }) // add new first message
		else if (supportsSystemMessage === 'developer-role')
			llmMessages.unshift({ role: 'developer', content: newSysMsg }) // add new first message
	}
	// if does not support system message
	else {
		const newFirstMessage = {
			role: 'user',
			content: `<SYSTEM_MESSAGE>\n${newSysMsg}\n</SYSTEM_MESSAGE>\n${llmMessages[0].content}`
		} as const
		llmMessages.splice(0, 1) // delete first message
		llmMessages.unshift(newFirstMessage) // add new first message
	}


	// ================ no empty message ================
	for (let i = 0; i < llmMessages.length; i += 1) {
		const currMsg: AnthropicOrOpenAILLMMessage = llmMessages[i]
		const nextMsg: AnthropicOrOpenAILLMMessage | undefined = llmMessages[i + 1]

		if (currMsg.role === 'tool') continue

		// if content is a string, replace string with empty msg
		if (typeof currMsg.content === 'string') {
			currMsg.content = currMsg.content || EMPTY_MESSAGE
		}
		else {
			// allowed to be empty if has a tool in it or following it
			if (currMsg.content.find(c => c.type === 'tool_result' || c.type === 'tool_use')) {
				continue
			}
			if (nextMsg?.role === 'tool') continue

			// replace any empty text entries with empty msg, and make sure there's at least 1 entry
			for (const c of currMsg.content) {
				if (c.type === 'text') c.text = c.text || EMPTY_MESSAGE
			}
			if (currMsg.content.length === 0) currMsg.content = [{ type: 'text', text: EMPTY_MESSAGE }]
		}
	}

	return {
		messages: llmMessages,
		separateSystemMessage: separateSystemMessageStr,
	} as const
}


type GeminiUserPart = (GeminiLLMChatMessage & { role: 'user' })['parts'][0]
type GeminiModelPart = (GeminiLLMChatMessage & { role: 'model' })['parts'][0]
const prepareGeminiMessages = (messages: AnthropicLLMChatMessage[]) => {
	let latestToolName: ToolName | undefined = undefined
	const messages2: GeminiLLMChatMessage[] = messages.map((m): GeminiLLMChatMessage | null => {
		if (m.role === 'assistant') {
			if (typeof m.content === 'string') {
				return { role: 'model', parts: [{ text: m.content }] }
			}
			else {
				const parts: GeminiModelPart[] = m.content.map((c): GeminiModelPart | null => {
					if (c.type === 'text') {
						return { text: c.text }
					}
					else if (c.type === 'tool_use') {
						if (!isAToolName(c.name)) {
							return { text: JSON.stringify({ tool_use: c }) }
						}
						latestToolName = c.name
						return { functionCall: { id: c.id, name: c.name, args: c.input } }
					}
					else return null
				}).filter(m => !!m)
				return { role: 'model', parts, }
			}
		}
		else if (m.role === 'user') {
			if (typeof m.content === 'string') {
				return { role: 'user', parts: [{ text: m.content }] } satisfies GeminiLLMChatMessage
			}
			else {
				const parts: GeminiUserPart[] = m.content.map((c): GeminiUserPart | null => {
					if (c.type === 'text') {
						return { text: c.text }
					}
					else if (c.type === 'tool_result') {
						if (!latestToolName) {
							return { text: JSON.stringify({ tool_result: c }) }
						}
						return { functionResponse: { id: c.tool_use_id, name: latestToolName, response: { output: c.content } } }
					}
					else if ((c as any).type === 'image' && (c as any).source?.type === 'base64') {
						const src = (c as any).source as { media_type: string; data: string };
						return { inlineData: { mimeType: src.media_type, data: src.data } } as any;
					}
					else return null
				}).filter(m => !!m)
				return { role: 'user', parts, }
			}

		}
		else return null
	}).filter(m => !!m)

	return messages2
}


const prepareMessages = (params: {
	messages: SimpleLLMMessage[],
	systemMessage: string,
	aiInstructions: string,
	supportsSystemMessage: supportsSystemMessage,
	specialToolFormat: specialToolFormat,
	supportsAnthropicReasoning: boolean,
	contextWindow: number,
	reservedOutputTokenSpace: number | null | undefined,
	providerName: ProviderName
}): { messages: LLMChatMessage[], separateSystemMessage: string | undefined } => {
	// if need to convert to gemini style of messages, do that (treat as anthropic style, then convert to gemini style)
	if (params.providerName === 'gemini' || params.specialToolFormat === 'gemini-style') {
		const res = prepareOpenAIOrAnthropicMessages({ ...params, specialToolFormat: 'anthropic-style' })
		const messages = res.messages as AnthropicLLMChatMessage[]
		const messages2 = prepareGeminiMessages(messages)
		return { messages: messages2, separateSystemMessage: res.separateSystemMessage }
	}

	const res = prepareOpenAIOrAnthropicMessages({ ...params })
	return { messages: res.messages, separateSystemMessage: res.separateSystemMessage }
}

export interface IConvertToLLMMessageService {
	readonly _serviceBrand: undefined;
	prepareLLMSimpleMessages: (opts: { simpleMessages: SimpleLLMMessage[], systemMessage: string, modelSelection: ModelSelection | null, featureName: FeatureName }) => { messages: LLMChatMessage[], separateSystemMessage: string | undefined }
	prepareLLMChatMessages: (opts: { chatMessages: ChatMessage[], chatMode: ChatMode, modelSelection: ModelSelection | null }) => Promise<{ messages: LLMChatMessage[], separateSystemMessage: string | undefined }>
	prepareFIMMessage(opts: { messages: LLMFIMMessage, }): { prefix: string, suffix: string, stopTokens: string[] }
}

export const IConvertToLLMMessageService = createDecorator<IConvertToLLMMessageService>('ConvertToLLMMessageService');



class ConvertToLLMMessageService extends Disposable implements IConvertToLLMMessageService {
	_serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILocalPtyService private readonly ptyHostService: ILocalPtyService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IVoidModelService private readonly voidModelService: IVoidModelService,
		@IDynamicProviderRegistryService private readonly dynamicRegistry: IDynamicProviderRegistryService,
		@IDynamicModelService private readonly dynamicModelService: IDynamicModelService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		try {
			setDynamicModelService(this.dynamicModelService);
			void this.dynamicModelService.initialize?.();
		} catch {
			// ignore
		}
	}

	// Resolve explicit user override for supportsSystemMessage, case-insensitive provider and flexible model key
	private _getUserSupportsSystemMessageOverride(providerName: ProviderName, modelName: string): supportsSystemMessage | undefined {
		try {
			const overrides = this.voidSettingsService.state.overridesOfModel;
			if (!overrides) return undefined;
			const provKey = Object.keys(overrides).find(k => k.toLowerCase() === String(providerName).toLowerCase());
			if (!provKey) return undefined;
			const byModel = (overrides as any)[provKey] as Record<string, { supportsSystemMessage?: supportsSystemMessage } | undefined>;
			const exact = byModel?.[modelName]?.supportsSystemMessage;
			if (exact !== undefined) return exact;
			if (modelName.includes('/')) {
				const after = modelName.slice(modelName.indexOf('/') + 1);
				const alt = byModel?.[after]?.supportsSystemMessage;
				if (alt !== undefined) return alt;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	// Read .voidrules files from workspace folders
	private _getVoidRulesFileContents(): string {
		try {
			const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
			let voidRules = '';
			for (const folder of workspaceFolders) {
				const uri = URI.joinPath(folder.uri, '.voidrules');
				const { model } = this.voidModelService.getModel(uri);
				if (!model) continue;
				voidRules += model.getValue(EndOfLinePreference.LF) + '\n\n';
			}
			return voidRules.trim();
		} catch {
			return '';
		}
	}

	private _findCustomProviderSlugForModel(fullId: string): string | null {
		try {
			const cps = this.voidSettingsService.state.customProviders || {};

			if (fullId.includes('/')) {
				const prefix = fullId.split('/')[0];
				if (cps[prefix]) return prefix;
			}

			for (const [slug, entry] of Object.entries<any>(cps)) {
				const list: string[] = Array.isArray(entry?.models) ? entry.models : [];
				if (list.includes(fullId)) return slug;
			}
		} catch {
			// ignore
		}
		return null;
	}

	private async _getDynamicCapsForSelection(_providerName: ProviderName, modelName: string): Promise<Partial<VoidStaticModelInfo> | undefined> {
		const slug = this._findCustomProviderSlugForModel(modelName);
		if (!slug) return undefined;

		await this.dynamicRegistry.initialize?.();


		let argModelId = modelName;
		if (slug.toLowerCase() !== 'openrouter') {
			const i = modelName.indexOf('/');
			argModelId = i >= 0 ? modelName.slice(i + 1) : modelName;
		}

		try {
			return await this.dynamicRegistry.getEffectiveModelCapabilities(slug, argModelId);
		} catch {
			return undefined;
		}
	}

	// Get combined AI instructions from settings and .voidrules files
	private _getCombinedAIInstructions(): string {
		const globalAIInstructions = this.voidSettingsService.state.globalSettings.aiInstructions;
		const voidRulesFileContent = this._getVoidRulesFileContents();

		const ans: string[] = [];
		if (globalAIInstructions) ans.push(globalAIInstructions);
		if (voidRulesFileContent) ans.push(voidRulesFileContent);
		return ans.join('\n\n');
	}

	// system message
	private _generateChatMessagesSystemMessage = async (
		chatMode: ChatMode,
		specialToolFormat: 'openai-style' | 'anthropic-style' | 'gemini-style' | 'disabled' | undefined,
	) => {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath);
		const systemMessage = await chat_systemMessage({
			workspaceFolders,
			chatMode,
			toolFormat: (specialToolFormat ?? 'openai-style') as specialToolFormat,
			ptyHostService: this.ptyHostService,
		});
		return systemMessage;
	};

	// --- LLM Chat messages ---

	private _chatMessagesToSimpleMessages(chatMessages: ChatMessage[]): SimpleLLMMessage[] {
		const simpleLLMMessages: SimpleLLMMessage[] = [];

		for (const m of chatMessages) {
			if (m.role === 'checkpoint') continue
			if (m.role === 'interrupted_streaming_tool') continue
			if (m.role === 'assistant') {
				simpleLLMMessages.push({
					role: m.role,
					content: m.displayContent,
					anthropicReasoning: m.anthropicReasoning,
				})
			}
			else if (m.role === 'tool') {

				this.logService.debug('[DEBUG] _chatMessagesToSimpleMessages tool:', JSON.stringify({
					name: m.name,
					type: m.type,
					contentLength: m.content?.length,
					hasTruncationMeta: m.content?.includes('TRUNCATION_META'),
					contentTail: m.content?.slice(-200),
				}));

				simpleLLMMessages.push({
					role: m.role,
					content: m.content,
					name: m.name,
					id: m.id,
					rawParams: m.rawParams,
				})
			}
			else if (m.role === 'user') {
				const attachments: ResolvedChatAttachment[] | undefined = m.attachments
					? m.attachments.map(att => ({ ...att }))
					: undefined
				simpleLLMMessages.push({
					role: m.role,
					content: m.content,
					...(attachments && attachments.length ? { attachments } : {}),
				})
			}
		}
		return simpleLLMMessages
	}

	prepareLLMSimpleMessages: IConvertToLLMMessageService['prepareLLMSimpleMessages'] = ({ simpleMessages, systemMessage, modelSelection, featureName }) => {
		if (modelSelection === null) return { messages: [], separateSystemMessage: undefined }

		const { overridesOfModel } = this.voidSettingsService.state

		const { providerName, modelName } = modelSelection
		const caps = getModelCapabilities(providerName, modelName, overridesOfModel)
		let specialToolFormat: specialToolFormat = caps.specialToolFormat ?? 'disabled'
		let { contextWindow, supportsSystemMessage } = caps

		// Fallback to provider API config only when tool format is truly missing
		// Do NOT override an explicit or inferred 'disabled' value - that means
		// "no native tools", and must be respected.
		if (!specialToolFormat) {
			try {
				const modelId = modelName.includes('/') ? modelName : `${providerName}/${modelName}`;
				const apiCfg = getModelApiConfiguration(modelId);
				specialToolFormat = apiCfg.specialToolFormat;
			} catch { /* ignore */ }
		}

		// Enforce explicit user override if present (override wins over dynamic caps)
		const userSSMOverride = this._getUserSupportsSystemMessageOverride(providerName as ProviderName, modelName);
		if (userSSMOverride !== undefined) supportsSystemMessage = userSSMOverride;

		const modelSelectionOptions = this.voidSettingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]

		// Get combined AI instructions
		const aiInstructions = this._getCombinedAIInstructions();

		const isReasoningEnabled = getIsReasoningEnabledState(featureName, providerName, modelName, modelSelectionOptions, overridesOfModel)
		const reservedOutputTokenSpace = getReservedOutputTokenSpace(providerName, modelName, { isReasoningEnabled, overridesOfModel })

		// Force global override if provided
		if (typeof SYSTEM_PROMPT_OVERRIDE === 'string' && SYSTEM_PROMPT_OVERRIDE.trim() !== '') {
			systemMessage = SYSTEM_PROMPT_OVERRIDE
		}

		const { messages, separateSystemMessage } = prepareMessages({
			messages: simpleMessages,
			systemMessage,
			aiInstructions,
			supportsSystemMessage,
			specialToolFormat,
			supportsAnthropicReasoning: providerName === 'anthropic',
			contextWindow,
			reservedOutputTokenSpace,
			providerName,
		})
		return { messages, separateSystemMessage };
	}


	prepareLLMChatMessages: IConvertToLLMMessageService['prepareLLMChatMessages'] = async ({ chatMessages, chatMode, modelSelection }) => {
		if (modelSelection === null) return { messages: [], separateSystemMessage: undefined }

		const { overridesOfModel } = this.voidSettingsService.state

		const { providerName, modelName } = modelSelection
		const caps = getModelCapabilities(providerName, modelName, overridesOfModel)
		let specialToolFormat: specialToolFormat = caps.specialToolFormat ?? 'disabled'
		let { contextWindow, supportsSystemMessage } = caps

		try {
			const dynCaps = await this._getDynamicCapsForSelection(providerName, modelName);
			if (dynCaps) {
				// adopt dynamic value only when present; keeps strict typing and lints happy
				specialToolFormat = dynCaps.specialToolFormat ?? specialToolFormat;
				// Only adopt dynamic supportsSystemMessage when user didn't explicitly override it
				const userSSMOverride = this._getUserSupportsSystemMessageOverride(providerName as ProviderName, modelName);
				if (userSSMOverride === undefined) {
					const ssm = dynCaps.supportsSystemMessage;
					supportsSystemMessage = ssm ?? supportsSystemMessage;
				}
				if (typeof dynCaps.contextWindow === 'number') contextWindow = dynCaps.contextWindow;
			}
		} catch {
			// ignore
		}
		// Enforce explicit user override again after all fallbacks
		{
			const userSSMOverride2 = this._getUserSupportsSystemMessageOverride(providerName as ProviderName, modelName);
			if (userSSMOverride2 !== undefined) supportsSystemMessage = userSSMOverride2;
		}

		// allow-any-unicode-next-line
		// Fallback to provider API config only when tool format is truly missing.
		// Never override explicit or inferred 'disabled', since that means
		// "no native tools" and must be honored.
		if (!specialToolFormat) {
			try {
				const modelId = modelName.includes('/') ? modelName : `${providerName}/${modelName}`;
				const apiCfg = getModelApiConfiguration(modelId);
				specialToolFormat = apiCfg.specialToolFormat;
			} catch { /* ignore */ }
		}

		let systemMessage = await this._generateChatMessagesSystemMessage(chatMode, specialToolFormat)
		if (typeof SYSTEM_PROMPT_OVERRIDE === 'string' && SYSTEM_PROMPT_OVERRIDE.trim() !== '') {
			systemMessage = SYSTEM_PROMPT_OVERRIDE
		}

		const modelSelectionOptions = this.voidSettingsService.state.optionsOfModelSelection['Chat'][modelSelection.providerName]?.[modelSelection.modelName]

		// Get combined AI instructions
		const aiInstructions = this._getCombinedAIInstructions();

		const isReasoningEnabled = getIsReasoningEnabledState('Chat', providerName, modelName, modelSelectionOptions, overridesOfModel)
		const reservedOutputTokenSpace = getReservedOutputTokenSpace(providerName, modelName, { isReasoningEnabled, overridesOfModel })
		const llmMessages = this._chatMessagesToSimpleMessages(chatMessages)
		await this._populateAttachmentData(llmMessages)

		const { messages, separateSystemMessage } = prepareMessages({
			messages: llmMessages,
			systemMessage,
			aiInstructions,
			supportsSystemMessage,
			specialToolFormat,
			supportsAnthropicReasoning: providerName === 'anthropic',
			contextWindow,
			reservedOutputTokenSpace,
			providerName,
		})
		return { messages, separateSystemMessage };
	}
	// --- FIM ---

	prepareFIMMessage: IConvertToLLMMessageService['prepareFIMMessage'] = ({ messages }) => {
		// Get combined AI instructions with the provided aiInstructions as the base
		const combinedInstructions = this._getCombinedAIInstructions();

		let prefix = `\
${!combinedInstructions ? '' : `\
// Instructions:
// Do not output an explanation. Try to avoid outputting comments. Only output the middle code.
${combinedInstructions.split('\n').map(line => `//${line}`).join('\n')}`}

${messages.prefix}`

		const suffix = messages.suffix
		const stopTokens = messages.stopTokens
		return { prefix, suffix, stopTokens }
	}

	private async _populateAttachmentData(messages: SimpleLLMMessage[]): Promise<void> {
		for (const m of messages) {
			if (m.role !== 'user') continue
			const atts = m.attachments
			if (!atts || !atts.length) continue
			for (const att of atts) {
				if (att.dataBase64) continue
				try {
					const content = await this.fileService.readFile(att.uri)
					att.dataBase64 = encodeBase64(content.value)
				} catch {
					// ignore individual attachment failures
				}
			}
		}
	}
}

registerSingleton(IConvertToLLMMessageService, ConvertToLLMMessageService, InstantiationType.Eager);

