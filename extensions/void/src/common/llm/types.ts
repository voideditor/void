import { VoidConfig } from '../../webviews/common/contextForConfig'

export type AbortRef = { current: (() => void) | null }

export type OnText = (newText: string, fullText: string) => void

export type OnFinalMessage = (input: string) => void

export type LLMMessageAnthropic = {
	role: 'user' | 'assistant',
	content: string,
}

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant',
	content: string,
}

export type SendLLMMessageParams = {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: OnFinalMessage,
	onError: (error: string) => void,
	voidConfig: VoidConfig,
	abortRef: AbortRef,
}
