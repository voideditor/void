/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Server as UtilityProcessServer } from '../../../../base/parts/ipc/node/ipc.mp.js';
import { IChannel, IServerChannel, StaticRouter } from '../../../../base/parts/ipc/common/ipc.js';
import { Event } from '../../../../base/common/event.js';
import { VoidConfig } from './registerConfig.js';

export type LLMMessageAbortRef = { current: (() => void) | null }

export type LLMMessageOnText = (newText: string, fullText: string) => void

export type OnFinalMessage = (input: string) => void

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type SendLLMMessageFnType = (params: {
	messages: LLMMessage[];
	onText: LLMMessageOnText;
	onFinalMessage: (fullText: string) => void;
	onError: (error: Error | string) => void;
	voidConfig: VoidConfig | null;
	abortRef: LLMMessageAbortRef;

	logging: {
		loggingName: string,
	};
}) => void

export const ISendLLMMessageService = createDecorator<ISendLLMMessageService>('sendLLMMessageService');

export interface ISendLLMMessageService {
	readonly _serviceBrand: undefined;

	sendMessage(params: {
		messages: LLMMessage[];
		onText: LLMMessageOnText;
		onFinalMessage: OnFinalMessage;
		onError: (error: Error | string) => void;
		voidConfig: VoidConfig;
	}): Promise<void>;
}

class SendLLMMessageChannel implements IServerChannel {
	constructor() {


	}

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error('No events available');
	}

	call(context: any, command: string, args?: any[]): Promise<any> {
		switch (command) {
			case 'sendMessage':
				console.log('ARGS', args)
			// this.service.sendMessage(args![0]);
			default:
				throw new Error(`Invalid command ${command}`);
		}
	}
}

export class SendLLMMessageService extends Disposable implements ISendLLMMessageService {
	_serviceBrand: undefined;
	private readonly server: UtilityProcessServer;
	private channel: IChannel | undefined;

	constructor() {
		super();

		// Create the utility process server
		this.server = this._register(new UtilityProcessServer());

		// Register our channel
		this.server.registerChannel('sendLLMMessage', new SendLLMMessageChannel());

		// Get the channel from the utility process
		this.channel = this.server.getChannel('sendLLMMessage', new StaticRouter(() => true));
	}

	async sendMessage(params: {
		messages: LLMMessage[];
		onText: LLMMessageOnText;
		onFinalMessage: OnFinalMessage;
		onError: (error: Error | string) => void;
		voidConfig: VoidConfig;
	}): Promise<void> {
		if (!this.channel) {
			throw new Error('LLM Message service not initialized');
		}

		try {
			await this.channel.call('sendMessage', [params]);
		} catch (error) {
			params.onError(error instanceof Error ? error : new Error(String(error)));
		}
	}
}

registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Eager);
