import { IAcpService, IAcpStream, IAcpChatMessage, IAcpUserMessage, IAcpSendOptions } from '../../../../platform/acp/common/iAcpService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { AcpChannelClient, AcpChannelName, AcpHostCallbackRequest } from '../../../../platform/acp/common/acpIpc.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FeatureName } from '../../../../platform/void/common/voidSettingsTypes.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';

import { AcpHostCallbacksService } from './AcpHostCallbacksService.js';
import { AcpInternalExtMethodService } from './AcpInternalExtMethodService.js';

export class AcpService extends Disposable implements IAcpService {
	declare readonly _serviceBrand: undefined;

	private readonly client: IAcpService;

	// Remember ACP mode per thread to separate builtin vs external behaviors
	private readonly _modeByThreadId = new Map<string, IAcpSendOptions['mode']>();
	private readonly _acpThreadPrefix = generateUuid();
	private readonly _hostCallbacks: AcpHostCallbacksService;
	private readonly _internalExtMethods: AcpInternalExtMethodService;
	private readonly _acpThreadIdByUiThreadId = new Map<string, string>();
	private readonly _uiThreadIdByAcpThreadId = new Map<string, string>();

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		const channel = mainProcessService.getChannel(AcpChannelName);
		this.client = new AcpChannelClient(channel);

		this._hostCallbacks = new AcpHostCallbacksService(this.instantiationService, this.fileService, this.logService);
		this._internalExtMethods = new AcpInternalExtMethodService(this.instantiationService, this.logService);

		// host callbacks from main
		const onHostCallback = channel.listen<AcpHostCallbackRequest>('onHostCallback');
		const disposable = onHostCallback(async (req) => {
			// IMPORTANT: multi-window routing guard.
			// Do NOT respond if this window does not own the thread, otherwise it can race and return wrong workspace.
			if (!this._shouldHandleHostCallback(req)) {
				this.logService.debug?.('[ACP Browser] ignore hostCallback for foreign thread', {
					requestId: req.requestId,
					kind: req.kind,
					threadId: req.threadId
				});
				return;
			}

			try {
				const result = await this.handleHostCallback(req);
				await channel.call('hostCallbackResult', { requestId: req.requestId, result });
			} catch (e: any) {
				await channel.call('hostCallbackResult', { requestId: req.requestId, error: e?.message ?? String(e) });
			}
		});
		this._register(disposable);
	}

	isConnected(): boolean { return this.client.isConnected(); }

	connect(opts?: IAcpSendOptions): Promise<void> {
		this.logService.debug?.('[ACP Browser] AcpService.connect called with opts:', opts);
		return this.client.connect(opts);
	}

	disconnect(): Promise<void> { return this.client.disconnect(); }

	sendChatMessage(
		threadId: string,
		history: IAcpChatMessage[],
		message: IAcpUserMessage,
		opts?: IAcpSendOptions
	): Promise<IAcpStream> {
		// IMPORTANT:
		// UI threadId can be identical across windows (shared StorageScope.APPLICATION),
		// so we must use a per-window unique ACP threadId on the wire.
		const acpThreadId = this._toAcpThreadId(threadId);

		// remember mode for routing host callbacks (keyed by ACP threadId)
		const mode = opts?.mode || 'builtin';
		this._modeByThreadId.set(acpThreadId, mode);

		return this._sendChatMessageWithResolvedSystem(acpThreadId, history, message, opts);
	}

	private _toAcpThreadId(uiThreadId: string): string {
		const tid = String(uiThreadId ?? '').trim();
		if (!tid) return tid;

		const existing = this._acpThreadIdByUiThreadId.get(tid);
		if (existing) return existing;

		const acpTid = `${this._acpThreadPrefix}:${tid}`;
		this._acpThreadIdByUiThreadId.set(tid, acpTid);
		this._uiThreadIdByAcpThreadId.set(acpTid, tid);
		return acpTid;
	}

	private _toUiThreadId(acpThreadId: string | undefined): string | undefined {
		if (!acpThreadId) return undefined;
		return this._uiThreadIdByAcpThreadId.get(acpThreadId) ?? acpThreadId;
	}

	private _shouldHandleHostCallback(req: AcpHostCallbackRequest): boolean {
		const acpTid = req.threadId;

		// If no threadId, keep legacy behavior.
		if (!acpTid) return true;

		// Only the window that initiated this ACP threadId should answer.
		return this._modeByThreadId.has(acpTid);
	}

	private async _sendChatMessageWithResolvedSystem(
		threadId: string,
		history: IAcpChatMessage[],
		message: IAcpUserMessage,
		opts?: IAcpSendOptions
	): Promise<IAcpStream> {
		const feature = (opts?.featureName === 'Ctrl+K') ? 'Ctrl+K' : 'Chat';
		let system = (opts?.system ?? '').trim();
		if (!system) {
			system = (await this._computeDefaultAcpSystemPrompt(feature))?.trim() ?? '';
		}
		const nextOpts: IAcpSendOptions | undefined = system
			? { ...(opts ?? {}), system }
			: opts;
		return this.client.sendChatMessage(threadId, history, message, nextOpts);
	}

	private async _computeDefaultAcpSystemPrompt(_feature: FeatureName): Promise<string | null> {
		const vss = this.instantiationService.invokeFunction(a => a.get(IVoidSettingsService));
		const st = vss.state;

		const explicit = (st.globalSettings.acpSystemPrompt ?? '').trim();
		//It doesn't make any sense
		if (explicit) return explicit;

		// The ACP protocol does not support the transfer of system prompt for external agents
		return '';
	}

	private async handleHostCallback(req: AcpHostCallbackRequest): Promise<any> {
		const kind = req.kind;
		const params = req.params ?? {};

		// threadId on the wire is ACP-threadId (prefixed)
		const acpThreadId: string | undefined = req.threadId;
		// threadId for UI services must be original UI threadId
		const uiThreadId: string | undefined = this._toUiThreadId(acpThreadId);

		// extMethod is INTERNAL-only (builtin agent)
		if (kind === 'extMethod') {
			const mode = (acpThreadId ? this._modeByThreadId.get(acpThreadId) : undefined) || 'builtin';
			if (mode !== 'builtin') {
				throw new Error(`ACP extMethod is only supported in builtin mode. Current mode: ${mode}`);
			}
			return this._internalExtMethods.handle(params);
		}

		// all other host callbacks are common (permission/fs/terminal)
		// IMPORTANT: pass uiThreadId so tool permission/results route to the correct chat thread in this window.
		return this._hostCallbacks.handle(kind, params, uiThreadId);
	}
}

registerSingleton(IAcpService, AcpService, InstantiationType.Delayed);
