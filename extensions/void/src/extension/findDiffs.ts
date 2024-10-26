
import * as vscode from 'vscode';
// import { diffLines, Change } from 'diff';
import { diff_match_patch } from 'diff-match-patch';
import { diffLines } from 'diff';
import { BaseDiff } from '../common/shared_types';


// Andrew diff algo:
// import { diffLines, Change } from 'diff';

// export type SuggestedEdit = {
// 	// start/end of current file
// 	startLine: number;
// 	startCol: number;
// 	endLine: number;
// 	endCol: number;

// 	// start/end of original file
// 	originalStartLine: number,
// 	originalStartCol: number,
// 	originalEndLine: number,
// 	originalEndCol: number,
// 	type: 'insertion' | 'deletion' | 'edit',
// 	originalContent: string, // original content (originalfile[originalStart...originalEnd])
// 	newContent: string,
// }

// export function findDiffs(oldStr: string, newStr: string) {
// 	// an ordered list of every original line, line added to the new file, and line removed from the old file (order is unambiguous, think about it)
// 	const lineByLineChanges: Change[] = diffLines(oldStr, newStr);
// 	lineByLineChanges.push({ value: '' }) // add a dummy so we flush any streaks we haven't yet at the very end (!line.added && !line.removed)

// 	let oldFileLineNum: number = 0;
// 	let newFileLineNum: number = 0;

// 	let streakStartInNewFile: number | undefined = undefined
// 	let streakStartInOldFile: number | undefined = undefined

// 	let oldStrLines = oldStr.split('\n')
// 	let newStrLines = newStr.split('\n')

// 	const replacements: SuggestedEdit[] = []
// 	for (let line of lineByLineChanges) {

// 		// no change on this line
// 		if (!line.added && !line.removed) {

// 			// do nothing

// 			// if we were on a streak of +s and -s, end it
// 			if (streakStartInNewFile !== undefined) {
// 				let type: 'edit' | 'insertion' | 'deletion' = 'edit'

// 				let startLine = streakStartInNewFile
// 				let endLine = newFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
// 				let startCol = 0
// 				let endCol = Number.MAX_SAFE_INTEGER

// 				let originalStartLine = streakStartInOldFile!
// 				let originalEndLine = oldFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
// 				let originalStartCol = 0
// 				let originalEndCol = Number.MAX_SAFE_INTEGER

// 				let newContent = newStrLines.slice(startLine, endLine + 1).join('\n')
// 				let originalContent = oldStrLines.slice(originalStartLine, originalEndLine + 1).join('\n')

// 				// if the range is empty, mark it as a deletion / insertion (both won't be true at once)
// 				// DELETION
// 				if (endLine === startLine - 1) {
// 					type = 'deletion'
// 					endLine = startLine
// 					startCol = 0
// 					endCol = 0
// 					newContent += '\n'
// 				}

// 				// INSERTION
// 				else if (originalEndLine === originalStartLine - 1) {
// 					type = 'insertion'
// 					originalEndLine = originalStartLine
// 					originalStartCol = 0
// 					originalEndCol = 0
// 				}

// 				const replacement: SuggestedEdit = {
// 					type,
// 					startLine, startCol, endLine, endCol, newContent,
// 					originalStartLine, originalStartCol, originalEndLine, originalEndCol, originalContent
// 				} as SuggestedEdit

// 				replacements.push(replacement)

// 				streakStartInNewFile = undefined
// 				streakStartInOldFile = undefined
// 			}
// 			oldFileLineNum += line.count ?? 0;
// 			newFileLineNum += line.count ?? 0;
// 		}

// 		// line was removed from old file
// 		else if (line.removed) {
// 			// if we weren't on a streak, start one on this current line num
// 			if (streakStartInNewFile === undefined) {
// 				streakStartInNewFile = newFileLineNum
// 				streakStartInOldFile = oldFileLineNum
// 			}
// 			oldFileLineNum += line.count ?? 0 // we processed the line so add 1
// 		}

// 		// line was added to new file
// 		else if (line.added) {
// 			// if we weren't on a streak, start one on this current line num
// 			if (streakStartInNewFile === undefined) {
// 				streakStartInNewFile = newFileLineNum
// 				streakStartInOldFile = oldFileLineNum
// 			}
// 			newFileLineNum += line.count ?? 0; // we processed the line so add 1
// 		}
// 	} // end for

// 	console.debug('Replacements', replacements)
// 	return replacements
// }

















// const diffLinesOld = (text1: string, text2: string) => {
// 	var dmp = new diff_match_patch();
// 	var a = dmp.diff_linesToChars_(text1, text2);
// 	var lineText1 = a.chars1;
// 	var lineText2 = a.chars2;
// 	var lineArray = a.lineArray;
// 	var diffs = dmp.diff_main(lineText1, lineText2, false);
// 	dmp.diff_charsToLines_(diffs, lineArray);
// 	// dmp.diff_cleanupSemantic(diffs);
// 	return diffs;
// }


// // TODO use a better diff algorithm
// export const findDiffsOld = (oldText: string, newText: string): BaseDiff[] => {

// 	const diffs = diffLinesOld(oldText, newText);

// 	const blocks: BaseDiff[] = [];
// 	let reprBlock: string[] = [];
// 	let deletedBlock: string[] = [];
// 	let insertedBlock: string[] = [];
// 	let insertedLine = 0;
// 	let deletedLine = 0;
// 	let insertedStart = 0;
// 	let deletedStart = 0;

// 	diffs.forEach(([operation, text]) => {

// 		const lines = text.split('\n');

// 		switch (operation) {

// 			// insertion
// 			case 1:
// 				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
// 				if (insertedBlock.length === 0) insertedStart = insertedLine;
// 				insertedLine += lines.length - 1; // Update only the line count for new text
// 				insertedBlock.push(text);
// 				reprBlock.push(lines.map(line => `+ ${line}`).join('\n'));
// 				break;

// 			// deletion
// 			case -1:
// 				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
// 				if (deletedBlock.length === 0) deletedStart = deletedLine;
// 				deletedLine += lines.length - 1; // Update only the line count for old text
// 				deletedBlock.push(text);
// 				reprBlock.push(lines.map(line => `- ${line}`).join('\n'));
// 				break;

// 			// no change
// 			case 0:
// 				// If we have a pending block, add it to the blocks array
// 				if (insertedBlock.length > 0 || deletedBlock.length > 0) {
// 					blocks.push({
// 						code: reprBlock.join(''),
// 						deletedCode: deletedBlock.join(''),
// 						insertedCode: insertedBlock.join(''),
// 						deletedRange: new vscode.Range(deletedStart, 0, deletedLine, Number.MAX_SAFE_INTEGER),
// 						insertedRange: new vscode.Range(insertedStart, 0, insertedLine, Number.MAX_SAFE_INTEGER),
// 					});
// 				}

// 				// Reset the block variables
// 				reprBlock = [];
// 				deletedBlock = [];
// 				insertedBlock = [];

// 				// Update line counts for unchanged text
// 				insertedLine += lines.length - 1;
// 				deletedLine += lines.length - 1;

// 				break;
// 		}
// 	});

// 	// Add any remaining blocks after the loop ends
// 	if (insertedBlock.length > 0 || deletedBlock.length > 0) {
// 		blocks.push({
// 			code: reprBlock.join(''),
// 			deletedCode: deletedBlock.join(''),
// 			insertedCode: insertedBlock.join(''),
// 			deletedRange: new vscode.Range(deletedStart, 0, deletedLine, Number.MAX_SAFE_INTEGER),
// 			insertedRange: new vscode.Range(insertedStart, 0, insertedLine, Number.MAX_SAFE_INTEGER),
// 		});
// 	}

// 	return blocks;
// };


export const findDiffs = (oldText: string, newText: string): BaseDiff[] => {

	let diffs = diffLines(oldText, newText)
		.map(diff => {
			const operation = diff.added ? 1 : diff.removed ? -1 : 0;
			const text = diff.value;
			return [operation, text] as const;
		})


	const blocks: BaseDiff[] = [];
	let reprBlock: string[] = [];
	let deletedBlock: string[] = [];
	let insertedBlock: string[] = [];
	let newFileLine = 0;
	let oldFileLine = 0;
	let insertedStart = 0;
	let deletedStart = 0;

	diffs.forEach(([operation, text]) => {

		const lines = text.split('\n');

		switch (operation) {

			// insertion
			case 1:
				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
				if (insertedBlock.length === 0) insertedStart = newFileLine;
				newFileLine += lines.length - 1; // update the line count for new text
				insertedBlock.push(text);
				reprBlock.push(lines.map(line => `+ ${line}`).join('\n'));
				break;

			// deletion
			case -1:
				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
				if (deletedBlock.length === 0) deletedStart = oldFileLine;
				oldFileLine += lines.length - 1; // update the line count for old text
				deletedBlock.push(text);
				reprBlock.push(lines.map(line => `- ${line}`).join('\n'));
				break;

			// no change
			case 0:
				// add pending block to the blocks array
				if (insertedBlock.length > 0 || deletedBlock.length > 0) {
					blocks.push({
						repr: reprBlock.join(''),
						originalCode: deletedBlock.join(''),
						code: insertedBlock.join(''),
						originalRange: new vscode.Range(deletedStart, 0, oldFileLine, Number.MAX_SAFE_INTEGER),
						range: new vscode.Range(insertedStart, 0, newFileLine, Number.MAX_SAFE_INTEGER),
					});
				}

				// update variables
				reprBlock = [];
				deletedBlock = [];
				insertedBlock = [];
				deletedStart += lines.length - 1;
				insertedStart += lines.length - 1;
				newFileLine += lines.length - 1;
				oldFileLine += lines.length - 1;

				break;
		}
	});

	// Add any remaining blocks after the loop ends
	if (insertedBlock.length > 0 || deletedBlock.length > 0) {
		blocks.push({
			repr: reprBlock.join(''),
			originalCode: deletedBlock.join(''),
			code: insertedBlock.join(''),
			originalRange: new vscode.Range(deletedStart, 0, oldFileLine, Number.MAX_SAFE_INTEGER),
			range: new vscode.Range(insertedStart, 0, newFileLine, Number.MAX_SAFE_INTEGER),
		});
	}

	return blocks;
};

