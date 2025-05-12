import { ThemeIcon } from '../../../../base/common/themables.js'
import { localize2 } from '../../../../nls.js'
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js'
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js'
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js'
import { ISCMService } from '../../scm/common/scm.js'
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js'
import { IVoidSCM } from '../common/voidSCM.js'
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js'
import { IVoidSettingsService } from '../common/voidSettingsService.js'
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js'
import { ILLMMessageService } from '../common/sendLLMMessageService.js'
import { ModelSelection, OverridesOfModel, ModelSelectionOptions } from '../common/voidSettingsTypes.js'
import { commitMessage_systemMessage } from '../common/prompt/prompts.js'
import { LLMChatMessage } from '../common/sendLLMMessageTypes.js'
import { ISCMRepository } from '../../../../workbench/contrib/scm/common/scm.js'

interface ModelOptions {
	modelSelection: ModelSelection | null
	modelSelectionOptions?: ModelSelectionOptions
	overridesOfModel: OverridesOfModel
}

const scm = 'SCM'

const prepareModelOptions = (settingsService: IVoidSettingsService): ModelOptions => {
	const modelSelection = settingsService.state.modelSelectionOfFeature[scm]
	const modelSelectionOptions = modelSelection ? settingsService.state.optionsOfModelSelection[scm][modelSelection?.providerName]?.[modelSelection.modelName] : undefined
	const overridesOfModel = settingsService.state.overridesOfModel
	return {
		modelSelection,
		modelSelectionOptions,
		overridesOfModel
	}
}

const preparePrompt = (stat: string, sampledDiffs: string) => {
	const section1 = `Section 1 - Summary of Changes (git diff --stat):`
	const section2 = `Section 2 - Sampled File Diffs (Top changed files):`
	return `
Based on the following Git changes, write a clear, concise commit message that accurately summarizes the intent of the code changes.

${section1}

${stat}

${section2}

${sampledDiffs}
`.trim()
}

const prepareMessages = (prompt: string, modelOptions: ModelOptions, convertToLLMMessageService: IConvertToLLMMessageService) => {
	const simpleMessages = [{ role: 'user' as 'user', content: prompt }]
	const { messages, separateSystemMessage } = convertToLLMMessageService.prepareLLMSimpleMessages({
		simpleMessages,
		systemMessage: commitMessage_systemMessage,
		modelSelection: modelOptions.modelSelection,
		featureName: scm,
	})
	return {
		messages,
		separateSystemMessage
	}
}

const onFinalMessage = (repo: ISCMRepository) => (params: { fullText: string }) => {
	const match = params.fullText.match(/<output>([\s\S]*?)<\/output>/i)
	const commitMessage = match ? match[1].trim() : ''
	repo.input.setValue(commitMessage, false)
}

const sendLLMMessage = (messages: LLMChatMessage[], separateSystemMessage: string, modelOptions: ModelOptions, repo: ISCMRepository, llmMessageService: ILLMMessageService) => {
	//TODO VoidSCM - Experiment with LLM messages to get better results. The results now seem decent. But it hasn't been tested much and could probably be improved.
	llmMessageService.sendLLMMessage({
		messagesType: 'chatMessages',
		messages,
		separateSystemMessage,
		chatMode: null,
		modelSelection: modelOptions.modelSelection,
		modelSelectionOptions: modelOptions.modelSelectionOptions,
		overridesOfModel: modelOptions.overridesOfModel,
		onText: () => { },
		onFinalMessage: onFinalMessage(repo),
		onError: (error: any) => { console.error(error) }, //TODO VoidSCM - handle errors
		onAbort: () => { console.log('abort') }, //TODO VoidSCM - handle abort
		logging: { loggingName: 'VoidSCM - Commit Message' },
	})
}


class CommitMessagePromptActionService extends Action2 {
	private static readonly VOID_COMMIT_MESSAGE_PROMPT_ID = 'void.commitMessagePrompt'

	constructor() {
		super({
			id: CommitMessagePromptActionService.VOID_COMMIT_MESSAGE_PROMPT_ID,
			title: localize2('voidCommitMessagePrompt', 'Void: Generate Commit Message'),
			icon: ThemeIcon.fromId('sparkle'),
			tooltip: localize2('voidCommitMessagePromptTooltip', 'Void: Generate Commit Message'),
			f1: true,
			menu: [{
				id: MenuId.SCMInputBox,
				when: ContextKeyExpr.equals('scmProvider', 'git'),
				group: 'inline'
			}]
		})
	}

	//TODO VoidSCM - handle loading state, errors, aborting, and debouncing (possibly not needed)
	async run(accessor: ServicesAccessor): Promise<void> {
		const scmService = accessor.get(ISCMService)
		const mainProcessService = accessor.get(IMainProcessService)
		const voidSettingsService = accessor.get(IVoidSettingsService)
		const convertToLLMMessageService = accessor.get(IConvertToLLMMessageService)
		const llmMessageService = accessor.get(ILLMMessageService)
		const voidSCM = ProxyChannel.toService<IVoidSCM>(mainProcessService.getChannel('void-channel-scm'))

		const repo = Array.from(scmService.repositories || []).find((r: any) => r.provider.contextValue === 'git')
		//TODO VoidSCM - use the notification service to show an error if repo or rootUri is not found
		if (!repo || !repo.provider.rootUri?.fsPath) { return }
		const path = repo.provider.rootUri.fsPath
		const [stat, sampledDiffs] = await Promise.all([voidSCM.gitStat(path), voidSCM.gitSampledDiffs(path)])
		const modelOptions = prepareModelOptions(voidSettingsService)
		const prompt = preparePrompt(stat, sampledDiffs)
		const { messages, separateSystemMessage } = prepareMessages(prompt, modelOptions, convertToLLMMessageService)
		sendLLMMessage(messages, separateSystemMessage!, modelOptions, repo, llmMessageService)
	}
}

registerAction2(CommitMessagePromptActionService)
