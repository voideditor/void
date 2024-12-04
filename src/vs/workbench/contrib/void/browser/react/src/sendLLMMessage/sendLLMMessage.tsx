import { posthog } from 'posthog-js'
import type { OnText, OnError, OnFinalMessage, SendLLMMMessageParams, } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { sendAnthropicMsg } from './anthropic.js';
import { sendGeminiMsg } from './gemini.js';
import { sendGreptileMsg } from './greptile.js';
import { sendOllamaMsg } from './ollama.js';
import { sendOpenAIMsg } from './openai.js';


export const sendLLMMessage = ({ messages, onText: onText_, onFinalMessage: onFinalMessage_, onError: onError_, abortRef: abortRef_, voidConfig, logging: { loggingName }}: SendLLMMMessageParams) => {
	if (!voidConfig) return;

	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
	messages = messages.map(m => ({ ...m, content: m.content.trim() }))

	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureChatEvent = (eventId: string, extras?: object) => {
		posthog.capture(eventId, {
			whichApi: voidConfig.default['whichApi'],
			numMessages: messages?.length,
			messagesShape: messages?.map(msg => ({ role: msg.role, length: msg.content.length })),
			version: '2024-11-14',
			...extras,
		})
	}
	const submit_time = new Date()

	let _fullTextSoFar = ''
	let _aborter: (() => void) | null = null
	let _setAborter = (fn: () => void) => { _aborter = fn }
	let _didAbort = false

	const onText: OnText = ({ newText, fullText }) => {
		if (_didAbort) return
		onText_({ newText, fullText })
		_fullTextSoFar = fullText
	}

	const onFinalMessage: OnFinalMessage = ({ fullText }) => {
		if (_didAbort) return
		captureChatEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds() })
		onFinalMessage_({ fullText })
	}

	const onError: OnError = ({ error }) => {
		console.error('sendLLMMessage onError:', error)
		if (_didAbort) return
		captureChatEvent(`${loggingName} - Error`, { error })
		onError_({ error })
	}

	const onAbort = () => {
		captureChatEvent(`${loggingName} - Abort`, { messageLengthSoFar: _fullTextSoFar.length })
		_aborter?.()
		_didAbort = true
	}
	abortRef_.current = onAbort

	captureChatEvent(`${loggingName} - Sending Message`, { messageLength: messages[messages.length - 1]?.content.length })

	try {
		switch (voidConfig.default.whichApi) {
			case 'anthropic':
				sendAnthropicMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'openAI':
			case 'openRouter':
			case 'openAICompatible':
				sendOpenAIMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'gemini':
				sendGeminiMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'ollama':
				sendOllamaMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'greptile':
				sendGreptileMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			default:
				onError({ error: `Error: whichApi was "${voidConfig.default.whichApi}", which is not recognized!` })
				break;
		}
	}

	catch (error) {
		if (error instanceof Error) { onError({ error }) }
		else { onError({ error: `Unexpected Error in sendLLMMessage: ${error}` }); }
		; (_aborter as any)?.()
		_didAbort = true
	}



}

