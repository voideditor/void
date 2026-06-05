/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outDir = resolve(repoRoot, 'out/vs/platform/acp/electron-main/vendor');

const external = [
	'node:*', 'fs', 'path', 'net', 'tls', 'http', 'https', 'zlib', 'stream', 'crypto', 'url', 'events',
	'bufferutil', 'utf-8-validate'
];

await mkdir(outDir, { recursive: true });

await build({
	entryPoints: [resolve(repoRoot, 'scripts/vendor/entry-acp-sdk.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'es2020',
	outfile: join(outDir, 'acp-sdk.vendored.js'),
	external
});

await build({
	entryPoints: [resolve(repoRoot, 'scripts/vendor/entry-ws.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'es2020',
	outfile: join(outDir, 'ws.vendored.js'),
	external,
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
	}
});

console.log('[acp-vendor] built:', outDir);
