/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import { AcpHostCallbacksService } from '../../../../../workbench/contrib/acp/browser/AcpHostCallbacksService.js';
import { IChatThreadService } from '../../../../../workbench/contrib/void/browser/chatThreadService.js';

type Decision = 'approved' | 'rejected' | 'skipped';
type DecisionEvent = { threadId: string; toolCallId: string; decision: Decision };
type HostCallbacksConstructorArgs = ConstructorParameters<typeof AcpHostCallbacksService>;

type HostCallbacks = {
	handle(kind: string, params: unknown, threadId: string | undefined): Promise<unknown>;
};

suite('AcpHostCallbacksService approval queue', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('concurrent external callbacks materialize one FIFO request and correlate decisions by id', async () => {
		const listeners = new Set<(event: DecisionEvent) => void>();
		const visibleRequests: string[] = [];
		const chat = {
			streamState: {},
			enqueueToolRequestFromAcp: (_threadId: string, request: { id: string }) => visibleRequests.push(request.id),
			onExternalToolDecision: (listener: (event: DecisionEvent) => void) => {
				listeners.add(listener);
				return { dispose: () => listeners.delete(listener) };
			},
		};
		const settingsService = {
			state: { globalSettings: { autoApprove: {}, mcpAutoApprove: false } },
		};
		const instantiationService = {
			invokeFunction<T>(fn: (accessor: { get: (id: unknown) => unknown }) => T): T {
				return fn({
					get(id: unknown) {
						if (id === IVoidSettingsService) return settingsService;
						if (id === IChatThreadService) return chat;
						throw new Error('Unexpected service token');
					},
				});
			},
		};
		const logService = { debug: () => { }, error: () => { } };
		const service = new AcpHostCallbacksService(
			instantiationService as unknown as HostCallbacksConstructorArgs[0],
			{} as HostCallbacksConstructorArgs[1],
			logService as unknown as HostCallbacksConstructorArgs[2],
		) as HostCallbacks;
		const request = (id: string) => ({
			toolCall: {
				toolCallId: id,
				rawInput: { name: 'edit_file', args: { uri: `/${id}.ts` } },
			},
		});

		const first = service.handle('requestPermission', request('call-a'), 'thread-1');
		const second = service.handle('requestPermission', request('call-b'), 'thread-1');
		await Promise.resolve();
		assert.deepStrictEqual(visibleRequests, ['call-a']);

		for (const listener of [...listeners]) {
			listener({ threadId: 'thread-1', toolCallId: 'call-b', decision: 'approved' });
		}
		await Promise.resolve();
		assert.deepStrictEqual(visibleRequests, ['call-a']);

		for (const listener of [...listeners]) {
			listener({ threadId: 'thread-1', toolCallId: 'call-a', decision: 'approved' });
		}
		assert.deepStrictEqual(await first, { outcome: { outcome: 'selected', optionId: 'allow_once' } });
		assert.deepStrictEqual(visibleRequests, ['call-a', 'call-b']);

		for (const listener of [...listeners]) {
			listener({ threadId: 'thread-1', toolCallId: 'call-b', decision: 'rejected' });
		}
		assert.deepStrictEqual(await second, { outcome: { outcome: 'selected', optionId: 'reject_once' } });
	});

	test('builtin skip selects skip_once when the agent offers distinct decisions', async () => {
		const listeners = new Set<(event: DecisionEvent) => void>();
		const chat = {
			streamState: {},
			enqueueToolRequestFromAcp: () => { },
			onExternalToolDecision: (listener: (event: DecisionEvent) => void) => {
				listeners.add(listener);
				return { dispose: () => listeners.delete(listener) };
			},
		};
		const settingsService = {
			state: { globalSettings: { autoApprove: {}, mcpAutoApprove: false } },
		};
		const instantiationService = {
			invokeFunction<T>(fn: (accessor: { get: (id: unknown) => unknown }) => T): T {
				return fn({
					get(id: unknown) {
						if (id === IVoidSettingsService) return settingsService;
						if (id === IChatThreadService) return chat;
						throw new Error('Unexpected service token');
					},
				});
			},
		};
		const logService = { debug: () => { }, error: () => { } };
		const service = new AcpHostCallbacksService(
			instantiationService as unknown as HostCallbacksConstructorArgs[0],
			{} as HostCallbacksConstructorArgs[1],
			logService as unknown as HostCallbacksConstructorArgs[2],
		) as HostCallbacks;
		const response = service.handle('requestPermission', {
			toolCall: {
				toolCallId: 'skip-call',
				rawInput: { name: 'edit_file', args: { uri: '/skip.ts' } },
			},
			options: [
				{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
				{ optionId: 'skip_once', name: 'Skip', kind: 'reject_once' },
				{ optionId: 'cancel_once', name: 'Cancel', kind: 'reject_once' },
			],
		}, 'thread-1');
		await Promise.resolve();

		for (const listener of [...listeners]) {
			listener({ threadId: 'thread-1', toolCallId: 'skip-call', decision: 'skipped' });
		}

		assert.deepStrictEqual(await response, { outcome: { outcome: 'selected', optionId: 'skip_once' } });
	});

	test('builtin cancel selects cancel_once when the agent offers distinct decisions', async () => {
		const listeners = new Set<(event: DecisionEvent) => void>();
		const chat = {
			streamState: {},
			enqueueToolRequestFromAcp: () => { },
			onExternalToolDecision: (listener: (event: DecisionEvent) => void) => {
				listeners.add(listener);
				return { dispose: () => listeners.delete(listener) };
			},
		};
		const settingsService = {
			state: { globalSettings: { autoApprove: {}, mcpAutoApprove: false } },
		};
		const instantiationService = {
			invokeFunction<T>(fn: (accessor: { get: (id: unknown) => unknown }) => T): T {
				return fn({
					get(id: unknown) {
						if (id === IVoidSettingsService) return settingsService;
						if (id === IChatThreadService) return chat;
						throw new Error('Unexpected service token');
					},
				});
			},
		};
		const logService = { debug: () => { }, error: () => { } };
		const service = new AcpHostCallbacksService(
			instantiationService as unknown as HostCallbacksConstructorArgs[0],
			{} as HostCallbacksConstructorArgs[1],
			logService as unknown as HostCallbacksConstructorArgs[2],
		) as HostCallbacks;
		const response = service.handle('requestPermission', {
			toolCall: {
				toolCallId: 'cancel-call',
				rawInput: { name: 'edit_file', args: { uri: '/cancel.ts' } },
			},
			options: [
				{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
				{ optionId: 'skip_once', name: 'Skip', kind: 'reject_once' },
				{ optionId: 'cancel_once', name: 'Cancel', kind: 'reject_once' },
			],
		}, 'thread-1');
		await Promise.resolve();

		for (const listener of [...listeners]) {
			listener({ threadId: 'thread-1', toolCallId: 'cancel-call', decision: 'rejected' });
		}

		assert.deepStrictEqual(await response, { outcome: { outcome: 'selected', optionId: 'cancel_once' } });
	});
});
