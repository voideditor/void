/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { buildTerminalOutputSummaryPipeline, type TerminalOutputSummaryPipelineResult } from '../terminalOutputSummaryPipeline.js';
import { shouldSummarizeTerminalOutput } from '../terminalOutputSummaryPolicy.js';
import { renderTerminalOutputSummary, type TerminalOutputSummaryRenderResult } from '../terminalOutputSummaryRenderer.js';
import { sourceRange } from '../terminalOutputSummaryModel.js';
import type {
	CountFactKind,
	CountFactScope,
	TerminalOutputProfile,
	TerminalOutputSummaryCandidate,
} from '../terminalOutputSummaryTypes.js';

type QualityFixtureMode = 'success' | 'failure' | 'verbose' | 'short';
type FixtureStatus = 'success' | 'failure';

interface CountExpectation {
	kind: CountFactKind;
	scope: CountFactScope;
	value: number;
}

interface AggregateExpectation {
	signature: string;
	count: number;
}

interface QualityFixture {
	name: string;
	mode: QualityFixtureMode;
	command: string;
	body: string;
	status: FixtureStatus;
	profile: TerminalOutputProfile;
	adapter: string;
	expectedCounts: readonly CountExpectation[];
	expectedAggregates?: readonly AggregateExpectation[];
	mandatorySubstrings: readonly string[];
	unknownCountKinds: readonly CountFactKind[];
}

const footer = 'TRUNCATION_META: {"summarizer":true,"summaryVersion":2}';
const adaptiveLimit = 100_000;
const falsePositiveTokens = ['error.mp3', 'src/errors.ts', 'warningCount', 'failed_request_total'];

function fixture(value: QualityFixture): QualityFixture {
	return value;
}

function jestVerboseBody(count: number): string {
	return [
		...Array.from({ length: count }, (_, index) => `PASS src/suite-${index + 1}.test.ts`),
		`Test Suites: ${count} passed, ${count} total`,
		`Tests: ${count * 10} passed, ${count * 10} total`,
		'Time: 4.2 s',
	].join('\n');
}

function buildVerboseBody(count: number): string {
	return [
		...Array.from({ length: count }, (_, index) => `[${index + 1}/${count}] Building module-${index + 1}`),
		'BUILD SUCCESSFUL in 8s',
	].join('\n');
}

function packageVerboseBody(count: number): string {
	return [
		...Array.from({ length: count }, (_, index) => `Progress: resolved ${index + 1}, reused ${index}, downloaded 1, added ${index + 1}`),
		`added ${count} packages in 2s`,
		'Done in 2.1s',
	].join('\n');
}

function searchVerboseBody(count: number): string {
	return Array.from({ length: count }, (_, index) => `src/file${index % 8}.ts:${index + 1}:1:const match${index + 1} = true;`).join('\n');
}

function gitLogHash(index: number): string {
	return index.toString(16).padStart(40, 'a');
}

function gitLogVerboseBody(count: number): string {
	return Array.from({ length: count }, (_, index) => [
		`commit ${gitLogHash(index + 1)} (refs/heads/branch-${index + 1})`,
		`Author: Fixture Author <fixture${index + 1}@example.com>`,
		`Date:   Mon Jul ${String((index % 28) + 1).padStart(2, '0')} 10:00:00 2026 +0000`,
		'',
		`    Fixture commit ${index + 1}`,
		'',
	]).flat().join('\n');
}

function logsVerboseBody(count: number): string {
	return Array.from({ length: count }, (_, index) => `2026-07-28T10:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z INFO [worker] queue empty`).join('\n');
}

const fixtures: readonly QualityFixture[] = [
	fixture({
		name: 'test success',
		mode: 'success',
		command: 'cargo test',
		body: [
			'running 1 test',
			'test tests::works ... ok',
			'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s',
		].join('\n'),
		status: 'success',
		profile: 'test',
		adapter: 'cargo-test',
		expectedCounts: [
			{ kind: 'passed', scope: 'tests', value: 1 },
			{ kind: 'failed', scope: 'tests', value: 0 },
		],
		mandatorySubstrings: ['test result: ok. 1 passed; 0 failed'],
		unknownCountKinds: ['vulnerabilities'],
	}),
	fixture({
		name: 'test failure',
		mode: 'failure',
		command: 'pytest -q',
		body: [
			'______________________________ test_addition ______________________________',
			'def test_addition():',
			'>       assert add(1, 2) == 4',
			'E       assert 3 == 4',
			'tests/test_math.py:10: AssertionError',
			'=========================== short test summary info ============================',
			'FAILED tests/test_math.py::test_addition - assert 3 == 4',
			'============================== 1 failed, 2 passed in 1.2s ==============================',
		].join('\n'),
		status: 'failure',
		profile: 'test',
		adapter: 'pytest',
		expectedCounts: [
			{ kind: 'failed', scope: 'tests', value: 1 },
			{ kind: 'passed', scope: 'tests', value: 2 },
		],
		mandatorySubstrings: [
			'FAILED tests/test_math.py::test_addition - assert 3 == 4',
			'1 failed, 2 passed in 1.2s',
		],
		unknownCountKinds: ['vulnerabilities'],
	}),
	fixture({
		name: 'test verbose',
		mode: 'verbose',
		command: 'npx jest',
		body: jestVerboseBody(220),
		status: 'success',
		profile: 'test',
		adapter: 'jest-vitest-mocha',
		expectedCounts: [
			{ kind: 'passed', scope: 'tests', value: 220 },
			{ kind: 'passed', scope: 'tests', value: 2200 },
		],
		expectedAggregates: [{ signature: 'passing-suite', count: 220 }],
		mandatorySubstrings: ['Tests: 2200 passed, 2200 total'],
		unknownCountKinds: ['vulnerabilities'],
	}),
	fixture({
		name: 'test short',
		mode: 'short',
		command: 'npm test',
		body: [
			'PASS error.mp3',
			'Test Suites: 1 passed, 1 total',
			'Tests: 1 passed, 1 total',
			'Time: 0.1 s',
		].join('\n'),
		status: 'success',
		profile: 'test',
		adapter: 'jest-vitest-mocha',
		expectedCounts: [{ kind: 'passed', scope: 'tests', value: 1 }],
		mandatorySubstrings: ['Tests: 1 passed, 1 total'],
		unknownCountKinds: ['vulnerabilities'],
	}),
	fixture({
		name: 'build success',
		mode: 'success',
		command: 'make all',
		body: [
			'Building module core',
			'BUILD SUCCESSFUL in 1s',
		].join('\n'),
		status: 'success',
		profile: 'build-diagnostics',
		adapter: 'build-generic',
		expectedCounts: [],
		mandatorySubstrings: ['BUILD SUCCESSFUL in 1s'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'build failure',
		mode: 'failure',
		command: 'npx tsc --noEmit',
		body: [
			"src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
			'Found 1 error in 1 file.',
		].join('\n'),
		status: 'failure',
		profile: 'build-diagnostics',
		adapter: 'typescript-eslint',
		expectedCounts: [
			{ kind: 'errors', scope: 'diagnostics', value: 1 },
			{ kind: 'files', scope: 'diagnostics', value: 1 },
		],
		mandatorySubstrings: ["src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'."],
		unknownCountKinds: ['passed'],
	}),
	fixture({
		name: 'build verbose',
		mode: 'verbose',
		command: 'make all',
		body: buildVerboseBody(220),
		status: 'success',
		profile: 'build-diagnostics',
		adapter: 'build-generic',
		expectedCounts: [],
		expectedAggregates: [{ signature: 'build-progress:building', count: 220 }],
		mandatorySubstrings: ['BUILD SUCCESSFUL in 8s'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'build short',
		mode: 'short',
		command: 'make all',
		body: 'BUILD SUCCESSFUL in 0.1s',
		status: 'success',
		profile: 'build-diagnostics',
		adapter: 'build-generic',
		expectedCounts: [],
		mandatorySubstrings: ['BUILD SUCCESSFUL in 0.1s'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'package manager success',
		mode: 'success',
		command: 'npm install',
		body: [
			'added 12 packages, removed 1 package, and changed 2 packages in 1.5s',
			'found 0 vulnerabilities',
		].join('\n'),
		status: 'success',
		profile: 'package-manager',
		adapter: 'npm-pnpm-yarn',
		expectedCounts: [
			{ kind: 'added', scope: 'packages', value: 12 },
			{ kind: 'removed', scope: 'packages', value: 1 },
			{ kind: 'changed', scope: 'packages', value: 2 },
			{ kind: 'vulnerabilities', scope: 'dependencies', value: 0 },
		],
		mandatorySubstrings: ['added 12 packages, removed 1 package, and changed 2 packages in 1.5s'],
		unknownCountKinds: ['passed'],
	}),
	fixture({
		name: 'package manager failure',
		mode: 'failure',
		command: 'npm install',
		body: [
			'> app@1.0.0 build',
			'> tsc -p tsconfig.json',
			'src/app.ts(4,5): error TS2322: Type string is not assignable to number',
			'npm ERR! Lifecycle script `build` failed with error:',
			'npm ERR! Error: command failed',
			'found 1 vulnerability',
		].join('\n'),
		status: 'failure',
		profile: 'package-manager',
		adapter: 'npm-pnpm-yarn',
		expectedCounts: [{ kind: 'vulnerabilities', scope: 'dependencies', value: 1 }],
		mandatorySubstrings: [
			'src/app.ts(4,5): error TS2322: Type string is not assignable to number',
			'npm ERR! Lifecycle script `build` failed with error:',
		],
		unknownCountKinds: ['passed'],
	}),
	fixture({
		name: 'package manager verbose',
		mode: 'verbose',
		command: 'pnpm install',
		body: packageVerboseBody(220),
		status: 'success',
		profile: 'package-manager',
		adapter: 'npm-pnpm-yarn',
		expectedCounts: [{ kind: 'added', scope: 'packages', value: 220 }],
		expectedAggregates: [{ signature: 'pnpm-progress', count: 220 }],
		mandatorySubstrings: ['added 220 packages in 2s', 'Done in 2.1s'],
		unknownCountKinds: ['passed'],
	}),
	fixture({
		name: 'package manager short',
		mode: 'short',
		command: 'npm install',
		body: [
			'warningCount cache unchanged',
			'added 1 package in 0.2s',
		].join('\n'),
		status: 'success',
		profile: 'package-manager',
		adapter: 'npm-pnpm-yarn',
		expectedCounts: [{ kind: 'added', scope: 'packages', value: 1 }],
		mandatorySubstrings: ['added 1 package in 0.2s'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'search success',
		mode: 'success',
		command: 'rg -n value src',
		body: [
			'src/a.ts:1:1:const value = 1;',
			'src/b.ts:2:1:const value = 2;',
		].join('\n'),
		status: 'success',
		profile: 'search-listing',
		adapter: 'rg-grep',
		expectedCounts: [
			{ kind: 'matches', scope: 'search-results', value: 2 },
			{ kind: 'files', scope: 'search-results', value: 2 },
		],
		mandatorySubstrings: ['src/a.ts:1:1:const value = 1;'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'search failure',
		mode: 'failure',
		command: 'grep -Rn value src',
		body: 'src/a.ts:1:1:const value = 1;',
		status: 'failure',
		profile: 'search-listing',
		adapter: 'rg-grep',
		expectedCounts: [{ kind: 'matches', scope: 'search-results', value: 1 }],
		mandatorySubstrings: ['src/a.ts:1:1:const value = 1;'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'search verbose',
		mode: 'verbose',
		command: 'rg -n match src',
		body: searchVerboseBody(220),
		status: 'success',
		profile: 'search-listing',
		adapter: 'rg-grep',
		expectedCounts: [
			{ kind: 'matches', scope: 'search-results', value: 220 },
			{ kind: 'files', scope: 'search-results', value: 8 },
		],
		expectedAggregates: [{ signature: 'search-matches', count: 220 }],
		mandatorySubstrings: ['src/file0.ts:1:1:const match1 = true;'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'search short',
		mode: 'short',
		command: 'rg -n error src',
		body: [
			'src/errors.ts:10:1:console.error(message)',
			'src/warningCount.ts:11:1:const warningCount = 4;',
			'assets/error.mp3:12:1:error sample',
			'src/failed_request_total.ts:13:1:failed_request_total++;',
		].join('\n'),
		status: 'success',
		profile: 'search-listing',
		adapter: 'rg-grep',
		expectedCounts: [{ kind: 'matches', scope: 'search-results', value: 4 }],
		mandatorySubstrings: ['src/errors.ts:10:1:console.error(message)'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'version control success',
		mode: 'success',
		command: 'git status',
		body: [
			'On branch feature/quality',
			'Changes to be committed:',
			'\tmodified:   src/index.ts',
			'Untracked files:',
			'\ttmp/error.mp3',
		].join('\n'),
		status: 'success',
		profile: 'version-control',
		adapter: 'git-status',
		expectedCounts: [
			{ kind: 'staged', scope: 'version-control', value: 1 },
			{ kind: 'untracked', scope: 'version-control', value: 1 },
		],
		mandatorySubstrings: ['On branch feature/quality'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'version control failure',
		mode: 'failure',
		command: 'git push origin feature/quality',
		body: [
			'To github.com:org/repo.git',
			' ! [rejected]        feature/quality -> feature/quality (non-fast-forward)',
			"error: failed to push some refs to 'github.com:org/repo.git'",
			'hint: Updates were rejected because the remote contains work that you do not have locally.',
			'fatal: refusing to update checked out branch',
		].join('\n'),
		status: 'failure',
		profile: 'version-control',
		adapter: 'git-mutation',
		expectedCounts: [],
		mandatorySubstrings: [
			' ! [rejected]        feature/quality -> feature/quality (non-fast-forward)',
			'fatal: refusing to update checked out branch',
		],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'version control verbose',
		mode: 'verbose',
		command: 'git log --stat',
		body: gitLogVerboseBody(160),
		status: 'success',
		profile: 'version-control',
		adapter: 'git-log',
		expectedCounts: [{ kind: 'commits', scope: 'version-control', value: 160 }],
		expectedAggregates: [{ signature: 'git-log-commits', count: 160 }],
		mandatorySubstrings: [`commit ${gitLogHash(1)} (refs/heads/branch-1)`],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'version control short',
		mode: 'short',
		command: 'git status --short',
		body: [
			'On branch main',
			'nothing to commit, working tree clean',
		].join('\n'),
		status: 'success',
		profile: 'version-control',
		adapter: 'git-status',
		expectedCounts: [],
		mandatorySubstrings: ['nothing to commit, working tree clean'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'logs success',
		mode: 'success',
		command: 'docker build .',
		body: [
			'#1 [internal] load build definition from Dockerfile',
			'#1 DONE 0.1s',
			'#2 [1/1] RUN echo ok',
			'#2 DONE 0.2s',
			'Successfully built abcdef123456',
		].join('\n'),
		status: 'success',
		profile: 'logs',
		adapter: 'docker-build',
		expectedCounts: [],
		expectedAggregates: [{ signature: 'docker-build-stages', count: 2 }],
		mandatorySubstrings: ['Successfully built abcdef123456'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'logs failure',
		mode: 'failure',
		command: 'docker build .',
		body: [
			'#1 [internal] load build definition from Dockerfile',
			'#1 DONE 0.1s',
			'#7 [builder 4/5] RUN npm run build',
			'#7 1.000 ERROR: command returned exit code 2',
			'#7 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
			'ERROR: failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
		].join('\n'),
		status: 'failure',
		profile: 'logs',
		adapter: 'docker-build',
		expectedCounts: [],
		mandatorySubstrings: [
			'#7 [builder 4/5] RUN npm run build',
			'ERROR: failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
		],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'logs verbose',
		mode: 'verbose',
		command: 'kubectl logs worker',
		body: logsVerboseBody(220),
		status: 'success',
		profile: 'logs',
		adapter: 'application-logs',
		expectedCounts: [{ kind: 'events', scope: 'log-events', value: 220 }],
		expectedAggregates: [{ signature: 'log-event:\u0000info\u0000worker\u0000queue empty', count: 220 }],
		mandatorySubstrings: ['2026-07-28T10:00:00Z INFO [worker] queue empty'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'logs short',
		mode: 'short',
		command: 'kubectl logs api',
		body: '2026-07-28T10:00:00Z INFO [api] loaded src/errors.ts warningCount=1',
		status: 'success',
		profile: 'logs',
		adapter: 'application-logs',
		expectedCounts: [{ kind: 'events', scope: 'log-events', value: 1 }],
		mandatorySubstrings: ['2026-07-28T10:00:00Z INFO [api] loaded src/errors.ts warningCount=1'],
		unknownCountKinds: ['errors'],
	}),
	fixture({
		name: 'generic success',
		mode: 'success',
		command: 'custom-command',
		body: 'operation complete',
		status: 'success',
		profile: 'generic',
		adapter: 'generic',
		expectedCounts: [],
		mandatorySubstrings: ['operation complete'],
		unknownCountKinds: ['total'],
	}),
	fixture({
		name: 'generic failure',
		mode: 'failure',
		command: 'custom-command',
		body: [
			'preparing request',
			'ERROR: database unavailable',
			'retry disabled',
		].join('\n'),
		status: 'failure',
		profile: 'generic',
		adapter: 'generic',
		expectedCounts: [],
		mandatorySubstrings: ['ERROR: database unavailable'],
		unknownCountKinds: ['total'],
	}),
	fixture({
		name: 'generic verbose',
		mode: 'verbose',
		command: 'custom-command',
		body: Array.from({ length: 300 }, () => 'heartbeat').join('\n'),
		status: 'success',
		profile: 'generic',
		adapter: 'generic',
		expectedCounts: [],
		expectedAggregates: [{ signature: 'heartbeat', count: 300 }],
		mandatorySubstrings: ['heartbeat [repeated 300 times]'],
		unknownCountKinds: ['total'],
	}),
	fixture({
		name: 'generic short',
		mode: 'short',
		command: 'custom-command',
		body: [
			'src/errors.ts',
			'warningCount',
			'failed_request_total',
		].join('\n'),
		status: 'success',
		profile: 'generic',
		adapter: 'generic',
		expectedCounts: [],
		mandatorySubstrings: ['src/errors.ts'],
		unknownCountKinds: ['total'],
	}),
];

function statusTextOf(status: FixtureStatus): string {
	return status === 'success' ? 'exit status 0' : 'exit status 1';
}

function rawOutputOf(value: QualityFixture): string {
	return `${value.body}\n${statusTextOf(value.status)}`;
}

function bodyLineCount(value: QualityFixture): number {
	return value.body ? value.body.split(/\r\n|\r|\n/).length : 0;
}

function pipelineOf(value: QualityFixture): TerminalOutputSummaryPipelineResult {
	const statusLine = bodyLineCount(value) + 1;
	return buildTerminalOutputSummaryPipeline({
		rawOutput: rawOutputOf(value),
		bodyOutput: value.body,
		bodyStartLine: 0,
		command: value.command,
		processStatus: value.status,
		processStatusText: statusTextOf(value.status),
		processStatusRange: sourceRange(statusLine),
		headLines: 3,
		tailLines: 3,
	});
}

function renderOf(
	pipeline: TerminalOutputSummaryPipelineResult,
	maxOutputLength = adaptiveLimit,
): TerminalOutputSummaryRenderResult {
	return renderTerminalOutputSummary(pipeline.summary, {
		maxOutputLength,
		footer,
		rawLineCount: pipeline.rawLineCount,
	});
}

function candidateOf(
	pipeline: TerminalOutputSummaryPipelineResult,
	rendered: TerminalOutputSummaryRenderResult,
): TerminalOutputSummaryCandidate {
	return {
		summary: pipeline.summary,
		text: rendered.text,
		mandatorySignals: pipeline.mandatorySignals,
		verboseEvidence: pipeline.verboseEvidence,
	};
}

function assertExpectedCounts(value: QualityFixture, pipeline: TerminalOutputSummaryPipelineResult): void {
	for (const expected of value.expectedCounts) {
		const count = pipeline.summary.counts.find(candidate => candidate.kind === expected.kind && candidate.scope === expected.scope && candidate.value === expected.value);
		assert.ok(count, `${value.name}: missing ${expected.scope}/${expected.kind}=${expected.value} count`);
		assert.strictEqual(count.value, expected.value, `${value.name}: unexpected ${expected.scope}/${expected.kind} count`);
		assert.ok(count.sourceRange.startLine >= 1, `${value.name}: count source range must be 1-based`);
	}
	for (const kind of value.unknownCountKinds) {
		const candidates = pipeline.summary.counts.filter(count => count.kind === kind);
		assert.ok(candidates.length === 0 || candidates.every(count => count.value === undefined), `${value.name}: ${kind} must remain unknown`);
	}
}

function assertExpectedAggregates(value: QualityFixture, pipeline: TerminalOutputSummaryPipelineResult): void {
	for (const expected of value.expectedAggregates ?? []) {
		const aggregate = pipeline.summary.aggregates.find(candidate => candidate.signature === expected.signature);
		assert.ok(aggregate, `${value.name}: missing ${expected.signature} aggregate`);
		assert.strictEqual(aggregate.count, expected.count, `${value.name}: unexpected ${expected.signature} aggregate count`);
	}
}

function assertFalsePositiveSafety(value: QualityFixture, pipeline: TerminalOutputSummaryPipelineResult): void {
	for (const token of falsePositiveTokens) {
		if (!value.body.includes(token)) { continue; }
		assert.ok(!pipeline.summary.diagnostics.some(diagnostic =>
			diagnostic.verbatim.includes(token) || diagnostic.identity.includes(token)
		), `${value.name}: ${token} must not become a diagnostic`);
	}
}

function assertMetrics(value: QualityFixture, rendered: TerminalOutputSummaryRenderResult): void {
	for (const metric of [rendered.omittedRawLines, rendered.omittedBlocks, rendered.omittedDiagnostics]) {
		assert.ok(Number.isSafeInteger(metric) && metric >= 0, `${value.name}: omitted metrics must be non-negative integers`);
	}
	assert.ok(rendered.omittedRawLines <= bodyLineCount(value) + 1, `${value.name}: omitted raw lines exceed the fixture size`);
	if (value.mode === 'verbose') {
		assert.ok(rendered.body.includes('omitted') || rendered.body.includes('[repeated ') || rendered.omittedRawLines > 0 || rendered.omittedBlocks > 0, `${value.name}: verbose rendering must expose reduction`);
	}
}

suite('terminal output quality matrix', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('golden fixtures preserve typed facts, mandatory text, unknown counts, and false-positive safety', () => {
		assert.strictEqual(fixtures.length, 28);
		for (const value of fixtures) {
			const pipeline = pipelineOf(value);
			const rendered = renderOf(pipeline);
			assert.strictEqual(pipeline.summary.profile, value.profile, `${value.name}: profile`);
			assert.strictEqual(pipeline.summary.adapter, value.adapter, `${value.name}: adapter`);
			assert.strictEqual(pipeline.summary.status, value.status, `${value.name}: status`);
			if (value.profile === 'generic') {
				assert.strictEqual(pipeline.summary.confidence, 'low', `${value.name}: generic confidence`);
			} else {
				assert.notStrictEqual(pipeline.summary.confidence, 'low', `${value.name}: profile confidence`);
			}
			assertExpectedCounts(value, pipeline);
			assertExpectedAggregates(value, pipeline);
			for (const substring of [...value.mandatorySubstrings, statusTextOf(value.status)]) {
				assert.ok(rendered.body.includes(substring), `${value.name}: missing mandatory rendered substring ${substring}`);
			}
			assertFalsePositiveSafety(value, pipeline);
			assertMetrics(value, rendered);
		}
	});

	test('pipeline and rendered output are deterministic and idempotent across every profile and mode', () => {
		for (const value of fixtures) {
			const firstPipeline = pipelineOf(value);
			const secondPipeline = pipelineOf(value);
			assert.deepStrictEqual(secondPipeline, firstPipeline, `${value.name}: pipeline`);
			assert.deepStrictEqual(renderOf(secondPipeline), renderOf(firstPipeline), `${value.name}: renderer`);
		}
	});

	test('compact fixtures remain unchanged and verbose fixtures summarize only after the savings threshold', () => {
		for (const value of fixtures.filter(candidate => candidate.mode === 'short' || candidate.mode === 'verbose')) {
			const rawOutput = rawOutputOf(value);
			const pipeline = pipelineOf(value);
			const rendered = renderOf(pipeline);
			const candidate = candidateOf(pipeline, rendered);
			const decision = shouldSummarizeTerminalOutput(rawOutput.length, adaptiveLimit, candidate);
			if (value.mode === 'short') {
				assert.strictEqual(decision.kind, 'pass-through', `${value.name}: compact decision`);
				assert.strictEqual(rawOutput, rawOutputOf(value), `${value.name}: compact output`);
				continue;
			}

			assert.ok(rawOutput.length < adaptiveLimit, `${value.name}: verbose fixture must remain below the hard limit`);
			assert.strictEqual(decision.kind, 'verbose', `${value.name}: verbose decision`);
			assert.ok(rendered.text.length < rawOutput.length, `${value.name}: verbose result must save characters`);

			const mandatoryText = pipeline.mandatorySignals.join('\n');
			const belowThresholdLength = Math.max(mandatoryText.length, rawOutput.length - 999);
			const belowThresholdCandidate: TerminalOutputSummaryCandidate = {
				...candidate,
				text: `${mandatoryText}${'x'.repeat(Math.max(0, belowThresholdLength - mandatoryText.length))}`,
			};
			assert.strictEqual(
				shouldSummarizeTerminalOutput(rawOutput.length, adaptiveLimit, belowThresholdCandidate).kind,
				'pass-through',
				`${value.name}: below-threshold candidate`,
			);
		}
	});

	test('failure golden keeps mandatory signals through large, medium, and small normal budgets', () => {
		const value = fixtures.find(candidate => candidate.name === 'test failure');
		assert.ok(value);
		const pipeline = pipelineOf(value);
		const renderedVariants = [adaptiveLimit, 1800, 900].map(maxOutputLength => renderOf(pipeline, maxOutputLength));
		for (const rendered of renderedVariants) {
			for (const signal of pipeline.mandatorySignals) {
				assert.ok(rendered.body.includes(signal), `budget ${rendered.text.length}: missing ${signal}`);
			}
			assert.ok(rendered.text.endsWith(footer));
			assertMetrics(value, rendered);
		}
	});

	test('hard limit remains mandatory independently of the verbose threshold', () => {
		const value = fixtures.find(candidate => candidate.name === 'build short');
		assert.ok(value);
		const pipeline = pipelineOf(value);
		const candidate = candidateOf(pipeline, renderOf(pipeline));
		assert.strictEqual(shouldSummarizeTerminalOutput(rawOutputOf(value).length, 10, candidate).kind, 'hard-limit');
	});
});
