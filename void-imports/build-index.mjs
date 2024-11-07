import tsup from 'tsup' // Void added tsup as a dependency
import * as fs from 'fs'
import * as path from 'path'

const buildFiles = (imports, to_be_built_folder) => {
	// create a file with name importName that imports importName and immediately re-exports it
	for (const importName of imports) {
		const content = `\
import * as mod from '${importName}'
export default mod
`
		const dir = path.dirname(importName);
		const file = path.basename(importName);

		const fullPath = path.join(to_be_built_folder, dir, `${file}.ts`);

		// Create all necessary directories before writing the file
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content, 'utf8');
	}
}

const compileFiles = async (imports, to_be_built_folder, outDir) => {
	const fileEntries = imports.map((importName) => path.join(to_be_built_folder, `${importName}.ts`))
	await tsup.build({
		entry: fileEntries,
		format: ['cjs'],
		sourcemap: false,
		bundle: true,
		clean: true,
		// minify: true, // no need to minify since it all gets bundled later
		outDir: path.join(outDir),
		dts: false,
		noExternal: [/.*/],  // This bundles everything
		platform: 'browser', // Important for browser compatibility
		target: 'es2020',
		banner: {
			js: '/* eslint-disable */'
		}
	})
}

const to_be_built_folder = 'to_be_built'
fs.rmSync(to_be_built_folder, { recursive: true, force: true });

const imports = ['openai', '@anthropic-ai/sdk', 'react', 'react-dom']
buildFiles(imports, to_be_built_folder)

const OUT_DIR = '../src/vs/workbench/contrib/void/browser/void-imports'
compileFiles(imports, to_be_built_folder, OUT_DIR)

