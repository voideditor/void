const deps = [
	'path', 'original-fs', 'os', 'perf_hooks',
	'./out/bootstrap-node.js', './out/bootstrap-esm.js', 'url', 'electron', 'minimist',
	'./out/bootstrap-meta.js', './out/vs/base/common/jsonc.js',
	'./out/vs/platform/environment/node/userDataPath.js',
	'./out/vs/base/common/performance.js', './out/vs/base/node/nls.js',
	'./out/vs/base/node/unc.js'
];

async function test() {
	for (const dep of deps) {
		try {
			console.log('Testing', dep);
			await import(dep);
			console.log('OK', dep);
		} catch (err) {
			console.error('FAIL', dep, err.message, err.stack);
			break;
		}
	}
}
test();
