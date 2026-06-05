import { CancellationToken } from '../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { removeMCPToolNamePrefix } from '../../void/common/mcpServiceTypes.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IPtyHostService } from '../../../../platform/terminal/common/terminal.js';

import { IToolsService } from '../../void/common/toolsService.js';
import { ILanguageModelToolsService, IToolData } from '../../chat/common/languageModelToolsService.js';

import { IDynamicProviderRegistryService } from '../../../../platform/void/common/providerReg.js';
import { getModelApiConfiguration, getModelCapabilities } from '../../../../platform/void/common/modelInference.js';

import {
	FeatureName,
	ModelSelection,
	ModelSelectionOptions,
	ProviderName,
	type ChatMode,
	type specialToolFormat
} from '../../../../platform/void/common/voidSettingsTypes.js';

import {
	ToolName,
	isAToolName,
	availableTools,
	chat_systemMessageForAcp,
} from '../../void/common/prompt/prompts.js';

import type {
	RawToolParamsObj,
	RequestParamsConfig,
	ProviderRouting,
	DynamicRequestConfig,
	AdditionalToolInfo
} from '../../../../platform/void/common/sendLLMMessageTypes.js';

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { timeout } from '../../../../base/common/async.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { ITerminalService, ITerminalInstance, ICreateTerminalOptions } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { MAX_TERMINAL_CHARS } from '../../../../platform/void/common/prompt/constants.js';
import { URI } from '../../../../base/common/uri.js';

const IMCPServiceId = createDecorator<any>('mcpConfigService');

type _TerminalRunState = {
	terminalId: string;
	terminal: ITerminalInstance;

	// tail buffer (fast for streaming)
	outputRaw: string;
	truncated: boolean;

	// full buffer (used once at the end)
	outputRawFull: string;
	fullTruncated: boolean;

	done: boolean;
	exitCode: number | null;

	resolveExit: (code: number) => void;
	exitPromise: Promise<{ exitCode: number }>;
	disposables: IDisposable[];
};

export class AcpInternalExtMethodService {
	constructor(
		private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService
	) { }


	private _getMcpService(): any | null {
		try { return this.instantiationService.invokeFunction(accessor => accessor.get(IMCPServiceId)); }
		catch { return null; }
	}

	private _mcpSafePrefixFromServerName(serverName: string): string {
		const s = String(serverName ?? '').trim();
		const safe = s.replace(/[^a-zA-Z0-9_]/g, '_');
		return safe || 'mcp';
	}

	private _mcpInputSchemaToAdditionalToolParams(inputSchema: any): Record<string, any> | undefined {
		const props = inputSchema?.properties;
		if (!props || typeof props !== 'object') return undefined;

		return Object.fromEntries(
			Object.entries(props).map(([key, schema]: [string, any]) => [
				key,
				{
					description: schema?.description || `Parameter: ${key}`,
					type: schema?.type,
					enum: schema?.enum,
					items: schema?.items,
					properties: schema?.properties,
					required: schema?.required,
					default: schema?.default,
					minimum: schema?.minimum,
					maximum: schema?.maximum,
					minLength: schema?.minLength,
					maxLength: schema?.maxLength,
				},
			])
		);
	}

	private _collectMcpJsonAdditionalTools(): AdditionalToolInfo[] {
		const mcp = this._getMcpService();
		if (!mcp) return [];

		const servers = (mcp.state?.mcpServerOfName ?? {}) as Record<string, any>;
		const out: AdditionalToolInfo[] = [];

		for (const [serverName, server] of Object.entries(servers)) {
			if (!server || server.status !== 'success') continue;

			const tools = Array.isArray(server.tools) ? server.tools : [];
			if (!tools.length) continue;

			const safePrefix = this._mcpSafePrefixFromServerName(serverName);

			for (const t of tools) {
				const fullName = String(t?.name ?? '').trim();
				if (!fullName) continue;

				const baseName = removeMCPToolNamePrefix(fullName) || fullName;

				out.push({
					
					name: `${safePrefix}__${baseName}`,
					description: String(t?.description ?? ''),
					params: this._mcpInputSchemaToAdditionalToolParams(t?.inputSchema),
				});
			}
		}

		return out;
	}

	private _resolveMcpJsonToolByAcpName(acpToolName: string): { serverName: string; toolNamePrefixed: string } | null {
		
		const idx = acpToolName.indexOf('__');
		if (idx <= 0) return null;

		const safePrefix = acpToolName.slice(0, idx).trim();
		const baseName = acpToolName.slice(idx + 2).trim();
		if (!safePrefix || !baseName) return null;

		const mcp = this._getMcpService();
		if (!mcp) return null;

		const servers = (mcp.state?.mcpServerOfName ?? {}) as Record<string, any>;

		
		let matchedServerName: string | null = null;
		for (const serverName of Object.keys(servers)) {
			if (this._mcpSafePrefixFromServerName(serverName).toLowerCase() === safePrefix.toLowerCase()) {
				matchedServerName = serverName;
				break;
			}
		}
		if (!matchedServerName) return null;

		const server = servers[matchedServerName];
		if (!server || server.status !== 'success') return null;

		const tools = Array.isArray(server.tools) ? server.tools : [];
		for (const t of tools) {
			const fullName = String(t?.name ?? '').trim();
			if (!fullName) continue;

			const bn = removeMCPToolNamePrefix(fullName) || fullName;
			if (bn === baseName) {
				
				
				return { serverName: matchedServerName, toolNamePrefixed: fullName };
			}
		}

		return null;
	}

	private _getToolsService(): IToolsService | null {
		try { return this.instantiationService.invokeFunction(accessor => accessor.get(IToolsService)); }
		catch { return null; }
	}

	private _getDisabledToolNamesSet(): Set<string> {
		try {
			const vss = this.instantiationService.invokeFunction(accessor => accessor.get(IVoidSettingsService));
			const arr = vss.state.globalSettings.disabledToolNames;
			if (!Array.isArray(arr)) return new Set();
			return new Set(arr.map(v => String(v ?? '').trim()).filter(Boolean));
		} catch {
			return new Set();
		}
	}

	private _disabledToolError(name: string): string {
		return `Tool "${name}" is disabled in Void settings.`;
	}

	private readonly _terminalRuns = new Map<string, _TerminalRunState>();

	private _getTerminalService(): ITerminalService | null {
		try { return this.instantiationService.invokeFunction(accessor => accessor.get(ITerminalService)); }
		catch { return null; }
	}

	private async _waitForCommandDetectionCapability(terminal: ITerminalInstance): Promise<any | undefined> {
		const existing = terminal.capabilities.get(TerminalCapability.CommandDetection);
		if (existing) return existing;

		const disposables: IDisposable[] = [];
		const waitTimeout = timeout(10_000);

		const waitForCapability = new Promise<any>((res) => {
			disposables.push(
				terminal.capabilities.onDidAddCapability((e: any) => {
					if (e?.id === TerminalCapability.CommandDetection) {
						res(e.capability);
					}
				})
			);
		});

		const cap = await Promise.any([waitTimeout, waitForCapability])
			.finally(() => { disposables.forEach(d => d.dispose()); });

		return cap ?? undefined;
	}

	private _quoteShellArg(s: string): string {
		// simple POSIX-safe single-quote escaping
		if (s === '') return '\'\'';
		if (/^[a-zA-Z0-9_\/\.\-=:]+$/.test(s)) return s;
		return `'${s.replace(/'/g, `'\\''`)}'`;
	}

	private async _handleTerminalExtMethod(method: string, p: any): Promise<any | undefined> {
		const rawMethod = String(method ?? '');
		const isTerminal = rawMethod.startsWith('terminal/') || rawMethod.startsWith('_terminal/');
		if (!isTerminal) return undefined;

		const m = rawMethod.startsWith('_') ? rawMethod.slice(1) : rawMethod;

		const safeJson = (v: any): string => {
			try {
				const seen = new WeakSet<object>();
				return JSON.stringify(v, (_k, val) => {
					if (val && typeof val === 'object') {
						if (seen.has(val)) return '[Circular]';
						seen.add(val);
					}
					if (typeof val === 'function') return '[Function]';
					return val;
				});
			} catch (e: any) {
				try { return JSON.stringify({ _stringifyError: String(e?.message ?? e) }); } catch { return '"[Unstringifiable]"'; }
			}
		};
		const dbg = (tag: string, obj: any) => this.logService.debug('[ACP debug terminal]', tag, safeJson(obj));

		const safeErrMsg = (e: any): string => {
			if (e instanceof Error) return e.message;
			if (typeof e?.message === 'string') return e.message;
			try { return JSON.stringify(e); } catch { return String(e); }
		};

		dbg('incoming', {
			method: rawMethod,
			normalized: m,
			paramsKeys: p && typeof p === 'object' ? Object.keys(p) : null,
		});

		const terminalService = this._getTerminalService();
		if (!terminalService) throw new Error(`terminal/*: ITerminalService not available`);

		try {
			try {
				const wc = (terminalService as any).whenConnected;
				if (wc && typeof wc.then === 'function') await wc;
			} catch { /* ignore */ }

			if (m === 'terminal/create') {
				const type = String(p?.type ?? 'ephemeral');
				if (type !== 'ephemeral') throw new Error(`terminal/create: only type="ephemeral" is supported`);

				const terminalId = String(p?.terminalId ?? '').trim();
				if (!terminalId) throw new Error('terminal/create: terminalId is required');

				const command = String(p?.command ?? '').trim();
				if (!command) throw new Error('terminal/create: command is required');

				const args: string[] = Array.isArray(p?.args)
					? (p.args as unknown[]).map((x: unknown): string => String(x ?? ''))
					: [];

				const cwdRaw = (p?.cwd === null || p?.cwd === undefined) ? null : String(p.cwd);
				const outputByteLimit =
					typeof p?.outputByteLimit === 'number' && Number.isFinite(p.outputByteLimit) && p.outputByteLimit > 0
						? Math.floor(p.outputByteLimit)
						: undefined;

				const commandLine = args.length
					? `${command} ${args.map((a: string) => this._quoteShellArg(a)).join(' ')}`
					: command;

				// release old
				const prev = this._terminalRuns.get(terminalId);
				if (prev) {
					try { prev.disposables.forEach(d => d.dispose()); } catch { }
					try { prev.terminal.dispose(); } catch { }
					this._terminalRuns.delete(terminalId);
				}

				const ws = this.instantiationService.invokeFunction(a => a.get(IWorkspaceContextService));
				const cwd: URI | string | undefined =
					(cwdRaw && cwdRaw.trim().length > 0)
						? cwdRaw.trim()
						: ws.getWorkspace().folders[0]?.uri;

				const options: ICreateTerminalOptions = {
					cwd,
					location: undefined,
					config: {
						forceShellIntegration: true,
						hideFromUser: true,
					} as any,
					skipContributedProfileCheck: true,
				};

				const terminal = await terminalService.createTerminal(options);

				let resolveExit!: (code: number) => void;
				const exitPromise = new Promise<{ exitCode: number }>((res) => {
					resolveExit = (code: number) => res({ exitCode: code });
				});

				const st: _TerminalRunState = {
					terminalId,
					terminal,

					// tail buffer (fast for streaming)
					outputRaw: '',
					truncated: false,

					// full buffer (used once at the end)
					outputRawFull: '',
					fullTruncated: false,

					done: false,
					exitCode: null,

					resolveExit,
					exitPromise,
					disposables: []
				};

				// Tail buffer limit (for fast polling)
				const TAIL_MAX =
					typeof outputByteLimit === 'number'
						? Math.max(4096, outputByteLimit)
						: Math.max(50_000, MAX_TERMINAL_CHARS * 4);

				// Full buffer limit
				// IMPORTANT: Make FULL_MAX >= outputByteLimit so "full:true" can actually be full.
				// (We still keep a hard cap to avoid OOM.)
				const FULL_MAX = Math.max(
					50 * 1024 * 1024, // 50MB baseline
					typeof outputByteLimit === 'number' ? outputByteLimit * 4 : 0 // best-effort chars vs bytes
				);

				st.disposables.push(
					terminal.onData((data: string) => {
						if (st.done) return;
						const chunk = String(data ?? '');

						// full
						if (!st.fullTruncated) {
							if (st.outputRawFull.length + chunk.length <= FULL_MAX) {
								st.outputRawFull += chunk;
							} else {
								st.outputRawFull += chunk.slice(0, Math.max(0, FULL_MAX - st.outputRawFull.length));
								st.fullTruncated = true;
								dbg('full.truncated', { terminalId, FULL_MAX });
							}
						}

						// tail
						st.outputRaw += chunk;
						if (st.outputRaw.length > TAIL_MAX) {
							st.outputRaw = st.outputRaw.slice(st.outputRaw.length - TAIL_MAX);
							st.truncated = true;
						}
					})
				);

				const cmdCap = await this._waitForCommandDetectionCapability(terminal);
				if (!cmdCap) throw new Error('terminal/create: CommandDetection not ready');

				st.disposables.push(
					cmdCap.onCommandFinished((cmd: any) => {
						if (st.done) return;
						st.done = true;

						const exitCode = (typeof cmd?.exitCode === 'number') ? cmd.exitCode : 0;
						st.exitCode = exitCode;

						// Prefer structured output ONLY if it is not shorter than what we already captured
						// (some implementations return only tail/limited output).
						const out = cmd?.getOutput?.();
						if (typeof out === 'string' && out.length) {
							const shouldReplaceFull =
								st.outputRawFull.length === 0 ||
								st.fullTruncated ||
								out.length > st.outputRawFull.length;

							if (shouldReplaceFull) {
								if (out.length <= FULL_MAX) {
									st.outputRawFull = out;
									st.fullTruncated = false;
								} else {
									st.outputRawFull = out.slice(0, FULL_MAX);
									st.fullTruncated = true;
								}
							}

							// Recompute tail from whatever we consider "full truth"
							const src = st.outputRawFull;
							st.outputRaw = src.slice(Math.max(0, src.length - TAIL_MAX));
							st.truncated = src.length > TAIL_MAX;
						}

						dbg('command.finished', {
							terminalId,
							exitCode,
							fullLen: st.outputRawFull.length,
							tailLen: st.outputRaw.length,
							fullTruncated: st.fullTruncated,
							tailTruncated: st.truncated
						});
						try { st.resolveExit(exitCode); } catch { }
					})
				);

				this._terminalRuns.set(terminalId, st);

				dbg('create.sendText', { terminalId, commandLinePreview: commandLine.slice(0, 200) });
				await terminal.sendText(commandLine, true);

				return { terminalId };
			}

			if (m === 'terminal/output') {
				const terminalId = String(p?.terminalId ?? '').trim();
				if (!terminalId) throw new Error('terminal/output: terminalId is required');

				const st = this._terminalRuns.get(terminalId);
				if (!st) throw new Error(`terminal/output: terminal "${terminalId}" does not exist`);

				const wantFull = !!p?.full;

				let outputRaw = wantFull ? st.outputRawFull : st.outputRaw;
				let output = removeAnsiEscapeCodes(outputRaw ?? '');

				// clamp only in non-full mode (stream polling)
				if (!wantFull && output.length > MAX_TERMINAL_CHARS) {
					const half = Math.floor(MAX_TERMINAL_CHARS / 2);
					output = output.slice(0, half) + '\n...\n' + output.slice(output.length - half);
				}

				const exitStatus = st.done
					? { exitCode: st.exitCode ?? 0, signal: null as string | null }
					: undefined;

				dbg('output.read', {
					terminalId,
					full: wantFull,
					outputLen: output.length,
					truncated: wantFull ? st.fullTruncated : st.truncated,
					done: st.done,
					exitCode: st.exitCode
				});

				return {
					output,
					truncated: wantFull ? !!st.fullTruncated : !!st.truncated,
					...(exitStatus ? { exitStatus } : {})
				};
			}

			if (m === 'terminal/wait_for_exit') {
				const terminalId = String(p?.terminalId ?? '').trim();
				if (!terminalId) throw new Error('terminal/wait_for_exit: terminalId is required');

				const st = this._terminalRuns.get(terminalId);
				if (!st) throw new Error(`terminal/wait_for_exit: terminal "${terminalId}" does not exist`);

				const r = await st.exitPromise;
				return { exitCode: r.exitCode, signal: null };
			}

			if (m === 'terminal/kill') {
				const terminalId = String(p?.terminalId ?? '').trim();
				if (!terminalId) throw new Error('terminal/kill: terminalId is required');

				const st = this._terminalRuns.get(terminalId);
				if (!st) return {};

				if (!st.done) {
					st.done = true;
					st.exitCode = 130;
					try { st.resolveExit(130); } catch { }
				}
				try { st.disposables.forEach(d => d.dispose()); } catch { }
				try { st.terminal.dispose(); } catch { }
				this._terminalRuns.delete(terminalId);
				return {};
			}

			if (m === 'terminal/release') {
				const terminalId = String(p?.terminalId ?? '').trim();
				if (!terminalId) throw new Error('terminal/release: terminalId is required');

				const st = this._terminalRuns.get(terminalId);
				if (!st) return {};

				try { st.disposables.forEach(d => d.dispose()); } catch { }
				try { st.terminal.dispose(); } catch { }
				this._terminalRuns.delete(terminalId);
				return {};
			}

			throw new Error(`Unknown terminal extMethod: ${m}`);
		} catch (e: any) {
			const msg = `terminal extMethod failed (${rawMethod}): ${safeErrMsg(e)}`;
			dbg('error', { rawMethod, normalized: m, message: msg });
			throw new Error(msg);
		}
	}

	public async handle(reqParams: any): Promise<any> {
		const method = reqParams?.method as string;
		const p = reqParams?.params ?? {};
		const disabledToolNames = this._getDisabledToolNamesSet();

		const terminalHandled = await this._handleTerminalExtMethod(method, p);
		if (terminalHandled !== undefined) {
			return terminalHandled;
		}

		// IMPORTANT: void/settings/getLLMConfig must NOT depend on IToolsService.
		// Tests (and some runtimes) may not register IToolsService, but ACP settings extMethod must still work.
		if (method === 'void/settings/getLLMConfig') {
			const vss = this.instantiationService.invokeFunction(a => a.get(IVoidSettingsService));
			const st = vss.state;
			const disabledToolNamesList = Array.from(disabledToolNames);
			const disabledStaticTools = disabledToolNamesList.filter(name => isAToolName(name));
			const disabledDynamicTools = disabledToolNamesList.filter(name => !isAToolName(name));

			type GetLLMCfgParams = { featureName: FeatureName };
			const paramsTyped = p as Partial<GetLLMCfgParams> | undefined;
			const rawFeature = paramsTyped?.featureName;

			const isAllowedFeature = (val: unknown): val is Extract<FeatureName, 'Chat' | 'Ctrl+K'> =>
				val === 'Chat' || val === 'Ctrl+K';

			if (!isAllowedFeature(rawFeature)) {
				throw new Error(`void/settings/getLLMConfig: featureName must be 'Chat' or 'Ctrl+K'`);
			}

			const feature = rawFeature;

			const selected: ModelSelection | null = st.modelSelectionOfFeature[feature];

			const providerName: ProviderName | null = selected ? selected.providerName : null;
			const modelName: string | null = selected ? selected.modelName : null;

			let modelSelectionOptions: ModelSelectionOptions | null = null;
			if (providerName && modelName) {
				modelSelectionOptions = st.optionsOfModelSelection?.[feature]?.[providerName]?.[modelName] ?? null;
			}

			// ---- Per-model requestParams/providerRouting from customProviders ----
			let requestParams: RequestParamsConfig | null = null;
			let providerRouting: ProviderRouting | null = null;

			if (providerName && modelName) {
				try {
					const providerSlug = String(providerName).trim().toLowerCase();

					// st.customProviders is usually a map keyed by slug,
					// but be resilient: also search by `cp.slug`.
					const cp: any =
						(st.customProviders as any)?.[providerSlug] ??
						Object.values(st.customProviders ?? {}).find((x: any) => String(x?.slug ?? '').trim().toLowerCase() === providerSlug);

					// Some versions store overrides under cp.perModel, others under cp.models.
					const perModel: Record<string, any> =
						(cp?.perModel && typeof cp.perModel === 'object') ? cp.perModel :
							(cp?.models && typeof cp.models === 'object') ? cp.models :
								{};

					const fullKey = modelName.includes('/') ? modelName : `${providerSlug}/${modelName}`;
					const shortKey = modelName.includes('/') ? modelName.split('/').slice(1).join('/') : modelName;

					const cfg = perModel[modelName] ?? perModel[fullKey] ?? perModel[shortKey];

					const rp = cfg?.requestParams as RequestParamsConfig | undefined;
					if (rp && (rp.mode === 'default' || rp.mode === 'off' || rp.mode === 'override')) {
						requestParams = rp;
					}

					const pr = cfg?.providerRouting as ProviderRouting | undefined;
					if (pr && typeof pr === 'object') {
						providerRouting = pr;
					}
				} catch {
					// ignore
				}
			}

			this.logService.debug('[ACP getLLMConfig]', JSON.stringify({
				feature,
				hasSelection: !!selected,
				providerName,
				modelName,
				hasModelSelectionOptions: !!modelSelectionOptions,
				chatMode: st.globalSettings.chatMode ?? null,
				hasSystemPrompt: !!st.globalSettings.acpSystemPrompt,
				hasRequestParams: !!requestParams,
				hasProviderRouting: !!providerRouting,
			}, null, 2));

			const combinedSettings = { ...st.settingsOfProvider };
			if (st.customProviders) {
				for (const [slug, cp] of Object.entries(st.customProviders)) {
					combinedSettings[slug] = {
						...cp,
						models: [],
						_didFillInProviderSettings: true
					} as any;
				}
			}

			const asToolFormat = (v: unknown): specialToolFormat | undefined => {
				return (v === 'openai-style' || v === 'anthropic-style' || v === 'gemini-style' || v === 'disabled')
					? v
					: undefined;
			};

			// ---- dynamicRequestConfig from dynamic provider registry ----
			let dynamicRequestConfig: DynamicRequestConfig | null = null;
			if (providerName && modelName) {
				try {
					const registry = this.instantiationService.invokeFunction(a => a.get(IDynamicProviderRegistryService));
					await registry.initialize?.();

					const providerSlug = String(providerName).trim().toLowerCase();

					// Registry often expects a fully-qualified model id.
					const fullModelId = modelName.includes('/') ? modelName : `${providerSlug}/${modelName}`;

					const baseCfg = registry.getRequestConfigForModel(fullModelId, providerSlug);
					const caps =
						await registry.getEffectiveModelCapabilities(providerSlug, modelName)
							.catch(async () => registry.getEffectiveModelCapabilities(providerSlug, fullModelId as any));

					dynamicRequestConfig = {
						endpoint: baseCfg.endpoint,
						apiStyle: baseCfg.apiStyle,
						supportsSystemMessage: baseCfg.supportsSystemMessage,
						specialToolFormat: baseCfg.specialToolFormat,
						headers: { ...baseCfg.headers },
						...(caps?.fimTransport ? { fimTransport: caps.fimTransport as any } : {}),
						...(caps?.reasoningCapabilities !== undefined ? { reasoningCapabilities: caps.reasoningCapabilities as any } : {}),
						...(caps?.supportCacheControl !== undefined ? { supportCacheControl: !!caps.supportCacheControl } : {}),
					};
				} catch (e) {
					this.logService.warn('[ACP getLLMConfig] Failed to build dynamicRequestConfig:', e);
					dynamicRequestConfig = null;
				}
			}

			// separateSystemMessage here is for the LLM inside the builtin ACP agent.
			let separateSystemMessage: string | null = null;

			const explicit = (st.globalSettings.acpSystemPrompt ?? '').trim();

			if (explicit) {
				separateSystemMessage = explicit + `
							ACP PLAN (builtin ACP agent; REQUIRED):
							 - Do NOT output any execution plan in plain text (no "<plan>...</plan>").
							 - If a plan is needed, call the tool "acp_plan" with entries and keep it updated.`;
			} else {
				try {
					const ws = this.instantiationService.invokeFunction(a => a.get(IWorkspaceContextService));
					const folders = ws.getWorkspace().folders.map(f => f.uri.fsPath);

					const dummyPty = {} as unknown as IPtyHostService;

					// IMPORTANT: for ACP prompt format, prefer dynamicRequestConfig from registry.
					// This keeps ACP prompt style in sync with the actual transport/tool format
					// used by sendChatRouter in main.
					let toolFormat: specialToolFormat = 'openai-style';
					const dynFmt = asToolFormat((dynamicRequestConfig as any)?.specialToolFormat);
					if (dynFmt) {
						toolFormat = dynFmt;
					} else if (providerName && modelName) {
						const modelCapabilities = getModelCapabilities(providerName, modelName, st.overridesOfModel || undefined);
						const capsFmt = asToolFormat((modelCapabilities as any)?.specialToolFormat);
						if (capsFmt) {
							toolFormat = capsFmt;
						} else {
							try {
								const modelId = modelName.includes('/') ? modelName : `${providerName}/${modelName}`;
								const apiCfg = getModelApiConfiguration(modelId);
								const apiFmt = asToolFormat((apiCfg as any)?.specialToolFormat);
								if (apiFmt) toolFormat = apiFmt;
							} catch { /* ignore */ }
						}
					}

					separateSystemMessage = await chat_systemMessageForAcp({
						workspaceFolders: folders,
						chatMode: st.globalSettings.chatMode,
						toolFormat,
						ptyHostService: dummyPty,
						disabledStaticToolNames: disabledStaticTools,
					});
				} catch {
					separateSystemMessage = `You are an editor agent inside Void.
							Use tools to read/search/edit. For plans, do NOT print a textual plan; use the tool "acp_plan".`;
				}
			}

			let additionalTools: AdditionalToolInfo[] | null = null;
			try {
				const byName = new Map<string, AdditionalToolInfo>();

				
				try {
					const lmToolsService = this.instantiationService.invokeFunction(a => a.get(ILanguageModelToolsService));
					const registeredTools = lmToolsService.getTools();

					const toolsArray: IToolData[] = [];
					for (const toolData of registeredTools) toolsArray.push(toolData);

					const mcpTools = toolsArray.filter(toolData => toolData.source?.type === 'mcp');

					for (const toolData of mcpTools) {
						const baseName = toolData.toolReferenceName || toolData.displayName;
						const source = toolData.source;

						let safePrefix = 'mcp';
						if (source && source.type === 'mcp') {
							const rawId = source.definitionId || source.collectionId || 'mcp';
							const idParts = rawId.split('.');
							const serverName = idParts[idParts.length - 1] || rawId;
							safePrefix = serverName.replace(/[^a-zA-Z0-9_]/g, '_');
						}

						const name = `${safePrefix}__${baseName}`;
						if (disabledToolNames.has(name)) continue;

						byName.set(name, {
							name,
							description: toolData.modelDescription || toolData.userDescription || '',
							params: toolData.inputSchema?.properties
								? Object.fromEntries(
									Object.entries(toolData.inputSchema.properties).map(([key, schema]: [string, any]) => [
										key,
										{
											description: (schema as any).description || `Parameter: ${key}`,
											type: (schema as any).type,
											enum: (schema as any).enum,
											items: (schema as any).items,
											properties: (schema as any).properties,
											required: (schema as any).required,
											default: (schema as any).default,
											minimum: (schema as any).minimum,
											maximum: (schema as any).maximum,
											minLength: (schema as any).minLength,
											maxLength: (schema as any).maxLength,
										},
									])
								)
								: undefined,
						});
					}
				} catch (e) {
					
					this.logService.debug('[ACP getLLMConfig] ILanguageModelToolsService MCP tools unavailable:', e);
				}

				
				try {
					for (const t of this._collectMcpJsonAdditionalTools()) {
						if (disabledToolNames.has(t.name)) continue;
						if (!byName.has(t.name)) byName.set(t.name, t);
					}
				} catch (e) {
					this.logService.warn('[ACP getLLMConfig] Failed to collect MCP tools from IMCPService:', e);
				}

				additionalTools = byName.size ? Array.from(byName.values()) : null;
			} catch (e) {
				this.logService.error('[ACP getLLMConfig] Failed to collect dynamic tools:', e);
				additionalTools = null;
			}

			return {
				providerName,
				modelName,
				settingsOfProvider: combinedSettings,
				modelSelectionOptions,
				overridesOfModel: st.overridesOfModel || null,
				separateSystemMessage,
				chatMode: st.globalSettings.chatMode ?? null,
				loopGuard: {
					maxTurnsPerPrompt: st.globalSettings.loopGuardMaxTurnsPerPrompt,
					maxSameAssistantPrefix: st.globalSettings.loopGuardMaxSameAssistantPrefix,
					maxSameToolCall: st.globalSettings.loopGuardMaxSameToolCall,
				},
				requestParams,
				providerRouting,
				dynamicRequestConfig,
				additionalTools,
				disabledStaticTools,
				disabledDynamicTools,
			};
		}

		// Everything below is tool-related and needs IToolsService.
		const tools = this._getToolsService();
		if (!tools) return {};

		const normalizeToolAlias = (nameStr: string): string => {
			const n = nameStr.trim().toLowerCase();
			if (n === 'edit' || n === 'apply_patch') return 'edit_file';
			if (n === 'write' || n === 'write_file') return 'rewrite_file';
			if (n === 'read' || n === 'cat') return 'read_file';
			if (n === 'search' || n === 'ripgrep') return 'grep';
			return nameStr;
		};

		const getMcpSafePrefix = (t: IToolData): string | undefined => {
			if (!t.source || t.source.type !== 'mcp') return undefined;
			const rawId = t.source.definitionId || t.source.collectionId || 'mcp';
			const idParts = String(rawId).split('.');
			const serverName = idParts[idParts.length - 1] || rawId;
			return String(serverName).replace(/[^a-zA-Z0-9_]/g, '_');
		};

		const toMcpPrefixedName = (t: IToolData): string => {
			const baseName = t.toolReferenceName || t.displayName || t.id;
			const prefix = getMcpSafePrefix(t) || 'mcp';
			return `${prefix}__${baseName}`;
		};

		const resolveMcpToolByName = (nameStr: string): IToolData | undefined => {
			const lmToolsService = this.instantiationService.invokeFunction(accessor => accessor.get(ILanguageModelToolsService));
			const allTools = Array.from(lmToolsService.getTools());

			let tool: IToolData | undefined = lmToolsService.getToolByName(nameStr);
			if (tool) return tool;

			const findCandidates = (baseName: string) =>
				allTools.filter(t =>
					t.source?.type === 'mcp' &&
					(t.toolReferenceName === baseName || t.displayName === baseName)
				);

			if (nameStr.includes('__')) {
				const idx = nameStr.indexOf('__');
				const prefix = nameStr.slice(0, idx);
				const baseName = nameStr.slice(idx + 2);

				if (baseName) {
					const candidates = findCandidates(baseName);
					if (candidates.length) {
						const byPrefix = candidates.find(c => getMcpSafePrefix(c) === prefix);
						return byPrefix || candidates[0];
					}
				}

				const fallbackBase = nameStr.split('__').pop();
				if (fallbackBase) {
					const candidates = findCandidates(fallbackBase);
					if (candidates.length) {
						const byPrefix = candidates.find(c => getMcpSafePrefix(c) === prefix);
						return byPrefix || candidates[0];
					}
				}
			}

			const candidates2 = findCandidates(nameStr);
			if (candidates2.length) return candidates2[0];

			return undefined;
		};

		// Bridge validate/call/stringify for builtin tools
		const bindTool = <K extends ToolName>(name: K) => {
			const validate = (tools.validateParams as Record<K, (rp: RawToolParamsObj) => unknown>)[name];
			const call = (tools.callTool as Record<K, (vp: unknown) => Promise<{ result: unknown }>>)[name];
			const stringify = (tools.stringOfResult as Partial<Record<K, (vp: unknown, r: unknown) => string>>)[name];
			return { validate, call, stringify };
		};

		if (method === 'void/tools/list') {
			const fallbackBuiltinNames = (): ToolName[] =>
				Object.keys(tools.callTool).filter(isAToolName) as ToolName[];
			let builtinNames: ToolName[] = fallbackBuiltinNames();
			try {
				const vss = this.instantiationService.invokeFunction(a => a.get(IVoidSettingsService));
				const rawChatMode = vss.state.globalSettings.chatMode;
				const chatMode: ChatMode | null =
					rawChatMode === 'agent' || rawChatMode === 'gather' || rawChatMode === 'normal'
						? rawChatMode
						: null;
				if (chatMode) {
					const names = (availableTools(chatMode) ?? []).map(tool => tool.name);
					builtinNames = Array.from(new Set(names)).filter(isAToolName) as ToolName[];
				}
			} catch {
				builtinNames = fallbackBuiltinNames();
			}

			let mcpNames: string[] = [];
			try {
				const lmToolsService = this.instantiationService.invokeFunction(accessor => accessor.get(ILanguageModelToolsService));
				const allTools = Array.from(lmToolsService.getTools());
				mcpNames = allTools
					.filter(t => t.source?.type === 'mcp')
					.map(t => toMcpPrefixedName(t));
			} catch {
				mcpNames = [];
			}

			const all = Array.from(new Set<string>([...builtinNames, ...mcpNames]))
				.filter(name => !disabledToolNames.has(name))
				.sort();
			return { tools: all };
		}

		if (method === 'void/tools/describe') {
			const raw = String(p?.name ?? '').trim();
			if (!raw) throw new Error('void/tools/describe: missing name');

			let nameStr = normalizeToolAlias(raw);

			// Built-in tools
			if (isAToolName(nameStr)) {
				if (disabledToolNames.has(nameStr)) {
					throw new Error(this._disabledToolError(nameStr));
				}

				const modes: Array<'agent' | 'gather' | 'normal'> = ['agent', 'gather', 'normal'];
				const all = new Map<string, any>();

				for (const m of modes) {
					const arr = availableTools(m) ?? [];
					for (const t of arr) {
						if (t?.name && !all.has(t.name)) all.set(t.name, t);
					}
				}

				const info = all.get(nameStr);
				return {
					name: nameStr,
					description: String(info?.description ?? ''),
					inputSchema: {
						type: 'object',
						properties: (info?.params ?? {}) as any
					}
				};
			}

			// MCP/dynamic tools
			const tool = resolveMcpToolByName(nameStr);
			if (!tool) throw new Error(`Unknown tool: ${nameStr}`);
			const prefixedName = toMcpPrefixedName(tool);
			if (disabledToolNames.has(prefixedName)) {
				throw new Error(this._disabledToolError(prefixedName));
			}

			return {
				name: prefixedName,
				description: tool.modelDescription || tool.userDescription || '',
				inputSchema: tool.inputSchema ?? null
			};
		}

		if (method === 'void/tools/execute') {
			let nameStr = normalizeToolAlias(String(p?.name ?? ''));
			if (!isAToolName(nameStr)) throw new Error(`Unknown tool: ${nameStr}`);
			if (disabledToolNames.has(nameStr)) throw new Error(this._disabledToolError(nameStr));

			const name: ToolName = nameStr;
			const rawParams: RawToolParamsObj = (p?.params ?? {}) as RawToolParamsObj;

			const { validate, call } = bindTool(name);
			const validated = validate(rawParams);
			const { result } = await call(validated);
			const resolved = await result;
			return { ok: true, result: resolved };
		}

		if (method === 'void/tools/execute_with_text') {
			let nameStr = normalizeToolAlias(String(p?.name ?? ''));
			const rawParams: RawToolParamsObj = (p?.params ?? {}) as RawToolParamsObj;

			// 1) Built-in tools
			if (isAToolName(nameStr)) {
				if (disabledToolNames.has(nameStr)) throw new Error(this._disabledToolError(nameStr));

				const name: ToolName = nameStr;
				const { validate, call, stringify } = bindTool(name);

				const validated = validate(rawParams);
				const { result } = await call(validated);
				const resolved = await result;

				let text: string;
				try {
					text = stringify
						? stringify(validated, resolved)
						: (typeof resolved === 'string' ? resolved : JSON.stringify(resolved));
				} catch {
					text = typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
				}

				return { ok: true, result: resolved, text };
			}

			
			try {
				const lmToolsService = this.instantiationService.invokeFunction(accessor => accessor.get(ILanguageModelToolsService));
				const tool = resolveMcpToolByName(nameStr);

				if (tool) {
					const prefixedName = toMcpPrefixedName(tool);
					if (disabledToolNames.has(prefixedName)) {
						throw new Error(this._disabledToolError(prefixedName));
					}

					const invocation = {
						callId: generateUuid(),
						toolId: tool.id,
						parameters: rawParams ?? {},
						context: undefined,
						skipConfirmation: true,
					};

					const res = await lmToolsService.invokeTool(invocation, async () => 0, CancellationToken.None);

					const textParts = (res.content ?? []).filter(part => part.kind === 'text').map(part => part.value as string);
					let value: any;
					if (textParts.length > 0) value = textParts.join('\n');
					else if (res.toolResultDetails) value = res.toolResultDetails;
					else if (res.toolResultMessage) value = res.toolResultMessage;
					else value = {};

					const text = typeof value === 'string' ? value : JSON.stringify(value);
					return { ok: true, result: value, text };
				}
			} catch {
				
			}

			
			const mcp = this._getMcpService();
			if (mcp) {
				const resolved = this._resolveMcpJsonToolByAcpName(nameStr);
				if (resolved) {
					if (disabledToolNames.has(nameStr)) {
						throw new Error(this._disabledToolError(nameStr));
					}

					const { serverName, toolNamePrefixed } = resolved;

					const callRes = await mcp.callMCPTool({
						serverName,
						toolName: toolNamePrefixed,
						params: rawParams ?? {}
					});

					const rawResult = callRes?.result ?? callRes;

					let text: string;
					try {
						text = typeof mcp.stringifyResult === 'function'
							? String(mcp.stringifyResult(rawResult))
							: (typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult));
					} catch {
						text = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
					}

					return { ok: true, result: rawResult, text };
				}
			}
			throw new Error(`Unknown tool: ${nameStr}`);
		}
		return {};
	}
}
