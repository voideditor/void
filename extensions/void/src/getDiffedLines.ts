import { diffLines, Change } from 'diff';

export type SuggestedDiff = {
	// start/end of current file
	startLine: number,
	endLine: number,

	// start/end of original file
	originalStartLine: number,
	originalEndLine: number,

	// original content (originalfile[originalStart...originalEnd])
	beforeCode: string;
	afterCode: string;
}

export function getDiffedLines(oldStr: string, newStr: string) {
	// an ordered list of every original line, line added to the new file, and line removed from the old file (order is unambiguous, think about it)

	// replace \r\n with \n
	oldStr = oldStr.replace(/\r\n/g, '\n')
	newStr = newStr.replace(/\r\n/g, '\n')

	const lineByLineChanges: Change[] = diffLines(oldStr, newStr);

	lineByLineChanges.push({ value: '' }) // add a dummy so we flush any streaks we haven't yet at the very end (!line.added && !line.removed)

	let oldFileLineNum: number = 0;
	let newFileLineNum: number = 0;

	let streakStartInNewFile: number | undefined = undefined
	let streakStartInOldFile: number | undefined = undefined

	let oldStrLines = oldStr.split('\n')
	let newStrLines = newStr.split('\n')

	const replacements: SuggestedDiff[] = []

	for (let line of lineByLineChanges) {
		// no change on this line
		if (!line.added && !line.removed) {
			// if we were on a streak, add it
			if (streakStartInNewFile !== undefined) {

				const startLine = streakStartInNewFile
				const endLine = newFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
				const newContent = newStrLines.slice(startLine, endLine + 1).join('\n')

				const originalStartLine = streakStartInOldFile!
				const originalEndLine = oldFileLineNum - 1 // don't include current line, the edit was up to this line but not including it
				const originalContent = oldStrLines.slice(originalStartLine, originalEndLine + 1).join('\n')

				const replacement: SuggestedDiff = { beforeCode: originalContent, afterCode: newContent, startLine, endLine, originalStartLine, originalEndLine, }

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

	return replacements

}
