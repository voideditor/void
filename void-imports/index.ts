import * as fs from 'fs'
import * as path from 'path'
import * as tsup from 'tsup'

const createFiles = (imports: string[], to_be_built_folder: string) => {
	for (const importName of imports) {
		const content = `\
export * from '${importName}';
`;

		const dir = path.dirname(importName);
		const file = path.basename(importName);

		const fullPath = path.join(to_be_built_folder, dir, `${file}.ts`);

		// Create all necessary directories before writing the file
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content, 'utf8');
	}
}




const compileFiles = async (imports: string[], to_be_built_folder: string, outDir: string) => {
	const fileEntries = imports.map((importName) => path.join(to_be_built_folder, `${importName}.ts`))
	await tsup.build({
		entry: fileEntries,
		format: ['esm'],
		sourcemap: false,
		bundle: true,
		clean: true,
		// minify: true, // no need to minify since it all gets bundled later
		outDir: path.join(outDir),
		dts: true,
		noExternal: [/.*/],  // This bundles everything
		platform: 'browser', // Important for browser compatibility
		target: 'es2020',
		outExtension: () => ({ js: '.js' })
	})
}



const to_be_built_folder = 'to_be_built'
// const imports = ['openai', '@anthropic-ai/sdk', 'react', 'react-dom']
const imports = ['sendLLMMessage']

// fs.rmSync(to_be_built_folder, { recursive: true, force: true });
// createFiles(imports, to_be_built_folder)

const OUT_DIR = '../src/vs/workbench/contrib/void/browser/void-imports'
compileFiles(imports, to_be_built_folder, OUT_DIR)

