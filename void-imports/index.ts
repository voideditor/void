import * as fs from 'fs'
import * as path from 'path'
import * as esbuild from 'esbuild'

export const buildFiles = (imports, to_be_built_folder) => {
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



export const compileFiles = async (imports: string[], srcFolder: string, outDir: string) => {
	const entryPoints = imports.map(name => path.join(srcFolder, `${name}.ts`))

	await esbuild.build({
		entryPoints,
		outdir: outDir,
		bundle: true,
		format: 'iife',
		platform: 'browser',
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

