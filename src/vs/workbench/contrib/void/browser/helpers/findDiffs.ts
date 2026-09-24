/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ComputedDiff } from '../../../../../platform/void/common/editCodeServiceTypes.js';
import { diffLines } from '../react/out/diff/index.js'

export function findDiffs(oldStr: string, newStr: string) {

	// this makes it so the end of the file always ends with a \n (if you don't have this, then diffing E vs E\n gives an "edit". With it, you end up diffing E\n vs E\n\n which now properly gives an insertion)
	newStr += '\n';
	oldStr += '\n';

	// an ordered list of every original line, line added to the new file, and line removed from the old file (order is unambiguous, think about it)
	const lineByLineChanges = diffLines(oldStr, newStr);
	lineByLineChanges.push({ value: '', added: false, removed: false }) // add a dummy so we flush any streaks we haven't yet at the very end (!line.added && !line.removed)

	let oldFileLineNum: number = 1;
	let newFileLineNum: number = 1;

	let streakStartInNewFile: number | undefined = undefined
	let streakStartInOldFile: number | undefined = undefined

	const oldStrLines = ('\n' + oldStr).split('\n') // add newline so indexing starts at 1
	const newStrLines = ('\n' + newStr).split('\n')

	const replacements: ComputedDiff[] = []
	for (const line of lineByLineChanges) {

		// no change on this line
		if (!line.added && !line.removed) {

			// do nothing

			// if we were on a streak of +s and -s, end it
			if (streakStartInNewFile !== undefined) {
				let type: 'edit' | 'insertion' | 'deletion' = 'edit'

				const startLine = streakStartInNewFile
				const endLine = newFileLineNum - 1 // don't include current line, the edit was up to this line but not including it

				const originalStartLine = streakStartInOldFile!
				const originalEndLine = oldFileLineNum - 1 // don't include current line, the edit was up to this line but not including it

				const newContent = newStrLines.slice(startLine, endLine + 1).join('\n')
				const originalContent = oldStrLines.slice(originalStartLine, originalEndLine + 1).join('\n')

				// if the range is empty, mark it as a deletion / insertion (both won't be true at once)
				// DELETION
				if (endLine === startLine - 1) {
					type = 'deletion'
					// endLine = startLine
				}

				// INSERTION
				else if (originalEndLine === originalStartLine - 1) {
					type = 'insertion'
					// originalEndLine = originalStartLine
				}

				const replacement: ComputedDiff = {
					type,
					startLine, endLine,
					// startCol, endCol,
					originalStartLine, originalEndLine,
					// code: newContent,
					// originalRange: new Range(originalStartLine, originalStartCol, originalEndLine, originalEndCol),
					originalCode: originalContent,
					code: newContent,
				}

				replacements.push(replacement)

				streakStartInNewFile = undefined
				streakStartInOldFile = undefined
			}
			oldFileLineNum += line.count ?? 0;
			newFileLineNum += line.count ?? 0;
		}

		// line was removed from old file
		else if (line.removed) {
			// if we weren't on a streak, start one on this current line num
			if (streakStartInNewFile === undefined) {
				streakStartInNewFile = newFileLineNum
				streakStartInOldFile = oldFileLineNum
			}
			oldFileLineNum += line.count ?? 0 // we processed the line so add 1 (or "count")
		}

		// line was added to new file
		else if (line.added) {
			// if we weren't on a streak, start one on this current line num
			if (streakStartInNewFile === undefined) {
				streakStartInNewFile = newFileLineNum
				streakStartInOldFile = oldFileLineNum
			}
			newFileLineNum += line.count ?? 0; // we processed the line so add 1 (or "count")
		}
	} // end for

	return replacements
}
