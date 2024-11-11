import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['./sidebar-tsx/Sidebar.tsx'],  // You'll need to create this index file
	outDir: './out',
	format: ['esm'],
	// dts: true,
	splitting: false,
	// sourcemap: true,
	clean: true,
	platform: 'browser',
	target: 'esnext',
	outExtension: () => ({ js: '.js' }),
	// default behavior is to take local files and make them internal (bundle them) and take imports like 'react' and leave them external (don't bundle them), we want the opposite in many ways
	noExternal: ['react', 'react-dom'], // noExternal means we should take these things and make them not external (bundle them into the output file)
	external: [/\.\.\/\.\.\/.*/], // these imports should be kept external ../../ are external (this is just an optimization so the output file doesn't re-implement functions)
	treeshake: true,
})
