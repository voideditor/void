/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Shared lightweight heuristics to detect potential infinite loops in agent-style
// LLM orchestrations (Void chat + ACP). The goals are:
// - keep behaviour deterministic and cheap (no heavy NLP)
// - be conservative to avoid false positives
// - provide a single place to tune thresholds for both ACP / non-ACP flows.

export const LOOP_DETECTED_MESSAGE = 'Loop detected, stop stream';

export type LoopDetectionReason = 'max_turns' | 'assistant_repeat' | 'tool_repeat';

export type LoopDetectionResult =
	| { isLoop: false }
	| { isLoop: true; reason: LoopDetectionReason; details?: string };

export interface LoopDetectorOptions {
	/** Maximum number of assistant turns per single user prompt (LLM calls). */
	maxTurnsPerPrompt: number;
	/** How many times the same assistant first-line prefix may repeat. */
	maxSameAssistantPrefix: number;
	/** How many times the same tool(name+args) may be invoked in one prompt. */
	maxSameToolCall: number;
	/** Prefix length (in chars) used for assistant repetition fingerprinting. */
	assistantPrefixLength: number;
	/** How many words of the assistant first-line to use for fingerprinting.
	 *  Higher = more conservative (fewer false positives). */
	assistantPrefixWords: number;
	/** Limit for read-only tools (read_file, search_*, ls_dir, get_dir_tree).
	 *  Read-only repeats are harmless, so we allow more of them. */
	maxSameReadOnlyToolCall: number;
	/** Whether tool_repeat only triggers on CONSECUTIVE identical calls
	 *  (not total across the whole prompt). Consecutive repeats = real loop,
	 *  scattered repeats = normal agent behaviour. */
	consecutiveToolRepeatOnly: boolean;
}

const DEFAULT_OPTIONS: LoopDetectorOptions = {
	maxTurnsPerPrompt: 25,
	maxSameAssistantPrefix: 3,
	maxSameToolCall: 3,
	assistantPrefixLength: 120,
	assistantPrefixWords: 5,
	maxSameReadOnlyToolCall: 8,
	consecutiveToolRepeatOnly: true,
};

// Read-only tools: repeats are harmless (re-reading a file after edit, etc).
const READ_ONLY_TOOLS = new Set([
	'read_file',
	'ls_dir',
	'get_dir_tree',
	'search_pathnames_only',
	'search_for_files',
	'search_in_file',
	'read_lint_errors',
]);

export class LLMLoopDetector {
	private readonly opts: LoopDetectorOptions;
	private assistantTurns = 0;
	private readonly assistantPrefixCounts = new Map<string, number>();
	private readonly toolSignatureCounts = new Map<string, number>();
	// Track of the last tool signature, for consecutive-repeat detection.
	// If a different tool was called in between, the counter resets.
	private lastToolSignature: string | null = null;
	// Track of mutating write-targets (file URIs that were edited). When a
	// read_file hits a previously-edited URI, we reset its repeat counter -
	// re-reading a file after an edit is normal, not a loop.
	private readonly mutatedTargets = new Set<string>();
	// Soft signals - used to escalate to a real loop only when multiple
	// heuristics fire together (assistant repeat + tool repeat = real loop).
	private assistantRepeatSignal: { prefix: string; count: number } | null = null;

	constructor(options?: Partial<LoopDetectorOptions>) {
		this.opts = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
	}

	/**
	 * Register a completed assistant turn (one LLM response). Returns a loop
	 * signal if any of the assistant-based heuristics trigger.
	 */
	registerAssistantTurn(text: string | undefined | null): LoopDetectionResult {
		this.assistantTurns++;

		// Hard cap on number of assistant responses per prompt.
		if (this.assistantTurns > this.opts.maxTurnsPerPrompt) {
			return {
				isLoop: true,
				reason: 'max_turns',
				details: `assistantTurns=${this.assistantTurns} > maxTurnsPerPrompt=${this.opts.maxTurnsPerPrompt}`,
			};
		}

		if (!text) {
			return { isLoop: false };
		}

		const prefix = this._normalizedAssistantPrefix(text);
		if (!prefix) {
			return { isLoop: false };
		}

		const prev = this.assistantPrefixCounts.get(prefix) ?? 0;
		const next = prev + 1;
		this.assistantPrefixCounts.set(prefix, next);

		// Assistant prefix repetition alone is NOT a loop - the model may legitimately
		// start multiple responses with "I'll", "Let me", "Now I", etc.
		// We store it as a soft signal; it only escalates to a real loop if a
		// tool_repeat signal also fires (see registerToolCall).
		if (next > this.opts.maxSameAssistantPrefix) {
			this.assistantRepeatSignal = { prefix, count: next };
		}

		return { isLoop: false };
	}

	/**
	 * Register a tool call candidate (name+args). Called before actually
	 * executing the tool so we can short-circuit potentially useless loops.
	 */
	registerToolCall(name: string | undefined | null, args: unknown): LoopDetectionResult {
		const n = (name ?? '').trim();
		if (!n) {
			return { isLoop: false };
		}

		const sig = this._signatureForTool(n, args);
		const isReadOnly = READ_ONLY_TOOLS.has(n.toLowerCase());

		// If the tool writes to a target, remember it. Subsequent read_file on the
		// same URI should reset its counter (re-reading after edit is normal).
		if (!isReadOnly) {
			const target = this._extractWriteTarget(n, args);
			if (target) this.mutatedTargets.add(target);
		} else if (n.toLowerCase() === 'read_file') {
			const target = this._extractReadTarget(args);
			if (target && this.mutatedTargets.has(target)) {
				// File was edited since last read - reset its counter.
				for (const k of Array.from(this.toolSignatureCounts.keys())) {
					if (k.includes(`"uri":"${target}"`) || k.includes(`"uri": "${target}"`)) {
						this.toolSignatureCounts.delete(k);
					}
				}
			}
		}

		// Consecutive-only mode: if the previous tool call was DIFFERENT, reset
		// the counter for this signature. This means 3 identical calls in a row
		// = loop, but 3 identical calls scattered across other calls = normal.
		if (this.opts.consecutiveToolRepeatOnly && this.lastToolSignature !== null && this.lastToolSignature !== sig) {
			// Different tool was called in between - reset all counters, because
			// the agent is making progress (different actions).
			this.toolSignatureCounts.clear();
			this.assistantRepeatSignal = null;
		}
		this.lastToolSignature = sig;

		const prev = this.toolSignatureCounts.get(sig) ?? 0;
		const next = prev + 1;
		this.toolSignatureCounts.set(sig, next);

		// Higher threshold for read-only tools - repeats are harmless.
		const limit = isReadOnly
			? Math.max(this.opts.maxSameToolCall, this.opts.maxSameReadOnlyToolCall)
			: this.opts.maxSameToolCall;

		if (next > limit) {
			// For mutating tools, this is a real loop - stop immediately.
			if (!isReadOnly) {
				return {
					isLoop: true,
					reason: 'tool_repeat',
					details: `tool ${n} with same arguments called ${next} times consecutively`,
				};
			}
			// For read-only tools, only escalate to a real loop if the assistant
			// is also repeating its text - that combination is a real loop.
			// Otherwise just continue (re-reading files is harmless).
			if (this.assistantRepeatSignal) {
				return {
					isLoop: true,
					reason: 'tool_repeat',
					details: `read-only tool ${n} repeated ${next} times AND assistant prefix "${this.assistantRepeatSignal.prefix}" repeated ${this.assistantRepeatSignal.count} times`,
				};
			}
		}

		return { isLoop: false };
	}

	/** Extract the write target URI from a mutating tool call, for tracking. */
	private _extractWriteTarget(_toolName: string, args: unknown): string | null {
		try {
			const a = args as any;
			const uri = a?.uri ?? a?.filePath ?? a?.path;
			return typeof uri === 'string' ? uri : null;
		} catch {
			return null;
		}
	}

	/** Extract the read target URI from a read_file call. */
	private _extractReadTarget(args: unknown): string | null {
		try {
			const a = args as any;
			const uri = a?.uri ?? a?.filePath ?? a?.path;
			return typeof uri === 'string' ? uri : null;
		} catch {
			return null;
		}
	}

	private _normalizedAssistantPrefix(text: string): string | null {
		const trimmed = text.trim();
		if (!trimmed) return null;

		const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
		let normalized = firstLine
			.toLowerCase()
			.replace(/\s+/g, ' ') // collapse whitespace
			.trim();

		if (!normalized) return null;

		// Use the first N words as the canonical "prefix". Higher N = fewer false
		// positives - common phrases like "I'll", "Let me", "Now I" alone match
		// too many legitimate responses. 5 words gives enough specificity.
		const words = normalized.split(' ');
		const maxWords = this.opts.assistantPrefixWords;
		normalized = words.slice(0, maxWords).join(' ');

		// Still cap by assistantPrefixLength to avoid overly long keys.
		normalized = normalized.slice(0, this.opts.assistantPrefixLength).trim();

		return normalized || null;
	}

	private _signatureForTool(name: string, args: unknown): string {
		const n = name.trim().toLowerCase();
		const argsJson = this._stableStringify(args);
		return `${n}::${argsJson}`;
	}

	private _stableStringify(value: any): string {
		const seen = new Set<any>();

		const helper = (v: any): any => {
			if (v === null || typeof v !== 'object') {
				return v;
			}
			if (seen.has(v)) {
				return '[Circular]';
			}
			seen.add(v);

			if (Array.isArray(v)) {
				return v.map(helper);
			}

			const out: any = {};
			for (const key of Object.keys(v).sort()) {
				out[key] = helper(v[key]);
			}
			return out;
		};

		try {
			return JSON.stringify(helper(value));
		} catch {
			try {
				return JSON.stringify(String(value));
			} catch {
				return '"[Unserializable]"';
			}
		}
	}
}
