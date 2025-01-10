/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/


// modelWasTrainedOnFIM should be false here
export const extractCodeFromFIM = ({ text, midTag, modelWasTrainedOnFIM }: { text: string, midTag: string, modelWasTrainedOnFIM: false }) => {

	/* desired matches
`
``
```
<
<P
<PR
<PRE
<PRE>
<PRE> a
<PRE> a </PRE>
<PRE> a </PRE><
<PRE> a </PRE><M
<PRE> a </PRE><MI
<PRE> a </PRE><MID
<PRE> a </PRE><MID>

<PRE> a <PRE/> ->
	*/


	/* ------------- summary of the regex -------------
		[optional ` | `` | ```]
		(match optional_language_name)
		[optional strings here]
		[required <MID> tag]
		(match the stuff between mid tags)
		[optional <MID/> tag]
		[optional ` | `` | ```]
	*/

	// const regex = /[\s\S]*?(?:`{1,3}\s*([a-zA-Z_]+[\w]*)?[\s\S]*?)?<MID>([\s\S]*?)(?:<\/MID>|`{1,3}|$)/;
	const regex = new RegExp(
		`[\\s\\S]*?(?:\`{1,3}\\s*([a-zA-Z_]+[\\w]*)?[\\s\\S]*?)?<${midTag}>([\\s\\S]*?)(?:</${midTag}>|\`{1,3}|$)`,
		''
	);
	const match = text.match(regex);
	if (match) {
		const [_, languageName, codeBetweenMidTags] = match;
		return [languageName, codeBetweenMidTags] as const

	} else {
		return [undefined, extractCodeFromRegular(text)] as const
	}

}



export const extractCodeFromRegular = (result: string) => {
	// Match either:
	// 1. ```language\n<code>```
	// 2. ```<code>```

	const match = result.match(/```(?:\w+\n)?([\s\S]*?)```|```([\s\S]*?)```/);

	if (!match) {
		return result;
	}

	// Return whichever group matched (non-empty)
	return match[1] ?? match[2] ?? result;
}
