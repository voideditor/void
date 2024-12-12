/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

export const parseMaxTokensStr = (maxTokensStr: string) => {
	// parse the string but only if the full string is a valid number, eg parseInt('100abc') should return NaN
	const int = isNaN(Number(maxTokensStr)) ? undefined : parseInt(maxTokensStr)
	if (Number.isNaN(int))
		return undefined
	return int
}


