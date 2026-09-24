/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ToolTurnCoordinator, type ToolTurnDiagnosticEvent, type ToolTurnInvariantCode } from '../ToolTurnCoordinator.js';

suite('ToolTurnCoordinator', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const assertInvariant = (fn: () => void, code: ToolTurnInvariantCode): void => {
		let thrown: unknown;
		try {
			fn();
		} catch (error) {
			thrown = error;
		}
		if (!(thrown instanceof Error)) {
			assert.fail('Expected an invariant error.');
		}
		if (!('code' in thrown)) {
			assert.fail('Expected the invariant error to include a code.');
		}
		assert.strictEqual(thrown.code, code);
	};

	test('registers the complete batch and rejects duplicate ids', () => {
		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'turn',
			toolCalls: [
				{ id: 'read', name: 'read_file' },
				{ id: 'command', name: 'run_command' },
			],
		});

		assert.deepStrictEqual([...coordinator.state.calls.keys()], ['read', 'command']);
		assert.strictEqual(coordinator.state.activeApprovalCallId, 'command');
		assert.deepStrictEqual(coordinator.state.approvalQueue, []);
		assert.strictEqual(coordinator.state.calls.get('read')?.phase, 'queued');
		assert.strictEqual(coordinator.state.calls.get('command')?.phase, 'awaiting-approval');

		assertInvariant(() => new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'duplicate',
			toolCalls: [
				{ id: 'same', name: 'read_file' },
				{ id: 'same', name: 'search_for_files' },
			],
		}), 'duplicate_tool_call_id');
	});

	test('runs read-only calls without approval and settles once', async () => {
		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'reads',
			toolCalls: [
				{ id: 'read-1', name: 'read_file' },
				{ id: 'read-2', name: 'search_for_files' },
			],
		});

		coordinator.startExecution('read-1');
		coordinator.startExecution('read-2');
		coordinator.succeed('read-1', 'one');
		assert.strictEqual(coordinator.isTurnSettled, false);
		coordinator.fail('read-2', 'failed');
		await coordinator.whenTurnSettled;

		coordinator.assertCanResumeLLM();
		assert.strictEqual(coordinator.state.calls.get('read-1')?.phase, 'succeeded');
		assert.strictEqual(coordinator.state.calls.get('read-2')?.phase, 'failed');
		assertInvariant(() => coordinator.succeed('read-1'), 'duplicate_terminal_result');
	});

	test('serializes manual approvals until the previous call has a terminal result', () => {
		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'manual',
			toolCalls: [
				{ id: 'first', name: 'run_command' },
				{ id: 'second', name: 'edit_file' },
			],
		});

		assert.strictEqual(coordinator.state.activeApprovalCallId, 'first');
		assert.deepStrictEqual(coordinator.state.approvalQueue, ['second']);
		coordinator.markToolRequestPersisted('first');
		coordinator.approve('first');
		assert.strictEqual(coordinator.state.activeApprovalCallId, undefined);
		assert.deepStrictEqual(coordinator.state.approvalQueue, ['second']);
		assert.strictEqual(coordinator.state.calls.get('second')?.phase, 'queued');

		coordinator.succeed('first');
		assert.strictEqual(coordinator.state.activeApprovalCallId, 'second');
		assert.deepStrictEqual(coordinator.state.approvalQueue, []);
		coordinator.reject('second');
		coordinator.assertCanResumeLLM();
	});

	test('rejects and skips only the active approval id', () => {
		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'decisions',
			toolCalls: [
				{ id: 'first', name: 'run_command' },
				{ id: 'second', name: 'rewrite_file' },
			],
		});

		assertInvariant(() => coordinator.approve('second'), 'decision_for_inactive_call');
		coordinator.reject('first');
		assert.strictEqual(coordinator.state.activeApprovalCallId, 'second');
		assertInvariant(() => coordinator.reject('first'), 'decision_for_inactive_call');
		coordinator.skip('second');
		assert.strictEqual(coordinator.state.calls.get('first')?.phase, 'rejected');
		assert.strictEqual(coordinator.state.calls.get('second')?.phase, 'skipped');
	});

	test('guards invalid approvals and duplicate requests', () => {
		assertInvariant(() => new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'invalid-approval',
			toolCalls: [{ id: 'read', name: 'read_file', approval: 'manual' }],
		}), 'approval_not_allowed_for_builtin');

		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'requests',
			toolCalls: [
				{ id: 'first', name: 'run_command' },
				{ id: 'second', name: 'edit_file' },
			],
		});
		coordinator.markToolRequestPersisted('first');
		assertInvariant(() => coordinator.markToolRequestPersisted('first'), 'duplicate_tool_request');
		assertInvariant(() => coordinator.activateApproval('second'), 'multiple_active_approvals');
	});

	test('blocks LLM resume before every call is terminal', () => {
		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'barrier',
			toolCalls: [{ id: 'read', name: 'read_file' }],
		});

		assertInvariant(() => coordinator.assertCanResumeLLM(), 'llm_resume_before_tool_turn_settled');
		coordinator.startExecution('read');
		assertInvariant(() => coordinator.assertCanResumeLLM(), 'llm_resume_before_tool_turn_settled');
		coordinator.succeed('read');
		coordinator.assertCanResumeLLM();
	});

	test('closes running, queued, and active calls on interruption or timeout', async () => {
		const interrupted = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'interrupt',
			toolCalls: [
				{ id: 'read', name: 'read_file' },
				{ id: 'command', name: 'run_command' },
			],
		});
		interrupted.startExecution('read');
		interrupted.interruptAll();
		await interrupted.whenTurnSettled;
		assert.strictEqual(interrupted.state.calls.get('read')?.terminalResult?.kind, 'tool_error');
		assert.strictEqual(interrupted.state.calls.get('command')?.terminalResult?.kind, 'tool_error');

		const timedOut = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'timeout',
			toolCalls: [{ id: 'read', name: 'read_file' }],
		});
		timedOut.startExecution('read');
		timedOut.expireWatchdog();
		await timedOut.whenTurnSettled;
		assert.deepStrictEqual(timedOut.state.calls.get('read')?.terminalResult, {
			kind: 'tool_error',
			reason: 'timeout',
			message: 'Tool call did not produce a terminal callback before the turn watchdog expired.',
		});
	});

	test('watchdog settles lost callbacks and structured logs stay redacted', async () => {
		const events: ToolTurnDiagnosticEvent[] = [];
		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread-secret',
			turnId: 'turn-secret',
			toolCalls: [{ id: 'call-secret', name: 'read_file' }],
			watchdogMs: 5,
			log: event => events.push(event),
		});
		coordinator.startExecution('call-secret');
		await coordinator.whenTurnSettled;

		assert.ok(events.some(event => event.type === 'transition' && event.reason === 'watchdog-timeout'));
		for (const event of events) {
			assert.deepStrictEqual(Object.keys(event).sort(), event.type === 'transition'
				? ['activeApprovalCallId', 'fromPhase', 'queueDepth', 'reason', 'threadId', 'toPhase', 'toolCallId', 'toolName', 'turnId', 'type'].filter(key => Object.prototype.hasOwnProperty.call(event, key)).sort()
				: ['activeApprovalCallId', 'code', 'phase', 'queueDepth', 'threadId', 'toolCallId', 'toolName', 'turnId', 'type'].filter(key => Object.prototype.hasOwnProperty.call(event, key)).sort());
		}
	});

	test('logs exact invariant codes', () => {
		const events: ToolTurnDiagnosticEvent[] = [];
		const coordinator = new ToolTurnCoordinator({
			threadId: 'thread',
			turnId: 'logging',
			toolCalls: [{ id: 'read', name: 'read_file' }],
			log: event => events.push(event),
		});
		assertInvariant(() => coordinator.assertCanResumeLLM(), 'llm_resume_before_tool_turn_settled');
		assert.ok(events.some(event => event.type === 'invariant' && event.code === 'llm_resume_before_tool_turn_settled'));
	});
});
