// void/common/sendLLMMessage.ts

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ISendLLMMessageService = createDecorator<ISendLLMMessageService>('sendLLMMessageService');

// defines an interface that node/ creates and browser/ uses
export interface ISendLLMMessageService {
	readonly _serviceBrand: undefined;

	sendLLMMessage(data: any): Promise<any>;
}


