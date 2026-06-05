/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { timeout } from '../../../../base/common/async.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { IDirectoryStrService } from '../../../../platform/void/common/directoryStrService.js';
import { IAcpService, IAcpUserMessage, IAcpChatMessage, IAcpMessageChunk } from '../../../../platform/acp/common/iAcpService.js';
import { getErrorMessage, RawToolCallObj } from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { chat_userMessageContent, isAToolName, ToolName } from '../common/prompt/prompts.js';
import { AnyToolName, ChatAttachment, StagingSelectionItem, ChatMessage } from '../../../../platform/void/common/chatThreadServiceTypes.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { ChatHistoryCompressor } from './ChatHistoryCompressor.js';
import { ChatToolOutputManager } from './ChatToolOutputManager.js';
import { ILogService } from '../../../../platform/log/common/log.js';

const _snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const _normalizeFsPath = (p: string) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/g, '');
const _stripDotPrefix = (p: string) => {
	if (p.startsWith('./')) return p.substring(2);
	if (p.startsWith('.\\')) return p.substring(2);
	return p;
};
const _resolvePathWithWorkspace = (pathStr: string, workspaceRoot: URI | undefined): URI => {
	try {
		const s = String(pathStr ?? '').trim();
		if (!s && workspaceRoot) return workspaceRoot;

		// Real URI with scheme (file://, vscode-remote://, etc)
		// Important: don't treat "C:foo" as a scheme URI
		const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) && !/^[a-zA-Z]:/.test(s);
		if (hasScheme) {
			return URI.parse(s);
		}

		// Windows absolute path: C:\... or C:/...
		const isWindowsDriveAbs = /^[a-zA-Z]:[\\/]/.test(s);
		// POSIX absolute path: /...
		const isPosixAbs = s.startsWith('/');

		if (workspaceRoot) {
			const rootNorm = _normalizeFsPath(workspaceRoot.fsPath);
			const inputNorm = _normalizeFsPath(s);
			if (rootNorm && (inputNorm === rootNorm || inputNorm.startsWith(rootNorm + '/'))) {
				const rel = inputNorm === rootNorm ? '' : inputNorm.slice(rootNorm.length + 1);
				return rel ? URI.joinPath(workspaceRoot, rel) : workspaceRoot;
			}

			if (!isWindowsDriveAbs && !isPosixAbs) {
				const cleanPath = _stripDotPrefix(s);
				return URI.joinPath(workspaceRoot, cleanPath);
			}

			// In remote/virtual workspaces absolute paths should stay in that scheme.
			if (workspaceRoot.scheme !== 'file') {
				const remotePath = s.replace(/\\/g, '/');
				return workspaceRoot.with({ path: remotePath.startsWith('/') ? remotePath : `/${remotePath}` });
			}
		}

		// Fallback: treat as local file path
		return URI.file(s);
	} catch {
		return URI.file(String(pathStr ?? ''));
	}
};
const _deepCamelize = (v: any): any => {
	if (Array.isArray(v)) return v.map(_deepCamelize);
	if (v && typeof v === 'object') {
		const out: any = {};
		for (const [k, val] of Object.entries(v)) {
			out[_snakeToCamel(k)] = _deepCamelize(val);
		}
		return out;
	}
	return v;
};

export const normalizeAcpToolName = (raw: string): ToolName | string => {
	const n = (raw || '').trim();
	const map: Record<string, ToolName> = {
		'fs/read_text_file': 'read_file',
		'fs/write_text_file': 'rewrite_file',
		'terminal/create': 'run_command',
		'terminal/kill': 'kill_persistent_terminal',
		'terminal/output': 'open_persistent_terminal',
		'terminal/release': 'kill_persistent_terminal',
		'terminal/wait_for_exit': 'run_persistent_command',
	};
	return (map[n] ?? n) as ToolName | string;
};

export const normalizeAcpArgsForUi = (
	toolName: AnyToolName | string,
	rawParams: Record<string, any> | undefined,
	workspaceRoot: URI | undefined
) => {
	const src = rawParams && typeof rawParams === 'object' && 'args' in rawParams ? (rawParams as any).args : rawParams;
	const p = _deepCamelize(src ?? {});

	// --- NEW: parse "(from line..., limit ...)" embedded into uri for read_file ---
	if (toolName === 'read_file' && p && typeof (p as any).uri === 'string') {
		const uriStr = String((p as any).uri);
		const range = _parseReadRangeFromText(uriStr);

		// only fill if missing
		if (typeof (p as any).startLine !== 'number' && typeof range.startLine === 'number') (p as any).startLine = range.startLine;
		if (typeof (p as any).linesCount !== 'number' && typeof range.linesCount === 'number') (p as any).linesCount = range.linesCount;

		// clean uri string before resolving to URI
		(p as any).uri = _stripReadRangeSuffixFromUri(uriStr);
	}

	const resolvePath = (pathStr: string): URI => _resolvePathWithWorkspace(pathStr, workspaceRoot);

	if (p && typeof (p as any).uri === 'string') (p as any).uri = resolvePath((p as any).uri);
	if (p && typeof (p as any).searchInFolder === 'string') (p as any).searchInFolder = resolvePath((p as any).searchInFolder);
	if ((p as any)?.isFolder !== null && typeof (p as any).isFolder !== 'boolean') (p as any).isFolder = String((p as any).isFolder).toLowerCase() === 'true';
	return p;
};

// ---------- NEW helpers for external ACP normalization ----------

const _asObj = (v: any): Record<string, any> | null =>
	(v && typeof v === 'object' && !Array.isArray(v)) ? (v as Record<string, any>) : null;

const _inferInternalToolNameFromResult = (rawName: string, result: any): AnyToolName | string => {
	const rn = String(rawName ?? '').trim();
	const r = _asObj(result);

	// 1) If it already matches internal tool names, keep it
	if (isAToolName(rn as any)) return rn as any;

	// 2) Strong structural signals
	if (r) {
		// read file: path + content
		if (typeof r.path === 'string' && typeof r.content === 'string') return 'read_file';
		// edit/patch: diffs array
		if (Array.isArray((r as any).diffs) && (r as any).diffs.length > 0) return 'edit_file';
		// terminal: output/exitCode/terminalId
		if (typeof (r as any).output === 'string') return 'run_command';
		if (typeof (r as any).terminalId === 'string') return 'run_command';
		if (typeof (r as any).exitCode === 'number' || (r as any).exitCode === null) return 'run_command';
		if (Array.isArray((r as any).terminals) && (r as any).terminals.length > 0) return 'run_command';
	}

	// 3) Weak heuristic based on name strings (last resort)
	if (rn.startsWith('read_file')) return 'read_file';
	if (rn.startsWith('edit_file') || rn.toLowerCase().includes('patch')) return 'edit_file';

	// if it looks like a shell command line, treat as terminal
	if (/^(cat|ls|pwd|echo|git|npm|pnpm|yarn|node|python|bash|sh)\b/i.test(rn)) return 'run_command';

	return rawName;
};

const _parseReadRangeFromText = (s: string): { startLine?: number; linesCount?: number } => {
	const str = String(s ?? '');

	// (from line 650, limit 20 lines)
	let m = str.match(/from line\s+(\d+)\s*,\s*limit\s+(\d+)\s+lines/i);
	if (m) {
		const startLine = Number(m[1]);
		const linesCount = Number(m[2]);
		if (Number.isFinite(startLine) && Number.isFinite(linesCount) && linesCount > 0) {
			return { startLine, linesCount };
		}
		return {};
	}


	m = str.match(/limit\s+(\d+)\s+lines/i);
	if (m) {
		const linesCount = Number(m[1]);
		if (Number.isFinite(linesCount) && linesCount > 0) {
			return { startLine: 1, linesCount };
		}
	}

	return {};
};

const _stripReadRangeSuffixFromUri = (uriStr: string): string => {
	const s = String(uriStr ?? '');

	return s.replace(/\s*\(\s*(?:from line\s+\d+\s*,\s*)?limit\s+\d+\s+lines\s*\)\s*$/i, '').trim();
};

const _buildCommandLine = (command: any, args: any): string | undefined => {
	const cmd = typeof command === 'string' ? command : '';
	if (!cmd) return undefined;
	const arr = Array.isArray(args) ? args.map(a => String(a ?? '')) : [];
	return arr.length ? `${cmd} ${arr.join(' ')}` : cmd;
};

const _diffsToPatchUnified = (diffs: Array<{ path: string; oldText?: string; newText: string }>): string => {
	const blocks: string[] = [];
	for (const d of diffs) {
		const path = String(d?.path ?? 'unknown');
		const oldText = String(d?.oldText ?? '');
		const newText = String(d?.newText ?? '');
		blocks.push(
			[
				`--- a/${path}`,
				`+++ b/${path}`,
				`@@`,
				...oldText.split('\n').map(l => `-${l}`),
				...newText.split('\n').map(l => `+${l}`),
				``
			].join('\n')
		);
	}
	return blocks.join('\n');
};

export interface IThreadStateAccess {
	getThreadMessages(threadId: string): ChatMessage[];
	getStreamState(threadId: string): any;
	setStreamState(threadId: string, state: any): void;
	addMessageToThread(threadId: string, message: ChatMessage): void;
	updateLatestTool(threadId: string, tool: any): void;
	setThreadState(threadId: string, state: any): void;
	accumulateTokenUsage(threadId: string, usage: any): void;
	addUserCheckpoint(threadId: string): void;
	currentModelSelectionProps(): { modelSelection: any; modelSelectionOptions: any };
}

export class ChatAcpHandler extends Disposable {
	private readonly _acpStreamByThread = new Map<string, { stream: any, sub?: IDisposable }>();
	private readonly _acpToolCallInfoByKey = new Map<string, { name: string; rawParams: Record<string, any>; paramsForUi: any }>();

	constructor(
		@IAcpService private readonly _acpService: IAcpService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@IFileService private readonly _fileService: IFileService,
		@IDirectoryStrService private readonly _directoryStringService: IDirectoryStrService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@ILogService private readonly _logService: ILogService,
		private readonly _historyCompressor: ChatHistoryCompressor,
		private readonly _toolOutputManager: ChatToolOutputManager
	) {
		super();
	}

	private _getExistingToolMsgById(threadId: string, toolCallId: string, access: IThreadStateAccess): any | null {
		const msgs = access.getThreadMessages(threadId) ?? [];
		for (let i = msgs.length - 1; i >= 0; i--) {
			const m: any = msgs[i] as any;
			if (m?.role === 'tool' && String(m.id ?? '') === String(toolCallId)) return m;
		}
		return null;
	}

	private _acpToolKey(threadId: string, toolCallId: string): string {
		return `${threadId}:${toolCallId}`;
	}

	public enqueueToolRequestFromAcp(
		threadId: string,
		req: { id: string; name: AnyToolName | string; rawParams: Record<string, any>; params?: Record<string, any> },
		access: IThreadStateAccess
	): void {
		const normName = normalizeAcpToolName(String(req.name));

		// Flush assistant text if any
		const st = access.getStreamState(threadId);
		if (st?.isRunning === 'LLM' && st.llmInfo) {
			const { displayContentSoFar, reasoningSoFar } = st.llmInfo;
			if ((displayContentSoFar?.length ?? 0) || (reasoningSoFar?.length ?? 0)) {
				access.addMessageToThread(threadId, {
					role: 'assistant',
					displayContent: displayContentSoFar ?? '',
					reasoning: reasoningSoFar ?? '',
					anthropicReasoning: null
				});
			}
		}

		const workspace = this._workspaceContextService.getWorkspace();
		const rootUri = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;

		const paramsForUi = normalizeAcpArgsForUi(normName, req.params ?? req.rawParams, rootUri);

		// Remember tool call info (used later for tool_result/progress)
		this._acpToolCallInfoByKey.set(this._acpToolKey(threadId, String(req.id)), {
			name: String(normName),
			rawParams: req.rawParams ?? {},
			paramsForUi
		});

		// IMPORTANT: use updateLatestTool (by id) to avoid duplicate headers
		access.updateLatestTool(threadId, {
			role: 'tool',
			type: 'tool_request',
			content: 'Awaiting user permission...',
			displayContent: 'Awaiting user permission...',
			result: null,
			name: (isAToolName(normName) ? normName : (normName as any)),
			params: paramsForUi,
			id: req.id,
			rawParams: req.rawParams
		});

		// Keep stream in awaiting_user
		access.setStreamState(threadId, { isRunning: 'awaiting_user' });
	}

	public async runAcp(opts: {
		threadId: string;
		userMessage: string;
		_chatSelections?: StagingSelectionItem[];
		attachments?: ChatAttachment[];
	}, access: IThreadStateAccess): Promise<void> {

		const { threadId, userMessage, _chatSelections, attachments } = opts;

		// --- Helper: Merge Text ---
		const MAX_OVERLAP = 512;
		function findOverlapLength(prev: string, incoming: string, max: number): number {
			const prevSuffix = prev.slice(prev.length - max);
			const incomingPrefix = incoming.slice(0, max);
			const combined = `${incomingPrefix}\u0000${prevSuffix}`;

			const lps = new Array<number>(combined.length).fill(0);
			for (let i = 1; i < combined.length; i += 1) {
				let len = lps[i - 1];
				while (len > 0 && combined[i] !== combined[len]) {
					len = lps[len - 1];
				}
				if (combined[i] === combined[len]) {
					len += 1;
				}
				lps[i] = len;
			}

			return Math.min(lps[lps.length - 1], max);
		}

		function mergeWithOverlap(prev: string, incoming: string): string {
			if (!prev) return incoming;
			const max = Math.min(prev.length, incoming.length, MAX_OVERLAP);
			if (max <= 0) return prev + incoming;
			const overlap = findOverlapLength(prev, incoming, max);
			if (overlap > 0) return prev + incoming.slice(overlap);
			return prev + incoming;
		}

		const mergeAcpText = (prev: string, incoming: string): string => {
			if (incoming === '') return prev;
			if (!prev) return incoming;
			if (incoming === prev) return prev;
			if (incoming.startsWith(prev)) return incoming;
			if (prev.startsWith(incoming)) return prev;

			const merged = mergeWithOverlap(prev, incoming);
			if (merged.length < prev.length + incoming.length) return merged;

			const trimmedPrev = prev.replace(/\s+$/u, '');
			const last = trimmedPrev[trimmedPrev.length - 1] ?? '';
			const first = incoming[0] ?? '';

			let sep = '';
			if (last && first && !/\s/u.test(last) && !/\s/u.test(first)) {
				if (last === ':') sep = ' ';
				else if (/[.!?]/.test(last)) sep = ' ';
			}
			return prev + sep + incoming;
		};

		const mergeAcpReasoning = (prev: string, incoming: string): string => {
			if (incoming === '') return prev;
			if (!prev) return incoming;
			if (incoming === prev) return prev;
			if (incoming.startsWith(prev)) return incoming;
			if (prev.startsWith(incoming)) return prev;
			return mergeWithOverlap(prev, incoming);
		};

		const flushAssistantIfAny = () => {
			const info = access.getStreamState(threadId)?.llmInfo;
			if (!info) return;
			const text = info.displayContentSoFar ?? '';
			const reasoning = info.reasoningSoFar ?? '';
			if (!text && !reasoning) return;

			access.addMessageToThread(threadId, {
				role: 'assistant',
				displayContent: text,
				reasoning,
				anthropicReasoning: null
			});

			access.setStreamState(threadId, {
				isRunning: 'LLM',
				llmInfo: {
					displayContentSoFar: '',
					reasoningSoFar: '',
					toolCallSoFar: null,
					planSoFar: info.planSoFar
				},
				interrupt: interruptP
			});
		};

		let done = false;

		this.clearAcpState(threadId);

		const cancelFn = () => {
			const entry = this._acpStreamByThread.get(threadId);
			try { entry?.stream?.cancel?.(); } catch { /* noop */ }
		};
		const interruptP = Promise.resolve(cancelFn);

		access.setStreamState(threadId, {
			isRunning: 'LLM',
			llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null },
			interrupt: interruptP
		});

		let history = this._buildAcpHistory(threadId, access);

		const currSelns = _chatSelections ?? null;
		const builtContent = await chat_userMessageContent(
			userMessage,
			currSelns,
			{
				directoryStrService: this._directoryStringService,
				fileService: this._fileService,
				voidModelService: this._voidModelService,
			}
		);

		const contentBlocks: any[] = [];
		if (builtContent && builtContent.trim()) {
			contentBlocks.push({ type: 'text', text: builtContent });
		}
		if (attachments && attachments.length) {
			for (const att of attachments) {
				if (att.kind !== 'image') continue;
				try {
					const fileData = await this._fileService.readFile(att.uri);
					const dataBase64 = encodeBase64(fileData.value);
					contentBlocks.push({
						type: 'image',
						mimeType: (att as any).mimeType || 'image/png',
						data: dataBase64,
					});
				} catch { /* ignore */ }
			}
		}

		let message: IAcpUserMessage = { role: 'user', content: builtContent } as IAcpUserMessage;
		if (contentBlocks.length) {
			(message as any).contentBlocks = contentBlocks;
		}

		// Compression
		try {
			const { modelSelection, modelSelectionOptions } = access.currentModelSelectionProps();
			if (modelSelection) {
				const { summaryText, compressionInfo } = await this._historyCompressor.maybeSummarizeHistoryBeforeLLM({
					threadId,
					messages: access.getThreadMessages(threadId),
					modelSelection,
					modelSelectionOptions,
				});
				if (compressionInfo) {
					access.setThreadState(threadId, { historyCompression: compressionInfo });
				}
				if (summaryText && summaryText.trim()) {
					const tail = history.slice(-8);
					history = [
						{ role: 'assistant', content: summaryText.trim() } as IAcpChatMessage,
						...tail,
					];
				}
			}
		} catch { /* fail open */ }

		const gs = this._settingsService.state.globalSettings;
		let stream: any;
		let attempt = 0;
		const chatRetries = gs.chatRetries;
		const retryDelay = gs.retryDelay;

		while (attempt < chatRetries + 1 && !stream) {
			attempt += 1;
			try {
				stream = await this._acpService.sendChatMessage(threadId, history, message, {
					mode: gs.acpMode,
					agentUrl: gs.acpAgentUrl || undefined,
					command: gs.acpProcessCommand || undefined,
					args: gs.acpProcessArgs || undefined,
					env: gs.acpProcessEnv || undefined,
					model: gs.acpModel || undefined,
					system: gs.acpSystemPrompt || undefined,
					featureName: 'Chat',
					maxToolOutputLength: gs.maxToolOutputLength,
					readFileChunkLines: gs.readFileChunkLines,
				});
			} catch (e) {
				const msg = getErrorMessage(e);
				if (attempt > chatRetries) {
					access.setStreamState(threadId, {
						isRunning: undefined,
						error: { message: msg, fullError: e instanceof Error ? e : null }
					});
					access.addUserCheckpoint(threadId);
					return;
				}
				if (retryDelay > 0) await timeout(retryDelay);
			}
		}

		if (!stream) {
			access.setStreamState(threadId, {
				isRunning: undefined,
				error: { message: 'ACP: failed to start session', fullError: null }
			});
			access.addUserCheckpoint(threadId);
			return;
		}

		this._acpStreamByThread.set(threadId, { stream });

		let sub: IDisposable | undefined;
		const finish = () => {
			if (done) return;
			done = true;
			try { sub?.dispose(); } catch { }
			this._acpStreamByThread.delete(threadId);
		};

		const onChunk = async (chunk: IAcpMessageChunk) => {
			if (done) return;

			if (chunk.type === 'text') {
				let incoming = chunk.text ?? '';
				const prevInfo = access.getStreamState(threadId)?.llmInfo;
				const prev = prevInfo?.displayContentSoFar ?? '';
				let next = mergeAcpText(prev, incoming);
				if (next === prev) return;

				access.setStreamState(threadId, {
					isRunning: 'LLM',
					llmInfo: {
						displayContentSoFar: next,
						reasoningSoFar: prevInfo?.reasoningSoFar ?? '',
						toolCallSoFar: prevInfo?.toolCallSoFar ?? null,
						planSoFar: prevInfo?.planSoFar
					},
					interrupt: interruptP
				});
				return;
			}

			if (chunk.type === 'reasoning') {
				const incoming = chunk.reasoning ?? '';
				const prevInfo = access.getStreamState(threadId)?.llmInfo;
				const prev = prevInfo?.reasoningSoFar ?? '';
				const next = mergeAcpReasoning(prev, incoming);
				if (next === prev) return;

				access.setStreamState(threadId, {
					isRunning: 'LLM',
					llmInfo: {
						displayContentSoFar: prevInfo?.displayContentSoFar ?? '',
						reasoningSoFar: next,
						toolCallSoFar: prevInfo?.toolCallSoFar ?? null,
						planSoFar: prevInfo?.planSoFar
					},
					interrupt: interruptP
				});
				return;
			}

			if (chunk.type === 'plan' && chunk.plan) {
				const prev = access.getStreamState(threadId)?.llmInfo ?? { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null };
				if (this._settingsService.state.globalSettings.showAcpPlanInChat !== false) {
					const normalizedPlan = {
						title: chunk.plan.title,
						items: (chunk.plan.items ?? []).map(it => ({
							id: it.id,
							text: it.text,
							state: (it.state ?? 'pending') as 'pending' | 'running' | 'done' | 'error'
						}))
					};
					const cleanedText = (prev.displayContentSoFar ?? '').replace(/<\/plan\s*>/gi, '').trimEnd();
					access.setStreamState(threadId, {
						isRunning: 'LLM',
						llmInfo: { ...prev, displayContentSoFar: cleanedText, planSoFar: normalizedPlan },
						interrupt: interruptP
					});
					access.setThreadState(threadId, { acpPlan: normalizedPlan });
				}
				return;
			}

			if (chunk.type === 'tool_call' && chunk.toolCall) {
				flushAssistantIfAny();
				const { id, name, args } = chunk.toolCall;

				const normName = normalizeAcpToolName(String(name));
				const toolCallSoFar: RawToolCallObj = {
					id,
					name: (isAToolName(normName) ? normName : (normName as any)),
					rawParams: args ?? {},
					isDone: false,
					doneParams: []
				};

				const workspace = this._workspaceContextService.getWorkspace();
				const rootUri = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;

				const paramsForUi = normalizeAcpArgsForUi(normName, args, rootUri);
				this._acpToolCallInfoByKey.set(this._acpToolKey(threadId, String(id)), {
					name: String(normName),
					rawParams: args ?? {},
					paramsForUi
				});

				const prev = access.getStreamState(threadId)?.llmInfo;
				access.updateLatestTool(threadId, {
					role: 'tool',
					type: 'running_now',
					name: (isAToolName(normName) ? normName : (normName as any)),
					params: paramsForUi,
					content: 'running...',
					displayContent: 'running...',
					result: null,
					id,
					rawParams: args ?? {}
				});
				access.setStreamState(threadId, {
					isRunning: 'LLM',
					llmInfo: {
						displayContentSoFar: prev?.displayContentSoFar ?? '',
						reasoningSoFar: prev?.reasoningSoFar ?? '',
						toolCallSoFar,
						planSoFar: prev?.planSoFar
					},
					interrupt: interruptP
				});
				return;
			}

			if (chunk.type === 'tool_progress' && (chunk as any).toolProgress) {
				const tp = (chunk as any).toolProgress;
				const id = String(tp.id ?? '');
				if (!id) return;

				const existing = this._getExistingToolMsgById(threadId, id, access);
				const prevLen =
					(typeof existing?.displayContent === 'string' ? existing.displayContent.length : 0)
					|| (typeof existing?.content === 'string' ? existing.content.length : 0);

				// Normalize output
				const output = (typeof tp.output === 'string') ? tp.output : String(tp.output ?? '');
				const exitStatus = tp.exitStatus;
				const isDone =
					!!exitStatus && (
						typeof exitStatus.exitCode === 'number' || exitStatus.exitCode === null ||
						typeof exitStatus.signal === 'string' || exitStatus.signal === null
					);

				// CRITICAL: never overwrite existing output with empty progress
				if (!output || output.length === 0) {
					this._logService.debug('[Void][ChatAcpHandler][tool_progress][SKIP_EMPTY]', JSON.stringify({
						threadId,
						toolCallId: id,
						prevLen,
						terminalId: typeof tp.terminalId === 'string' ? tp.terminalId : null,
						hasExitStatus: !!tp.exitStatus
					}));
					return;
				}

				// While tool is still running, never shrink non-empty output.
				if (!isDone && prevLen > 0 && output.length < prevLen) {
					this._logService.debug('[Void][ChatAcpHandler][tool_progress][SKIP_SHRINK]', JSON.stringify({
						threadId,
						toolCallId: id,
						prevLen,
						nextLen: output.length,
						terminalId: typeof tp.terminalId === 'string' ? tp.terminalId : null,
						isDone
					}));
					return;
				}

				// Ignore late progress for skipped/rejected
				if (existing && (existing.type === 'skipped' || existing.type === 'rejected')) return;

				const rawNameStr = String(tp.name ?? 'run_command');
				const normName = normalizeAcpToolName(rawNameStr);
				const uiToolName = (isAToolName(normName) ? normName : (normName as any));

				const workspace = this._workspaceContextService.getWorkspace();
				const rootUri = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;

				const key = this._acpToolKey(threadId, id);
				const callInfo = this._acpToolCallInfoByKey.get(key);

				const rawParamsForUi: Record<string, any> = { ...(callInfo?.rawParams ?? {}) };
				if (typeof tp.terminalId === 'string' && tp.terminalId) rawParamsForUi.terminalId = tp.terminalId;

				const paramsForUi = callInfo?.paramsForUi
					?? normalizeAcpArgsForUi(uiToolName, rawParamsForUi, rootUri)
					?? {};

				// For streaming we DO NOT run ToolOutputManager: it can dedupe/normalize and accidentally blank output.
				// Just show the current output.
				const resultForUi: any = {
					toolCallId: id,
					...(tp.terminalId ? { terminalId: String(tp.terminalId) } : {}),
					output,
					...(typeof tp.truncated === 'boolean' ? { truncated: tp.truncated } : {}),
					...(exitStatus ? {
						exitCode: (typeof exitStatus.exitCode === 'number' || exitStatus.exitCode === null) ? exitStatus.exitCode : undefined,
						signal: (typeof exitStatus.signal === 'string' || exitStatus.signal === null) ? exitStatus.signal : undefined
					} : {})
				};

				this._logService.debug('[Void][ChatAcpHandler][tool_progress][APPLY]', JSON.stringify({
					threadId,
					toolCallId: id,
					uiToolName,
					prevLen,
					nextLen: output.length,
					terminalId: resultForUi.terminalId ?? null,
					truncated: typeof resultForUi.truncated === 'boolean' ? resultForUi.truncated : null
				}));

				access.updateLatestTool(threadId, {
					role: 'tool',
					type: 'running_now',
					name: uiToolName,
					params: paramsForUi,
					result: resultForUi,
					content: output,
					displayContent: output,
					id,
					rawParams: rawParamsForUi
				});

				return;
			}

			if (chunk.type === 'tool_result' && chunk.toolResult) {
				const { id, name, result, error } = chunk.toolResult;
				const existing = this._getExistingToolMsgById(threadId, String(id), access);
				if (existing && (existing.type === 'skipped' || existing.type === 'rejected')) {
					return;
				}
				const workspace = this._workspaceContextService.getWorkspace();
				const rootUri = workspace.folders.length > 0 ? workspace.folders[0].uri : undefined;

				const rawNameStr = String(name ?? '');

				// DEBUG LOG: Show raw ACP tool result for debugging
				this._logService.debug('[Void][ChatAcpHandler][tool_result][RAW_ACP_DATA]', JSON.stringify({
					threadId,
					toolCallId: id,
					rawName: name,
					rawResult: result,
					rawError: error
				}, null, 2));

				// --- NEW: infer internal tool name from result structure ---
				const inferredName = _inferInternalToolNameFromResult(rawNameStr, result);
				const normName = normalizeAcpToolName(String(inferredName));
				const uiToolName = (isAToolName(normName) ? normName : (normName as any));

				// DEBUG LOG: Show inferred tool name
				this._logService.debug('[Void][ChatAcpHandler][tool_result][INFERRED_TOOL]', JSON.stringify({
					threadId,
					toolCallId: id,
					rawName: rawNameStr,
					inferredName,
					normName,
					uiToolName
				}, null, 2));

				// Prefer params captured earlier (tool_request / tool_call), so read_file gets URI and line range
				const key = this._acpToolKey(threadId, String(id));
				const callInfo = this._acpToolCallInfoByKey.get(key);

				const msgs = access.getThreadMessages(threadId);
				const lastMsg = msgs[msgs.length - 1];
				const prevParams =
					(existing && existing.role === 'tool') ? (existing as any).params :
						(lastMsg && lastMsg.role === 'tool') ? (lastMsg as any).params : {};
				const prevRawParams =
					(existing && existing.role === 'tool') ? (existing as any).rawParams :
						(lastMsg && lastMsg.role === 'tool') ? (lastMsg as any).rawParams : {};

				let rawParamsForUi: Record<string, any> =
					(callInfo?.rawParams ?? prevRawParams ?? {}) as Record<string, any>;

				// --- NEW: enrich rawParamsForUi from tool_result.result (path/diffs/command) ---
				const rObj = _asObj(result);

				if (uiToolName === 'read_file' && rObj) {
					// DEBUG LOG: Show raw params before processing
					this._logService.debug('[Void][ChatAcpHandler][tool_result][READ_FILE_BEFORE]', JSON.stringify({
						threadId,
						toolCallId: id,
						rawParamsForUi: rawParamsForUi,
						rObjPath: rObj.path,
						rObjContentLength: typeof rObj.content === 'string' ? rObj.content.length : undefined
					}, null, 2));

					const uriRaw = (rawParamsForUi as any).uri;
					const uriStr = (typeof uriRaw === 'string') ? uriRaw : '';


					const rangeFromUri = _parseReadRangeFromText(uriStr);
					if (typeof (rawParamsForUi as any).startLine !== 'number' && typeof rangeFromUri.startLine === 'number') {
						(rawParamsForUi as any).startLine = rangeFromUri.startLine;
					}
					if (typeof (rawParamsForUi as any).linesCount !== 'number' && typeof rangeFromUri.linesCount === 'number') {
						(rawParamsForUi as any).linesCount = rangeFromUri.linesCount;
					}


					const hasSuffix = /\(\s*(?:from line\s+\d+\s*,\s*)?limit\s+\d+\s+lines\s*\)\s*$/i.test(uriStr);
					if (typeof rObj.path === 'string' && rObj.path && (hasSuffix || !uriStr)) {
						(rawParamsForUi as any).uri = rObj.path;
					} else if (typeof uriStr === 'string' && uriStr) {
						(rawParamsForUi as any).uri = _stripReadRangeSuffixFromUri(uriStr);
					}
					// DEBUG LOG: Show final params after processing
					this._logService.debug('[Void][ChatAcpHandler][tool_result][READ_FILE_AFTER]', JSON.stringify({
						threadId,
						toolCallId: id,
						finalParamsForUi: rawParamsForUi,
					}, null, 2));
				}

				if (uiToolName === 'edit_file' && rObj) {
					const diffs: Array<{ path: string; oldText?: string; newText: string }> | undefined = Array.isArray((rObj as any).diffs) ? (rObj as any).diffs : undefined;
					const firstPath = diffs && diffs.length ? String(diffs[0]?.path ?? '') : '';
					const filePath = typeof (rObj as any).file === 'string' ? String((rObj as any).file) : '';

					if (typeof (rawParamsForUi as any).uri !== 'string') {
						const p = firstPath || filePath;
						if (p) (rawParamsForUi as any).uri = p;
					}

					// Provide snippets for EditTool preview/apply (best-effort)
					if (diffs && diffs.length) {
						const d0 = diffs[0];
						if (typeof (rawParamsForUi as any).originalSnippet !== 'string') (rawParamsForUi as any).originalSnippet = String(d0.oldText ?? '');
						if (typeof (rawParamsForUi as any).updatedSnippet !== 'string') (rawParamsForUi as any).updatedSnippet = String(d0.newText ?? '');
					}
				}

				if (uiToolName === 'run_command' && rObj) {
					// terminalId
					if (typeof (rObj as any).terminalId === 'string' && typeof (rawParamsForUi as any).terminalId !== 'string') {
						(rawParamsForUi as any).terminalId = (rObj as any).terminalId;
					}

					// command line (best-effort, now host returns command on waitForTerminalExit)
					const cmdLine =
						_buildCommandLine((rawParamsForUi as any).command, (rawParamsForUi as any).args)
						?? (typeof (rObj as any).command === 'string' ? String((rObj as any).command) : undefined)
						?? _buildCommandLine((rObj as any).command, (rObj as any).args)
						?? (typeof (rObj as any).commandLine === 'string' ? String((rObj as any).commandLine) : undefined)
						?? (typeof rawNameStr === 'string' && rawNameStr.trim() ? rawNameStr.trim() : undefined);

					if (cmdLine && typeof (rawParamsForUi as any).command !== 'string') {
						(rawParamsForUi as any).command = cmdLine;
					}

					// output (host now returns output; but keep fallbacks)
					if (typeof (rObj as any).output !== 'string') {
						const t = typeof (rObj as any).text === 'string' ? (rObj as any).text : undefined;
						if (t) (rObj as any).output = t;
					}
					if (typeof (rObj as any).output !== 'string' && typeof (rObj as any).rawOutput === 'string') {
						(rObj as any).output = (rObj as any).rawOutput;
					}
				}

				// Compute paramsForUi from augmented raw params
				const computedParamsForUi = normalizeAcpArgsForUi(uiToolName, rawParamsForUi, rootUri);
				const paramsForUi = { ...(callInfo?.paramsForUi ?? prevParams ?? {}), ...(computedParamsForUi ?? {}) };

				// --- NEW: for edit_file, generate patch_unified from diffs so UI shows Preview(diff) like internal ---
				let normalizedResult: any = result;
				if (uiToolName === 'edit_file') {
					const ro = _asObj(result);
					const diffs: Array<{ path: string; oldText?: string; newText: string }> | undefined = (ro && Array.isArray((ro as any).diffs)) ? (ro as any).diffs : undefined;
					if (ro && diffs && diffs.length) {
						const patch = _diffsToPatchUnified(diffs);
						if (typeof (ro as any).patch_unified !== 'string' || !(ro as any).patch_unified) {
							(ro as any).patch_unified = patch;
						}
						if (!ro.preview || typeof ro.preview !== 'object') {
							(ro as any).preview = {};
						}
						if (typeof (ro.preview as any).patch_unified !== 'string' || !(ro.preview as any).patch_unified) {
							(ro.preview as any).patch_unified = (ro as any).patch_unified;
						}
						normalizedResult = ro;
					}
				}

				if (error) {
					access.updateLatestTool(threadId, {
						role: 'tool',
						type: 'tool_error',
						name: uiToolName,
						params: paramsForUi,
						result: error,
						content: String(error),
						id,
						rawParams: rawParamsForUi
					});
				} else {
					const terminalIdForKey =
						(rObj && typeof (rObj as any).terminalId === 'string' ? String((rObj as any).terminalId) : undefined)
						?? (typeof (rawParamsForUi as any)?.terminalId === 'string' ? String((rawParamsForUi as any).terminalId) : undefined)
						?? (typeof (paramsForUi as any)?.terminalId === 'string' ? String((paramsForUi as any).terminalId) : undefined);

					let resultForToolOutput: any = normalizedResult;

					if (_asObj(resultForToolOutput)) {
						// Preserve existing result fields, but guarantee IDs exist.
						resultForToolOutput = {
							toolCallId: String(id),
							...(terminalIdForKey ? { terminalId: terminalIdForKey } : {}),
							...(resultForToolOutput as any),
						};
					} else if (typeof resultForToolOutput === 'string') {
						// Wrap string into object so ToolOutputManager can key by ids.
						resultForToolOutput = {
							toolCallId: String(id),
							...(terminalIdForKey ? { terminalId: terminalIdForKey } : {}),
							text: resultForToolOutput
						};
					} else {
						// Fallback wrap
						resultForToolOutput = {
							toolCallId: String(id),
							...(terminalIdForKey ? { terminalId: terminalIdForKey } : {}),
							value: resultForToolOutput
						};
					}

					const { result: processedResult, content, displayContent } =
						await this._toolOutputManager.processToolResult(resultForToolOutput, uiToolName);

					access.updateLatestTool(threadId, {
						role: 'tool',
						type: 'success',
						name: uiToolName,
						params: paramsForUi,
						result: processedResult,
						content,
						displayContent,
						id,
						rawParams: rawParamsForUi
					});
				}


				const diffs: Array<{ path: string; oldText?: string; newText: string }> | undefined = (normalizedResult as any)?.diffs;
				if (diffs && diffs.length > 0) {
					for (const d of diffs) {
						try {
							const uri = _resolvePathWithWorkspace(String(d.path ?? ''), rootUri);
							await this._editCodeService.callBeforeApplyOrEdit(uri);
							await (this._editCodeService as any).previewEditFileSimple?.({
								uri,
								originalSnippet: d.oldText ?? '',
								updatedSnippet: d.newText,
								replaceAll: false,
								locationHint: undefined,
								encoding: null,
								newline: null,
								applyBoxId: undefined
							});
						} catch { /* noop */ }
					}
				}

				// cleanup per-call cache
				try { this._acpToolCallInfoByKey.delete(key); } catch { /* noop */ }

				return;
			}

			if (chunk.type === 'error' || chunk.type === 'done') {
				const info = access.getStreamState(threadId)?.llmInfo;
				if (info?.displayContentSoFar || info?.reasoningSoFar) {
					access.addMessageToThread(threadId, {
						role: 'assistant',
						displayContent: info.displayContentSoFar,
						reasoning: info.reasoningSoFar,
						anthropicReasoning: null
					});
				}

				if (chunk.type === 'done' && chunk.tokenUsageSnapshot) {
					access.accumulateTokenUsage(threadId, chunk.tokenUsageSnapshot);
				}

				if (chunk.type === 'error') {
					access.setStreamState(threadId, { isRunning: undefined, error: { message: chunk.error ?? 'ACP error', fullError: null } });
				} else {
					access.setStreamState(threadId, undefined);
				}
				finish();
				access.addUserCheckpoint(threadId);
				return;
			}
		};

		sub = stream.onData(onChunk);
		const entry = this._acpStreamByThread.get(threadId);
		if (entry) entry.sub = sub;
	}

	public clearAcpState(threadId: string) {
		try {
			const entry = this._acpStreamByThread.get(threadId);
			try { entry?.stream?.cancel?.(); } catch { /* noop */ }
			try { entry?.sub?.dispose?.(); } catch { /* noop */ }
		} finally {
			this._acpStreamByThread.delete(threadId);
			try {
				const prefix = `${threadId}:`;
				for (const k of Array.from(this._acpToolCallInfoByKey.keys())) {
					if (k.startsWith(prefix)) this._acpToolCallInfoByKey.delete(k);
				}
			} catch { /* noop */ }
		}
	}

	private _buildAcpHistory(threadId: string, access: IThreadStateAccess): IAcpChatMessage[] {
		const msgs = access.getThreadMessages(threadId);
		const upto = Math.max(0, msgs.length - 1);

		const history: IAcpChatMessage[] = [];
		for (let i = 0; i < upto; i++) {
			const m = msgs[i];
			if (m.role === 'user') {
				const dc = (m as any).displayContent;
				const c = (m as any).content;
				const display = typeof dc === 'string' ? dc : '';
				const fallback = typeof c === 'string' ? c : '';
				const content = (display && display.trim().length > 0) ? display : fallback;
				if (!content.trim()) continue;
				history.push({ role: 'user', content });
			} else if (m.role === 'assistant') {
				const content = (m as any).displayContent ?? '';
				if (!String(content).trim()) continue;
				history.push({ role: 'assistant', content: String(content) });
			}
		}
		return history;
	}
}
