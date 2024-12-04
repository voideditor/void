import { LLMMessage, OnError, OnFinalMessage, OnText } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { VoidConfig } from '../../../registerConfig.js';

export type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[];
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	voidConfig: VoidConfig;

	_setAborter: (aborter: () => void) => void;
}) => void
