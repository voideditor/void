import { VoidConfig } from '../../common/configTypes'
import { LLMMessage, OnText, OnFinalMessage, OnError } from '../../common/llmMessageTypes'

export const parseMaxTokensStr = (maxTokensStr: string) => {
	// parse the string but only if the full string is a valid number, eg parseInt('100abc') should return NaN
	const int = isNaN(Number(maxTokensStr)) ? undefined : parseInt(maxTokensStr)
	if (Number.isNaN(int))
		return undefined
	return int
}


export type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[];
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	voidConfig: VoidConfig;

	_setAborter: (aborter: () => void) => void;
}) => void
