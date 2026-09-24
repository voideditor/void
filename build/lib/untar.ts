/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import VinylFile from 'vinyl';
import path from 'path';
import through2 from 'through2';
import { Readable, Stream, Transform } from 'stream';
import { Parser } from 'tar';

/**
 * A minimal, security-audited replacement for the abandoned `gulp-untar` package.
 * `gulp-untar` pins `tar@^2` (multiple critical/high advisories) and has not been
 * updated since 2018. This implementation uses the maintained `tar@7` `Parser`
 * API and keeps the same vinyl-based stream contract as `gulp-untar`:
 * - non-file entries (directories, symlinks, ...) are skipped,
 * - each regular file is emitted as a vinyl file with its full contents.
 */
export function untar(): Stream {
	return through2.obj(function (this: Transform, file: VinylFile, _enc: string, callback: through2.TransformCallback) {
		let contentsStream: Readable;
		if (file.isNull()) {
			this.push(file);
			return callback();
		}
		if (file.isStream()) {
			contentsStream = file.contents as Readable;
		} else {
			contentsStream = Readable.from(file.contents as Buffer);
		}

		contentsStream
			.pipe(new Parser())
			.on('entry', (entry) => {
				// Skip anything that is not a regular file, mirroring `gulp-untar`'s
				// `entry.props.type !== '0'` check. The entry stream must still be
				// consumed so that parsing can continue.
				if (entry.type !== 'File') {
					entry.resume();
					return;
				}
				const chunks: Buffer[] = [];
				entry.on('data', (chunk: Buffer) => chunks.push(chunk));
				entry.on('end', () => {
					this.push(new VinylFile({
						contents: Buffer.concat(chunks),
						path: path.normalize(path.dirname(file.path) + '/' + entry.path),
						base: file.base,
						cwd: file.cwd
					}));
				});
			})
			.on('end', () => callback())
			.on('error', (err: Error) => this.emit('error', err));
	});
}
