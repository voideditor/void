/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const cp = require('child_process');
const path = require('path');

const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 8192;

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parseHeapLimit(value) {
	if (!value) {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return undefined;
	}

	return parsed;
}

/**
 * @param {string[]} argv
 * @returns {{ argv: string[]; heapLimitMb: number | undefined }}
 */
function extractHeapLimitFromArgv(argv) {
	/** @type {string[]} */
	const cleanedArgv = [];
	let heapLimitMb;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		if (arg.startsWith('--max-old-space-size=')) {
			heapLimitMb = parseHeapLimit(arg.slice('--max-old-space-size='.length));
			continue;
		}

		if (arg === '--max-old-space-size') {
			heapLimitMb = parseHeapLimit(argv[i + 1]);
			i++;
			continue;
		}

		cleanedArgv.push(arg);
	}

	return { argv: cleanedArgv, heapLimitMb };
}

const argInfo = extractHeapLimitFromArgv(process.argv.slice(2));
const heapLimitMb = argInfo.heapLimitMb
	?? parseHeapLimit(process.env['npm_config_max_old_space_size'])
	?? DEFAULT_MAX_OLD_SPACE_SIZE_MB;
const heapLimitSource = argInfo.heapLimitMb !== undefined
	? 'cli'
	: parseHeapLimit(process.env['npm_config_max_old_space_size']) !== undefined
		? 'npm_config_max_old_space_size'
		: 'default';

const gulpCliPath = path.join(__dirname, '..', '..', 'node_modules', 'gulp', 'bin', 'gulp.js');

console.log(`[run-gulp] Using --max-old-space-size=${heapLimitMb} (${heapLimitSource})`);

const child = cp.spawn(process.execPath, [
	`--max-old-space-size=${heapLimitMb}`,
	gulpCliPath,
	...argInfo.argv
], {
	stdio: 'inherit',
	env: process.env
});

child.on('error', err => {
	console.error(err);
	process.exit(1);
});

child.on('exit', (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});
