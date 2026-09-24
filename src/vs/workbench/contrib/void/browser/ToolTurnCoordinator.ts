/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { getToolApprovalRequirement, type ToolApprovalRequirement } from '../../../../platform/void/common/toolApprovalPolicy.js';

export type ToolCallPhase =
	| 'queued'
	| 'awaiting-approval'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'rejected'
	| 'skipped';

export type ToolCallTerminalResult =
	| { readonly kind: 'success'; readonly result?: unknown }
	| { readonly kind: 'tool_error'; readonly reason: 'failed' | 'interrupted' | 'timeout'; readonly message: string }
	| { readonly kind: 'rejected'; readonly message?: string }
	| { readonly kind: 'skipped'; readonly message?: string };

export type ToolTurnCall = {
	readonly id: string;
	readonly name: string;
	readonly approval?: 'manual' | 'none' | 'dynamic-policy';
};

export type ToolCallState = {
	readonly id: string;
	readonly name: string;
	readonly phase: ToolCallPhase;
	readonly approvalRequirement: ToolApprovalRequirement;
	readonly requiresApproval: boolean;
	readonly toolRequestPersisted: boolean;
	readonly terminalResult?: ToolCallTerminalResult;
};

export type ToolTurnState = {
	readonly threadId: string;
	readonly turnId: string;
	readonly calls: ReadonlyMap<string, ToolCallState>;
	readonly approvalQueue: readonly string[];
	readonly activeApprovalCallId?: string;
};

export type ToolTurnInvariantCode =
	| 'approval_not_allowed_for_builtin'
	| 'multiple_active_approvals'
	| 'duplicate_tool_request'
	| 'duplicate_terminal_result'
	| 'llm_resume_before_tool_turn_settled'
	| 'decision_for_inactive_call'
	| 'duplicate_tool_call_id'
	| 'unknown_tool_call'
	| 'invalid_tool_call_transition';

export type ToolTurnTransitionReason =
	| 'registered'
	| 'approval-activated'
	| 'approved'
	| 'execution-started'
	| 'execution-succeeded'
	| 'execution-failed'
	| 'rejected'
	| 'skipped'
	| 'interrupted'
	| 'timeout'
	| 'watchdog-timeout';

export type ToolTurnDiagnosticEvent =
	| {
		readonly type: 'transition';
		readonly threadId: string;
		readonly turnId: string;
		readonly toolCallId: string;
		readonly toolName: string;
		readonly fromPhase?: ToolCallPhase;
		readonly toPhase: ToolCallPhase;
		readonly reason: ToolTurnTransitionReason;
		readonly queueDepth: number;
		readonly activeApprovalCallId?: string;
	}
	| {
		readonly type: 'invariant';
		readonly threadId: string;
		readonly turnId: string;
		readonly code: ToolTurnInvariantCode;
		readonly toolCallId?: string;
		readonly toolName?: string;
		readonly phase?: ToolCallPhase;
		readonly queueDepth: number;
		readonly activeApprovalCallId?: string;
	};

export type ToolTurnCoordinatorOptions = {
	readonly threadId: string;
	readonly turnId: string;
	readonly toolCalls: readonly ToolTurnCall[];
	readonly watchdogMs?: number;
	readonly log?: (event: ToolTurnDiagnosticEvent) => void;
};

type MutableToolCallState = {
	id: string;
	name: string;
	phase: ToolCallPhase;
	approvalRequirement: ToolApprovalRequirement;
	requiresApproval: boolean;
	toolRequestPersisted: boolean;
	terminalResult?: ToolCallTerminalResult;
};

const terminalPhases = new Set<ToolCallPhase>(['succeeded', 'failed', 'rejected', 'skipped']);

const invariantMessages: Record<ToolTurnInvariantCode, string> = {
	approval_not_allowed_for_builtin: 'Manual approval is not allowed for this builtin tool.',
	multiple_active_approvals: 'Only one tool approval may be active in a turn.',
	duplicate_tool_request: 'A tool request was already persisted for this call.',
	duplicate_terminal_result: 'A terminal result was already recorded for this call.',
	llm_resume_before_tool_turn_settled: 'The LLM cannot resume before every tool call has a terminal result.',
	decision_for_inactive_call: 'The approval decision does not target the active tool call.',
	duplicate_tool_call_id: 'Tool call ids must be unique within a turn.',
	unknown_tool_call: 'The tool call id is not registered in this turn.',
	invalid_tool_call_transition: 'The requested tool call lifecycle transition is not allowed.',
};

export class ToolTurnInvariantError extends Error {
	constructor(readonly code: ToolTurnInvariantCode) {
		super(invariantMessages[code]);
		this.name = 'ToolTurnInvariantError';
	}
}

export class ToolTurnCoordinator {
	private readonly _calls = new Map<string, MutableToolCallState>();
	private readonly _approvalQueue: string[] = [];
	private _activeApprovalCallId: string | undefined;
	private _watchdogHandle: ReturnType<typeof setTimeout> | undefined;
	private _isSettled = false;
	private readonly _resolveTurnSettled: () => void;

	readonly whenTurnSettled: Promise<void>;

	constructor(private readonly _options: ToolTurnCoordinatorOptions) {
		let resolveTurnSettled: (() => void) | undefined;
		this.whenTurnSettled = new Promise<void>(resolve => {
			resolveTurnSettled = resolve;
		});
		this._resolveTurnSettled = () => resolveTurnSettled?.();

		for (const toolCall of _options.toolCalls) {
			this._registerCall(toolCall);
		}
		this._activateNextApprovalIfPossible();
		this._settleTurnIfComplete();
		this._armWatchdog();
	}

	get state(): ToolTurnState {
		return {
			threadId: this._options.threadId,
			turnId: this._options.turnId,
			calls: new Map(Array.from(this._calls, ([id, call]) => [id, { ...call }])),
			approvalQueue: [...this._approvalQueue],
			activeApprovalCallId: this._activeApprovalCallId,
		};
	}

	get isTurnSettled(): boolean {
		return this._isSettled;
	}

	markToolRequestPersisted(callId: string): void {
		const call = this._getCall(callId);
		if (this._activeApprovalCallId !== callId || call.phase !== 'awaiting-approval') {
			this._throwInvariant('decision_for_inactive_call', call);
		}
		if (call.toolRequestPersisted) {
			this._throwInvariant('duplicate_tool_request', call);
		}
		call.toolRequestPersisted = true;
	}

	activateApproval(callId: string): void {
		const call = this._getCall(callId);
		if (call.approvalRequirement.kind === 'none') {
			this._throwInvariant('approval_not_allowed_for_builtin', call);
		}
		if (this._activeApprovalCallId !== undefined) {
			this._throwInvariant('multiple_active_approvals', call);
		}
		if (call.phase !== 'queued') {
			this._throwInvariant('invalid_tool_call_transition', call);
		}
		this._removeFromApprovalQueue(callId);
		this._activeApprovalCallId = callId;
		this._transition(call, 'awaiting-approval', 'approval-activated');
	}

	startExecution(callId: string): void {
		const call = this._getCall(callId);
		if (call.phase !== 'queued' || call.requiresApproval) {
			this._throwInvalidTransition(call);
		}
		this._transition(call, 'running', 'execution-started');
	}

	approve(callId: string): void {
		const call = this._getActiveApprovalCall(callId);
		this._activeApprovalCallId = undefined;
		this._transition(call, 'running', 'approved');
	}

	reject(callId: string, message?: string): void {
		const call = this._getActiveApprovalCall(callId);
		this._activeApprovalCallId = undefined;
		this._recordTerminal(call, 'rejected', { kind: 'rejected', message }, 'rejected');
	}

	skip(callId: string, message?: string): void {
		const call = this._getActiveApprovalCall(callId);
		this._activeApprovalCallId = undefined;
		this._recordTerminal(call, 'skipped', { kind: 'skipped', message }, 'skipped');
	}

	succeed(callId: string, result?: unknown): void {
		const call = this._getCall(callId);
		if (call.phase !== 'running') {
			this._throwInvalidTransition(call);
		}
		this._recordTerminal(call, 'succeeded', { kind: 'success', result }, 'execution-succeeded');
	}

	fail(callId: string, message: string): void {
		const call = this._getCall(callId);
		this._recordToolError(call, 'failed', message, 'execution-failed');
	}

	interrupt(callId: string, message = 'Tool call was interrupted.'): void {
		const call = this._getCall(callId);
		this._recordToolError(call, 'interrupted', message, 'interrupted');
	}

	timeout(callId: string, message = 'Tool call timed out.'): void {
		const call = this._getCall(callId);
		this._recordToolError(call, 'timeout', message, 'timeout');
	}

	interruptAll(message = 'Tool call was interrupted.'): void {
		this._closeUnsettledCalls('interrupted', message, 'interrupted');
	}

	expireWatchdog(message = 'Tool call did not produce a terminal callback before the turn watchdog expired.'): void {
		this._closeUnsettledCalls('timeout', message, 'watchdog-timeout');
	}

	assertCanResumeLLM(): void {
		if (!this._isSettled) {
			this._throwInvariant('llm_resume_before_tool_turn_settled');
		}
	}

	dispose(): void {
		this._clearWatchdog();
	}

	private _registerCall(toolCall: ToolTurnCall): void {
		if (this._calls.has(toolCall.id)) {
			this._throwInvariant('duplicate_tool_call_id', undefined, toolCall.id, toolCall.name);
		}

		const approvalRequirement = getToolApprovalRequirement(toolCall.name);
		if (approvalRequirement.kind === 'none' && toolCall.approval === 'manual') {
			this._throwInvariant('approval_not_allowed_for_builtin', undefined, toolCall.id, toolCall.name);
		}
		const requiresApproval = toolCall.approval === 'manual'
			|| toolCall.approval === 'dynamic-policy'
			|| (toolCall.approval === undefined && approvalRequirement.kind === 'manual');
		const call: MutableToolCallState = {
			id: toolCall.id,
			name: toolCall.name,
			phase: 'queued',
			approvalRequirement,
			requiresApproval,
			toolRequestPersisted: false,
		};
		this._calls.set(call.id, call);
		if (requiresApproval) this._approvalQueue.push(call.id);
		this._logTransition(call, undefined, 'queued', 'registered');
	}

	private _activateNextApprovalIfPossible(): void {
		if (this._activeApprovalCallId !== undefined) return;
		if (Array.from(this._calls.values()).some(call => call.requiresApproval && call.phase === 'running')) return;

		while (this._approvalQueue.length > 0) {
			const callId = this._approvalQueue.shift();
			if (callId === undefined) return;
			const call = this._calls.get(callId);
			if (!call || call.phase !== 'queued') continue;
			this._activeApprovalCallId = callId;
			this._transition(call, 'awaiting-approval', 'approval-activated');
			return;
		}
	}

	private _getActiveApprovalCall(callId: string): MutableToolCallState {
		const call = this._getCall(callId);
		if (this._activeApprovalCallId !== callId || call.phase !== 'awaiting-approval') {
			this._throwInvariant('decision_for_inactive_call', call);
		}
		return call;
	}

	private _getCall(callId: string): MutableToolCallState {
		const call = this._calls.get(callId);
		if (!call) {
			this._throwInvariant('unknown_tool_call', undefined, callId);
		}
		return call;
	}

	private _recordToolError(
		call: MutableToolCallState,
		reason: 'failed' | 'interrupted' | 'timeout',
		message: string,
		transitionReason: ToolTurnTransitionReason
	): void {
		if (terminalPhases.has(call.phase)) {
			this._throwInvariant('duplicate_terminal_result', call);
		}
		if (call.phase !== 'queued' && call.phase !== 'awaiting-approval' && call.phase !== 'running') {
			this._throwInvalidTransition(call);
		}
		if (this._activeApprovalCallId === call.id) this._activeApprovalCallId = undefined;
		this._removeFromApprovalQueue(call.id);
		this._recordTerminal(call, 'failed', { kind: 'tool_error', reason, message }, transitionReason);
	}

	private _recordTerminal(
		call: MutableToolCallState,
		phase: Extract<ToolCallPhase, 'succeeded' | 'failed' | 'rejected' | 'skipped'>,
		terminalResult: ToolCallTerminalResult,
		reason: ToolTurnTransitionReason,
		advanceApproval = true
	): void {
		if (call.terminalResult !== undefined || terminalPhases.has(call.phase)) {
			this._throwInvariant('duplicate_terminal_result', call);
		}
		call.terminalResult = terminalResult;
		this._transition(call, phase, reason, false);
		if (advanceApproval) this._activateNextApprovalIfPossible();
		this._settleTurnIfComplete();
		this._armWatchdog();
	}

	private _closeUnsettledCalls(
		reason: 'interrupted' | 'timeout',
		message: string,
		transitionReason: Extract<ToolTurnTransitionReason, 'interrupted' | 'watchdog-timeout'>
	): void {
		this._activeApprovalCallId = undefined;
		this._approvalQueue.length = 0;
		for (const call of this._calls.values()) {
			if (terminalPhases.has(call.phase)) continue;
			call.terminalResult = { kind: 'tool_error', reason, message };
			this._transition(call, 'failed', transitionReason, false);
		}
		this._settleTurnIfComplete();
		this._clearWatchdog();
	}

	private _transition(
		call: MutableToolCallState,
		toPhase: ToolCallPhase,
		reason: ToolTurnTransitionReason,
		armWatchdog = true
	): void {
		const fromPhase = call.phase;
		call.phase = toPhase;
		this._logTransition(call, fromPhase, toPhase, reason);
		if (armWatchdog) this._armWatchdog();
	}

	private _throwInvalidTransition(call: MutableToolCallState): never {
		if (terminalPhases.has(call.phase)) {
			this._throwInvariant('duplicate_terminal_result', call);
		}
		this._throwInvariant('invalid_tool_call_transition', call);
	}

	private _removeFromApprovalQueue(callId: string): void {
		const index = this._approvalQueue.indexOf(callId);
		if (index !== -1) this._approvalQueue.splice(index, 1);
	}

	private _settleTurnIfComplete(): void {
		if (this._isSettled) return;
		if (Array.from(this._calls.values()).some(call => !terminalPhases.has(call.phase))) return;
		this._isSettled = true;
		this._clearWatchdog();
		this._resolveTurnSettled();
	}

	private _armWatchdog(): void {
		this._clearWatchdog();
		if (this._isSettled) return;
		const watchdogMs = this._options.watchdogMs;
		if (watchdogMs === undefined || watchdogMs <= 0) return;
		this._watchdogHandle = setTimeout(() => {
			this._watchdogHandle = undefined;
			this.expireWatchdog();
		}, watchdogMs);
	}

	private _clearWatchdog(): void {
		if (this._watchdogHandle === undefined) return;
		clearTimeout(this._watchdogHandle);
		this._watchdogHandle = undefined;
	}

	private _logTransition(
		call: MutableToolCallState,
		fromPhase: ToolCallPhase | undefined,
		toPhase: ToolCallPhase,
		reason: ToolTurnTransitionReason
	): void {
		this._options.log?.({
			type: 'transition',
			threadId: this._options.threadId,
			turnId: this._options.turnId,
			toolCallId: call.id,
			toolName: call.name,
			fromPhase,
			toPhase,
			reason,
			queueDepth: this._approvalQueue.length,
			activeApprovalCallId: this._activeApprovalCallId,
		});
	}

	private _throwInvariant(
		code: ToolTurnInvariantCode,
		call?: MutableToolCallState,
		toolCallId?: string,
		toolName?: string
	): never {
		this._options.log?.({
			type: 'invariant',
			threadId: this._options.threadId,
			turnId: this._options.turnId,
			code,
			toolCallId: call?.id ?? toolCallId,
			toolName: call?.name ?? toolName,
			phase: call?.phase,
			queueDepth: this._approvalQueue.length,
			activeApprovalCallId: this._activeApprovalCallId,
		});
		throw new ToolTurnInvariantError(code);
	}
}
