/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

// gulp 5 ships vinyl-fs 4 / glob-stream 8. Its directory walker calls
// `fs.readdir(path, { withFileTypes: true }, cb)` for every directory it
// descends into and destroys the whole source stream with an `ENOENT: scandir`
// error when a subdirectory is missing (e.g. because it was excluded from the
// build but its parent is still walked). gulp 4 (vinyl-fs 3) silently skipped
// such directories and simply emitted no files for them.
//
// This wrapper restores the lenient vinyl-fs 3 behaviour by intercepting the
// walker's `withFileTypes` readdir calls and turning `ENOENT`/`ENOTDIR` into
// an empty directory listing, so missing subdirectories are skipped instead
// of failing the build.

const fs = require('fs');
const gulp = require('gulp');

const skippedErrors = new Set(['ENOENT', 'ENOTDIR']);

let patchDepth = 0;
let originalReaddir = null;

function installPatch() {
    if (patchDepth++ === 0) {
        originalReaddir = fs.readdir;
        fs.readdir = function patchedReaddir(target, options, callback) {
            // Only intercept the glob-stream walker signature
            // (readdir with { withFileTypes: true } and a callback).
            if (options && typeof options === 'object' && options.withFileTypes === true && typeof callback === 'function') {
                return originalReaddir.call(fs, target, options, function(err, dirents) {
                    if (err && skippedErrors.has(err.code)) {
                        // Mimic vinyl-fs 3: a missing/unreadable directory
                        // simply yields no entries instead of failing the stream.
                        return callback(null, []);
                    }
                    return callback(err, dirents);
                });
            }
            return originalReaddir.apply(fs, arguments);
        };
    }
}

function uninstallPatch() {
    if (--patchDepth === 0 && originalReaddir) {
        fs.readdir = originalReaddir;
        originalReaddir = null;
    }
}

function src(globs, opt) {
    installPatch();
    let stream;
    try {
        stream = gulp.src(globs, opt);
    } catch (err) {
        uninstallPatch();
        throw err;
    }
    let done = false;
    const teardown = function() {
        if (!done) {
            done = true;
            uninstallPatch();
        }
    };
    stream.once('end', teardown);
    stream.once('error', teardown);
    stream.once('close', teardown);
    return stream;
}

exports.src = src;
