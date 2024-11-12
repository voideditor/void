// This is from the old repo

// const tailwindcss = require('tailwindcss')
// const autoprefixer = require('autoprefixer')
// const postcss = require('postcss')
// const fs = require('fs')

// const convertTailwindToCSS = ({ from, to }) => {
// 	console.log('converting ', from, ' --> ', to)

// 	const original_css_contents = fs.readFileSync(from, 'utf8')

// 	return postcss([
// 		tailwindcss, // this compiles tailwind of all the files specified in tailwind.config.json
// 		autoprefixer,
// 	])
// 		.process(original_css_contents, { from, to })
// 		.then(processed_css_contents => { fs.writeFileSync(to, processed_css_contents.css) })
// 		.catch(error => {
// 			console.error('Error in build-css:', error)
// 		})
// }


// const esbuild = require('esbuild')

// const convertTSXtoJS = async ({ from, to }) => {
// 	console.log('converting ', from, ' --> ', to)

// 	return esbuild.build({
// 		entryPoints: [from],
// 		bundle: true,
// 		minify: true,
// 		sourcemap: true,
// 		outfile: to,
// 		format: 'iife', // apparently iife is safe for browsers (safer than cjs)
// 		platform: 'browser',
// 		external: ['vscode'],
// 	}).catch(() => process.exit(1));
// }

// (async () => {
// 	// convert tsx to js
// 	await convertTSXtoJS({
// 		from: 'src/webviews/sidebar/index.tsx',
// 		to: 'dist/webviews/sidebar/index.js',
// 	})

// 	await convertTSXtoJS({
// 		from: 'src/webviews/ctrlk/index.tsx',
// 		to: 'dist/webviews/ctrlk/index.js',
// 	})

// 	await convertTSXtoJS({
// 		from: 'src/webviews/diffline/index.tsx',
// 		to: 'dist/webviews/diffline/index.js',
// 	})

// 	// convert tailwind to css
// 	await convertTailwindToCSS({
// 		from: 'src/webviews/styles.css',
// 		to: 'dist/webviews/styles.css',
// 	})

// })()

