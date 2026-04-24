#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 * Patches @vscode/spdlog to compile with Apple Clang 17+ (macOS 26 Tahoe and later).
 *
 * Root cause: the FMT_STRING macro in the bundled {fmt} library generates a consteval lambda
 * with pointer arithmetic that Clang 17+ rejects as non-constant. The fix is to make
 * SPDLOG_FMT_STRING a no-op (pass-through), disabling compile-time format string validation.
 *
 * Usage:
 *   node scripts/patch-spdlog.js          # patch + rebuild
 *   node scripts/patch-spdlog.js --patch  # patch only (no rebuild)
 *---------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const COMMON_H = path.join(__dirname, '..', 'node_modules', '@vscode', 'spdlog', 'deps', 'spdlog', 'include', 'spdlog', 'common.h');
const SPDLOG_DIR = path.join(__dirname, '..', 'node_modules', '@vscode', 'spdlog');

const OLD_DEFINE = '#    define SPDLOG_FMT_STRING(format_string) FMT_STRING(format_string)';
const NEW_DEFINE = '#    define SPDLOG_FMT_STRING(format_string) format_string /* patched: FMT_STRING consteval rejected by Clang 17+ */';

function patchSource() {
	if (!fs.existsSync(COMMON_H)) {
		console.error(`[patch-spdlog] ERROR: ${COMMON_H} not found.`);
		console.error('[patch-spdlog] Run "npm install --ignore-scripts" first.');
		process.exit(1);
	}

	const content = fs.readFileSync(COMMON_H, 'utf8');

	if (content.includes(NEW_DEFINE)) {
		console.log('[patch-spdlog] Already patched, skipping.');
		return;
	}

	if (!content.includes(OLD_DEFINE)) {
		console.warn('[patch-spdlog] WARNING: Expected line not found in common.h — spdlog version may have changed.');
		console.warn('[patch-spdlog] Skipping patch; you may need to update this script.');
		return;
	}

	fs.writeFileSync(COMMON_H, content.replace(OLD_DEFINE, NEW_DEFINE), 'utf8');
	console.log('[patch-spdlog] Patched spdlog/common.h — FMT_STRING consteval disabled.');
}

function rebuild() {
	if (!fs.existsSync(SPDLOG_DIR)) {
		console.error(`[patch-spdlog] ERROR: ${SPDLOG_DIR} not found.`);
		process.exit(1);
	}

	// Read Electron target from root .npmrc if available
	const npmrcPath = path.join(__dirname, '..', '.npmrc');
	let target = '34.3.2';
	let disturl = 'https://electronjs.org/headers';
	if (fs.existsSync(npmrcPath)) {
		for (const line of fs.readFileSync(npmrcPath, 'utf8').split('\n')) {
			const [k, v] = line.split('=').map(s => s.trim().replace(/"/g, ''));
			if (k === 'target') target = v;
			if (k === 'disturl') disturl = v;
		}
	}

	const arch = process.arch;
	const args = [
		'rebuild',
		`--target=${target}`,
		`--disturl=${disturl}`,
		'--runtime=electron',
		'--build-from-source',
		`--arch=${arch}`,
	];

	console.log(`[patch-spdlog] Rebuilding @vscode/spdlog for Electron ${target} (${arch})...`);
	console.log(`[patch-spdlog] $ node-gyp ${args.join(' ')}`);

	const nodeGyp = path.join(__dirname, '..', 'node_modules', '.bin', 'node-gyp');
	const bin = fs.existsSync(nodeGyp) ? nodeGyp : 'npx node-gyp';

	const result = cp.spawnSync(bin, args, {
		cwd: SPDLOG_DIR,
		stdio: 'inherit',
		shell: true,
	});

	if (result.status !== 0) {
		console.error('[patch-spdlog] Rebuild failed.');
		process.exit(result.status ?? 1);
	}

	console.log('[patch-spdlog] Rebuild successful.');
}

const patchOnly = process.argv.includes('--patch');

patchSource();
if (!patchOnly) {
	rebuild();
}
