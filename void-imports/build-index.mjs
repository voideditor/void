import tsup from 'tsup'

tsup.build({
	entry: [`void-imports.js`],
	format: ['esm'],
	sourcemap: false,
	bundle: true,
	clean: true,
	// minify: true, // no need to minify since it all gets bundled later
	outDir: '../src/vs/workbench/contrib/void/browser/out',
	dts: false,
	name: 'void-imports',
	noExternal: [/.*/],  // This bundles everything
	platform: 'browser', // Important for browser compatibility
	target: 'es2020',
	// banner: {
	// 	js: '/* eslint-disable */'
	// }
})

