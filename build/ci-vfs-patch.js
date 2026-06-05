/**
 * CI shim for gulp/vinyl-fs to tolerate empty/invalid globs.
 * Preload with: NODE_OPTIONS="--require ./build/ci-vfs-patch.cjs"
 */
'use strict';

/** @returns {import('stream').Readable} */
function emptyStream() {
	const { Readable } = require('stream');
	return Readable.from([]);
}

/**
 * Sanitize vinyl-fs glob argument.
 * @param {any} globs
 * @returns {string|string[]|null}
 */
function sanitize(globs) {
	if (Array.isArray(globs)) {
		const cleaned = globs.filter(g => typeof g === 'string' && g.trim().length > 0);
		return cleaned.length ? cleaned : null;
	}
	if (typeof globs === 'string') {
		const s = globs.trim();
		return s.length ? s : null;
	}
	return null;
}

/**
 * Patch a src function (vinyl-fs/lib/src).
 * @param {(globs:any, options?:any)=>any} realSrc
 */
function makePatchedSrc(realSrc) {
	return function patchedSrc(globs, options) {
		const safe = sanitize(globs);
		if (!safe) return emptyStream();
		return realSrc.call(this, safe, options);
	};
}

try {
	// Patch top-level vinyl-fs.src
	const vfs = require('vinyl-fs');
	if (vfs && typeof vfs.src === 'function') {
		vfs.src = makePatchedSrc(vfs.src);
	}
} catch { /* ignore */ }

try {
	// Patch direct import path used by gulp
	const srcPath = require.resolve('vinyl-fs/lib/src/index.js');
	const realSrc = require(srcPath);
	if (typeof realSrc === 'function' && require.cache[srcPath]) {
		require.cache[srcPath].exports = makePatchedSrc(realSrc);
	}
} catch { /* ignore */ }
