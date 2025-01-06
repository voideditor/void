/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'tsup'

export default defineConfig({
	entry: [
		'./src2/sidebar-tsx/index.tsx',
		'./src2/void-settings-tsx/index.tsx',
		'./src2/quick-edit-tsx/index.tsx',
		'./src2/diff/index.tsx',
	],
	outDir: './out',
	format: ['esm'],
	splitting: false,

	// dts: true,
	// sourcemap: true,

	clean: false,
	platform: 'browser', // 'node'
	target: 'esnext',
	injectStyle: true, // bundle css into the output file
	outExtension: () => ({ js: '.js' }),
	// default behavior is to take local files and make them internal (bundle them) and take imports like 'react' and leave them external (don't bundle them), we want the opposite in many ways
	noExternal: [ // noExternal means we should take these things and make them not external (bundle them into the output file) - anything that doesn't start with a "." needs to be force-flagged as not external
		/^(?!\.).*$/
	],
	external: [ // these imports should be kept external ../../../ are external (this is just an optimization so the output file doesn't re-implement functions)
		new RegExp('../../../*.js'
			.replaceAll('.', '\\.')
			.replaceAll('*', '.*'))
	],
	treeshake: true,
	esbuildOptions(options) {
		options.outbase = 'src2'  // tries copying the folder hierarchy starting at src2
	}
})
