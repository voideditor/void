/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { __test } from '../acpBuiltinAgent.js';

type BuiltinAgent = InstanceType<typeof __test.VoidPipelineAcpAgent>;
type AgentConnection = ConstructorParameters<typeof __test.VoidPipelineAcpAgent>[0];
type NewSessionRequest = Parameters<BuiltinAgent['newSession']>[0];
type PromptRequest = Parameters<BuiltinAgent['prompt']>[0];
type SendOpts = Parameters<Parameters<typeof __test.setSendChatRouter>[0]>[0];

interface RecordedUpdate {
	type: string;
	transition?: { phase?: string; fromModel?: { providerName: string; modelName: string }; toModel?: { providerName: string; modelName: string } };
}

const primaryConfig = {
	providerName: 'openAI',
	modelName: 'gpt-4o-mini',
	settingsOfProvider: { openAI: {}, anthropic: {} },
	modelSelectionOptions: null,
	overridesOfModel: null,
	separateSystemMessage: null,
	chatMode: null,
	loopGuard: null,
	requestParams: null,
	providerRouting: null,
	dynamicRequestConfig: null,
	additionalTools: null,
	chatModelFallback: {
		enabled: true,
		errorPolicy: 'any-provider-error',
		fallbackModels: [
			{ providerName: 'anthropic', modelName: 'claude-sonnet-4' },
		],
	},
};

const asRecord = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

/**
 * Report a provider error through onError without letting its synchronous
 * throw escape the stub (the rotation path rejects the turn itself).
 */
const reportProviderError = (opts: SendOpts, status: number, retryAfterMs: number): void => {
	const err: any = new Error(`HTTP ${status} Too Many Requests`);
	err.providerHttp = { status, retryAfterMs };
	try {
		opts.onError(err);
	} catch {
		// The agent rejects the failed turn; the prompt loop retries with the
		// rotated candidate (task 4.2).
	}
};

const makeConnection = (updates: RecordedUpdate[]): AgentConnection => ({
	extMethod: async (method: string) => {
		if (method === 'void/settings/getLLMConfig') return primaryConfig;
		throw new Error(`Unexpected extMethod: ${method}`);
	},
	requestPermission: async () => {
		return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
	},
	sessionUpdate: async (u: unknown) => {
		const req = asRecord(u);
		const update = asRecord(req.update);
		updates.push({
			type: String(update.sessionUpdate ?? ''),
			transition: asRecord(update.transition) as RecordedUpdate['transition'],
		});
	},
} as unknown as AgentConnection);

suite('acpBuiltinAgent fallback rotation (tasks 4.1-4.4)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		__test.reset();
	});

	test('HTTP 429 with Retry-After rotates to fallback, emits model_status, and does not commit the failed attempt', async () => {
		const updates: RecordedUpdate[] = [];
		let callNo = 0;

		__test.setSendChatRouter(async opts => {
			callNo++;
			if (callNo === 1) {
				// Primary attempt fails with a rate limit + Retry-After.
				reportProviderError(opts, 429, 1000);
				return;
			}
			// Fallback attempt succeeds with a plain answer.
			await opts.onFinalMessage({ fullText: 'recovered by fallback', fullReasoning: '', anthropicReasoning: null });
		});

		const agent = new __test.VoidPipelineAcpAgent(makeConnection(updates), new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);

		const response = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
		} as unknown as PromptRequest);

		assert.strictEqual(response.stopReason, 'end_turn');

		// Both the primary and the rotated fallback candidate were used.
		assert.strictEqual(callNo, 2);

		// A model_status transition was emitted (task 4.3) with fallback phase.
		const modelStatus = updates.find(u => u.type === 'model_status' && u.transition);
		assert.ok(modelStatus, 'expected a model_status session update');
		assert.strictEqual(modelStatus.transition?.phase, 'fallback');
		assert.strictEqual(modelStatus.transition?.fromModel?.providerName, 'openAI');
		assert.strictEqual(modelStatus.transition?.toModel?.providerName, 'anthropic');
		assert.strictEqual(modelStatus.transition?.toModel?.modelName, 'claude-sonnet-4');

		// No text chunks from the failed primary attempt were emitted (task 4.4).
		const textChunks = updates.filter(u => u.type === 'text');
		assert.strictEqual(textChunks.length, 0);

		// The actual model metadata is attached to the response (task 4.1).
		const meta = asRecord(asRecord(response as Record<string, unknown>)._meta);
		const actualModel = asRecord(meta.actualModel);
		assert.strictEqual(actualModel.providerName, 'anthropic');
		assert.strictEqual(actualModel.modelName, 'claude-sonnet-4');
		assert.strictEqual(actualModel.isFallback, true);
	});

	test('exhausted candidates surface the original provider error', async () => {
		let callNo = 0;

		__test.setSendChatRouter(async opts => {
			callNo++;
			reportProviderError(opts, 429, 60_000);
		});

		const agent = new __test.VoidPipelineAcpAgent(makeConnection([]), new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);

		await assert.rejects(
			() => agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] } as unknown as PromptRequest),
			(e: any) => {
				assert.ok(e instanceof Error);
				assert.ok(String(e.message).includes('429'));
				return true;
			}
		);

		// Both the primary and the fallback candidate were tried before giving up.
		assert.ok(callNo >= 2, 'expected both primary and fallback attempts before the final error');
	});

	test('rotation disabled keeps the legacy single-attempt behavior', async () => {
		let callNo = 0;

		__test.setSendChatRouter(async opts => {
			callNo++;
			reportProviderError(opts, 429, 1000);
		});

		const disabledConfig = {
			...primaryConfig,
			chatModelFallback: { enabled: false, errorPolicy: 'any-provider-error', fallbackModels: [] },
		};

		const connection = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') return disabledConfig;
				throw new Error(`Unexpected extMethod: ${method}`);
			},
			requestPermission: async () => {
				return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
			},
			sessionUpdate: async () => { },
		} as unknown as AgentConnection;

		const agent = new __test.VoidPipelineAcpAgent(connection, new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);

		await assert.rejects(
			() => agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] } as unknown as PromptRequest),
			(e: any) => {
				assert.ok(e instanceof Error);
				return true;
			}
		);

		// Without rotation there is exactly one LLM attempt.
		assert.strictEqual(callNo, 1);
	});
});
