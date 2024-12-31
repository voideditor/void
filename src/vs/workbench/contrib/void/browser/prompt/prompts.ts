/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/


import { CodeSelection } from '../threadHistoryService.js';

export const chat_systemMessage = `\
You are a coding assistant. You are given a list of relevant files \`files\`, a selection that the user is making \`selection\`, and instructions to follow \`instructions\`.

Please edit the selected file following the user's instructions (or, if appropriate, answer their question instead).

Instructions:
1. Output the changes to make to the entire file.
1. Do not re-write the entire file.
3. Instead, you may use code elision to represent unchanged portions of code. For example, write "existing code..." in code comments.
4. You must give enough context to apply the change in the correct location.

## EXAMPLE

FILES
selected file \`math.ts\`:
\`\`\`
const addNumbers = (a, b) => a + b
const subtractNumbers = (a, b) => a - b
const divideNumbers = (a, b) => a / b
\`\`\`

SELECTION
\`\`\`
const subtractNumbers = (a, b) => a - b
\`\`\`

INSTRUCTIONS
\`\`\`
add a function that multiplies numbers below this
\`\`\`

EXPECTED OUTPUT
We can add the following code to the file:
\`\`\`
// existing code...
const subtractNumbers = (a, b) => a - b;
const multiplyNumbers = (a, b) => a * b;
// existing code...
\`\`\`

## EXAMPLE

FILES
selected file \`fib.ts\`:
\`\`\`

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

SELECTION
\`\`\`
	return fib(n - 1) + fib(n - 2)
\`\`\`

INSTRUCTIONS
\`\`\`
memoize results
\`\`\`

EXPECTED OUTPUT
To implement memoization in your Fibonacci function, you can use a JavaScript object to store previously computed results. This will help avoid redundant calculations and improve performance. Here's how you can modify your function:
\`\`\`
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



const stringifySelections = (selections: CodeSelection[]) => {
	return selections.map(({ fileURI, content, selectionStr }) =>
		`\
File: ${fileURI.fsPath}
\`\`\`
${content // this was the enite file which is foolish
		}
\`\`\`${selectionStr === null ? '' : `
Selection: ${selectionStr}`}
`).join('\n')
}


export const chat_prompt = (instructions: string, selections: CodeSelection[] | null) => {
	let str = '';
	if (selections && selections.length > 0) {
		str += stringifySelections(selections);
		str += `Please edit the selected code following these instructions:\n`
	}
	str += `${instructions}`;
	return str;
};




export const ctrlLStream_systemMessage = `
You are a coding assistant that applies a diff to a file. You are given the original file \`original_file\`, a diff \`diff\`, and a new file that you are applying the diff to \`new_file\`.

Please finish writing the new file \`new_file\`, according to the diff \`diff\`. You must completely re-write the whole file, using the diff.

Directions:
1. Continue exactly where the new file \`new_file\` left off.
2. Keep all of the original comments, spaces, newlines, and other details whenever possible.
3. Note that \`+\` lines represent additions, \`-\` lines represent removals, and space lines \` \` represent no change.

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

COMPLETION
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

export default Sidebar;\`\`\`
`




export const ctrlLStream_prompt = ({ originalCode, userMessage }: { originalCode: string, userMessage: string }) => {
	return `\
ORIGINAL_CODE
\`\`\`
${originalCode}
\`\`\`

DIFF
\`\`\`
${userMessage}
\`\`\`

INSTRUCTIONS
Please finish writing the new file by applying the diff to the original file. Return ONLY the completion of the file, without any explanation.
`
}



export const ctrlKStream_systemMessage = `\
`


export const ctrlKStream_prefixAndSuffix = ({ fullFileStr, startLine, endLine }: { fullFileStr: string, startLine: number, endLine: number }) => {

	const fullFileLines = fullFileStr.split('\n')

	// we can optimize this later
	const MAX_CHARS = 1024
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
		if (newLine.length + 1 + prefix.length <= MAX_CHARS) { // +1 to include the \n
			prefix = `${newLine}\n${prefix}`
			i -= 1
		}
		else break
	}

	let suffix = ''
	let j = endLine - 1
	while (j !== fullFileLines.length - 1) {
		const newLine = fullFileLines[j + 1]
		if (newLine.length + 1 + suffix.length <= MAX_CHARS) { // +1 to include the \n
			suffix = `${suffix}\n${newLine}`
			j += 1
		}
		else break
	}

	return { prefix, suffix }

}

export const ctrlKStream_prompt = ({ selection, prefix, suffix, userMessage }: { selection: string, prefix: string, suffix: string, userMessage: string, }) => {
	const onlySpeaksFIM = false

	if (onlySpeaksFIM) {
		const preTag = 'PRE'
		const sufTag = 'SUF'
		const midTag = 'MID'
		return `\
<${preTag}>
/* Original Selection:
${selection}*/
/* Instructions: ${userMessage}*/
${prefix}</${preTag}>
<${sufTag}>${suffix}</${sufTag}>
<${midTag}>`
	}
	// prompt the model on how to do FIM
	else {
		const preTag = 'PRE'
		const sufTag = 'SUF'
		const midTag = 'MID'
		return `\
Here is the user's original selection:
\`\`\`
<${midTag}>${selection}</${midTag}>
\`\`\`

The user wants to apply the following instructions to the selection:
${userMessage}

Please rewrite the selection following the user's instructions.

Instructions to follow:
1. Follow the user's instructions
2. You may ONLY CHANGE the selection, and nothing else in the file
3. Make sure all brackets in the new selection are balanced the same was as in the original selection
3. Be careful not to duplicate or remove variables, comments, or other syntax by mistake

Complete the following:
<${preTag}>${prefix}</${preTag}>
<${sufTag}>${suffix}</${sufTag}>
<${midTag}>`
	}
};



// export const searchDiffChunkInstructions = `
// You are a coding assistant that applies a diff to a file. You are given a diff \`diff\`, a list of files \`files\` to apply the diff to, and a selection \`selection\` that you are currently considering in the file.

// Determine whether you should modify ANY PART of the selection \`selection\` following the \`diff\`. Return \`true\` if you should modify any part of the selection, and \`false\` if you should not modify any part of it.

// # Example 1:

// FILES
// selected file \`Sidebar.tsx\`:
// \`\`\`
// import React from 'react';
// import styles from './Sidebar.module.css';

// interface SidebarProps {
//   items: { label: string; href: string }[];
//   onItemSelect?: (label: string) => void;
//   onExtraButtonClick?: () => void;
// }

// const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
//   return (
//     <div className={styles.sidebar}>
//       <ul>
//         {items.map((item, index) => (
//           <li key={index}>
//             <button
//               className={styles.sidebarButton}
//               onClick={() => onItemSelect?.(item.label)}
//             >
//               {item.label}
//             </button>
//           </li>
//         ))}
//       </ul>
//       <button className={styles.extraButton} onClick={onExtraButtonClick}>
//         Extra Action
//       </button>
//     </div>
//   );
// };

// export default Sidebar;
// \`\`\`

// DIFF
// \`\`\`
// @@ ... @@
// -<div className={styles.sidebar}>
// -<ul>
// -  {items.map((item, index) => (
// -	<li key={index}>
// -	  <button
// -		className={styles.sidebarButton}
// -		onClick={() => onItemSelect?.(item.label)}
// -	  >
// -		{item.label}
// -	  </button>
// -	</li>
// -  ))}
// -</ul>
// -<button className={styles.extraButton} onClick={onExtraButtonClick}>
// -  Extra Action
// -</button>
// -</div>
// +<div className={styles.sidebar}>
// +<ul>
// +  {items.map((item, index) => (
// +	<li key={index}>
// +	  <div
// +		className={styles.sidebarButton}
// +		onClick={() => onItemSelect?.(item.label)}
// +	  >
// +		{item.label}
// +	  </div>
// +	</li>
// +  ))}
// +</ul>
// +<div className={styles.extraButton} onClick={onExtraButtonClick}>
// +  Extra Action
// +</div>
// +</div>
// \`\`\`

// SELECTION
// \`\`\`
// import React from 'react';
// import styles from './Sidebar.module.css';

// interface SidebarProps {
//   items: { label: string; href: string }[];
//   onItemSelect?: (label: string) => void;
//   onExtraButtonClick?: () => void;
// }

// const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
//   return (
//     <div className={styles.sidebar}>
//       <ul>
//         {items.map((item, index) => (
// \`\`\`

// RESULT
// The output should be \`true\` because the diff begins on the line with \`<div className={styles.sidebar}>\` and this line is present in the selection.

// OUTPUT
// \`true\`
// `



// export const generateDiffInstructions = `
// You are a coding assistant. You are given a list of relevant files \`files\`, a selection that the user is making \`selection\`, and instructions to follow \`instructions\`.

// Please edit the selected file following the user's instructions (or, if appropriate, answer their question instead).

// All changes made to files must be outputted in unified diff format.
// Unified diff format instructions:
// 1. Each diff must begin with \`\`\`@@ ... @@\`\`\`.
// 2. Each line must start with a \`+\` or \`-\` or \` \` symbol.
// 3. Make diffs more than a few lines.
// 4. Make high-level diffs rather than many one-line diffs.

// Here's an example of unified diff format:

// \`\`\`
// @@ ... @@
// -def factorial(n):
// -    if n == 0:
// -        return 1
// -    else:
// -        return n * factorial(n-1)
// +def factorial(number):
// +    if number == 0:
// +        return 1
// +    else:
// +        return number * factorial(number-1)
// \`\`\`

// Please create high-level diffs where you group edits together if they are near each other, like in the above example. Another way to represent the above example is to make many small line edits. However, this is less preferred, because the edits are not high-level. The edits are close together and should be grouped:

// \`\`\`
// @@ ... @@ # This is less preferred because edits are close together and should be grouped:
// -def factorial(n):
// +def factorial(number):
// -    if n == 0:
// +    if number == 0:
//          return 1
//      else:
// -        return n * factorial(n-1)
// +        return number * factorial(number-1)
// \`\`\`

// # Example 1:

// FILES
// selected file \`test.ts\`:
// \`\`\`
// x = 1

// {{selection}}

// z = 3
// \`\`\`

// SELECTION
// \`\`\`const y = 2\`\`\`

// INSTRUCTIONS
// \`\`\`y = 3\`\`\`

// EXPECTED RESULT

// We should change the selection from \`\`\`y = 2\`\`\` to \`\`\`y = 3\`\`\`.
// \`\`\`
// @@ ... @@
// -x = 1
// -
// -y = 2
// +x = 1
// +
// +y = 3
// \`\`\`

// # Example 2:

// FILES
// selected file \`Sidebar.tsx\`:
// \`\`\`
// import React from 'react';
// import styles from './Sidebar.module.css';

// interface SidebarProps {
//   items: { label: string; href: string }[];
//   onItemSelect?: (label: string) => void;
//   onExtraButtonClick?: () => void;
// }

// const Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {
//   return (
//     <div className={styles.sidebar}>
//       <ul>
//         {items.map((item, index) => (
//           <li key={index}>
//              {{selection}}
//               className={styles.sidebarButton}
//               onClick={() => onItemSelect?.(item.label)}
//             >
//               {item.label}
//             </button>
//           </li>
//         ))}
//       </ul>
//       <button className={styles.extraButton} onClick={onExtraButtonClick}>
//         Extra Action
//       </button>
//     </div>
//   );
// };

// export default Sidebar;
// \`\`\`

// SELECTION
// \`\`\`             <button\`\`\`

// INSTRUCTIONS
// \`\`\`make all the buttons like this into divs\`\`\`

// EXPECTED OUTPUT

// We should change all the buttons like the one selected into a div component. Here is the change:
// \`\`\`
// @@ ... @@
// -<div className={styles.sidebar}>
// -<ul>
// -  {items.map((item, index) => (
// -	<li key={index}>
// -	  <button
// -		className={styles.sidebarButton}
// -		onClick={() => onItemSelect?.(item.label)}
// -	  >
// -		{item.label}
// -	  </button>
// -	</li>
// -  ))}
// -</ul>
// -<button className={styles.extraButton} onClick={onExtraButtonClick}>
// -  Extra Action
// -</button>
// -</div>
// +<div className={styles.sidebar}>
// +<ul>
// +  {items.map((item, index) => (
// +	<li key={index}>
// +	  <div
// +		className={styles.sidebarButton}
// +		onClick={() => onItemSelect?.(item.label)}
// +	  >
// +		{item.label}
// +	  </div>
// +	</li>
// +  ))}
// +</ul>
// +<div className={styles.extraButton} onClick={onExtraButtonClick}>
// +  Extra Action
// +</div>
// +</div>
// \`\`\`
// `;
