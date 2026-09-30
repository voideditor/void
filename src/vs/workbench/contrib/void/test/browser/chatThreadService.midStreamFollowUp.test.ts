/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

import { ChatThreadService } from '../../browser/chatThreadService.js';
import { LLMMessageService } from '../../common/sendLLMMessageService.js';
import { IDynamicProviderRegistryService } from '../../../../../platform/void/common/providerReg.js';

/**
 * send-message-during-stream (task 3.1): non-ACP mid-stream behavior.
 *
 * Scenarios covered (see openspec/changes/send-message-during-stream/tasks.md):
 *  (a) sending during a running stream does NOT abort it and creates no interrupted messages
 *  (b) the mid-stream message is added to thread.messages immediately
 *  (c) when the current stream finishes, a follow-up sendLLMMessage runs with a history
 *      that includes the mid-stream message
 *  (d) multiple mid-stream messages are delivered in FIFO order (all answered by a single
 *      follow-up turn; no redundant extra turns once they are already delivered)
 *  (e) abortRunning clears the queue - no follow-up sendLLMMessage is issued afterwards
 *  (f) a mid-stream message that the still-running turn already delivered (the agent loop
 *      re-reads the thread between LLM iterations) is dropped, not re-sent as a follow-up -
 *      re-sending it made the model answer the same message twice (one extra response)
 *  (3.3 regression) the follow-up launch goes through wrapRunAgentToNotify with the same
 *      arguments as a regular launch (notification is created for the follow-up turn)
 *
 * The harness mirrors chatThreadService.nonAcpToAcpSwitch.test.ts (fake IPC channel), but
 * the final LLM message is NOT auto-fired: each stream is completed manually so a
 * mid-stream send can happen while the stream is still running.
 */

// ---- Fake IPC channel ----
// Payloads are JSON snapshots (functions are dropped by JSON.stringify, like over real IPC).
type FakeChannelPayload = {
	requestId?: string;
	messages?: Array<{ role: string; content: string }>;
	[key: string]: unknown;
};

class FakeChannel {
	private emitters = new Map<string, Emitter<FakeChannelPayload>>();
	public calls: Array<{ command: string; arg: FakeChannelPayload }> = [];

	listen<T>(eventName: string): Event<T> {
		let e = this.emitters.get(eventName);
		if (!e) { e = new Emitter<FakeChannelPayload>(); this.emitters.set(eventName, e); }
		return e.event as unknown as Event<T>;
	}

	fire(eventName: string, payload: FakeChannelPayload) {
		this.emitters.get(eventName)?.fire(payload);
	}

	async call(command: string, arg?: unknown): Promise<unknown> {
		const snap = JSON.parse(JSON.stringify(arg ?? null)) as FakeChannelPayload;
		this.calls.push({ command, arg: snap });
		return {};
	}

	sendLLMMessageCalls() {
		return this.calls.filter(c => c.command === 'sendLLMMessage');
	}

	/** Completes a pending sendLLMMessage request, like the main process would. */
	completeLLMRequest(requestId: string | undefined, fullText: string) {
		this.fire('onFinalMessage_sendLLMMessage', {
			requestId,
			fullText,
			fullReasoning: '',
			anthropicReasoning: null,
			toolCall: undefined,
			tokenUsage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
		});
	}
}

async function waitUntil(predicate: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (predicate()) return;
		await new Promise<void>(resolve => setTimeout(resolve, 5));
	}
	throw new Error(`Timed out waiting for: ${what}`);
}

async function settle(ms = 50): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, ms));
}

type WrapRunCall = {
	threadId: string;
	argCount: number;
	promiseArg: boolean;
	fnArgs: boolean;
};

type ServiceInternals = {
	_acpHandler: {
		runAcp(args: unknown): Promise<void>;
		sendMidStreamPrompt(args: unknown): Promise<void>;
		clearAcpState(): void;
		enqueueToolRequestFromAcp(): void;
		dispose?(): void;
	};
	_notificationManager: { wrapRunAgentToNotify(...args: unknown[]): unknown };
	_pendingFollowUpByThread: Map<string, unknown[]>;
	_executionEngine: {
		// send-message-during-stream: invoked by the engine when a stream finishes naturally.
		_drainPendingFollowUp?: (threadId: string, nThreadMessagesConsumed?: number) => void;
	};
};

function createHarness() {
	const logService = new NullLogService();
	const fakeChannel = new FakeChannel();

	const mainProcessService = {
		getChannel: (_name: string) => fakeChannel,
	};

	const registry = {
		initialize: async () => { },
		getRequestConfigForModel: (fullId: string, _providerSlug: string) => {
			if (fullId === 'provA/modelA') {
				return {
					apiStyle: 'openai-compatible',
					endpoint: 'https://api-a.example/v1',
					headers: { Authorization: 'Bearer keyA' },
					specialToolFormat: 'openai-style',
					supportsSystemMessage: 'developer-role',
				};
			}
			return null;
		},
		getEffectiveModelCapabilities: async () => ({ supportCacheControl: false }),
	};

	const instantiationService = {
		invokeFunction: (fn: unknown) => (fn as (accessor: { get(id: unknown): unknown }) => void)({
			get: (id: unknown) => {
				if (id === IDynamicProviderRegistryService) return registry;
				return { getTools: () => new Set() };
			}
		}),
	};

	const settingsService = {
		state: {
			settingsOfProvider: {
				provA: { endpoint: 'https://provider-a.example/v1', apiKey: 'provKeyA', additionalHeaders: {} },
			},
			customProviders: {},
			overridesOfModel: {},

			modelSelectionOfFeature: {
				Chat: { providerName: 'provA', modelName: 'provA/modelA' },
				'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null,
			},
			optionsOfModelSelection: {
				Chat: {
					provA: { 'provA/modelA': { temperature: 0.1 } },
				},
				'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {},
			},

			globalSettings: {
				chatMode: 'normal',
				useAcp: false,
				acpMode: 'builtin',
				acpAgentUrl: '',
				acpProcessCommand: '',
				acpProcessArgs: [],
				acpProcessEnv: {},
				acpModel: null,
				acpSystemPrompt: null,
				showAcpPlanInChat: false,

				autoRefreshModels: false,
				aiInstructions: '',
				enableAutocomplete: false,
				syncApplyToChat: false,
				syncSCMToChat: false,
				enableFastApply: false,
				autoApprove: {},
				mcpAutoApprove: false,
				showInlineSuggestions: false,
				includeToolLintErrors: false,
				loopGuardMaxTurnsPerPrompt: 25,
				loopGuardMaxSameAssistantPrefix: 10,
				loopGuardMaxSameToolCall: 10,
				isOnboardingComplete: true,
				disableTelemetry: true,

				chatRetries: 0,
				retryDelay: 0,
				maxToolOutputLength: 40000,
			},
		}
	};

	const llmSvc = new LLMMessageService(
		mainProcessService as never,
		settingsService as never,
		instantiationService as never,
		logService,
		/* mcp */ { getMCPTools: () => [] } as never,
		/* notification */ { notify: () => { } } as never,
	);

	// ---- ChatThreadService ----
	const svc = new ChatThreadService(
		/* acpService */ {} as never,
		/* storage */ { get: () => undefined, store: () => { } } as never,
		/* voidModel */ {} as never,
		/* llmMessageService */ llmSvc,
		/* tools */ {} as never,
		/* settings */ settingsService as never,
		/* langFeatures */ {} as never,
		/* lmTools */ { getTools: () => new Set() } as never,
		/* mcp */ {} as never,
		/* metrics */ { capture: () => { } } as never,
		/* editCode */ {} as never,
		/* notification */ { notify: () => { } } as never,
		/* convertToLLM */ {
			prepareLLMChatMessages: async ({ chatMessages }: { chatMessages: Array<{ role: string; displayContent?: string; content?: string }> }) => ({
				messages: (chatMessages ?? []).map(m => ({
					role: m.role,
					content: (m.displayContent ?? m.content ?? ''),
				})),
				separateSystemMessage: undefined,
			}),
		} as never,
		/* workspace */ { getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }) } as never,
		/* dirStr */ { getDirectoryString: async () => '' } as never,
		/* file */ { readFile: async () => ({ value: { toString: () => '' } }) } as never,
		/* label */ { getUriLabel: () => './x' } as never,
		/* log */ logService,
		/* agentSkills */ { getActiveSkills: () => [], activateSkill: async () => { throw new Error('not used in this test'); } } as never,
		/* lifecycle */ undefined,
	);

	const internals = svc as unknown as ServiceInternals;

	// Stub the ACP handler (not used in non-ACP mode, but abortRunning calls clearAcpState).
	try { internals._acpHandler.dispose?.(); } catch { }
	internals._acpHandler = {
		runAcp: async () => { },
		sendMidStreamPrompt: async () => { },
		clearAcpState: () => { },
		enqueueToolRequestFromAcp: () => { },
	};

	// Record wrapRunAgentToNotify calls (3.3 regression assertions).
	const wrapCalls: WrapRunCall[] = [];
	internals._notificationManager = {
		wrapRunAgentToNotify: (...args: unknown[]) => {
			wrapCalls.push({
				threadId: String(args[1]),
				argCount: args.length,
				promiseArg: args[0] instanceof Promise,
				fnArgs: args.slice(2).every(arg => typeof arg === 'function'),
			});
			return args[0];
		},
	};

	return { svc, llmSvc, fakeChannel, wrapCalls, internals };
}

function userTexts(messages: Array<{ role: string; displayContent?: string }>): string[] {
	return messages.filter(m => m.role === 'user').map(m => m.displayContent ?? '');
}

suite('ChatThreadService - mid-stream follow-up (non-ACP)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('mid-stream message is queued and auto-delivered as a follow-up turn after the stream finishes', async () => {
		const { svc, llmSvc, fakeChannel, wrapCalls, internals } = createHarness();
		try {
			const tid = svc.state.currentThreadId;

			// -------- 1) start the first stream --------
			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'first' });
			await waitUntil(() => fakeChannel.sendLLMMessageCalls().length === 1, 'first sendLLMMessage');
			assert.ok(svc.streamState[tid]?.isRunning, 'stream should be running before the mid-stream send');

			// -------- 2) mid-stream send: (a) no abort, (b) message immediately in thread --------
			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'mid1' });

			assert.ok(svc.streamState[tid]?.isRunning, '(a) mid-stream send must not abort the running stream');
			assert.strictEqual(fakeChannel.sendLLMMessageCalls().length, 1, '(a) no second LLM request while the stream runs');

			const messages = svc.state.allThreads[tid]?.messages ?? [];
			assert.ok(!messages.some(m => m.role === 'interrupted_streaming_tool'), '(a) no interrupted streaming tool messages');
			assert.ok(!messages.some(m => m.role === 'tool'), '(a) no interrupted tool messages');
			assert.ok(userTexts(messages).includes('mid1'), '(b) mid-stream message is in thread.messages immediately');
			assert.strictEqual(internals._pendingFollowUpByThread.get(tid)?.length, 1, '(b) message is queued as a pending follow-up');

			// -------- 3) finish the first stream -> follow-up starts automatically (c) --------
			fakeChannel.completeLLMRequest(fakeChannel.sendLLMMessageCalls()[0].arg.requestId, 'ok');
			await waitUntil(() => fakeChannel.sendLLMMessageCalls().length === 2, 'follow-up sendLLMMessage');

			const followUpMessages = fakeChannel.sendLLMMessageCalls()[1].arg.messages ?? [];
			const contents = followUpMessages.map(m => m.content);
			assert.ok(contents.includes('first'), '(c) follow-up history contains the first message');
			assert.ok(contents.includes('mid1'), '(c) follow-up history contains the mid-stream message');
			const lastUser = [...followUpMessages].reverse().find(m => m.role === 'user');
			assert.strictEqual(lastUser?.content, 'mid1', '(c) the mid-stream message is the latest user message of the follow-up turn');

			// (3.3 regression) both the regular and the follow-up launches go through
			// wrapRunAgentToNotify with the same argument shape.
			assert.strictEqual(wrapCalls.length, 2, '(3.3) initial + follow-up launches both go through wrapRunAgentToNotify');
			for (const call of wrapCalls) {
				assert.strictEqual(call.threadId, tid, '(3.3) wrapRunAgentToNotify receives the threadId');
				assert.strictEqual(call.argCount, 5, '(3.3) wrapRunAgentToNotify receives the same 5 args as a regular launch');
				assert.ok(call.promiseArg, '(3.3) first argument is the agent run promise');
				assert.ok(call.fnArgs, '(3.3) getters/switch callbacks are passed like on a regular launch');
			}

			// -------- 4) finish the follow-up -> the queue is empty, nothing re-runs --------
			fakeChannel.completeLLMRequest(fakeChannel.sendLLMMessageCalls()[1].arg.requestId, 'ok');
			await waitUntil(() => svc.streamState[tid]?.isRunning === undefined, 'follow-up stream to finish');
			await settle();
			assert.strictEqual(fakeChannel.sendLLMMessageCalls().length, 2, 'no extra LLM request once the queue is drained');
			assert.strictEqual(internals._pendingFollowUpByThread.size, 0, 'follow-up queue is empty');
		} finally {
			svc.dispose();
			llmSvc.dispose();
		}
	});

	test('multiple mid-stream messages are delivered in FIFO order', async () => {
		const { svc, llmSvc, fakeChannel, internals } = createHarness();
		try {
			const tid = svc.state.currentThreadId;

			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'first' });
			await waitUntil(() => fakeChannel.sendLLMMessageCalls().length === 1, 'first sendLLMMessage');

			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'mid1' });
			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'mid2' });
			assert.strictEqual(fakeChannel.sendLLMMessageCalls().length, 1, 'both messages queued, no LLM request while the stream runs');

			// finish the first stream -> first follow-up runs with both messages in history
			fakeChannel.completeLLMRequest(fakeChannel.sendLLMMessageCalls()[0].arg.requestId, 'ok');
			await waitUntil(() => fakeChannel.sendLLMMessageCalls().length === 2, 'first follow-up');

			const firstContents = (fakeChannel.sendLLMMessageCalls()[1].arg.messages ?? []).map(m => m.content);
			const idxMid1 = firstContents.indexOf('mid1');
			const idxMid2 = firstContents.indexOf('mid2');
			assert.ok(idxMid1 !== -1 && idxMid2 !== -1, '(d) both mid-stream messages are in the follow-up history');
			assert.ok(idxMid1 < idxMid2, '(d) mid-stream messages are delivered in FIFO order');

			// finish the first follow-up: its LLM request already contained mid2 (the agent
			// loop re-reads the thread), so the second queued message must NOT start another
			// turn - the model would answer mid2 twice with a redundant extra response.
			fakeChannel.completeLLMRequest(fakeChannel.sendLLMMessageCalls()[1].arg.requestId, 'ok');
			await waitUntil(() => svc.streamState[tid]?.isRunning === undefined, 'follow-up stream to finish');
			await settle();
			assert.strictEqual(fakeChannel.sendLLMMessageCalls().length, 2, 'no second follow-up for a message already delivered by the previous turn');
			assert.strictEqual(internals._pendingFollowUpByThread.size, 0, 'queue fully drained, no further requests');
		} finally {
			svc.dispose();
			llmSvc.dispose();
		}
	});

	test('a mid-stream message already delivered by the running turn is not re-sent as a follow-up', async () => {
		// Regression for the "one extra response" bug: the agent loop re-reads the thread on
		// every iteration, so when a mid-stream message lands between two LLM iterations (e.g.
		// while tool calls run), the still-running turn already delivers it and answers it in
		// its final response. Launching the queued follow-up afterwards would send the model a
		// history that ends with its own answer, producing a redundant extra response.
		const { svc, llmSvc, fakeChannel, wrapCalls, internals } = createHarness();
		try {
			const tid = svc.state.currentThreadId;
			const drain = internals._executionEngine._drainPendingFollowUp;
			assert.ok(drain, 'the engine must wire the follow-up drain callback');

			// -------- 1) start the first stream --------
			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'first' });
			await waitUntil(() => fakeChannel.sendLLMMessageCalls().length === 1, 'first sendLLMMessage');

			// -------- 2) mid-stream send while the first request is still streaming --------
			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'mid1' });
			assert.strictEqual(internals._pendingFollowUpByThread.get(tid)?.length, 1, 'message queued mid-stream');

			// -------- 3) simulate a multi-iteration turn: its LAST LLM request re-read the
			// whole thread (a tool loop ran between the requests), so 'mid1' was already
			// included in it and answered by that turn. The engine reports the consumed
			// boundary (the thread message count of that last request) when the stream
			// finishes - the drain must drop the queued message instead of launching a
			// redundant follow-up turn. --------
			const consumed = svc.state.allThreads[tid]?.messages.length ?? 0;
			drain(tid, consumed);
			assert.strictEqual(internals._pendingFollowUpByThread.size, 0, 'already-delivered message is dropped from the queue');
			assert.strictEqual(fakeChannel.sendLLMMessageCalls().length, 1, 'no follow-up LLM request for an already-delivered message');
			assert.strictEqual(wrapCalls.length, 1, 'no follow-up agent launch for an already-delivered message');

			// -------- 4) the stream genuinely finishes: the engine drains again (a no-op on
			// the now-empty queue) and no extra turn may start --------
			fakeChannel.completeLLMRequest(fakeChannel.sendLLMMessageCalls()[0].arg.requestId, 'answer covering first and mid1');
			await waitUntil(() => svc.streamState[tid]?.isRunning === undefined, 'stream to finish');
			await settle();
			assert.strictEqual(fakeChannel.sendLLMMessageCalls().length, 1, 'exactly one response - no extra redundant answer');
			assert.strictEqual(internals._pendingFollowUpByThread.size, 0, 'queue stays empty');
		} finally {
			svc.dispose();
			llmSvc.dispose();
		}
	});

	test('abortRunning resets the follow-up queue - no follow-up is launched', async () => {
		const { svc, llmSvc, fakeChannel, internals } = createHarness();
		try {
			const tid = svc.state.currentThreadId;

			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'first' });
			await waitUntil(() => fakeChannel.sendLLMMessageCalls().length === 1, 'first sendLLMMessage');

			await svc.addUserMessageAndStreamResponse({ threadId: tid, userMessage: 'mid1' });
			assert.strictEqual(internals._pendingFollowUpByThread.get(tid)?.length, 1, 'message queued mid-stream');

			await svc.abortRunning(tid);
			assert.strictEqual(internals._pendingFollowUpByThread.size, 0, '(e) abort clears the follow-up queue');
			assert.strictEqual(svc.streamState[tid], undefined, '(e) abort stops the stream');

			// the (late) completion of the aborted stream must not launch a follow-up
			fakeChannel.completeLLMRequest(fakeChannel.sendLLMMessageCalls()[0].arg.requestId, 'ok');
			await settle();
			assert.strictEqual(fakeChannel.sendLLMMessageCalls().length, 1, '(e) no follow-up sendLLMMessage after abort');
		} finally {
			svc.dispose();
			llmSvc.dispose();
		}
	});
});
