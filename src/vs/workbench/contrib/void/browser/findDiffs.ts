
import { Range } from 'vscode';
import { Diff } from './registerInlineDiffs';

import { diffLines } from './react/out/util/diffLines.js'

type Fields =
	| 'type'
	| 'originalCode'
	| 'originalStartLine' | 'originalEndLine'
	| 'startLine' | 'endLine'
	| 'startCol' | 'endCol'


export type BaseDiff = Pick<Diff, Fields>

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
	const lineByLineChanges = diffLines(oldStr, newStr);
	lineByLineChanges.push({ value: '', added: false, removed: false }) // add a dummy so we flush any streaks we haven't yet at the very end (!line.added && !line.removed)

	let oldFileLineNum: number = 1;
	let newFileLineNum: number = 1;

	let streakStartInNewFile: number | undefined = undefined
	let streakStartInOldFile: number | undefined = undefined

	let oldStrLines = ('\n' + oldStr).split('\n') // add newline so indexing starts at 1
	// let newStrLines = ('\n' + newStr).split('\n')

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
				let startCol = 1
				let endCol = Number.MAX_SAFE_INTEGER

				let originalStartLine = streakStartInOldFile!
				let originalEndLine = oldFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
				// let originalStartCol = 0
				// let originalEndCol = Number.MAX_SAFE_INTEGER

				// let newContent = newStrLines.slice(startLine, endLine + 1).join('\n')
				let originalContent = oldStrLines.slice(originalStartLine, originalEndLine + 1).join('\n')

				// if the range is empty, mark it as a deletion / insertion (both won't be true at once)
				// DELETION
				if (endLine === startLine - 1) {
					type = 'deletion'
					endLine = startLine
					startCol = 1
					endCol = 1
					// newContent += '\n'
				}

				// INSERTION
				else if (originalEndLine === originalStartLine - 1) {
					type = 'insertion'
					originalEndLine = originalStartLine
					// originalStartCol = 0
					// originalEndCol = 0
				}

				const replacement: BaseDiff = {
					type,
					startLine, endLine,
					startCol, endCol,
					originalStartLine, originalEndLine,
					// code: newContent,
					// originalRange: new Range(originalStartLine, originalStartCol, originalEndLine, originalEndCol),
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

	// console.debug('Replacements', replacements)
	return replacements
}




















// uncomment this to test

// let name_ = ''
// let testsFailed = 0
// const assertEqual = (a: { [s: string]: any }, b: { [s: string]: any }) => {
// 	let keys = new Set([...Object.keys(a), ...Object.keys(b)])
// 	for (let k of keys) {
// 		if (a[k] !== b[k]) {
// 			console.error('Void Test Error:', name_, '\n', `${k}=`, `${JSON.stringify(a[k])}, ${JSON.stringify(b[k])}`)
// 			// console.error(JSON.stringify(a, null, 4))
// 			// console.error(JSON.stringify(b, null, 4))
// 			testsFailed += 1
// 		}
// 	}
// }
// const test = (name: string, fn: () => void) => {
// 	name_ = name
// 	fn()
// }

// const originalCode = `\
// A
// B
// C

// E
// `
// const insertedCode = `\
// A
// B
// C
// F
// D
// E
// `

// const modifiedCode = `\
// A
// B
// C
// F
// E
// `


// test('Diffs Insertion', () => {
// 	const diffs = findDiffs(originalCode, insertedCode)

// 	const expected: BaseDiff = {
// 		type: 'insertion',
// 		originalCode: '',
// 		originalStartLine: 4, // empty range where the insertion happened
// 		originalEndLine: 4,

// 		startLine: 4,
// 		startCol: 1,
// 		endLine: 4,
// 		endCol: Number.MAX_SAFE_INTEGER,
// 	}
// 	assertEqual(diffs[0], expected)
// })

// test('Diffs Deletion', () => {
// 	const diffs = findDiffs(insertedCode, originalCode)
// 	assertEqual({ length: diffs.length }, { length: 1 })
// 	const expected: BaseDiff = {
// 		type: 'deletion',
// 		originalCode: 'F',
// 		originalStartLine: 4,
// 		originalEndLine: 4,

// 		startLine: 4,
// 		startCol: 1, // empty range where the deletion happened
// 		endLine: 4,
// 		endCol: 1,
// 	}
// 	assertEqual(diffs[0], expected)
// })

// test('Diffs Modification', () => {
// 	const diffs = findDiffs(originalCode, modifiedCode)
// 	assertEqual({ length: diffs.length }, { length: 1 })
// 	const expected: BaseDiff = {
// 		type: 'edit',
// 		originalCode: 'D',
// 		originalStartLine: 4,
// 		originalEndLine: 4,

// 		startLine: 4,
// 		startCol: 1,
// 		endLine: 4,
// 		endCol: Number.MAX_SAFE_INTEGER,
// 	}
// 	assertEqual(diffs[0], expected)
// })



// if (testsFailed === 0) {
// 	console.log('✅ Void - All tests passed')
// }
// else {
// 	console.log('❌ Void - At least one test failed')
// }
