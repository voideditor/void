/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type {
	SourceRange,
	SummaryConfidence,
	TerminalOutputLine,
	TerminalOutputProfile,
	TerminalOutputSummary,
} from '../terminalOutputSummaryTypes.js';
import type { TerminalOutputSafeReductionSignatureProvider } from '../terminalOutputReducer.js';

export interface TerminalOutputAdapterInput {
	command: string;
	rawOutput: string;
	lines: readonly TerminalOutputLine[];
	processStatus: 'success' | 'failure' | 'unknown';
	processStatusText?: string;
	processStatusRange?: SourceRange;
}

export interface TerminalOutputAdapterMatch {
	confidence: SummaryConfidence;
	evidenceSpecificity: number;
	evidenceRanges: readonly SourceRange[];
}

export interface TerminalOutputProfileAdapter {
	id: string;
	profile: TerminalOutputProfile;
	match(input: TerminalOutputAdapterInput): TerminalOutputAdapterMatch | undefined;
	extract(input: TerminalOutputAdapterInput, match: TerminalOutputAdapterMatch): TerminalOutputSummary;
	safeReductionSignature?: TerminalOutputSafeReductionSignatureProvider;
}

export interface TerminalOutputAdapterSelection {
	adapter: TerminalOutputProfileAdapter;
	match: TerminalOutputAdapterMatch;
}
