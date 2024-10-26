
import * as vscode from 'vscode';
// import { diffLines, Change } from 'diff';
import { diff_match_patch } from 'diff-match-patch';
import { diffLines } from 'diff';
import { BaseDiff } from '../common/shared_types';



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
						code: reprBlock.join(''),
						deletedCode: deletedBlock.join(''),
						insertedCode: insertedBlock.join(''),
						deletedRange: new vscode.Range(deletedStart, 0, oldFileLine, Number.MAX_SAFE_INTEGER),
						insertedRange: new vscode.Range(insertedStart, 0, newFileLine, Number.MAX_SAFE_INTEGER),
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
			code: reprBlock.join(''),
			deletedCode: deletedBlock.join(''),
			insertedCode: insertedBlock.join(''),
			deletedRange: new vscode.Range(deletedStart, 0, oldFileLine, Number.MAX_SAFE_INTEGER),
			insertedRange: new vscode.Range(insertedStart, 0, newFileLine, Number.MAX_SAFE_INTEGER),
		});
	}

	return blocks;
};

