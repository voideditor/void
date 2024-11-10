import { defineConfig } from 'tsup'

export default defineConfig({
	entry: ['./sidebar-tsx/Sidebar.tsx'],  // You'll need to create this index file
	outDir: './out',
	format: ['esm'],
	// dts: true,
	splitting: false,
	sourcemap: true,
	clean: true,
	platform: 'browser',
	target: 'esnext',
	outExtension: () => ({ js: '.js' }),
	external: [/\.\.\/\.\.\/.*/],
	noExternal: ['react', 'react-dom'],
	treeshake: true,
})
