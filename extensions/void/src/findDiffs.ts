
import * as vscode from 'vscode';
// import { diffLines, Change } from 'diff';
import { BaseDiff } from './shared_types';

import { diff_match_patch } from 'diff-match-patch';


const diffLines = (text1: string, text2: string) => {
	var dmp = new diff_match_patch();
	var a = dmp.diff_linesToChars_(text1, text2);
	var lineText1 = a.chars1;
	var lineText2 = a.chars2;
	var lineArray = a.lineArray;
	var diffs = dmp.diff_main(lineText1, lineText2, false);
	dmp.diff_charsToLines_(diffs, lineArray);
	// dmp.diff_cleanupSemantic(diffs);
	return diffs;
}


// TODO use a better diff algorithm
export const findDiffs = (oldText: string, newText: string): BaseDiff[] => {

	const diffs = diffLines(oldText, newText);

	const blocks: BaseDiff[] = [];
	let reprBlock: string[] = [];
	let deletedBlock: string[] = [];
	let insertedBlock: string[] = [];
	let insertedLine = 0;
	let deletedLine = 0;
	let insertedStart = 0;
	let deletedStart = 0;

	diffs.forEach(([operation, text]) => {

		const lines = text.split('\n');

		switch (operation) {

			// insertion
			case 1:
				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
				if (insertedBlock.length === 0) insertedStart = insertedLine;
				insertedLine += lines.length - 1; // Update only the line count for new text
				insertedBlock.push(text);
				reprBlock.push(lines.map(line => `+ ${line}`).join('\n'));
				break;

			// deletion
			case -1:
				if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
				if (deletedBlock.length === 0) deletedStart = deletedLine;
				deletedLine += lines.length - 1; // Update only the line count for old text
				deletedBlock.push(text);
				reprBlock.push(lines.map(line => `- ${line}`).join('\n'));
				break;

			// no change
			case 0:
				// If we have a pending block, add it to the blocks array
				if (insertedBlock.length > 0 || deletedBlock.length > 0) {
					blocks.push({
						code: reprBlock.join(''),
						deletedCode: deletedBlock.join(''),
						insertedCode: insertedBlock.join(''),
						deletedRange: new vscode.Range(deletedStart, 0, deletedLine, Number.MAX_SAFE_INTEGER),
						insertedRange: new vscode.Range(insertedStart, 0, insertedLine, Number.MAX_SAFE_INTEGER),
					});
				}

				// Reset the block variables
				reprBlock = [];
				deletedBlock = [];
				insertedBlock = [];

				// Update line counts for unchanged text
				insertedLine += lines.length - 1;
				deletedLine += lines.length - 1;

				break;
		}
	});

	// Add any remaining blocks after the loop ends
	if (insertedBlock.length > 0 || deletedBlock.length > 0) {
		blocks.push({
			code: reprBlock.join(''),
			deletedCode: deletedBlock.join(''),
			insertedCode: insertedBlock.join(''),
			deletedRange: new vscode.Range(deletedStart, 0, deletedLine, Number.MAX_SAFE_INTEGER),
			insertedRange: new vscode.Range(insertedStart, 0, insertedLine, Number.MAX_SAFE_INTEGER),
		});
	}

	return blocks;
};



// export const findDiffs = (oldText: string, newText: string): DiffBlock[] => {

// 	const diffs = diffLines(oldText, newText);

// 	const blocks: DiffBlock[] = [];

// 	let reprBlock: string[] = [];
// 	let deletedBlock: string[] = [];
// 	let insertedBlock: string[] = [];

// 	let insertedEnd = 0;
// 	let deletedEnd = 0;
// 	let insertedStart = 0;
// 	let deletedStart = 0;

// 	diffs.forEach(part => {

// 		part.count = part.count ?? 0

// 		// if the part is an addition or deletion, add it to the current block
// 		if (part.added || part.removed) {
// 			if (reprBlock.length === 0) { reprBlock.push('@@@@'); }
// 			if (part.added) {
// 				if (insertedBlock.length === 0) insertedStart = insertedEnd;
// 				insertedEnd += part.count
// 				insertedBlock.push(part.value);
// 				reprBlock.push(part.value.split('\n').map(line => `+ ${line}`).join('\n'));
// 			}
// 			if (part.removed) {
// 				if (deletedBlock.length === 0) deletedStart = deletedEnd;
// 				deletedEnd += part.count
// 				deletedBlock.push(part.value);
// 				reprBlock.push(part.value.split('\n').map(line => `- ${line}`).join('\n'));
// 			}
// 		}

// 		// if the part is unchanged, finalize the block and add it to the array
// 		else {
// 			// if the block is not null, add it to the array
// 			if (insertedBlock.length > 0 || deletedBlock.length > 0) {
// 				blocks.push({
// 					code: reprBlock.join('\n'),
// 					deletedCode: deletedBlock.join(''),
// 					insertedCode: insertedBlock.join(''),
// 					deletedRange: new vscode.Range(deletedStart, 0, deletedEnd, Number.MAX_SAFE_INTEGER),
// 					insertedRange: new vscode.Range(insertedStart, 0, insertedEnd, Number.MAX_SAFE_INTEGER),
// 				});
// 			}

// 			// update block variables
// 			reprBlock = [];
// 			deletedBlock = [];
// 			insertedBlock = [];
// 			insertedEnd += part.count;
// 			deletedEnd += part.count;

// 		}

// 	})

// 	// finally, add the last block to the array
// 	if (insertedBlock.length > 0 || deletedBlock.length > 0) {
// 		blocks.push({
// 			code: reprBlock.join('\n'),
// 			deletedCode: deletedBlock.join(''),
// 			insertedCode: insertedBlock.join(''),
// 			deletedRange: new vscode.Range(deletedStart, 0, deletedEnd, Number.MAX_SAFE_INTEGER),
// 			insertedRange: new vscode.Range(insertedStart, 0, insertedEnd, Number.MAX_SAFE_INTEGER),
// 		});
// 	}

// 	return blocks;

// }











// import { diffLines, Change } from 'diff';

// export type SuggestedEdit = {
// 	// start/end of current file
// 	startLine: number;
// 	endLine: number;

// 	// start/end of original file
// 	originalStartLine: number,
// 	originalEndLine: number,

// 	// original content (originalfile[originalStart...originalEnd])
// 	originalContent: string;
// 	newContent: string;
// }

// export function getDiffedLines(oldStr: string, newStr: string) {
// 	// an ordered list of every original line, line added to the new file, and line removed from the old file (order is unambiguous, think about it)
// 	const lineByLineChanges: Change[] = diffLines(oldStr, newStr);
// 	console.debug('Line by line changes', lineByLineChanges)

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
// 			// if we were on a streak, add it
// 			if (streakStartInNewFile !== undefined) {

// 				const startLine = streakStartInNewFile
// 				const endLine = newFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
// 				const newContent = newStrLines.slice(startLine, endLine + 1).join('\n')

// 				const originalStartLine = streakStartInOldFile!
// 				const originalEndLine = oldFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
// 				const originalContent = oldStrLines.slice(originalStartLine, originalEndLine + 1).join('\n')

// 				const replacement: SuggestedEdit = { startLine, endLine, newContent, originalStartLine, originalEndLine, originalContent }

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