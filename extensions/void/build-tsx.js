const esbuild = require('esbuild')

// Build JS
esbuild.build({
  entryPoints: ['src/sidebar/index.tsx'],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: 'dist/sidebar/index.js',
  format: 'iife', // apparently iife is safe for browsers (safer than cjs)
  platform: 'browser',
  external: ['vscode'],
}).catch(() => process.exit(1));
