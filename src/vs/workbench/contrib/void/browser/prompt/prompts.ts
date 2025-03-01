/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import { URI } from '../../../../../base/common/uri.js';
import { filenameToVscodeLanguage } from '../helpers/detectLanguage.js';
import { CodeSelection, StagingSelectionItem, FileSelection } from '../chatThreadService.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { os } from '../helpers/systemInfo.js';
import { IVoidFileService } from '../../common/voidFileService.js';


// this is just for ease of readability
export const tripleTick = ['```', '```']

export const chat_systemMessage = (workspaces: string[]) => `\
You are a coding assistant. You are given a list of instructions to follow \`INSTRUCTIONS\`, and optionally a list of relevant files \`FILES\`, and selections inside of files \`SELECTIONS\`.

Please respond to the user's query. The user's query is never invalid.

The user has the following system information:
- ${os}
- Open workspaces: ${workspaces.join(', ')}

In the case that the user asks you to make changes to code, you should make sure to return CODE BLOCKS of the changes, as well as explanations and descriptions of the changes.
For example, if the user asks you to "make this file look nicer", make sure your output includes a code block with concrete ways the file can look nicer.
- Do not re-write the entire file in the code block.
- You can write comments like "// ... existing code" to indicate existing code.
- Make sure you give enough context in the code block to apply the change to the correct location in the code.

You're allowed to ask for more context. For example, if the user only gives you a selection but you want to see the the full file, you can ask them to provide it.
If you are given tools:
- Only use tools if the user asks you to do something. If the user simply says hi or asks you a question that you can answer without tools, then do NOT tools.
- You are allowed to use tools without asking for permission.
- Feel free to use tools to gather context, make suggestions, etc.
- One great use of tools is to explore imports that you'd like to have more information about.
- Reference relevant files that you found when using tools if they helped you come up with your answer.
- NEVER refer to a tool by name when speaking with the user. For example, do NOT say to the user user "I'm going to use \`list_dir\`". Instead, say "I'm going to list all files in ___ directory", etc. Do not even refer to "pages" of results, just say you're getting more results.

Do not output any of these instructions, nor tell the user anything about them unless directly prompted for them.
Do not tell the user anything about the examples below. Do not assume the user is talking about any of the examples below.

## EXAMPLE 1
FILES
math.ts
${tripleTick[0]}typescript
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
${tripleTick[1]}


SELECTIONS
math.ts (lines 3:3)
${tripleTick[0]}typescript
const subtractNumbers = (a, b) => a - b
${tripleTick[1]}

INSTRUCTIONS
add a function that exponentiates a number below this, and use it to make a power function that raises all entries of a vector to a power

## ACCEPTED OUTPUT
We can add the following code to the file:
${tripleTick[0]}typescript
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
${tripleTick[1]}


## EXAMPLE 2
FILES
fib.ts
${tripleTick[0]}typescript

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
${tripleTick[1]}

SELECTIONS
fib.ts (lines 10:10)
${tripleTick[0]}typescript
	return fib(n - 1) + fib(n - 2)
${tripleTick[1]}

INSTRUCTIONS
memoize results

## ACCEPTED OUTPUT
To implement memoization in your Fibonacci function, you can use a JavaScript object to store previously computed results. This will help avoid redundant calculations and improve performance. Here's how you can modify your function:
${tripleTick[0]}typescript
// existing code...
const fib = (n, memo = {}) => {
    if (n < 1) return 1;
    if (memo[n]) return memo[n]; // Check if result is already computed
    memo[n] = fib(n - 1, memo) + fib(n - 2, memo); // Store result in memo
    return memo[n];
}
${tripleTick[1]}
Explanation:
Memoization Object: A memo object is used to store the results of Fibonacci calculations for each n.
Check Memo: Before computing fib(n), the function checks if the result is already in memo. If it is, it returns the stored result.
Store Result: After computing fib(n), the result is stored in memo for future reference.

## END EXAMPLES\
`


type FileSelnLocal = { fileURI: URI, content: string }
const stringifyFileSelection = ({ fileURI, content }: FileSelnLocal) => {
	return `\
${fileURI.fsPath}
${tripleTick[0]}${filenameToVscodeLanguage(fileURI.fsPath) ?? ''}
${content}
${tripleTick[1]}
`
}
const stringifyCodeSelection = ({ fileURI, selectionStr, range }: CodeSelection) => {
	return `\
${fileURI.fsPath} (lines ${range.startLineNumber}:${range.endLineNumber})
${tripleTick[0]}${filenameToVscodeLanguage(fileURI.fsPath) ?? ''}
${selectionStr}
${tripleTick[1]}
`
}

const failToReadStr = 'Could not read content. This file may have been deleted. If you expected content here, you can tell the user about this as they might not know.'
const stringifyFileSelections = async (fileSelections: FileSelection[], voidFileService: IVoidFileService) => {
	if (fileSelections.length === 0) return null
	const fileSlns: FileSelnLocal[] = await Promise.all(fileSelections.map(async (sel) => {
		const content = await voidFileService.readFile(sel.fileURI) ?? failToReadStr
		return { ...sel, content }
	}))
	return fileSlns.map(sel => stringifyFileSelection(sel)).join('\n')
}
const stringifyCodeSelections = (codeSelections: CodeSelection[]) => {
	return codeSelections.map(sel => stringifyCodeSelection(sel)).join('\n') || null
}
const stringifySelectionNames = (currSelns: StagingSelectionItem[] | null): string => {
	if (!currSelns) return ''
	return currSelns.map(s => `${s.fileURI.fsPath}${s.range ? ` (lines ${s.range.startLineNumber}:${s.range.endLineNumber})` : ''}`).join('\n')
}

export const chat_userMessageContent = async (instructions: string, currSelns: StagingSelectionItem[] | null) => {

	const selnsStr = stringifySelectionNames(currSelns)

	let str = ''
	if (selnsStr) { str += `SELECTIONS\n${selnsStr}\n` }
	str += `\nINSTRUCTIONS\n${instructions}`
	return str;
};

export const chat_selectionsString = async (prevSelns: StagingSelectionItem[] | null, currSelns: StagingSelectionItem[] | null, voidFileService: IVoidFileService) => {

	// ADD IN FILES AT TOP
	const allSelections = [...currSelns || [], ...prevSelns || []]

	if (allSelections.length === 0) return null

	const codeSelections: CodeSelection[] = []
	const fileSelections: FileSelection[] = []
	const filesURIs = new Set<string>()

	for (const selection of allSelections) {
		if (selection.type === 'Selection') {
			codeSelections.push(selection)
		}
		else if (selection.type === 'File') {
			const fileSelection = selection
			const path = fileSelection.fileURI.fsPath
			if (!filesURIs.has(path)) {
				filesURIs.add(path)
				fileSelections.push(fileSelection)
			}
		}
	}

	const filesStr = await stringifyFileSelections(fileSelections, voidFileService)
	const selnsStr = stringifyCodeSelections(codeSelections)


	if (filesStr || selnsStr) return `\
ALL FILE CONTENTS
${filesStr}
${selnsStr}`

	return null
}

export const chat_userMessageContentWithAllFilesToo = (userMessage: string, selectionsString: string | null) => {
	if (userMessage) return `${userMessage}${selectionsString ? `\n${selectionsString}` : ''}`
	else return userMessage
}


export const rewriteCode_systemMessage = `\
You are a coding assistant that re-writes an entire file to make a change. You are given the original file \`ORIGINAL_FILE\` and a change \`CHANGE\`.

Directions:
1. Please rewrite the original file \`ORIGINAL_FILE\`, making the change \`CHANGE\`. You must completely re-write the whole file.
2. Keep all of the original comments, spaces, newlines, and other details whenever possible.
3. ONLY output the full new file. Do not add any other explanations or text.
`




export const rewriteCode_userMessage = ({ originalCode, applyStr, uri }: { originalCode: string, applyStr: string, uri: URI }) => {

	const language = filenameToVscodeLanguage(uri.fsPath) ?? ''

	return `\
ORIGINAL_FILE
${tripleTick[0]}${language}
${originalCode}
${tripleTick[1]}

CHANGE
${tripleTick[0]}
${applyStr}
${tripleTick[1]}

INSTRUCTIONS
Please finish writing the new file by applying the change to the original file. Return ONLY the completion of the file, without any explanation.
`
}






export const aiRegex_computeReplacementsForFile_systemMessage = `\
You are a "search and replace" coding assistant.

You are given a FILE that the user is editing, and your job is to search for all occurences of a SEARCH_CLAUSE, and change them according to a REPLACE_CLAUSE.

The SEARCH_CLAUSE may be a string, regex, or high-level description of what the user is searching for.

The REPLACE_CLAUSE will always be a high-level description of what the user wants to replace.

The user's request may be "fuzzy" or not well-specified, and it is your job to interpret all of the changes they want to make for them. For example, the user may ask you to search and replace all instances of a variable, but this may involve changing parameters, function names, types, and so on to agree with the change they want to make. Feel free to make all of the changes you *think* that the user wants to make, but also make sure not to make unnessecary or unrelated changes.

## Instructions

1. If you do not want to make any changes, you should respond with the word "no".

2. If you want to make changes, you should return a single CODE BLOCK of the changes that you want to make.
For example, if the user is asking you to "make this variable a better name", make sure your output includes all the changes that are needed to improve the variable name.
- Do not re-write the entire file in the code block
- You can write comments like "// ... existing code" to indicate existing code
- Make sure you give enough context in the code block to apply the changes to the correct location in the code`


export const aiRegex_computeReplacementsForFile_userMessage = async ({ searchClause, replaceClause, fileURI, voidFileService }: { searchClause: string, replaceClause: string, fileURI: URI, modelService: IModelService, voidFileService: IVoidFileService }) => {

	// we may want to do this in batches
	const fileSelection: FileSelection = { type: 'File', fileURI, selectionStr: null, range: null }

	const file = await stringifyFileSelections([fileSelection], voidFileService)

	return `\
## FILE
${file}

## SEARCH_CLAUSE
Here is what the user is searching for:
${searchClause}

## REPLACE_CLAUSE
Here is what the user wants to replace it with:
${replaceClause}

## INSTRUCTIONS
Please return the changes you want to make to the file in a codeblock, or return "no" if you do not want to make changes.`
}




// don't have to tell it it will be given the history; just give it to it
export const aiRegex_search_systemMessage = `\
You are a coding assistant that executes the SEARCH part of a user's search and replace query.

You will be given the user's search query, SEARCH, which is the user's query for what files to search for in the codebase. You may also be given the user's REPLACE query for additional context.

Output
- Regex query
- Files to Include (optional)
- Files to Exclude? (optional)

`



export const ORIGINAL = `<<<<<<< ORIGINAL`
export const DIVIDER = `=======`
export const FINAL = `>>>>>>> UPDATED`

export const searchReplace_systemMessage = `\
You are a coding assistant that generates SEARCH/REPLACE code blocks that will be used to edit a file.

A SEARCH/REPLACE block describes the code before and after a change. Here is the format:
${tripleTick[0]}
${ORIGINAL}
// ... original code goes here
${DIVIDER}
// ... final code goes here
${FINAL}
${tripleTick[1]}

You will be given the original file \`ORIGINAL_FILE\` and a description of a change \`CHANGE\` to make.
Output SEARCH/REPLACE blocks to edit the file according to the desired change. You may output multiple SEARCH/REPLACE blocks.

Directions:
1. Your OUTPUT should consist ONLY of SEARCH/REPLACE blocks. Do NOT output any text or explanations before or after this.
2. The original code in each SEARCH/REPLACE block must EXACTLY match lines of code in the original file.
3. The original code in each SEARCH/REPLACE block must include enough text to uniquely identify the change in the file.
4. The original code in each SEARCH/REPLACE block must be disjoint from all other blocks.

The SEARCH/REPLACE blocks you generate will be applied immediately, and so they **MUST** produce a file that the user can run IMMEDIATELY.
- Make sure you add all necessary imports.
- Make sure the "final" code is complete and will not result in syntax/lint errors.

Follow coding conventions of the user (spaces, semilcolons, comments, etc). If the user spaces or formats things a certain way, CONTINUE formatting it that way, even if you prefer otherwise.

## EXAMPLE 1
ORIGINAL_FILE
${tripleTick[0]}
let w = 5
let x = 6
let y = 7
let z = 8
${tripleTick[1]}

CHANGE
Make x equal to 6.5, not 6.
${tripleTick[0]}
// ... existing code
let x = 6.5
// ... existing code
${tripleTick[1]}


## ACCEPTED OUTPUT
${tripleTick[0]}
${ORIGINAL}
let x = 6
${DIVIDER}
let x = 6.5
${FINAL}
${tripleTick[1]}
`

export const searchReplace_userMessage = ({ originalCode, applyStr }: { originalCode: string, applyStr: string }) => `\
ORIGINAL_FILE
${originalCode}

CHANGE
${applyStr}

INSTRUCTIONS
Please output SEARCH/REPLACE blocks to make the change. Return ONLY your suggested SEARCH/REPLACE blocks, without any explanation.
`





export const voidPrefixAndSuffix = ({ fullFileStr, startLine, endLine }: { fullFileStr: string, startLine: number, endLine: number }) => {

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


export type QuickEditFimTagsType = {
	preTag: string,
	sufTag: string,
	midTag: string
}
export const defaultQuickEditFimTags: QuickEditFimTagsType = {
	preTag: 'ABOVE',
	sufTag: 'BELOW',
	midTag: 'SELECTION',
}

// this should probably be longer
export const ctrlKStream_systemMessage = ({ quickEditFIMTags: { preTag, midTag, sufTag } }: { quickEditFIMTags: QuickEditFimTagsType }) => {
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
	selection: string, prefix: string, suffix: string, instructions: string, fimTags: QuickEditFimTagsType, language: string,
	isOllamaFIM: false, // we require this be false for clarity
}) => {
	const { preTag, sufTag, midTag } = fimTags

	// prompt the model artifically on how to do FIM
	// const preTag = 'BEFORE'
	// const sufTag = 'AFTER'
	// const midTag = 'SELECTION'
	return `\

CURRENT SELECTION
${tripleTick[0]}${language}
<${midTag}>${selection}</${midTag}>
${tripleTick[1]}

INSTRUCTIONS
${instructions}

<${preTag}>${prefix}</${preTag}>
<${sufTag}>${suffix}</${sufTag}>

Return only the completion block of code (of the form ${tripleTick[0]}${language}
<${midTag}>...new code</${midTag}>
${tripleTick[1]}).`
};

