
import { Event } from '../../../base/common/event.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import {
	IAcpService,
	IAcpStream,
	IAcpUserMessage,
	IAcpMessageChunk,
	IAcpSendOptions,
	IAcpChatMessage
} from './iAcpService.js';

export const AcpChannelName = 'acp';
export type AcpRequestId = string;


export type AcpHostCallbackKind =
	| 'requestPermission'
	| 'createTerminal'
	| 'terminalOutput'
	| 'waitForTerminalExit'
	| 'killTerminal'
	| 'releaseTerminal'
	| 'readTextFile'
	| 'writeTextFile'
	| 'extMethod';

export interface AcpHostCallbackRequest {
	requestId: string;           
	kind: AcpHostCallbackKind;
	
	sessionId?: string;
	threadId?: string;
	
	params?: any;
}

export interface AcpHostCallbackResponse {
	requestId: string;
	result?: any;
	error?: string;
}


export interface IAcpMainServiceForChannel {
	
	connect(opts?: IAcpSendOptions): Promise<void>;
	disconnect(): Promise<void>;
	isConnected(): boolean;

	
	sendChatMessage(args: {
		threadId: string;
		history: IAcpChatMessage[];
		message: IAcpChatMessage; 
		opts?: IAcpSendOptions;
	}): Promise<AcpRequestId>;

	cancel(args: { requestId: AcpRequestId }): Promise<void>;

	
	onData(requestId: AcpRequestId): Event<IAcpMessageChunk>;

	
	onHostCallback: Event<AcpHostCallbackRequest>;
	hostCallbackResult(resp: AcpHostCallbackResponse): Promise<void>;
}


function unwrapWindowHandshake(name: string, arg: any, extraArg?: any): { name: string; arg: any } { 
	const extractPayload = (container: any): any => {
		if (!container || typeof container !== 'object')
			return undefined;
		if ('arg' in container) return (container as any).arg;

		if ('args' in container) {
			const a = (container as any).args;
			return Array.isArray(a) ? a[0] : a;
		}

		if ('payload' in container) return (container as any).payload;
		if ('data' in container) return (container as any).data;

		return undefined;
	};

	if (typeof name === 'string' && name.startsWith('window:')) {
		if (arg && typeof arg === 'object') {
			if (typeof (arg as any).event === 'string') {
				return { name: String((arg as any).event), arg: extractPayload(arg) };
			}
			if (typeof (arg as any).command === 'string') {
				return { name: String((arg as any).command), arg: extractPayload(arg) };
			}
			if (Array.isArray(arg) && arg.length >= 1) {
				return { name: String(arg[0]), arg: arg.length > 1 ? arg[1] : undefined };
			}
		}

		if (typeof arg === 'string') {
			return { name: arg, arg: typeof extraArg === 'undefined' ? undefined : extraArg };
		}

		return { name: '', arg: undefined };
	}
	return { name, arg };
}


export class AcpChannel implements IChannel {
	constructor(private readonly service: IAcpMainServiceForChannel) { }

	listen<T>(event: string, arg?: any): Event<T> {
		const extra = (arguments as any)[2];
		const { name, arg: realArg } = unwrapWindowHandshake(event, arg, extra);

		switch (name) {
			case 'onData':
				return this.service.onData(realArg.requestId) as Event<any>;
			case 'onHostCallback':
				return this.service.onHostCallback as Event<any>;
		}
		throw new Error(`AcpChannel: unknown event ${name}`);
	}


	call<T>(command: string, arg?: any): Promise<T> {
		const extra = (arguments as any)[2];
		const { name, arg: realArg } = unwrapWindowHandshake(command, arg, extra);

		switch (name) {
			case 'connect':
				return this.service.connect(realArg) as any;
			case 'disconnect':
				return this.service.disconnect() as any;
			case 'isConnected':
				return Promise.resolve(this.service.isConnected()) as any;
			case 'sendChatMessage':
				return this.service.sendChatMessage(realArg) as any;
			case 'cancel':
				return this.service.cancel(realArg) as any;
			case 'hostCallbackResult':
				return this.service.hostCallbackResult(realArg) as any;
		}
		return Promise.reject(new Error(`AcpChannel: unknown command ${name}`));
	}
}

export class AcpChannelClient implements IAcpService {
	declare readonly _serviceBrand: undefined;

	private _connected = false;

	constructor(private readonly channel: IChannel) { }

	isConnected(): boolean {
		
		return this._connected;
	}

	async connect(opts?: IAcpSendOptions): Promise<void> {
		await this.channel.call('connect', opts);
		this._connected = true;
	}

	async disconnect(): Promise<void> {
		try {
			await this.channel.call('disconnect');
		} finally {
			this._connected = false;
		}
	}

	async sendChatMessage(
		threadId: string,
		history: IAcpChatMessage[],
		message: IAcpUserMessage,
		opts?: IAcpSendOptions
	): Promise<IAcpStream> {
		
		const requestId = await this.channel.call<string>('sendChatMessage', { threadId, history, message, opts });
		const onData = this.channel.listen<IAcpMessageChunk>('onData', { requestId });

		return {
			onData,
			cancel: () => { void this.channel.call('cancel', { requestId }); }
		};
	}
}

