import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import type { LLMTokenUsage } from '../../void/common/sendLLMMessageTypes.js';

export type IAcpMessageChunk =
	| { type: 'text'; text: string }
	| { type: 'reasoning'; reasoning: string }
	| { type: 'plan'; plan: { title?: string; items: Array<{ id?: string; text: string; state?: string }> } }
	| {
		type: 'tool_call';
		toolCall: {
			id: string;
			name: string;
			args: Record<string, any>;
		};
	}
	| {
		type: 'tool_result';
		toolResult: {
			id: string;
			name: string;
			result: any;
			error?: string;
		};
	}
	| {
		type: 'tool_progress';
		toolProgress: {
			id: string;
			name: string;
			terminalId?: string;
			output: string;
			truncated?: boolean;
			exitStatus?: { exitCode: number | null; signal: string | null };
		};
	}
	| { type: 'error'; error: string }
	| { type: 'done'; tokenUsageSnapshot?: LLMTokenUsage };

export interface IAcpSendOptions {
	mode?: 'builtin' | 'websocket' | 'process';
	// For websocket mode
	agentUrl?: string;

	// For process mode
	command?: string;
	args?: string[];
	env?: Record<string, string>;

	// Common
	model?: string | null;
	system?: string | null;
	featureName?: 'Chat' | 'Ctrl+K';
	maxToolOutputLength?: number;
	readFileChunkLines?: number;
}

export interface IAcpUserMessage {
	role: 'user';
	content: string;
}

export interface IAcpAssistantMessage {
	role: 'assistant';
	content: string;
}

export type IAcpChatMessage = IAcpUserMessage | IAcpAssistantMessage;

export interface IAcpStream {
	onData: Event<IAcpMessageChunk>;
	cancel(): void;
}

export const IAcpService = createDecorator<IAcpService>('acpService');

export interface IAcpService {
	readonly _serviceBrand: undefined;

	isConnected(): boolean;
	connect(opts?: IAcpSendOptions): Promise<void>;
	disconnect(): Promise<void>;

	sendChatMessage(
		threadId: string,
		history: IAcpChatMessage[],
		message: IAcpUserMessage,
		opts?: IAcpSendOptions
	): Promise<IAcpStream>;
}
