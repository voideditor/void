
import { Range } from 'vscode';
import { diffLines, Change } from 'diff';
import { BaseDiff } from './common/shared_types';


// class Range {
// 	range: any;
// 	constructor(startLine, startCol, endLine, endCol) {
// 	  const range = {
// 		startLine,
// 		startCol,
// 		endLine,
// 		endCol,
// 	  };
// 	  this.range = range;
// 	}
//   }



// Andrew diff algo:
export type SuggestedEdit = {
	// start/end of current file
	newRange: Range;

	// start/end of original file
	originalRange: Range;
	type: 'insertion' | 'deletion' | 'edit',
	originalContent: string, // original content (originalfile[originalStart...originalEnd])
	newContent: string,
}

export function findDiffs(oldStr: string, newStr: string) {
	// an ordered list of every original line, line added to the new file, and line removed from the old file (order is unambiguous, think about it)
	const lineByLineChanges: Change[] = diffLines(oldStr, newStr);
	lineByLineChanges.push({ value: '' }) // add a dummy so we flush any streaks we haven't yet at the very end (!line.added && !line.removed)

	let oldFileLineNum: number = 0;
	let newFileLineNum: number = 0;

	let streakStartInNewFile: number | undefined = undefined
	let streakStartInOldFile: number | undefined = undefined

	let oldStrLines = oldStr.split('\n')
	let newStrLines = newStr.split('\n')

	const replacements: BaseDiff[] = []
	for (let line of lineByLineChanges) {

		// no change on this line
		if (!line.added && !line.removed) {

			// do nothing

			// if we were on a streak of +s and -s, end it
			if (streakStartInNewFile !== undefined) {
				let type: 'edit' | 'insertion' | 'deletion' = 'edit'

				let startLine = streakStartInNewFile
				let endLine = newFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
				let startCol = 0
				let endCol = Number.MAX_SAFE_INTEGER

				let originalStartLine = streakStartInOldFile!
				let originalEndLine = oldFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
				let originalStartCol = 0
				let originalEndCol = Number.MAX_SAFE_INTEGER

				let newContent = newStrLines.slice(startLine, endLine + 1).join('\n')
				let originalContent = oldStrLines.slice(originalStartLine, originalEndLine + 1).join('\n')

				// if the range is empty, mark it as a deletion / insertion (both won't be true at once)
				// DELETION
				if (endLine === startLine - 1) {
					type = 'deletion'
					endLine = startLine
					startCol = 0
					endCol = 0
					newContent += '\n'
				}

				// INSERTION
				else if (originalEndLine === originalStartLine - 1) {
					type = 'insertion'
					originalEndLine = originalStartLine
					originalStartCol = 0
					originalEndCol = 0
				}

				const replacement: BaseDiff = {
					type,
					range: new Range(startLine, startCol, endLine, endCol),
					code: newContent,
					originalRange: new Range(originalStartLine, originalStartCol, originalEndLine, originalEndCol),
					originalCode: originalContent,
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
			oldFileLineNum += line.count ?? 0 // we processed the line so add 1
		}

		// line was added to new file
		else if (line.added) {
			// if we weren't on a streak, start one on this current line num
			if (streakStartInNewFile === undefined) {
				streakStartInNewFile = newFileLineNum
				streakStartInOldFile = oldFileLineNum
			}
			newFileLineNum += line.count ?? 0; // we processed the line so add 1
		}
	} // end for

	console.debug('Replacements', replacements)
	return replacements
}
