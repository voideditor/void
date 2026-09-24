"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.untar = untar;
const vinyl_1 = __importDefault(require("vinyl"));
const path_1 = __importDefault(require("path"));
const through2_1 = __importDefault(require("through2"));
const stream_1 = require("stream");
const tar_1 = require("tar");
/**
 * A minimal, security-audited replacement for the abandoned `gulp-untar` package.
 * `gulp-untar` pins `tar@^2` (multiple critical/high advisories) and has not been
 * updated since 2018. This implementation uses the maintained `tar@7` `Parser`
 * API and keeps the same vinyl-based stream contract as `gulp-untar`:
 * - non-file entries (directories, symlinks, ...) are skipped,
 * - each regular file is emitted as a vinyl file with its full contents.
 */
function untar() {
    return through2_1.default.obj(function (file, _enc, callback) {
        let contentsStream;
        if (file.isNull()) {
            this.push(file);
            return callback();
        }
        if (file.isStream()) {
            contentsStream = file.contents;
        }
        else {
            contentsStream = stream_1.Readable.from(file.contents);
        }
        contentsStream
            .pipe(new tar_1.Parser())
            .on('entry', (entry) => {
            // Skip anything that is not a regular file, mirroring `gulp-untar`'s
            // `entry.props.type !== '0'` check. The entry stream must still be
            // consumed so that parsing can continue.
            if (entry.type !== 'File') {
                entry.resume();
                return;
            }
            const chunks = [];
            entry.on('data', (chunk) => chunks.push(chunk));
            entry.on('end', () => {
                this.push(new vinyl_1.default({
                    contents: Buffer.concat(chunks),
                    path: path_1.default.normalize(path_1.default.dirname(file.path) + '/' + entry.path),
                    base: file.base,
                    cwd: file.cwd
                }));
            });
        })
            .on('end', () => callback())
            .on('error', (err) => this.emit('error', err));
    });
}
//# sourceMappingURL=untar.js.map