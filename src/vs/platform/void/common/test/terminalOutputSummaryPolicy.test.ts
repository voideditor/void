/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { hasVerboseTerminalOutputEvidence, shouldSummarizeTerminalOutput } from '../terminalOutputSummaryPolicy.js';
import type {
	SummaryBlock,
	TerminalOutputSummary,
	TerminalOutputSummaryCandidate,
	TerminalOutputVerboseEvidence,
} from '../terminalOutputSummaryTypes.js';

const statusBlock: SummaryBlock = {
	kind: 'status',
	lines: ['exit status 0'],
	sourceRanges: [{ startLine: 200, endLine: 200 }],
	protected: true,
};

const summary: TerminalOutputSummary = {
	profile: 'test',
	adapter: 'test',
	confidence: 'high',
	command: 'npm test',
	status: 'success',
	nativeSummaries: [],
	statusEvidence: [],
	counts: [],
	durations: [],
	diagnostics: [],
	aggregates: [],
	samples: [],
	blocks: [statusBlock],
	protectedRanges: statusBlock.sourceRanges,
};

const verboseEvidence: TerminalOutputVerboseEvidence = {
	rawLineCount: 200,
	repeatNoiseRatio: 0.8,
	progressDensity: 0,
	blankProgressChurnRatio: 0,
	hasNativeSummary: false,
	profileConfidence: 'high',
};

function makeCandidate(textLength: number, overrides: Partial<TerminalOutputSummaryCandidate> = {}): TerminalOutputSummaryCandidate {
	return {
		summary,
		text: `${'x'.repeat(Math.max(0, textLength - statusBlock.lines[0].length - 1))}\n${statusBlock.lines[0]}`,
		mandatorySignals: statusBlock.lines,
		verboseEvidence,
		...overrides,
	};
}

suite('terminalOutputSummaryPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('short output with no candidate returns pass-through', () => {
		assert.strictEqual(shouldSummarizeTerminalOutput(500, 40000).kind, 'pass-through');
	});

	test('short compact candidate returns pass-through without verbose evidence', () => {
		const candidate = makeCandidate(500, {
			verboseEvidence: {
				...verboseEvidence,
				rawLineCount: 20,
				repeatNoiseRatio: 0,
				profileConfidence: 'high',
			},
		});
		assert.strictEqual(shouldSummarizeTerminalOutput(5000, 40000, candidate).kind, 'pass-through');
	});

	test('repeat/noise ratio is verbose evidence', () => {
		assert.strictEqual(hasVerboseTerminalOutputEvidence(verboseEvidence), true);
	});

	test('progress density is verbose evidence', () => {
		assert.strictEqual(hasVerboseTerminalOutputEvidence({
			...verboseEvidence,
			repeatNoiseRatio: 0,
			progressDensity: 0.3,
		}), true);
	});

	test('blank/progress churn is verbose evidence', () => {
		assert.strictEqual(hasVerboseTerminalOutputEvidence({
			...verboseEvidence,
			repeatNoiseRatio: 0,
			blankProgressChurnRatio: 0.3,
		}), true);
	});

	test('native summary plus verbose body requires non-low profile confidence', () => {
		const nativeSummaryEvidence: TerminalOutputVerboseEvidence = {
			...verboseEvidence,
			repeatNoiseRatio: 0,
			hasNativeSummary: true,
		};
		assert.strictEqual(hasVerboseTerminalOutputEvidence(nativeSummaryEvidence), true);
		assert.strictEqual(hasVerboseTerminalOutputEvidence({
			...nativeSummaryEvidence,
			profileConfidence: 'low',
		}), false);
	});

	test('candidate below absolute savings threshold returns pass-through', () => {
		const candidate = makeCandidate(1500);
		assert.strictEqual(shouldSummarizeTerminalOutput(2000, 40000, candidate).kind, 'pass-through');
	});

	test('candidate below fractional savings threshold returns pass-through', () => {
		const candidate = makeCandidate(8000);
		assert.strictEqual(shouldSummarizeTerminalOutput(10000, 40000, candidate).kind, 'pass-through');
	});

	test('fully rendered verbose candidate meeting threshold is accepted', () => {
		const candidate = makeCandidate(4000);
		const decision = shouldSummarizeTerminalOutput(20000, 40000, candidate);
		assert.strictEqual(decision.kind, 'verbose');
		if (decision.kind === 'verbose') {
			assert.strictEqual(decision.candidate, candidate);
			assert.strictEqual(decision.savedChars, 20000 - candidate.text.length);
		}
	});

	test('mandatory signal missing from rendered candidate rejects verbose summary', () => {
		const candidate = makeCandidate(4000, { mandatorySignals: ['Tests: 10 passed'] });
		assert.strictEqual(shouldSummarizeTerminalOutput(20000, 40000, candidate).kind, 'pass-through');
	});

	test('all mandatory signals must survive the rendered candidate', () => {
		const candidate = makeCandidate(4000, { mandatorySignals: ['exit status 0', 'Tests: 10 passed'] });
		assert.strictEqual(shouldSummarizeTerminalOutput(20000, 40000, candidate).kind, 'pass-through');
	});

	test('hard-limit returns the supplied candidate without applying verbose gates', () => {
		const candidate = makeCandidate(5000, {
			mandatorySignals: ['missing failure identity'],
			verboseEvidence: {
				...verboseEvidence,
				repeatNoiseRatio: 0,
			},
		});
		const decision = shouldSummarizeTerminalOutput(50000, 40000, candidate);
		assert.strictEqual(decision.kind, 'hard-limit');
		if (decision.kind === 'hard-limit') {
			assert.strictEqual(decision.candidate, candidate);
		}
	});

	test('hard-limit without a candidate delegates fallback selection to the caller', () => {
		const decision = shouldSummarizeTerminalOutput(50000, 40000);
		assert.strictEqual(decision.kind, 'hard-limit');
		if (decision.kind === 'hard-limit') {
			assert.strictEqual(decision.candidate, undefined);
		}
	});

	test('raw at exactly the limit can still use verbose reason', () => {
		const decision = shouldSummarizeTerminalOutput(40000, 40000, makeCandidate(10000));
		assert.strictEqual(decision.kind, 'verbose');
	});

	test('raw at limit plus one uses hard-limit reason', () => {
		assert.strictEqual(shouldSummarizeTerminalOutput(40001, 40000, makeCandidate(5000)).kind, 'hard-limit');
	});

	test('non-finite ratios do not create verbose evidence', () => {
		assert.strictEqual(hasVerboseTerminalOutputEvidence({
			...verboseEvidence,
			repeatNoiseRatio: Number.NaN,
			progressDensity: Number.POSITIVE_INFINITY,
			blankProgressChurnRatio: Number.NEGATIVE_INFINITY,
			hasNativeSummary: false,
		}), false);
	});
});
