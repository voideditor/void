import * as esbuild from 'esbuild'
import * as path from 'path'

// import tsup from 'tsup' // Void added tsup as a dependency
// import * as path from 'path'


// export const compileFiles = async (imports: string[], src_folder: string, outDir: string) => {
// 	const fileEntries = imports.map((importName) => path.join(src_folder, `${importName}.ts`))
// 	await tsup.build({
// 		entry: fileEntries,
// 		format: ['cjs'],
// 		sourcemap: false,
// 		bundle: true,
// 		clean: true,
// 		// minify: true, // no need to minify since it all gets bundled later
// 		outDir: path.join(outDir),
// 		dts: false,
// 		noExternal: [/.*/],  // This bundles everything
// 		platform: 'browser', // Important for browser compatibility
// 		target: 'es2020',
// 		banner: {
// 			js: '/* eslint-disable */'
// 		}
// 	})
// }
