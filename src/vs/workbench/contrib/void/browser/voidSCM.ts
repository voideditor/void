import { ThemeIcon } from '../../../../base/common/themables.js'
import { localize2 } from '../../../../nls.js'
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js'
import { ContextKeyExpr, IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js'
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
import { generateUuid } from '../../../../base/common/uuid.js'
import { ThrottledDelayer } from '../../../../base/common/async.js'
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js'
import { Disposable } from '../../../../base/common/lifecycle.js'
import { INotificationService } from '../../../../platform/notification/common/notification.js'

interface ModelOptions {
	modelSelection: ModelSelection | null
	modelSelectionOptions?: ModelSelectionOptions
	overridesOfModel: OverridesOfModel
}

export interface IGenerateCommitMessageService {
	readonly _serviceBrand: undefined;
	generateCommitMessage(): Promise<void>
	abort(): void
}

export const IGenerateCommitMessageService = createDecorator<IGenerateCommitMessageService>('voidGenerateCommitMessageService');

class GenerateCommitMessageService extends Disposable implements IGenerateCommitMessageService {
	readonly _serviceBrand: undefined;
	private readonly scm = 'SCM'
	private readonly execute = new ThrottledDelayer(300)
	private llmRequestId: string | null = null
	private currentRequestId: string | null = null
	private voidSCM: IVoidSCM
	private loadingContextKey: IContextKey<boolean>

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IConvertToLLMMessageService private readonly convertToLLMMessageService: IConvertToLLMMessageService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super()
		this.loadingContextKey = this.contextKeyService.createKey('voidSCMGenerateCommitMessageLoading', false)
		this.voidSCM = ProxyChannel.toService<IVoidSCM>(mainProcessService.getChannel('void-channel-scm'));
	}

	override dispose() {
		this.execute.dispose()
		super.dispose()
	}

	async generateCommitMessage() {
		this.setLoading(true)
		this.execute.trigger(async () => {
			const requestId = this.setRequestId()
			try {
				const { path, repo } = this.gitRepoInfo()
				const [stat, sampledDiffs] = await Promise.all([this.voidSCM.gitStat(path), this.voidSCM.gitSampledDiffs(path)])
				this.checkIsCurrentRequest(requestId)
				const modelOptions = this.prepareModelOptions()
				const prompt = this.preparePrompt(stat, sampledDiffs)
				const { messages, separateSystemMessage } = this.prepareMessages(prompt, modelOptions)
				const commitMessage = await this.sendLLMMessage(messages, separateSystemMessage!, modelOptions)
				this.checkIsCurrentRequest(requestId)
				this.setCommitMessage(repo, commitMessage)
			} catch (error) {
				this.onError(error)
			} finally {
				if (this.isCurrentRequest(requestId)) {
					this.setLoading(false)
				}
			}
		})
	}

	abort() {
		if (this.llmRequestId) {
			this.llmMessageService.abort(this.llmRequestId)
		}
		this.execute.cancel()
		this.setLoading(false)
		this.currentRequestId = null
	}

	private gitRepoInfo() {
		const repo = Array.from(this.scmService.repositories || []).find((r: any) => r.provider.contextValue === 'git')
		if (!repo) { throw new Error('No git repository found') }
		if (!repo.provider.rootUri?.fsPath) { throw new Error('No git repository root path found') }
		return { path: repo.provider.rootUri.fsPath, repo }
	}

	/** LLM Functions */

	private sendLLMMessage(messages: LLMChatMessage[], separateSystemMessage: string, modelOptions: ModelOptions): Promise<string> {
		//TODO VoidSCM - Experiment with LLM messages to get better results. The results now seem decent. But it hasn't been tested much and could probably be improved.
		return new Promise((resolve, reject) => {
			const onFinalMessage = (params: { fullText: string }) => {
				const match = params.fullText.match(/<output>([\s\S]*?)<\/output>/i)
				const commitMessage = match ? match[1].trim() : ''
				resolve(commitMessage)
			}

			const onError = (error: any) => {
				console.error(error)
				reject(error)
			}

			const onAbort = () => {
				reject(new CancellationError())
			}

			this.llmRequestId = this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				chatMode: null,
				modelSelection: modelOptions.modelSelection,
				modelSelectionOptions: modelOptions.modelSelectionOptions,
				overridesOfModel: modelOptions.overridesOfModel,
				onText: () => { },
				onFinalMessage: onFinalMessage,
				onError: onError,
				onAbort: onAbort,
				logging: { loggingName: 'VoidSCM - Commit Message' },
			})
		})
	}

	private prepareModelOptions(): ModelOptions {
		const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature[this.scm]
		const modelSelectionOptions = modelSelection ? this.voidSettingsService.state.optionsOfModelSelection[this.scm][modelSelection?.providerName]?.[modelSelection.modelName] : undefined
		const overridesOfModel = this.voidSettingsService.state.overridesOfModel
		return {
			modelSelection,
			modelSelectionOptions,
			overridesOfModel
		}
	}

	private preparePrompt(stat: string, sampledDiffs: string) {
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

	private prepareMessages(prompt: string, modelOptions: ModelOptions) {
		const simpleMessages = [{ role: 'user' as 'user', content: prompt }]
		const { messages, separateSystemMessage } = this.convertToLLMMessageService.prepareLLMSimpleMessages({
			simpleMessages,
			systemMessage: commitMessage_systemMessage,
			modelSelection: modelOptions.modelSelection,
			featureName: this.scm,
		})
		return {
			messages,
			separateSystemMessage
		}
	}

	/** Request Helpers */

	private setRequestId() {
		const requestId = generateUuid()
		this.currentRequestId = requestId
		return requestId
	}

	private isCurrentRequest(requestId: string) {
		return requestId === this.currentRequestId
	}

	private checkIsCurrentRequest(requestId: string) {
		if (!this.isCurrentRequest(requestId)) {
			throw new CancellationError()
		}
	}

	/** UI Functions */

	private setLoading(isLoading: boolean) {
		this.loadingContextKey.set(isLoading)
	}

	private setCommitMessage(repo: ISCMRepository, commitMessage: string) {
		repo.input.setValue(commitMessage, false)
	}

	private onError(error: any) {
		if (!isCancellationError(error)) {
			console.error(error)
			this.notificationService.error('Failed to generate commit message')
		}
	}
}

class GenerateCommitMessageAction extends Action2 {
	constructor() {
		super({
			id: 'void.generateCommitMessageAction',
			title: localize2('voidCommitMessagePrompt', 'Void: Generate Commit Message'),
			icon: ThemeIcon.fromId('sparkle'),
			tooltip: localize2('voidCommitMessagePromptTooltip', 'Void: Generate Commit Message'),
			f1: true,
			menu: [{
				id: MenuId.SCMInputBox,
				when: ContextKeyExpr.and(ContextKeyExpr.equals('scmProvider', 'git'), ContextKeyExpr.equals('voidSCMGenerateCommitMessageLoading', false)),
				group: 'inline'
			}]
		})
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const generateCommitMessageService = accessor.get(IGenerateCommitMessageService)
		generateCommitMessageService.generateCommitMessage()
	}
}

class LoadingGenerateCommitMessageAction extends Action2 {
	constructor() {
		super({
			id: 'void.loadingGenerateCommitMessageAction',
			title: localize2('voidCommitMessagePromptCancel', 'Cancel'),
			icon: ThemeIcon.fromId('stop-circle'),
			tooltip: localize2('voidCommitMessagePromptCancelTooltip', 'Cancel'),
			f1: true,
			menu: [{
				id: MenuId.SCMInputBox,
				when: ContextKeyExpr.and(ContextKeyExpr.equals('scmProvider', 'git'), ContextKeyExpr.equals('voidSCMGenerateCommitMessageLoading', true)),
				group: 'inline'
			}]
		})
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const generateCommitMessageService = accessor.get(IGenerateCommitMessageService)
		generateCommitMessageService.abort()
	}
}

registerSingleton(IGenerateCommitMessageService, GenerateCommitMessageService, InstantiationType.Delayed)
registerAction2(GenerateCommitMessageAction)
registerAction2(LoadingGenerateCommitMessageAction)
