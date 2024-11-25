// void/common/sendLLMMessage.ts

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { VoidConfig } from '../../../workbench/contrib/void/browser/registerConfig.js';



export type LLMMessageAbortRef = { current: (() => void) | null }

export type LLMMessageOnText = (newText: string, fullText: string) => void

export type OnFinalMessage = (input: string) => void

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type SendLLMMessageParams = {
	messages: LLMMessage[];
	onText: LLMMessageOnText;
	onFinalMessage: (fullText: string) => void;
	onError: (error: Error | string) => void;
	voidConfig: VoidConfig | null;
	abortRef: LLMMessageAbortRef;

	logging: {
		loggingName: string,
	};
}



export const ISendLLMMessageService = createDecorator<ISendLLMMessageService>('sendLLMMessageService');

// defines an interface that node/ creates and browser/ uses
export interface ISendLLMMessageService {
	readonly _serviceBrand: undefined;

	sendLLMMessage: (params: SendLLMMessageParams) => void;

}

