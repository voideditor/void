import * as vscode from 'vscode';
import { OnFinalMessage, OnText, sendLLMMessage, SetAbort } from "./sendLLMMessage"
import { VoidConfig } from '../sidebar/contextForConfig';

const generateDiffInstructions = `
You are a coding assistant. You are given a list of relevant files \`files\`, a selection that the user is making \`selection\`, and instructions to follow \`instructions\`.

Please edit the selected file following the user's instructions (or, if appropriate, answer their question instead).

All changes made to files must be outputted in unified diff format.
Unified diff format instructions:
1. Each diff must begin with \`\`\`@@ ... @@\`\`\`.
2. Each line must start with a \`+\` or \`-\` or \` \` symbol.
3. Make diffs more than a few lines.
4. Make high-level diffs rather than many one-line diffs.

Here's an example of unified diff format:

\`\`\`
@@ ... @@
-def factorial(n):
-    if n == 0:
-        return 1
-    else:
-        return n * factorial(n-1)
+def factorial(number):
+    if number == 0:
+        return 1
+    else:
+        return number * factorial(number-1)
\`\`\`

Please create high-level diffs where you group edits together if they are near each other, like in the above example. Another way to represent the above example is to make many small line edits. However, this is less preferred, because the edits are not high-level. The edits are close together and should be grouped:

\`\`\`
@@ ... @@ # This is less preferred because edits are close together and should be grouped:
-def factorial(n):
+def factorial(number):
-    if n == 0:
+    if number == 0:
         return 1
     else:
-        return n * factorial(n-1)
+        return number * factorial(number-1)
\`\`\`

# Example 1:

FILES
selected file \`test.ts\`:
\`\`\`
x = 1

{{selection}}

z = 3
\`\`\`

SELECTION
\`\`\`const y = 2\`\`\`

INSTRUCTIONS
\`\`\`y = 3\`\`\`

EXPECTED RESULT
Following the instructions, we should change the selection from \`\`\`y = 2\`\`\` to \`\`\`y = 3\`\`\`. Here is the expected output diff:
\`\`\`
@@ ... @@
-x = 1
-
-y = 2
+x = 1
+
+y = 3
\`\`\`

# Example 2:

FILES
selected file \`Sidebar.tsx\`:
\`\`\`
import React from 'react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  items: { label: string; href: string }[];
  onItemSelect?: (label: string) => void;
  onExtraButtonClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
  return (
    <div className={styles.sidebar}>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
             {{selection}}
              className={styles.sidebarButton}
              onClick={() => onItemSelect?.(item.label)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <button className={styles.extraButton} onClick={onExtraButtonClick}>
        Extra Action
      </button>
    </div>
  );
};

export default Sidebar;
\`\`\`

SELECTION
\`\`\`             <button\`\`\`

INSTRUCTIONS
\`\`\`make all the buttons like this into divs\`\`\`

EXPECTED OUTPUT

Following the instructions, we should change all the buttons like the one selected into a div component. Here is the result:
\`\`\`
@@ ... @@
-<div className={styles.sidebar}>
-<ul>
-  {items.map((item, index) => (
-	<li key={index}>
-	  <button
-		className={styles.sidebarButton}
-		onClick={() => onItemSelect?.(item.label)}
-	  >
-		{item.label}
-	  </button>
-	</li>
-  ))}
-</ul>
-<button className={styles.extraButton} onClick={onExtraButtonClick}>
-  Extra Action
-</button>
-</div>
+<div className={styles.sidebar}>
+<ul>
+  {items.map((item, index) => (
+	<li key={index}>
+	  <div
+		className={styles.sidebarButton}
+		onClick={() => onItemSelect?.(item.label)}
+	  >
+		{item.label}
+	  </div>
+	</li>
+  ))}
+</ul>
+<div className={styles.extraButton} onClick={onExtraButtonClick}>
+  Extra Action
+</div>
+</div>
\`\`\`
`;


const searchDiffChunkInstructions = `
You are a coding assistant that applies a diff to a file. You are given a diff \`diff\`, a list of files \`files\` to apply the diff to, and a selection \`selection\` that you are currently considering in the file.

Determine whether you should modify ANY PART of the selection \`selection\` following the \`diff\`. Return \`true\` if you should modify any part of the selection, and \`false\` if you should not modify any part of it.

# Example 1:

FILES
selected file \`Sidebar.tsx\`:
\`\`\`
import React from 'react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  items: { label: string; href: string }[];
  onItemSelect?: (label: string) => void;
  onExtraButtonClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
  return (
    <div className={styles.sidebar}>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <button
              className={styles.sidebarButton}
              onClick={() => onItemSelect?.(item.label)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <button className={styles.extraButton} onClick={onExtraButtonClick}>
        Extra Action
      </button>
    </div>
  );
};

export default Sidebar;
\`\`\`

DIFF
\`\`\`
@@ ... @@
-<div className={styles.sidebar}>
-<ul>
-  {items.map((item, index) => (
-	<li key={index}>
-	  <button
-		className={styles.sidebarButton}
-		onClick={() => onItemSelect?.(item.label)}
-	  >
-		{item.label}
-	  </button>
-	</li>
-  ))}
-</ul>
-<button className={styles.extraButton} onClick={onExtraButtonClick}>
-  Extra Action
-</button>
-</div>
+<div className={styles.sidebar}>
+<ul>
+  {items.map((item, index) => (
+	<li key={index}>
+	  <div
+		className={styles.sidebarButton}
+		onClick={() => onItemSelect?.(item.label)}
+	  >
+		{item.label}
+	  </div>
+	</li>
+  ))}
+</ul>
+<div className={styles.extraButton} onClick={onExtraButtonClick}>
+  Extra Action
+</div>
+</div>
\`\`\`

SELECTION
\`\`\`
import React from 'react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  items: { label: string; href: string }[];
  onItemSelect?: (label: string) => void;
  onExtraButtonClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
  return (
    <div className={styles.sidebar}>
      <ul>
        {items.map((item, index) => (
\`\`\`

EXPECTED RESULT
The expected output is \`true\`, because the diff begins on the line with \`<div className={styles.sidebar}>\` and this line is present in the selection.

\`true\`
`


const searchDiffLineInstructions = `
You are a coding assistant that applies a diff to a file. You are given a diff \`diff\`, a list of files \`files\` to apply the diff to, and a selection \`selection\` that you are currently considering in the file.

Determine whether you should modify ANY PART of the selection \`selection\` following the \`diff\`. Return \`true\` if you should modify any part of the selection, and \`false\` if you should not modify any part of it.

# Example 1:

FILES
selected file \`Sidebar.tsx\`:
\`\`\`
import React from 'react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  items: { label: string; href: string }[];
  onItemSelect?: (label: string) => void;
  onExtraButtonClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
  return (
    <div className={styles.sidebar}>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <button
              className={styles.sidebarButton}
              onClick={() => onItemSelect?.(item.label)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <button className={styles.extraButton} onClick={onExtraButtonClick}>
        Extra Action
      </button>
    </div>
  );
};

export default Sidebar;
\`\`\`

DIFF
\`\`\`
@@ ... @@
-<div className={styles.sidebar}>
-<ul>
-  {items.map((item, index) => (
-	<li key={index}>
-	  <button
-		className={styles.sidebarButton}
-		onClick={() => onItemSelect?.(item.label)}
-	  >
-		{item.label}
-	  </button>
-	</li>
-  ))}
-</ul>
-<button className={styles.extraButton} onClick={onExtraButtonClick}>
-  Extra Action
-</button>
-</div>
+<div className={styles.sidebar}>
+<ul>
+  {items.map((item, index) => (
+	<li key={index}>
+	  <div
+		className={styles.sidebarButton}
+		onClick={() => onItemSelect?.(item.label)}
+	  >
+		{item.label}
+	  </div>
+	</li>
+  ))}
+</ul>
+<div className={styles.extraButton} onClick={onExtraButtonClick}>
+  Extra Action
+</div>
+</div>
\`\`\`

SELECTION
\`\`\`
import React from 'react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  items: { label: string; href: string }[];
  onItemSelect?: (label: string) => void;
  onExtraButtonClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
  return (
    <div className={styles.sidebar}>
      <ul>
        {items.map((item, index) => (
\`\`\`

EXPECTED RESULT
The expected output is \`true\`, because the diff begins on the line with \`<div className={styles.sidebar}>\` and this line is present in the selection.

\`true\`
`



const rewriteFileWithDiffInstructions = `
You are a coding assistant that applies a diff to a file. You are given the original file \`original_file\`, a diff \`diff\`, and a new file that you are applying the diff to \`new_file\`.

Please finish writing the new file \`new_file\`, according to the diff \`diff\`.

Directions:
1. Continue exactly where the new file \`new_file\` left off.
2. Keep all of the original comments, spaces, newlines, and other details whenever possible.
3. Note that in the diff \`diff\`, \`+\` lines represent additions, \`-\` lines represent removals, and space lines \` \` represent no change.

# Example 1:

ORIGINAL_FILE
\`Sidebar.tsx\`:
\`\`\`
import React from 'react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  items: { label: string; href: string }[];
  onItemSelect?: (label: string) => void;
  onExtraButtonClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
  return (
    <div className={styles.sidebar}>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <button
              className={styles.sidebarButton}
              onClick={() => onItemSelect?.(item.label)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <button className={styles.extraButton} onClick={onExtraButtonClick}>
        Extra Action
      </button>
    </div>
  );
};

export default Sidebar;
\`\`\`

DIFF
\`\`\`
@@ ... @@
-<div className={styles.sidebar}>
-<ul>
-  {items.map((item, index) => (
-	<li key={index}>
-	  <button
-		className={styles.sidebarButton}
-		onClick={() => onItemSelect?.(item.label)}
-	  >
-		{item.label}
-	  </button>
-	</li>
-  ))}
-</ul>
-<button className={styles.extraButton} onClick={onExtraButtonClick}>
-  Extra Action
-</button>
-</div>
+<div className={styles.sidebar}>
+<ul>
+  {items.map((item, index) => (
+	<li key={index}>
+	  <div
+		className={styles.sidebarButton}
+		onClick={() => onItemSelect?.(item.label)}
+	  >
+		{item.label}
+	  </div>
+	</li>
+  ))}
+</ul>
+<div className={styles.extraButton} onClick={onExtraButtonClick}>
+  Extra Action
+</div>
+</div>
\`\`\`

NEW_FILE
\`\`\`
import React from 'react';
import styles from './Sidebar.module.css';

interface SidebarProps {
  items: { label: string; href: string }[];
  onItemSelect?: (label: string) => void;
  onExtraButtonClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
  return (
\`\`\`

EXPECTED RESULT
The expected output should complete the new file \`new_file\`, following the diff \`diff\`. Here is the expected output:
\`\`\`
    <div className={styles.sidebar}>
      <ul>
        {items.map((item, index) => (
          <li key={index}>
            <div
              className={styles.sidebarButton}
              onClick={() => onItemSelect?.(item.label)}
            >
              {item.label}
            </div>
          </li>
        ))}
      </ul>
      <div className={styles.extraButton} onClick={onExtraButtonClick}>
        Extra Action
      </div>
    </div>
  );
};

export default Sidebar;
\`\`\`
`


type Res<T> = ((value: T) => void)


const rewriteFileWithDiff = ({ fileUri, originalFileStr, newFileStr, diff, voidConfig, onText, setAbort }: { fileUri: vscode.Uri, originalFileStr: string, newFileStr: string, diff: string, voidConfig: VoidConfig, onText: OnText, setAbort: SetAbort }) => {

	const EXTRA_TOKENS = 20

	const promptContent = `ORIGINAL_FILE
\`\`\`
${originalFileStr}
\`\`\`

DIFF
\`\`\`
${diff}
\`\`\`

INSTRUCTIONS
Please finish writing the new file \`NEW_FILE\`. When

NEW_FILE
\`\`\`
${newFileStr}
\`\`\`
`
	// create a promise that can be awaited
	let res: Res<string> = () => { }
	const promise = new Promise<string>((resolve, reject) => { res = resolve })


	// make LLM rewrite file to include the diff
	sendLLMMessage({
		messages: [{ role: 'assistant', content: rewriteFileWithDiffInstructions, }, { role: 'assistant', content: promptContent, }],
		onText,
		onFinalMessage: (finalMessage) => { res(finalMessage) },
		onError: () => { res(''); console.error('Error rewriting file with diff') },
		voidConfig: {
			...voidConfig,
			default: {
				// set `max_tokens` = (number of expected tokens) + (number of extra tokens)
				maxTokens: Math.round((diff.split('\n').filter(l => !l.startsWith('-')).length) + EXTRA_TOKENS) + ''
			}
		},
		setAbort,
	})


	return promise

}

const shouldApplyDiffToLine = async ({ diff, fileStr, lineStr, voidConfig, setAbort }: { diff: string, fileStr: string, lineStr: string, voidConfig: VoidConfig, setAbort: SetAbort }) => {

	const promptContent = `DIFF
\`\`\`
${diff}
\`\`\`

FILES
\`\`\`
${fileStr}
\`\`\`

SELECTION
\`\`\`${lineStr}\`\`\`

Return \`true\` if this line should be modified, and \`false\` if it should not be modified.
`

	// create new promise
	let res: Res<boolean> = () => { }
	const promise = new Promise<boolean>((resolve, reject) => { res = resolve })

	sendLLMMessage({
		messages: [{ role: 'assistant', content: searchDiffLineInstructions, }, { role: 'assistant', content: promptContent, }],
		onText: () => { },
		onFinalMessage: (finalMessage) => {
			const containsTrue = finalMessage
				.slice(-10)
				.toLowerCase()
				.includes('true')
			res(containsTrue)
		},
		onError: () => {
			res(false);
			console.error('Error applying diff to line')
		},
		voidConfig,
		setAbort
	})

	return promise

}



// lazily applies the diff to the file
// we chunk the text in the file, and ask an LLM whether it should edit each chunk
const applyDiffLazily = async ({ fileUri, fileStr, diff, voidConfig, setAbort }: { fileUri: vscode.Uri, fileStr: string, diff: string, voidConfig: VoidConfig, setAbort: SetAbort }) => {

	const CHUNK_SIZE = 20 // number of lines to search at a time

	// read file content
	const fileLines = fileStr.split('\n')
	const completedLines = []

	// search the file chunk-by-chunk
	for (let chunkIdx = 0; chunkIdx * CHUNK_SIZE < fileLines.length; chunkIdx++) {

		// get the chunk
		const chunkStart = chunkIdx * CHUNK_SIZE
		const chunkEnd = (chunkIdx + 1) * CHUNK_SIZE
		const chunkLines = fileLines.slice(chunkStart, chunkEnd)
		const chunkStr = chunkLines.join('\n');

		// ask LLM if we should apply the diff to the chunk
		let shouldApplyDiff = await shouldApplyDiffToChunk({ chunkStr, diff, fileUri, setAbort })
		if (!shouldApplyDiff) { // should not change the chunk
			completedLines.push(chunkStr);
			// TODO update highlighting here
			continue;
		}

		// search the chunk line-by-line
		for (const lineStr of chunkLines) {

			// ask LLM if we should apply the diff to the line
			let shouldApplyDiff = await shouldApplyDiffToLine({ diff, fileStr, lineStr, voidConfig, setAbort })
			if (!shouldApplyDiff) { // should not change the line
				completedLines.push(lineStr);
				// TODO update highlighting here
				continue;
			}

			// ask LLM to apply the diff
			const changeStr = await rewriteFileWithDiff({ // rewrite file with diff (if there is significant matchup with the original file, we stop rewriting)
				originalFileStr: fileStr,
				newFileStr: completedLines.join('\n'),
				diff,
				fileUri,
				voidConfig,
				onText: async (text) => {
					// TODO! update highlighting here
					// also make edits here

				},
				setAbort,
			})
			completedLines.push(changeStr)


			// if there's matchup with the file, we stop rewriting
			// TODO! otherwise keep rewriting until there is matchup

		}

	}

}



export { applyDiffLazily }