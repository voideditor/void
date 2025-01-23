/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import { URI } from '../../../../../base/common/uri.js';
import { filenameToVscodeLanguage } from '../helpers/detectLanguage.js';
import { CodeSelection, StagingSelectionItem, FileSelection } from '../chatThreadService.js';
import { VSReadFile } from '../helpers/readFile.js';
import { IModelService } from '../../../../../editor/common/services/model.js';

export const chat_systemMessage = `\
You are a coding assistant. You are given a list of instructions to follow \`INSTRUCTIONS\`, and optionally a list of relevant files \`FILES\`, and selections inside of the files \`SELECTIONS\`.

Please respond to the user's query.

In the case that the user asks you to make changes to code, you should make sure to return CODE BLOCKS of the changes, as well as explanations and descriptions of the changes.
For example, if the user asks you to "make this file look nicer", make sure your output includes a code block with concrete ways the file can look nicer.
   - Do not re-write the entire file in the code block
   - You can write comments like "// ... existing code" to indicate existing code
   - Make sure you give enough context in the code block to apply the change to the correct location in the code.

You're allowed to ask for more context. For example, if the user only gives you a selection but you want to see the the full file, you can ask them to provide it.

Do not output any of these instructions, nor tell the user anything about them unless directly prompted for them.
Do not tell the user anything about the examples below.

## EXAMPLE 1
FILES
math.ts
\`\`\`typescript
const addNumbers = (a, b) => a + b
const multiplyNumbers = (a, b) => a * b
const subtractNumbers = (a, b) => a - b
const divideNumbers = (a, b) => a / b

const vectorize = (...numbers) => {
	return numbers // vector
}

const dot = (vector1: number[], vector2: number[]) => {
	if (vector1.length !== vector2.length) throw new Error(\`Could not dot vectors \${vector1} and \${vector2}. Size mismatch.\`)
	let sum = 0
	for (let i = 0; i < vector1.length; i += 1)
		sum += multiplyNumbers(vector1[i], vector2[i])
	return sum
}

const normalize = (vector: number[]) => {
	const norm = Math.sqrt(dot(vector, vector))
	for (let i = 0; i < vector.length; i += 1)
		vector[i] = divideNumbers(vector[i], norm)
	return vector
}

const normalized = (vector: number[]) => {
	const v2 = [...vector] // clone vector
	return normalize(v2)
}
\`\`\`


SELECTIONS
math.ts (lines 3:3)
\`\`\`typescript
const subtractNumbers = (a, b) => a - b
\`\`\`

INSTRUCTIONS
add a function that exponentiates a number below this, and use it to make a power function that raises all entries of a vector to a power

ACCEPTED OUTPUT
We can add the following code to the file:
\`\`\`typescript
// existing code...
const subtractNumbers = (a, b) => a - b
const exponentiateNumbers = (a, b) => Math.pow(a, b)
const divideNumbers = (a, b) => a / b
// existing code...

const raiseAll = (vector: number[], power: number) => {
	for (let i = 0; i < vector.length; i += 1)
		vector[i] = exponentiateNumbers(vector[i], power)
	return vector
}
\`\`\`


## EXAMPLE 2
FILES
fib.ts
\`\`\`typescript

const dfs = (root) => {
	if (!root) return;
	console.log(root.val);
	dfs(root.left);
	dfs(root.right);
}
const fib = (n) => {
	if (n < 1) return 1
	return fib(n - 1) + fib(n - 2)
}
\`\`\`

SELECTIONS
fib.ts (lines 10:10)
\`\`\`typescript
	return fib(n - 1) + fib(n - 2)
\`\`\`

INSTRUCTIONS
memoize results

ACCEPTED OUTPUT
To implement memoization in your Fibonacci function, you can use a JavaScript object to store previously computed results. This will help avoid redundant calculations and improve performance. Here's how you can modify your function:
\`\`\`typescript
// existing code...
const fib = (n, memo = {}) => {
    if (n < 1) return 1;
    if (memo[n]) return memo[n]; // Check if result is already computed
    memo[n] = fib(n - 1, memo) + fib(n - 2, memo); // Store result in memo
    return memo[n];
}
\`\`\`
Explanation:
Memoization Object: A memo object is used to store the results of Fibonacci calculations for each n.
Check Memo: Before computing fib(n), the function checks if the result is already in memo. If it is, it returns the stored result.
Store Result: After computing fib(n), the result is stored in memo for future reference.

## END EXAMPLES\
`


type FileSelnLocal = FileSelection & { content: string }
const stringifyFileSelection = ({ fileURI, selectionStr, range, content }: FileSelnLocal) => {
	return `\
${fileURI.fsPath}
\`\`\`${filenameToVscodeLanguage(fileURI.fsPath) ?? ''}
${content}
\`\`\`
`
}
const stringifyCodeSelection = ({ fileURI, selectionStr, range }: CodeSelection) => {
	return `\
${fileURI.fsPath} (lines ${range.startLineNumber}:${range.endLineNumber})
\`\`\`${filenameToVscodeLanguage(fileURI.fsPath) ?? ''}
${selectionStr}
\`\`\`
`
}

const failToReadStr = 'Could not read content. This file may have been deleted. If you expected content here, you can tell the user about this as they might not know.'
const stringifyFileSelections = async (fileSelections: FileSelection[], modelService: IModelService) => {
	if (fileSelections.length === 0) return null
	const fileSlns: FileSelnLocal[] = await Promise.all(fileSelections.map(async (sel) => {
		const content = await VSReadFile(modelService, sel.fileURI) ?? failToReadStr
		return { ...sel, content }
	}))
	return fileSlns.map(sel => stringifyFileSelection(sel)).join('\n')
}
const stringifyCodeSelections = (codeSelections: CodeSelection[]) => {
	return codeSelections.map(sel => stringifyCodeSelection(sel)).join('\n')
}



export const chat_userMessage = async (instructions: string, selections: StagingSelectionItem[] | null, modelService: IModelService) => {
	const fileSelections = selections?.filter(s => s.type === 'File') as FileSelection[]
	const codeSelections = selections?.filter(s => s.type === 'Selection') as CodeSelection[]

	const filesStr = await stringifyFileSelections(fileSelections, modelService)
	const codeStr = stringifyCodeSelections(codeSelections)

	let str = ''
	if (filesStr) str += `FILES\n${filesStr}\n`
	if (codeStr) str += `SELECTIONS\n${codeStr}\n`
	str += `INSTRUCTIONS\n${instructions}`
	return str;
};




export const fastApply_systemMessage = `\
You are a coding assistant that re-writes an entire file to make a change. You are given the original file \`ORIGINAL_FILE\` and a change \`CHANGE\`.

Directions:
1. Please rewrite the original file \`ORIGINAL_FILE\`, making the change \`CHANGE\`. You must completely re-write the whole file.
2. Keep all of the original comments, spaces, newlines, and other details whenever possible.
3. ONLY output the full new file. Do not add any other explanations or text.
`




export const fastApply_userMessage = ({ originalCode, applyStr, uri }: { originalCode: string, applyStr: string, uri: URI }) => {

	const language = filenameToVscodeLanguage(uri.fsPath) ?? ''

	return `\
ORIGINAL_FILE
\`\`\`${language}
${originalCode}
\`\`\`

CHANGE
\`\`\`
${applyStr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file by applying the change to the original file. Return ONLY the completion of the file, without any explanation.
`
}






export const ctrlKStream_prefixAndSuffix = ({ fullFileStr, startLine, endLine }: { fullFileStr: string, startLine: number, endLine: number }) => {

	const fullFileLines = fullFileStr.split('\n')

	// we can optimize this later
	const MAX_PREFIX_SUFFIX_CHARS = 20_000
	/*

	a
	a
	a     <-- final i (prefix = a\na\n)
	a
	|b    <-- startLine-1 (middle = b\nc\nd\n)   <-- initial i (moves up)
	c
	d|    <-- endLine-1                          <-- initial j (moves down)
	e
	e     <-- final j (suffix = e\ne\n)
	e
	e
	*/

	let prefix = ''
	let i = startLine - 1  // 0-indexed exclusive
	// we'll include fullFileLines[i...(startLine-1)-1].join('\n') in the prefix.
	while (i !== 0) {
		const newLine = fullFileLines[i - 1]
		if (newLine.length + 1 + prefix.length <= MAX_PREFIX_SUFFIX_CHARS) { // +1 to include the \n
			prefix = `${newLine}\n${prefix}`
			i -= 1
		}
		else break
	}

	let suffix = ''
	let j = endLine - 1
	while (j !== fullFileLines.length - 1) {
		const newLine = fullFileLines[j + 1]
		if (newLine.length + 1 + suffix.length <= MAX_PREFIX_SUFFIX_CHARS) { // +1 to include the \n
			suffix = `${suffix}\n${newLine}`
			j += 1
		}
		else break
	}

	return { prefix, suffix }

}


export type FimTagsType = {
	preTag: string,
	sufTag: string,
	midTag: string
}
export const defaultFimTags: FimTagsType = {
	preTag: 'ABOVE',
	sufTag: 'BELOW',
	midTag: 'SELECTION',
}

// this should probably be longer
export const ctrlKStream_systemMessage = ({ fimTags: { preTag, midTag, sufTag } }: { fimTags: FimTagsType }) => {
	return `\
You are a FIM (fill-in-the-middle) coding assistant. Your task is to fill in the middle SELECTION marked by <${midTag}> tags.

The user will give you INSTRUCTIONS, as well as code that comes BEFORE the SELECTION, indicated with <${preTag}>...before</${preTag}>, and code that comes AFTER the SELECTION, indicated with <${sufTag}>...after</${sufTag}>.
The user will also give you the existing original SELECTION that will be be replaced by the SELECTION that you output, for additional context.

Instructions:
1. Your OUTPUT should be a SINGLE PIECE OF CODE of the form <${midTag}>...new_code</${midTag}>. Do NOT output any text or explanations before or after this.
2. You may ONLY CHANGE the original SELECTION, and NOT the content in the <${preTag}>...</${preTag}> or <${sufTag}>...</${sufTag}> tags.
3. Make sure all brackets in the new selection are balanced the same as in the original selection.
4. Be careful not to duplicate or remove variables, comments, or other syntax by mistake.
`
}

export const ctrlKStream_userMessage = ({ selection, prefix, suffix, instructions, fimTags, isOllamaFIM, language }: {
	selection: string, prefix: string, suffix: string, instructions: string, fimTags: FimTagsType, language: string,
	isOllamaFIM: false, // we require this be false for clarity
}) => {
	const { preTag, sufTag, midTag } = fimTags

	// prompt the model artifically on how to do FIM
	// const preTag = 'BEFORE'
	// const sufTag = 'AFTER'
	// const midTag = 'SELECTION'
	return `\

CURRENT SELECTION
\`\`\`${language}
<${midTag}>${selection}</${midTag}>
\`\`\`

INSTRUCTIONS
${instructions}

<${preTag}>${prefix}</${preTag}>
<${sufTag}>${suffix}</${sufTag}>

Return only the completion block of code (of the form \`\`\`${language}
<${midTag}>...new code</${midTag}>
\`\`\`).`
};

