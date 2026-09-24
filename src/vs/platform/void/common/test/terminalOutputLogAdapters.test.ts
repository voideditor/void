/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { sourceRange } from '../terminalOutputSummaryModel.js';
import {
	logOutputAdapters,
	parseTerminalLogEvent,
	summarizeLogsOutput,
} from '../terminalOutputProfiles/index.js';
import type { TerminalOutputLine, TerminalOutputSummary } from '../terminalOutputSummaryTypes.js';

function line(text: string, lineNumber: number): TerminalOutputLine {
	return { text, lineNumber, sourceRange: sourceRange(lineNumber) };
}

function assertProtected(summary: TerminalOutputSummary, lineNumber: number): void {
	assert.ok(summary.protectedRanges.some(range => lineNumber >= range.startLine && lineNumber <= range.endLine), `line ${lineNumber} must be protected`);
}

suite('terminal output log adapters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses timestamp, level, component, stream, and structured key-value prefixes', () => {
		assert.deepStrictEqual(parseTerminalLogEvent(line('2026-07-27T10:00:00.123Z stderr F ERROR [api] request rejected', 1)), {
			timestamp: '2026-07-27T10:00:00.123Z',
			level: 'error',
			component: 'api',
			stream: 'stderr',
			message: 'request rejected',
			signature: 'stderr\u0000error\u0000api\u0000request rejected',
			sourceRange: sourceRange(1),
		});
		const structured = parseTerminalLogEvent(line('time="2026-07-27T10:00:01Z" level=warn component=worker msg="queue delayed"', 2));
		assert.strictEqual(structured?.timestamp, '2026-07-27T10:00:01Z');
		assert.strictEqual(structured?.level, 'warning');
		assert.strictEqual(structured?.component, 'worker');
		assert.strictEqual(structured?.message, 'queue delayed');
	});

	test('aggregates only consecutive events with the same normalized message', () => {
		const output = [
			'2026-07-27T10:00:00Z INFO [worker] queue empty',
			'2026-07-27T10:00:01Z INFO [worker] queue empty',
			'2026-07-27T10:00:02Z INFO [worker] queue empty',
			'2026-07-27T10:00:03Z INFO [worker] queue has 1 item',
			'2026-07-27T10:00:04Z INFO [worker] queue has 2 items',
		].join('\n');
		const summary = summarizeLogsOutput({ command: 'kubectl logs worker', rawOutput: output, processStatus: 'success' });
		const repeated = summary.aggregates.find(aggregate => aggregate.signature.endsWith('queue empty'));
		assert.strictEqual(repeated?.count, 3);
		assert.strictEqual(repeated?.samples[0].text, output.split('\n')[0]);
		assert.strictEqual(repeated?.samples[1].text, output.split('\n')[2]);
		assert.strictEqual(summary.aggregates.some(aggregate => aggregate.signature.includes('queue has') && aggregate.count > 1), false);
		assert.strictEqual(summary.counts.find(count => count.kind === 'events')?.value, 5);
	});

	test('timestamp, PID, IP, duration, bytes, and version remain meaningful payload', () => {
		const output = [
			'2026-07-27T10:00:00Z INFO [api] pid=101 client=10.0.0.1 duration=12ms bytes=1024 version=1.2.3',
			'2026-07-27T10:00:01Z INFO [api] pid=102 client=10.0.0.2 duration=13ms bytes=2048 version=1.2.4',
			'2026-07-27T10:00:02Z INFO [api] pid=103 client=10.0.0.3 duration=14ms bytes=4096 version=1.2.5',
		].join('\n');
		const summary = summarizeLogsOutput({ command: 'docker logs api', rawOutput: output });
		assert.strictEqual(summary.aggregates.some(aggregate => aggregate.count === 3), false);
		assert.strictEqual(summary.samples.length, 3);
	});

	test('multiline exception and kubectl panic preserve bounded context', () => {
		const output = [
			'2026-07-27T10:00:00Z INFO [api] request start',
			'request_id=abc',
			'user_id=42',
			'2026-07-27T10:00:01Z ERROR [api] database unavailable',
			'ConnectionError: refused by primary',
			'  at connect (db.js:20:4)',
			'retrying in 5s',
			'2026-07-27T10:00:06Z INFO [api] recovered',
		].join('\n');
		const summary = summarizeLogsOutput({ command: 'kubectl logs deployment/api', rawOutput: output, processStatus: 'failure' });
		const diagnostic = summary.diagnostics.find(item => item.message === 'database unavailable');
		assert.ok(diagnostic);
		assert.deepStrictEqual(diagnostic.contextLines, output.split('\n').slice(1, 7));
		assert.deepStrictEqual(diagnostic.contextRange, sourceRange(2, 7));
		assertProtected(summary, 4);
		assert.strictEqual(summary.status, 'failure');

		const panicOutput = [
			'2026-07-27T10:01:00Z INFO [worker] processing item',
			'item_id=abc',
			'thread "main" panicked at index out of bounds',
			'stack frame one',
			'stack frame two',
			'worker terminated',
		].join('\n');
		const panicSummary = summarizeLogsOutput({ command: 'kubectl logs worker', rawOutput: panicOutput, processStatus: 'failure' });
		const panic = panicSummary.diagnostics.find(item => item.message === 'index out of bounds');
		assert.ok(panic);
		assert.strictEqual(panic.severity, 'fatal');
		assert.ok(panic.contextLines.includes('stack frame two'));
	});

	test('semantic flood stays bounded without displacing process status', () => {
		const outputLines = [
			...Array.from({ length: 100 }, (_, index) => `2026-07-27T10:00:${String(index % 60).padStart(2, '0')}Z ERROR [worker] request ${index} failed`),
			'exit status 1',
		];
		const summary = summarizeLogsOutput({
			command: 'kubectl logs worker',
			rawOutput: outputLines.join('\n'),
			processStatus: 'failure',
			processStatusText: 'exit status 1',
			processStatusRange: sourceRange(101),
		});
		assert.strictEqual(summary.diagnostics.length, 32);
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.message === 'request 99 failed'));
		assert.ok(summary.statusEvidence.some(status => status.text === 'exit status 1'));
		assertProtected(summary, 101);
	});

	test('Docker failed stage preserves stage, command context, primary error, and final status', () => {
		const output = [
			'#1 [internal] load build definition from Dockerfile',
			'#1 DONE 0.1s',
			'#7 [builder 4/5] RUN npm run build',
			'#7 0.321 > app@1.0.0 build',
			'#7 0.322 > tsc -p tsconfig.json',
			'#7 1.000 ERROR: command returned exit code 2',
			'#7 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
			'ERROR: failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 2',
			'exit status 1',
		].join('\n');
		const summary = summarizeLogsOutput({
			command: 'docker build -t app .',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 1',
			processStatusRange: sourceRange(9),
		});
		assert.strictEqual(summary.adapter, 'docker-build');
		assert.strictEqual(summary.status, 'failure');
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'docker-build-stages' && aggregate.count === 2));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.contextLines.includes('#7 [builder 4/5] RUN npm run build')));
		assert.ok(summary.nativeSummaries.some(native => native.text.startsWith('ERROR: failed to solve')));
		assertProtected(summary, 3);
		assertProtected(summary, 8);
		assertProtected(summary, 9);
	});

	test('successful Docker build preserves final status and deterministic adapter order', () => {
		const output = [
			'#1 [internal] load build definition from Dockerfile',
			'#1 DONE 0.1s',
			'#2 [1/1] RUN echo ok',
			'#2 DONE 0.2s',
			'Successfully built abcdef123456',
		].join('\n');
		const options = { command: 'docker build .', rawOutput: output, processStatus: 'success' as const };
		const summary = summarizeLogsOutput(options);
		assert.strictEqual(summary.status, 'success');
		assert.ok(summary.nativeSummaries.some(native => native.text === 'Successfully built abcdef123456'));
		assert.deepStrictEqual(summary, summarizeLogsOutput(options));
		assert.deepStrictEqual(logOutputAdapters.map(adapter => adapter.id), ['docker-build', 'application-logs']);
	});
});
