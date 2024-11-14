import { defineConfig } from 'tsup'

export default defineConfig({
	entry: [
		'./src2/sidebar-tsx/Sidebar.tsx',
		'./src2/util/sendLLMMessage.tsx',
		'./src2/util/posthog.tsx',
	],
	outDir: './out',
	format: ['esm'],
	dts: true,
	splitting: false,
	// sourcemap: true,
	clean: true,
	platform: 'browser',
	target: 'esnext',
	injectStyle: true, // bundle css into the output file
	outExtension: () => ({ js: '.js' }),
	// default behavior is to take local files and make them internal (bundle them) and take imports like 'react' and leave them external (don't bundle them), we want the opposite in many ways
	noExternal: [ // noExternal means we should take these things and make them not external (bundle them into the output file)
		'react',
		'react-dom',
		'posthog-js',
		'@google/generative-ai',
		'ollama',
		'@anthropic-ai/sdk',
		'openai',
	],
	external: [ // these imports should be kept external ../../../ are external (this is just an optimization so the output file doesn't re-implement functions)
		new RegExp('../../../*'
			.replaceAll('.', '\\.')
			.replaceAll('*', '.*'))
	],
	treeshake: true,
	esbuildOptions(options) {
		options.outbase = 'src2'  // tries copying the folder hierarchy starting at src2
	}
})
