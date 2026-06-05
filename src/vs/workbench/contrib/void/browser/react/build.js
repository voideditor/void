/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { execFileSync } from 'child_process';
import { spawn } from 'cross-spawn'
// Added lines below
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function doesPathExist(filePath) {
	try {
		const stats = fs.statSync(filePath);

		return stats.isFile();
	} catch (err) {
		if (err.code === 'ENOENT') {
			return false;
		}
		throw err;
	}
}

/*

This function finds `globalDesiredPath` given `localDesiredPath` and `currentPath`

Diagram:

...basePath/
└── void/
	├── ...currentPath/ (defined globally)
	└── ...localDesiredPath/ (defined locally)

*/
function findDesiredPathFromLocalPath(localDesiredPath, currentPath) {

	// walk upwards until currentPath + localDesiredPath exists
	while (!doesPathExist(path.join(currentPath, localDesiredPath))) {
		const parentDir = path.dirname(currentPath);

		if (parentDir === currentPath) {
			return undefined;
		}

		currentPath = parentDir;
	}

	// return the `globallyDesiredPath`
	const globalDesiredPath = path.join(currentPath, localDesiredPath)
	return globalDesiredPath;
}

function requireRepoPath(localDesiredPath) {
	const desiredPath = findDesiredPathFromLocalPath(localDesiredPath, __dirname);
	if (!desiredPath) {
		throw new Error(`Could not resolve required path: ${localDesiredPath}`);
	}
	return desiredPath;
}

function createTailwindShim(tailwindCliPath) {
	const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'void-tailwind-'));
	const shimPath = path.join(shimDir, 'tailwindcss');
	const script = `#!/usr/bin/env sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(tailwindCliPath)} "$@"\n`;
	fs.writeFileSync(shimPath, script, { mode: 0o755 });

	return {
		shimDir,
		cleanup: () => {
			try {
				fs.rmSync(shimDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	};
}

const scopeTailwindCliPath = requireRepoPath('./node_modules/scope-tailwind/dist/main.js');
const nodemonCliPath = requireRepoPath('./node_modules/nodemon/bin/nodemon.js');
const tsupCliPath = requireRepoPath('./node_modules/tsup/dist/cli-default.js');
const tailwindCliPath = requireRepoPath('./node_modules/tailwindcss/lib/cli.js');

const { shimDir: tailwindShimDir, cleanup: cleanupTailwindShim } = createTailwindShim(tailwindCliPath);
const buildEnv = {
	...process.env,
	PATH: `${tailwindShimDir}${path.delimiter}${process.env.PATH ?? ''}`,
};
process.on('exit', cleanupTailwindShim);

// hack to refresh styles automatically
function saveStylesFile() {
	setTimeout(() => {
		try {
			const pathToCssFile = findDesiredPathFromLocalPath('./src/vs/workbench/contrib/void/browser/react/src2/styles.css', __dirname);

			if (pathToCssFile === undefined) {
				console.error('[scope-tailwind] Error finding styles.css');
				return;
			}

			// Or re-write with the same content:
			const content = fs.readFileSync(pathToCssFile, 'utf8');
			fs.writeFileSync(pathToCssFile, content, 'utf8');
			console.log('[scope-tailwind] Force-saved styles.css');
		} catch (err) {
			console.error('[scope-tailwind] Error saving styles.css:', err);
		}
	}, 6000);
}

const args = process.argv.slice(2);
const isWatch = args.includes('--watch') || args.includes('-w');

if (isWatch) {
	// this just builds it if it doesn't exist instead of waiting for the watcher to trigger
	// Check if src2/ exists; if not, do an initial scope-tailwind build
	if (!fs.existsSync('src2')) {
		try {
			console.log('🔨 Running initial scope-tailwind build to create src2 folder...');
			execFileSync(process.execPath, [
				scopeTailwindCliPath,
				'./src',
				'-o', 'src2/',
				'-s', 'void-scope',
				'-c', 'styles.css',
				'-p', 'void-',
			], { stdio: 'inherit', env: buildEnv });
			console.log('✅ src2/ created successfully.');
		} catch (err) {
			console.error('❌ Error running initial scope-tailwind build:', err);
			process.exit(1);
		}
	}

	// Watch mode
	const scopeTailwindWatcher = spawn(process.execPath, [
		nodemonCliPath,
		'--watch', 'src',
		'--ext', 'ts,tsx,css',
		'--exec',
		`${JSON.stringify(process.execPath)} ${JSON.stringify(scopeTailwindCliPath)} ./src -o src2/ -s void-scope -c styles.css -p void-`
	], { env: buildEnv });

	const tsupWatcher = spawn(process.execPath, [
		tsupCliPath,
		'--watch'
	], { env: buildEnv });

	scopeTailwindWatcher.stdout.on('data', (data) => {
		console.log(`[scope-tailwind] ${data}`);
		// If the output mentions "styles.css", trigger the save:
		if (data.toString().includes('styles.css')) {
			saveStylesFile();
		}
	});

	scopeTailwindWatcher.stderr.on('data', (data) => {
		console.error(`[scope-tailwind] ${data}`);
	});

	// Handle tsup watcher output
	tsupWatcher.stdout.on('data', (data) => {
		console.log(`[tsup] ${data}`);
	});

	tsupWatcher.stderr.on('data', (data) => {
		console.error(`[tsup] ${data}`);
	});

	// Handle process termination
	process.on('SIGINT', () => {
		scopeTailwindWatcher.kill();
		tsupWatcher.kill();
		cleanupTailwindShim();
		process.exit();
	});

	console.log('🔄 Watchers started! Press Ctrl+C to stop both watchers.');
} else {
	// Build mode
	console.log('📦 Building...');

	// Run scope-tailwind once
	execFileSync(process.execPath, [
		scopeTailwindCliPath,
		'./src',
		'-o', 'src2/',
		'-s', 'void-scope',
		'-c', 'styles.css',
		'-p', 'void-',
	], { stdio: 'inherit', env: buildEnv });

	// Run tsup once
	execFileSync(process.execPath, [tsupCliPath], { stdio: 'inherit', env: buildEnv });

	console.log('✅ Build complete!');
	cleanupTailwindShim();
}
