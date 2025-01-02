
export const extractCodeFromResult = (result: string) => {
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