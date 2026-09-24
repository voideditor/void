/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

// Increase max listeners for event emitters
require('events').EventEmitter.defaultMaxListeners = 100;

// gulp 5 uses vinyl-fs 4 (streamx), whose `pipe()` calls `dest.end()` when
// the source ends. `event-stream@3.3.4`'s `es.merge`/`es.concat` return a
// legacy `Stream` that has no `end()` method, which crashes builds with
// `TypeError: this.pipeTo.end is not a function` as soon as a `gulp.src()`
// stream (streamx) is merged into it. The merged stream already emits
// `'end'` via its internal end-count logic once all merged sources have
// ended, so a no-op `end()` is all that is needed.
const es = require('event-stream');
const esMergeOriginal = es.merge;
const esMergePatched = function (/* streams... */) {
	const merged = esMergeOriginal.apply(es, arguments);
	if (typeof merged.end !== 'function') {
		merged.end = function () { /* no-op, see comment above */ };
	}
	return merged;
};
es.merge = esMergePatched;
es.concat = esMergePatched;

const gulp = require('gulp');
const util = require('./lib/util');
const task = require('./lib/task');
const { transpileClientSWC, transpileTask, compileTask, watchTask, compileApiProposalNamesTask, watchApiProposalNamesTask } = require('./lib/compilation');
const { monacoTypecheckTask/* , monacoTypecheckWatchTask */ } = require('./gulpfile.editor');
const { compileExtensionsTask, watchExtensionsTask, compileExtensionMediaTask } = require('./gulpfile.extensions');

// API proposal names
gulp.task(compileApiProposalNamesTask);
gulp.task(watchApiProposalNamesTask);

// SWC Client Transpile
const transpileClientSWCTask = task.define('transpile-client-esbuild', task.series(util.rimraf('out'), transpileTask('src', 'out', true)));
gulp.task(transpileClientSWCTask);

// Transpile only
const transpileClientTask = task.define('transpile-client', task.series(util.rimraf('out'), transpileTask('src', 'out')));
gulp.task(transpileClientTask);

// Fast compile for development time (use esbuild for bundling dependencies)
const compileClientTask = task.define('compile-client', task.series(
	util.rimraf('out'),
	compileApiProposalNamesTask,
	transpileClientSWCTask
));
gulp.task(compileClientTask);

// Copy Terminalia fonts after dev compile
const copyVoidFontsDev = () => {
	// `encoding: false` is required so fonts are copied as raw binary;
	// vinyl-fs 4 (gulp 5) otherwise transcodes via utf8 and corrupts them.
	return gulp.src('src/vs/code/electron-sandbox/workbench/assets/fonts/*.{woff2,ttf}', { encoding: false })
		.pipe(gulp.dest('out/vs/code/electron-sandbox/workbench/assets/fonts'));
};

const copyPatchLibDev = () => {
	return gulp.src('src/vs/workbench/contrib/void/browser/lib/diff-match-patch.js')
		.pipe(gulp.dest('out/vs/workbench/contrib/void/browser/lib'));
};

const watchClientTask = task.define('watch-client', task.series(
	util.rimraf('out'),
	task.parallel(watchTask('out', false), watchApiProposalNamesTask)
));
gulp.task(watchClientTask);

// All
const _compileTask = task.define('compile', task.series(
	task.parallel(monacoTypecheckTask, compileClientTask, compileExtensionsTask, compileExtensionMediaTask),
	copyVoidFontsDev,
	copyPatchLibDev
));
gulp.task(_compileTask);

gulp.task(task.define('watch', task.parallel(/* monacoTypecheckWatchTask, */ watchClientTask, watchExtensionsTask)));

// Default
gulp.task('default', _compileTask);

process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
	process.exit(1);
});

// Load all the gulpfiles only if running tasks other than the editor tasks
require('glob').sync('gulpfile.*.js', { cwd: __dirname })
	.forEach(f => require(`./${f}`));
