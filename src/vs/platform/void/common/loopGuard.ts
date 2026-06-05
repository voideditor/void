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
}

const DEFAULT_OPTIONS: LoopDetectorOptions = {
	maxTurnsPerPrompt: 12,
	maxSameAssistantPrefix: 3,
	maxSameToolCall: 3,
	assistantPrefixLength: 120,
};

export class LLMLoopDetector {
	private readonly opts: LoopDetectorOptions;
	private assistantTurns = 0;
	private readonly assistantPrefixCounts = new Map<string, number>();
	private readonly toolSignatureCounts = new Map<string, number>();

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

		if (next > this.opts.maxSameAssistantPrefix) {
			return {
				isLoop: true,
				reason: 'assistant_repeat',
				details: `assistant first-line prefix repeated ${next} times`,
			};
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
		const prev = this.toolSignatureCounts.get(sig) ?? 0;
		const next = prev + 1;
		this.toolSignatureCounts.set(sig, next);

		if (next > this.opts.maxSameToolCall) {
			return {
				isLoop: true,
				reason: 'tool_repeat',
				details: `tool ${n} with same arguments called ${next} times`,
			};
		}

		return { isLoop: false };
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

		// Use only the first couple of words as the canonical "prefix" so that
		// small trailing variations like "Repeat me again" vs "Repeat me" still
		// map to the same fingerprint.
		const words = normalized.split(' ');
		const maxWords = 2;
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
