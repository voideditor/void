/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/




export const extractArtificialFIMCodeFromResult = ({ text, preTag, sufTag, midTag }: { text: string, preTag: string, sufTag: string, midTag: string }) => {

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

	const regex = /[\s\S]*?(?:`{1,3}\s*([a-zA-Z_]+[\w]*)?[\s\S]*?)?<MID>([\s\S]*?)(?:<MID\/>|`{1,3}|$)/;

	const match = text.match(regex);
	if (match) {
		const [_, languageName, codeBetweenMidTags] = match;
		return [languageName, codeBetweenMidTags]

	} else {
		return [undefined, extractCodeFromResult(text)]
	}

}



export const extractCodeFromResult = (result: string) => {
	// Match either:
	// 1. ```language\n<code>```
	// 2. ```<code>```

	// 4 <PRE> A
	// 3. <PRE> A </PRE><MID> B </MID> -> B
	const match = result.match(/```(?:\w+\n)?([\s\S]*?)```|```([\s\S]*?)```/);

	if (!match) {
		return result;
	}

	// Return whichever group matched (non-empty)
	return match[1] ?? match[2] ?? result;
}
