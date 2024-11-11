export const parseMaxTokensStr = (maxTokensStr: string) => {
	let int = isNaN(Number(maxTokensStr)) ? undefined : parseInt(maxTokensStr)
	if (Number.isNaN(int))
		return undefined
	return int
}
