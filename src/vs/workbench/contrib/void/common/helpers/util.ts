
export const separateOutFirstLine = (content: string): [string, string] | [string, undefined] => {
	const newLineIdx = content.indexOf('\r\n')
	if (newLineIdx !== -1) {
		const A = content.substring(0, newLineIdx)
		const B = content.substring(newLineIdx + 2, Infinity);
		return [A, B]
	}

	const newLineIdx2 = content.indexOf('\n')
	if (newLineIdx2 !== -1) {
		const A = content.substring(0, newLineIdx2)
		const B = content.substring(newLineIdx2 + 1, Infinity);
		return [A, B]
	}

	return [content, undefined]
}
