
import { Emitter, Event } from '../../../base/common/event.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IAcpMessageChunk, IAcpSendOptions, IAcpChatMessage } from '../common/iAcpService.js';
import type { LLMTokenUsage } from '../../void/common/sendLLMMessageTypes.js';
import { IAcpMainServiceForChannel, AcpHostCallbackRequest, AcpHostCallbackResponse } from '../common/acpIpc.js';
import { ILogService } from '../../log/common/log.js';
import { sanitizeAcpSendOptionsForLog } from '../common/acpLogSanitizer.js'
import { homedir } from 'os';
import * as sdk from './vendor/acp-sdk.vendored.js';
import { WebSocket } from './vendor/ws.vendored.js';
import { spawn, ChildProcess } from 'child_process';
import type {
	SessionNotification,
	ContentBlock,
	ToolCallContent,
	PlanEntry,
	AvailableCommand,
	SessionModeId
} from '@agentclientprotocol/sdk';
import * as path from 'path';

type AcpSessionUpdateNotification = SessionNotification['update'] | {
	sessionUpdate: string;
	content?: ContentBlock | ToolCallContent[] | PlanEntry[] | AvailableCommand[] | SessionModeId;
};

type Stream = ConstructorParameters<typeof sdk.ClientSideConnection>[1];

export class AcpMainService implements IAcpMainServiceForChannel {

	constructor(
		@ILogService private readonly logService: ILogService
	) { }

	private conn: sdk.ClientSideConnection | null = null;
	private connected = false;
	private childProcess: ChildProcess | null = null;

	private lastConnectParams: {
		mode?: 'builtin' | 'websocket' | 'process';
		url?: string;
		command?: string;
		args?: string[];
		env?: Record<string, string>;
	} | undefined;

	private readonly onDataEmitterByRequest = new Map<string, Emitter<IAcpMessageChunk>>();

	// thread<->session
	private readonly threadBySession = new Map<string, string>();
	private readonly sessionByThread = new Map<string, string>();
	private readonly requestSessionByRequestId = new Map<string, string>();
	private readonly sessionCwdBySession = new Map<string, string>();

	// callbacks to renderer
	private readonly _onHostCallback = new Emitter<AcpHostCallbackRequest>();
	readonly onHostCallback = this._onHostCallback.event;

	// awaiting host callback result
	private readonly pendingHostCallbacks = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();

	// per-session streaming
	private readonly emitterBySession = new Map<string, Emitter<IAcpMessageChunk>>();
	private readonly tokenUsageBySession = new Map<string, LLMTokenUsage | undefined>();

	// tool normalization caches (UI-friendly, does NOT change ACP wire protocol)
	private readonly toolNameBySessionToolCallId = new Map<string, string>();
	private readonly toolKindBySessionToolCallId = new Map<string, string | undefined>();
	private readonly toolArgsBySessionToolCallId = new Map<string, Record<string, any>>();

	// terminal caches (UI-friendly)
	private readonly activeToolCallIdBySession = new Map<string, string>();
	private readonly lastTerminalIdBySession = new Map<string, string>();
	private readonly terminalInfoById = new Map<string, {
		sessionId?: string;
		/**
		 * Human-readable command line (for UI). We store the reconstructed line "cmd args..."
		 */
		command?: string;
		/**
		 * Structured argv (best-effort) from terminal/create args
		 */
		argv?: string[];
		/**
		 * CWD used for terminal/create (if provided)
		 */
		cwd?: string;
		output?: string;
		truncated?: boolean;
		exitCode?: number | null;
		signal?: string | null;
	}>();
	private readonly terminalIdsBySessionToolCall = new Map<string, string[]>();

	private readonly terminalPollBySessionToolCall = new Map<string, {
		terminalId: string;
		timer: NodeJS.Timeout;
		runningTick: boolean;
		lastLen: number;
		lastTail: string;
	}>();

	private _pollKey(sessionId: string, toolCallId: string): string {
		return `${sessionId}:${toolCallId}`;
	}

	private _stopTerminalPoll(sessionId: string, toolCallId: string): void {
		const key = this._pollKey(sessionId, toolCallId);
		const st = this.terminalPollBySessionToolCall.get(key);
		if (!st) return;
		try { clearInterval(st.timer); } catch { /* ignore */ }
		this.terminalPollBySessionToolCall.delete(key);
	}

	private _stopAllTerminalPollsForSession(sessionId: string): void {
		for (const k of Array.from(this.terminalPollBySessionToolCall.keys())) {
			if (k.startsWith(`${sessionId}:`)) {
				const st = this.terminalPollBySessionToolCall.get(k);
				if (st) {
					try { clearInterval(st.timer); } catch { /* ignore */ }
					this.terminalPollBySessionToolCall.delete(k);
				}
			}
		}
	}

	private _startTerminalPoll(sessionId: string, toolCallId: string, terminalId: string): void {
		if (!sessionId || !toolCallId || !terminalId) return;

		// IMPORTANT:
		// In builtin mode the builtin ACP agent already streams terminal output via tool_call_update.
		// Polling terminalOutput here is redundant and can cause duplicate/empty progress updates that
		// overwrite UI with "(waiting for output...)".
		if (this.lastConnectParams?.mode === 'builtin') {
			this._logJson('terminalPoll SKIP (builtin mode)', { sessionId, toolCallId, terminalId });
			return;
		}

		const emitter = this.emitterBySession.get(sessionId);
		if (!emitter) return;

		const key = this._pollKey(sessionId, toolCallId);
		const existing = this.terminalPollBySessionToolCall.get(key);

		// already polling same terminal -> no-op
		if (existing && existing.terminalId === terminalId) return;

		// terminal changed -> restart
		if (existing) this._stopTerminalPoll(sessionId, toolCallId);

		this._logJson('terminalPoll START', { sessionId, toolCallId, terminalId });

		const pollState = {
			terminalId,
			runningTick: false,
			lastLen: -1,
			lastTail: '',
			timer: setInterval(async () => {
				const st = this.terminalPollBySessionToolCall.get(key);
				if (!st) return;
				if (st.runningTick) return;
				st.runningTick = true;

				try {
					const resp = await this._hostRequest('terminalOutput', { sessionId, terminalId });

					const output = typeof resp?.output === 'string' ? resp.output : '';
					const truncated = !!resp?.truncated;
					const exitStatus = resp?.exitStatus;

					const isDone =
						!!exitStatus && (
							typeof exitStatus.exitCode === 'number' || exitStatus.exitCode === null ||
							typeof exitStatus.signal === 'string' || exitStatus.signal === null
						);

					// CRITICAL: never emit empty output while still running.
					// This prevents UI from being overwritten with empty content.
					if (!isDone && output.length === 0) {
						this._logJson('terminalPoll TICK skip empty', { sessionId, toolCallId, terminalId });
						return;
					}

					const tail = output.slice(-256);

					// de-spam identical output
					if (output.length === st.lastLen && tail === st.lastTail) {
						if (isDone) {
							this._logJson('terminalPoll STOP (done + no changes)', { sessionId, toolCallId, terminalId });
							this._stopTerminalPoll(sessionId, toolCallId);
						}
						return;
					}

					st.lastLen = output.length;
					st.lastTail = tail;

					this._logJson('terminalPoll EMIT tool_progress', {
						sessionId,
						toolCallId,
						terminalId,
						outputLen: output.length,
						truncated,
						isDone
					});

					emitter.fire({
						type: 'tool_progress',
						toolProgress: {
							id: toolCallId,
							name: 'run_command',
							terminalId,
							output,
							truncated,
							...(exitStatus ? { exitStatus } : {})
						}
					});

					if (isDone) {
						this._logJson('terminalPoll STOP (done)', { sessionId, toolCallId, terminalId });
						this._stopTerminalPoll(sessionId, toolCallId);
					}
				} catch (e: any) {
					// ignore transient errors; keep polling
					this._logJson('terminalPoll TICK error (ignored)', {
						sessionId,
						toolCallId,
						terminalId,
						error: e?.message ?? String(e)
					});
				} finally {
					const st2 = this.terminalPollBySessionToolCall.get(key);
					if (st2) st2.runningTick = false;
				}
			}, 350)
		};

		this.terminalPollBySessionToolCall.set(key, pollState);
	}

	private _safeStringify(v: any, maxLen = 50_000): string {
		try {
			const s = JSON.stringify(v, null, 2);
			return s.length > maxLen ? (s.slice(0, maxLen) + '\n…(truncated)') : s;
		} catch {
			try {
				const s = String(v);
				return s.length > maxLen ? (s.slice(0, maxLen) + '\n…(truncated)') : s;
			} catch {
				return '<unstringifiable>';
			}
		}
	}

	private _logJson(label: string, payload: any) {
		this.logService.debug(`[ACP Main] ${label}: ${this._safeStringify(payload)}`);
	}

	private _toSessionId(v: any): string | undefined {
		if (v === undefined || v === null) return undefined;
		const s = String(v);
		return s.length ? s : undefined;
	}

	private getDefaultCwd(): string {
		this.logService.debug(`[ACP Main] getDefaultCwd: ${process.cwd()}`);
		try { return process.cwd(); } catch { }
		try { return homedir(); } catch { }
		return '/';
	}

	private _hasActiveRequestForSession(sessionId: string): boolean {
		for (const [, sid] of this.requestSessionByRequestId) {
			if (sid === sessionId) return true;
		}
		return false;
	}

	private _toolKey(sessionId: string, toolCallId: string): string {
		return `${sessionId}:${toolCallId}`;
	}

	private _buildCommandLine(command: unknown, args: unknown): string | undefined {
		const cmd = typeof command === 'string' ? command.trim() : '';
		if (!cmd) return undefined;
		const arr = Array.isArray(args) ? args.map(a => String(a ?? '')).filter(Boolean) : [];
		return arr.length ? `${cmd} ${arr.join(' ')}` : cmd;
	}

	private _asObject(v: any): Record<string, any> | null {
		return (v && typeof v === 'object' && !Array.isArray(v)) ? v as any : null;
	}

	private _resolvePathForSession(sessionId: string, p: unknown): string {
		const s = String(p ?? '').trim();
		if (!s) return '';

		const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) && !/^[A-Za-z]:[\\/]/.test(s);
		if (hasScheme) return s;

		if (path.isAbsolute(s)) return s;

		const base = this.sessionCwdBySession.get(sessionId) || this.getDefaultCwd();
		return path.resolve(base, s);
	}

	private _addTerminalIdForToolCall(sessionId: string, toolCallId: string, terminalId: string) {
		if (!sessionId || !toolCallId || !terminalId) return;
		const key = this._toolKey(sessionId, toolCallId);
		const prev = this.terminalIdsBySessionToolCall.get(key) ?? [];
		if (!prev.includes(terminalId)) {
			this.terminalIdsBySessionToolCall.set(key, [...prev, terminalId]);
		}
	}

	private _getTerminalIdForToolCall(sessionId: string, toolCallId: string): string | undefined {
		const key = this._toolKey(sessionId, toolCallId);
		const arr = this.terminalIdsBySessionToolCall.get(key);
		return arr && arr.length ? arr[arr.length - 1] : undefined;
	}

	private _isValidDiffItem(item: any): item is { path: string; oldText?: string; newText: string } {
		return !!item
			&& typeof item.path === 'string'
			&& item.path.trim().length > 0
			&& typeof item.newText === 'string';
	}

	private _canonicalToolName(args: {
		kind?: string;
		hasDiff?: boolean;
		hasTerminal?: boolean;
		rawName?: string;
		title?: string;
	}): string {
		const kind = (args.kind ?? '').toLowerCase();
		if (kind === 'edit' || args.hasDiff) return 'edit_file';
		if (kind === 'execute' || args.hasTerminal) return 'run_command';
		if (kind === 'read') return 'read_file';

		const raw = String(args.rawName ?? '').trim();
		if (raw) return raw;

		const t = String(args.title ?? '').trim();
		if (t) return t;

		return 'tool';
	}

	private _hostRequest(kind: AcpHostCallbackRequest['kind'], params: any): Promise<any> {
		const requestId = generateUuid();

		const promise = new Promise((resolve, reject) => {
			this.pendingHostCallbacks.set(requestId, { resolve, reject });
		});

		const sid = this._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
		const threadId = sid ? this.threadBySession.get(sid) : params?.threadId;

		this._onHostCallback.fire({ requestId, kind, params, sessionId: sid, threadId });
		return promise;
	}

	private async _captureTerminalOutputIntoCache(sessionId: string | undefined, terminalId: string | undefined): Promise<void> {
		if (!sessionId || !terminalId) return;

		try {
			this._logJson('capture terminal/output -> hostRequest', { sessionId, terminalId });

			const resp = await this._hostRequest('terminalOutput', { sessionId, terminalId });

			const nextOutput = typeof resp?.output === 'string' ? resp.output : '';
			const nextTruncated = !!resp?.truncated;

			const exitStatus = resp?.exitStatus;
			const exitCode = (typeof exitStatus?.exitCode === 'number' || exitStatus?.exitCode === null) ? exitStatus.exitCode : undefined;
			const signal = (typeof exitStatus?.signal === 'string' || exitStatus?.signal === null) ? exitStatus.signal : undefined;

			const prev = this.terminalInfoById.get(terminalId) ?? {};
			const prevOutput = typeof prev.output === 'string' ? prev.output : '';

			// IMPORTANT: keep the longest output we have ever seen for this terminalId
			const mergedOutput = nextOutput.length >= prevOutput.length ? nextOutput : prevOutput;

			this.terminalInfoById.set(terminalId, {
				...prev,
				sessionId,
				output: mergedOutput,
				truncated: (typeof prev.truncated === 'boolean' ? prev.truncated : false) || nextTruncated,
				...(exitCode !== undefined ? { exitCode } : {}),
				...(signal !== undefined ? { signal } : {})
			});

			this._logJson('capture terminal/output -> cached', {
				sessionId,
				terminalId,
				outputLen: mergedOutput.length,
				truncated: ((typeof prev.truncated === 'boolean' ? prev.truncated : false) || nextTruncated),
				exitCode: exitCode ?? null,
				signal: signal ?? null
			});
		} catch (e: any) {
			this._logJson('capture terminal/output FAILED', {
				sessionId,
				terminalId,
				error: e?.message ?? String(e)
			});
		}
	}

	// -------------------------
	// public
	// -------------------------
	isConnected(): boolean { return this.connected; }

	async connect(opts?: IAcpSendOptions): Promise<void> {
		this.logService.debug('[ACP Main] connect(opts):', sanitizeAcpSendOptionsForLog(opts));
		const mode = opts?.mode || 'builtin';

		if (this.connected && this.conn && this.lastConnectParams && this.lastConnectParams.mode === mode) {
			if (mode === 'websocket' || mode === 'builtin') {
				const targetUrl = mode === 'builtin' ? 'ws://127.0.0.1:8719' : (opts?.agentUrl || '');
				const url = targetUrl.trim().replace(/^http(s?):/, 'ws$1:');
				if (this.lastConnectParams.url === url) return;
			} else {
				const cmd = (opts?.command || '').trim();
				const args = opts?.args || [];
				const env = opts?.env;
				const isSame = cmd === this.lastConnectParams.command &&
					JSON.stringify(args) === JSON.stringify(this.lastConnectParams.args) &&
					JSON.stringify(env) === JSON.stringify(this.lastConnectParams.env);

				if (isSame && this.childProcess && !this.childProcess.killed) return;
			}
		}

		if (this.connected) await this.disconnect();

		let stream: Stream;

		if (mode === 'process') {
			const cmd = (opts?.command || '').trim();
			if (!cmd) throw new Error('ACP: command is required for process mode');
			const args = opts?.args || [];
			const env = { ...process.env, ...opts?.env };

			this.logService.debug(` Spawning process: ${cmd} ${args.join(' ')}`);

			const cp = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
			this.childProcess = cp;

			const disconnectIfStillCurrent = () => {
				if (this.childProcess !== cp) return;
				this.disconnect().catch(() => { });
			};

			cp.on('error', (err) => {
				this.logService.error('[ACP Main] Process error:', err);
				disconnectIfStillCurrent();
			});

			cp.on('exit', (code, signal) => {
				this.logService.debug(`[ACP Main] Process exited with code ${code} signal ${signal}`);
				disconnectIfStillCurrent();
			});

			if (!cp.stdin || !cp.stdout) {
				throw new Error('Failed to open stdio pipes for ACP process');
			}

			cp.stderr?.on('data', (data) => {
				const str = data.toString();
				this.logService.warn('[ACP Agent Stderr]:', str);
			});

			stream = this._stdioStream(cp.stdin, cp.stdout);
			this.lastConnectParams = { mode: 'process', command: cmd, args, env: opts?.env };
		} else {
			let urlFromOpts = '';
			if (mode === 'builtin') urlFromOpts = 'ws://127.0.0.1:8719';
			else {
				urlFromOpts = (opts?.agentUrl || '').trim();
				if (!urlFromOpts) throw new Error('ACP: agentUrl is required');
			}
			const wsUrl = urlFromOpts.replace(/^http(s?):/, 'ws$1:');

			stream = await this._wsNdjsonStream(wsUrl);
			this.lastConnectParams = { mode: mode as 'builtin' | 'websocket', url: wsUrl };
		}

		this.conn = new sdk.ClientSideConnection((_agent) => {
			const service = this;

			const client: sdk.Client = {

				async requestPermission(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const threadId = sid ? service.threadBySession.get(sid) : undefined;
					return service._hostRequest('requestPermission', { ...params, sessionId: sid, threadId });
				},

				async createTerminal(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const threadId = sid ? service.threadBySession.get(sid) : undefined;
					const acpMode = service.lastConnectParams?.mode ?? 'builtin';

					if (sid && typeof params?.cwd === 'string' && params.cwd) {
						service.sessionCwdBySession.set(sid, String(params.cwd));
						service._logJson('createTerminal updated session cwd', { sessionId: sid, cwd: String(params.cwd) });
					}

					service._logJson('client.createTerminal called', {
						sessionId: sid,
						threadId,
						command: params?.command,
						args: params?.args,
						cwd: params?.cwd,
						outputByteLimit: params?.outputByteLimit
					});

					const cmdLine = service._buildCommandLine(params?.command, params?.args);

					// -------------------------
					// DEDUP across retries:
					// If agent retries tool with a new toolCallId, but is actually trying to run the same command,
					// reuse the last running terminalId for this session.
					// -------------------------
					if (sid && !((typeof params?.terminalId === 'string') && params.terminalId.trim().length > 0) && cmdLine) {
						const lastTid = service.lastTerminalIdBySession.get(sid);
						if (lastTid) {
							const info = service.terminalInfoById.get(lastTid);
							const isDone = !!info && (info.exitCode !== undefined || info.signal !== undefined);
							if (!isDone && info?.command === cmdLine) {
								const activeToolCallId = service.activeToolCallIdBySession.get(sid);
								if (activeToolCallId) {
									service._addTerminalIdForToolCall(sid, activeToolCallId, lastTid);
									service._startTerminalPoll(sid, activeToolCallId, lastTid);
								}
								service._logJson('client.createTerminal DEDUP (session-level): reuse last running terminal', {
									sessionId: sid,
									terminalId: lastTid,
									commandLine: cmdLine
								});
								return { terminalId: lastTid };
							}
						}
					}

					// Existing per-toolCall dedup (fix isDone logic)
					if (sid) {
						const activeToolCallId = service.activeToolCallIdBySession.get(sid);
						const explicitTerminalId = (typeof params?.terminalId === 'string' && params.terminalId.trim().length > 0);

						if (!explicitTerminalId && activeToolCallId) {
							const existing = service._getTerminalIdForToolCall(sid, activeToolCallId);
							if (existing) {
								const info = service.terminalInfoById.get(existing);
								const isDone = !!info && (info.exitCode !== undefined || info.signal !== undefined);
								if (!isDone) {
									service._logJson('client.createTerminal DEDUP: reuse existing terminal', {
										sessionId: sid,
										toolCallId: activeToolCallId,
										terminalId: existing
									});
									return { terminalId: existing };
								}
							}
						}
					}

					const resp = await service._hostRequest('createTerminal', { ...params, sessionId: sid, threadId, acpMode });
					const terminalId = String(resp?.terminalId ?? '');

					if (sid && terminalId) {
						service.lastTerminalIdBySession.set(sid, terminalId);

						const argv = Array.isArray(params?.args)
							? params.args.map((a: any) => String(a ?? ''))
							: undefined;

						const cwd = (typeof params?.cwd === 'string' && params.cwd.trim().length)
							? String(params.cwd)
							: undefined;

						const prev = service.terminalInfoById.get(terminalId) ?? {};
						service.terminalInfoById.set(terminalId, {
							...prev,
							sessionId: sid,
							command: cmdLine ?? prev.command,
							argv: argv ?? prev.argv,
							cwd: cwd ?? prev.cwd
						});

						const activeToolCallId = service.activeToolCallIdBySession.get(sid);
						if (activeToolCallId) {
							service._addTerminalIdForToolCall(sid, activeToolCallId, terminalId);

							const k = service._toolKey(sid, activeToolCallId);
							const prevName = service.toolNameBySessionToolCallId.get(k);
							if (!prevName || prevName === 'tool') service.toolNameBySessionToolCallId.set(k, 'run_command');

							const prevArgs = service.toolArgsBySessionToolCallId.get(k) ?? {};
							service.toolArgsBySessionToolCallId.set(k, {
								...prevArgs,
								commandLine: (cmdLine ?? prevArgs.commandLine),
								command: (typeof prevArgs.command === 'string' ? prevArgs.command : (cmdLine ?? prevArgs.command)),
								args: (Array.isArray(prevArgs.args) ? prevArgs.args : (argv ?? prevArgs.args)),
								cwd: (typeof prevArgs.cwd === 'string' ? prevArgs.cwd : (cwd ?? prevArgs.cwd))
							});

							service._logJson('createTerminal bound to active toolCallId', {
								sessionId: sid,
								toolCallId: activeToolCallId,
								terminalId
							});
							service._startTerminalPoll(sid, activeToolCallId, terminalId);
						}
					}

					return { terminalId };
				},

				// terminal/output (SPEC): returns { output, truncated, exitStatus? }
				async terminalOutput(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const threadId = sid ? service.threadBySession.get(sid) : undefined;
					const acpMode = service.lastConnectParams?.mode ?? 'builtin';

					const terminalId = String(params?.terminalId ?? '');
					const resp = await service._hostRequest('terminalOutput', { ...params, sessionId: sid, threadId, acpMode });

					if (sid && terminalId) {
						service.lastTerminalIdBySession.set(sid, terminalId);
						const prev = service.terminalInfoById.get(terminalId) ?? {};
						service.terminalInfoById.set(terminalId, {
							...prev,
							sessionId: sid,
							output: typeof resp?.output === 'string' ? resp.output : prev.output,
							truncated: typeof resp?.truncated === 'boolean' ? resp.truncated : prev.truncated,
							exitCode: (typeof resp?.exitStatus?.exitCode === 'number' || resp?.exitStatus?.exitCode === null) ? resp.exitStatus.exitCode : prev.exitCode,
							signal: (typeof resp?.exitStatus?.signal === 'string' || resp?.exitStatus?.signal === null) ? resp.exitStatus.signal : prev.signal,
						});
					}

					return {
						output: typeof resp?.output === 'string' ? resp.output : '',
						truncated: !!resp?.truncated,
						...(resp?.exitStatus ? { exitStatus: resp.exitStatus } : {})
					};
				},

				// terminal/wait_for_exit (SPEC): returns { exitCode, signal }
				async waitForTerminalExit(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const threadId = sid ? service.threadBySession.get(sid) : undefined;
					const acpMode = service.lastConnectParams?.mode ?? 'builtin';
					const terminalId = String(params?.terminalId ?? '');

					const resp = await service._hostRequest('waitForTerminalExit', { ...params, sessionId: sid, threadId, acpMode });

					// capture output best-effort (does not create files now; renderer decides finalization)
					await service._captureTerminalOutputIntoCache(sid, terminalId);

					if (sid && terminalId) {
						service.lastTerminalIdBySession.set(sid, terminalId);
						const prev = service.terminalInfoById.get(terminalId) ?? {};
						service.terminalInfoById.set(terminalId, {
							...prev,
							sessionId: sid,
							exitCode: (typeof resp?.exitCode === 'number' || resp?.exitCode === null) ? resp.exitCode : prev.exitCode,
							signal: (typeof resp?.signal === 'string' || resp?.signal === null) ? resp.signal : prev.signal,
						});
					}

					return {
						exitCode: (typeof resp?.exitCode === 'number' || resp?.exitCode === null) ? resp.exitCode : null,
						signal: (typeof resp?.signal === 'string' || resp?.signal === null) ? resp.signal : null,
						// extras harmless
						...(typeof resp?.isRunning === 'boolean' ? { isRunning: resp.isRunning } : {})
					};
				},

				async killTerminal(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const threadId = sid ? service.threadBySession.get(sid) : undefined;
					const acpMode = service.lastConnectParams?.mode ?? 'builtin';
					return service._hostRequest('killTerminal', { ...params, sessionId: sid, threadId, acpMode });
				},

				async releaseTerminal(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const threadId = sid ? service.threadBySession.get(sid) : undefined;
					const acpMode = service.lastConnectParams?.mode ?? 'builtin';
					const terminalId = String(params?.terminalId ?? '');

					await service._captureTerminalOutputIntoCache(sid, terminalId);

					await service._hostRequest('releaseTerminal', { ...params, sessionId: sid, threadId, acpMode });
					return null;
				},

				async readTextFile(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const p = params?.path ?? params?.uri;
					if (sid && typeof p === 'string' && path.isAbsolute(p)) {
						service._maybeUpdateSessionCwdFromAbsolutePath(sid, p);
					}
					return service._hostRequest('readTextFile', params);
				},

				async writeTextFile(params: any): Promise<any> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id);
					const p = params?.path ?? params?.uri;
					if (sid && typeof p === 'string' && path.isAbsolute(p)) {
						service._maybeUpdateSessionCwdFromAbsolutePath(sid, p);
					}
					return service._hostRequest('writeTextFile', params);
				},

				async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
					// extMethod may be called during newSession BEFORE thread<->session mapping exists,
					// so we must forward routing hints to renderer.
					const pAny: any = params as any;

					const threadId =
						(typeof pAny?.threadId === 'string' && pAny.threadId.trim())
							? String(pAny.threadId).trim()
							: undefined;

					const sessionId =
						(typeof pAny?.sessionId === 'string' && pAny.sessionId.trim())
							? String(pAny.sessionId).trim()
							: undefined;

					return service._hostRequest('extMethod', {
						method,
						params,
						...(threadId ? { threadId } : {}),
						...(sessionId ? { sessionId } : {}),
					});
				},

				async sessionUpdate(params: any): Promise<void> {
					const sid = service._toSessionId(params?.sessionId ?? params?.session_id ?? params?.session?.id ?? params?.session?.sessionId);
					if (!sid) return;

					const emitter = service.emitterBySession.get(sid);
					if (!emitter) return;

					const update = (params && typeof params === 'object' && 'update' in params) ? (params as any).update : params;

					try {
						service._emitChunksFromSessionUpdate(emitter, update, sid);
					} catch (err: any) {
						emitter.fire({ type: 'error', error: err?.message ?? String(err) });
					}
				}
			};

			return client;
		}, stream);

		this.connected = true;

		try {
			await this.conn.initialize({
				protocolVersion: 1,
				clientInfo: { name: 'Void', version: 'dev' },
				clientCapabilities: {
					fs: { readTextFile: true, writeTextFile: true },
					terminal: true
				}
			} as any);
		} catch (e) {
			this.logService.error('ACP initialize failed', e);
			try { await this.disconnect(); } catch { /* ignore */ }
			throw e;
		}
	}

	async disconnect(): Promise<void> {
		this.conn = null;
		this.connected = false;
		this.lastConnectParams = undefined;

		if (this.childProcess) {
			if (!this.childProcess.killed) {
				try { this.childProcess.kill(); } catch { }
			}
			this.childProcess = null;
		}

		for (const [, em] of this.emitterBySession) em.dispose();
		this.emitterBySession.clear();

		for (const [, em] of this.onDataEmitterByRequest) em.dispose?.();
		this.onDataEmitterByRequest.clear();

		for (const [, p] of this.pendingHostCallbacks) p.reject(new Error('Disconnected'));
		this.pendingHostCallbacks.clear();

		this.requestSessionByRequestId.clear();
		this.sessionByThread.clear();
		this.threadBySession.clear();
		this.sessionCwdBySession.clear();

		this.tokenUsageBySession.clear();

		this.toolNameBySessionToolCallId.clear();
		this.toolKindBySessionToolCallId.clear();
		this.toolArgsBySessionToolCallId.clear();

		this.activeToolCallIdBySession.clear();
		this.lastTerminalIdBySession.clear();
		this.terminalInfoById.clear();
		this.terminalIdsBySessionToolCall.clear();
		for (const [, st] of this.terminalPollBySessionToolCall) {
			try { clearInterval(st.timer); } catch { /* ignore */ }
		}
		this.terminalPollBySessionToolCall.clear();
	}

	async sendChatMessage(args: { threadId: string; history: IAcpChatMessage[]; message: IAcpChatMessage; opts?: IAcpSendOptions; }): Promise<string> {
		this.logService.debug('[ACP Main] sendChatMessage called with args:', JSON.stringify({
			threadId: args.threadId,
			hasHistory: args.history.length > 0,
			message: args.message,
			opts: sanitizeAcpSendOptionsForLog(args.opts),
		}, null, 2));

		await this.connect(args.opts);
		if (!this.conn) throw new Error('ACP not connected');

		let sessionId = this.sessionByThread.get(args.threadId);

		if (!sessionId) {
			const sessionParams: any = {
				cwd: this.getDefaultCwd(),
				mcpServers: [],
				// IMPORTANT: threadId must be present so builtin agent can route extMethod during newSession.
				_meta: { history: args.history, threadId: args.threadId }
			};

			if (args?.opts?.system) {
				sessionParams.systemPrompt = args.opts.system;
			}

			const resp = await this.conn.newSession(sessionParams as any);

			const sidRaw = (resp as any)?.sessionId ?? (resp as any)?.session_id;
			const sid = this._toSessionId(sidRaw);
			if (!sid) throw new Error('ACP: agent did not return sessionId');

			sessionId = sid;
			this.sessionByThread.set(args.threadId, sessionId);
			this.threadBySession.set(sessionId, args.threadId);

			if (typeof sessionParams?.cwd === 'string' && sessionParams.cwd) {
				this.sessionCwdBySession.set(sessionId, sessionParams.cwd);
				this._logJson('newSession stored cwd', { sessionId, cwd: sessionParams.cwd });
			}
		}

		let emitter = this.emitterBySession.get(sessionId);
		if (!emitter) {
			emitter = new Emitter<IAcpMessageChunk>();
			this.emitterBySession.set(sessionId, emitter);
		}

		const requestId = generateUuid();
		this.onDataEmitterByRequest.set(requestId, emitter);
		this.requestSessionByRequestId.set(requestId, sessionId);

		let prompt: any[];
		const msgAny: any = args.message as any;
		if (Array.isArray(msgAny.contentBlocks) && msgAny.contentBlocks.length) {
			prompt = msgAny.contentBlocks;
		} else {
			prompt = [{ type: 'text', text: args.message.content }];
		}

		if (args?.opts?.model && this.conn.setSessionModel) {
			try {
				await this.conn.setSessionModel({ sessionId, modelId: args.opts.model } as any);
			} catch {
				try {
					await this.conn.setSessionModel({ sessionId, model: args.opts.model } as any);
				} catch { /* ignore */ }
			}
		}

		const parsePositiveInt = (v: unknown): number | undefined => {
			const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
			return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
		};

		const promptMaxToolOutputLength = parsePositiveInt(args?.opts?.maxToolOutputLength);
		const promptReadFileChunkLines = parsePositiveInt(args?.opts?.readFileChunkLines);

		// IMPORTANT: attach threadId and truncation knobs to prompt _meta for builtin ACP agent.
		const promptMeta: Record<string, unknown> = { threadId: args.threadId };
		if (promptMaxToolOutputLength !== undefined) promptMeta.maxToolOutputLength = promptMaxToolOutputLength;
		if (promptReadFileChunkLines !== undefined) promptMeta.readFileChunkLines = promptReadFileChunkLines;
		if (promptMaxToolOutputLength !== undefined || promptReadFileChunkLines !== undefined) {
			promptMeta.globalSettings = {
				...(promptMaxToolOutputLength !== undefined ? { maxToolOutputLength: promptMaxToolOutputLength } : {}),
				...(promptReadFileChunkLines !== undefined ? { readFileChunkLines: promptReadFileChunkLines } : {}),
			};
		}

		this.conn.prompt({ sessionId, prompt, _meta: promptMeta } as any)
			.then((resp: any) => {
				const usageFromMeta: LLMTokenUsage | undefined = resp?._meta?.llmTokenUsage;
				const usageFromSession = this.tokenUsageBySession.get(sessionId);
				const usage = usageFromMeta ?? usageFromSession;
				this.tokenUsageBySession.delete(sessionId);
				emitter?.fire({ type: 'done', ...(usage ? { tokenUsageSnapshot: usage } : {}) });
			})
			.catch((err: any) => {
				const baseMsg = typeof err?.message === 'string' ? err.message : String(err);
				const details = typeof err?.data?.details === 'string' ? err.data.details
					: (typeof err?.details === 'string' ? err.details : '');
				const combined = details && !baseMsg.includes(details)
					? `${baseMsg}: ${details}`
					: baseMsg;

				const usage = this.tokenUsageBySession.get(sessionId);
				this.tokenUsageBySession.delete(sessionId);

				emitter?.fire({ type: 'error', error: combined });
				emitter?.fire({ type: 'done', ...(usage ? { tokenUsageSnapshot: usage } : {}) });
			})
			.finally(() => {
				this.onDataEmitterByRequest.delete(requestId);
				this.requestSessionByRequestId.delete(requestId);
			});

		return requestId;
	}

	async cancel({ requestId }: { requestId: string }): Promise<void> {
		this.logService.debug('[ACP Main] cancel(requestId):', requestId);

		const sid = this._toSessionId(this.requestSessionByRequestId.get(requestId));

		try {
			if (sid) {
				await this.conn?.cancel({ sessionId: sid } as any);
			}
		} catch { /* ignore */ }

		// This makes "Skip/Abort" actually stop long-running commands even if the agent doesn't.
		if (sid) {
			const terminalIdsToKill = new Set<string>();

			const activeToolCallId = this.activeToolCallIdBySession.get(sid);
			if (activeToolCallId) {
				const tid = this._getTerminalIdForToolCall(sid, activeToolCallId);
				if (tid) terminalIdsToKill.add(tid);
			}

			const lastTid = this.lastTerminalIdBySession.get(sid);
			if (lastTid) terminalIdsToKill.add(lastTid);

			for (const terminalId of terminalIdsToKill) {
				try { await this._hostRequest('killTerminal', { sessionId: sid, terminalId }); } catch { /* ignore */ }
				try { await this._hostRequest('releaseTerminal', { sessionId: sid, terminalId }); } catch { /* ignore */ }

				// update cache for UI (best-effort)
				const prev = this.terminalInfoById.get(terminalId) ?? {};
				this.terminalInfoById.set(terminalId, {
					...prev,
					exitCode: (typeof prev.exitCode === 'number' || prev.exitCode === null) ? prev.exitCode : null,
					signal: (typeof prev.signal === 'string' || prev.signal === null) ? prev.signal : 'SIGTERM'
				});
			}
			this._stopAllTerminalPollsForSession(sid);
		}

		const em = this.onDataEmitterByRequest.get(requestId);
		if (em) {
			const usage = sid ? this.tokenUsageBySession.get(sid) : undefined;
			if (sid) this.tokenUsageBySession.delete(sid);
			em.fire({ type: 'done', ...(usage ? { tokenUsageSnapshot: usage } : {}) });
		}

		this.requestSessionByRequestId.delete(requestId);
		this.onDataEmitterByRequest.delete(requestId);

		if (sid && !this._hasActiveRequestForSession(sid)) {
			const threadId = this.threadBySession.get(sid);
			this.emitterBySession.get(sid)?.dispose();
			this.emitterBySession.delete(sid);
			if (threadId) {
				this.sessionByThread.delete(threadId);
				this.threadBySession.delete(sid);
			}
		}
	}

	onData(requestId: string): Event<IAcpMessageChunk> {
		let em = this.onDataEmitterByRequest.get(requestId);
		if (!em) {
			em = new Emitter<IAcpMessageChunk>();
			this.onDataEmitterByRequest.set(requestId, em);
		}
		return em.event;
	}

	private async _wsNdjsonStream(url: string): Promise<Stream> {
		const ws = new WebSocket(url);

		await new Promise<void>((resolve, reject) => {
			ws.once('open', () => resolve());
			ws.once('error', (e) => reject(e));
		});

		const readable = new ReadableStream<Uint8Array>({
			start(controller) {
				ws.on('message', (data) => {
					try {
						if (typeof data === 'string') controller.enqueue(new TextEncoder().encode(data));
						else if (data instanceof Buffer) controller.enqueue(new Uint8Array(data));
						else if (data instanceof ArrayBuffer) controller.enqueue(new Uint8Array(data));
						else if (Array.isArray(data)) controller.enqueue(new Uint8Array(Buffer.concat(data)));
					} catch (e) {
						controller.error(e);
					}
				});
				ws.on('close', () => controller.close());
				ws.on('error', (e) => controller.error(e));
			}
		});

		const writable = new WritableStream<Uint8Array>({
			write(chunk) { ws.send(Buffer.from(chunk)); },
			close() { try { ws.close(); } catch { } },
			abort() { try { ws.close(); } catch { } },
		});

		return sdk.ndJsonStream(writable, readable);
	}

	private _stdioStream(stdin: import('stream').Writable, stdout: import('stream').Readable): Stream {
		const readable = new ReadableStream<Uint8Array>({
			start(controller) {
				stdout.on('data', (chunk: Buffer) => {
					try {
						controller.enqueue(new Uint8Array(chunk));
					} catch (e) {
						controller.error(e);
					}
				});
				stdout.on('error', (err) => controller.error(err));
				stdout.on('end', () => controller.close());
			}
		});

		const writable = new WritableStream<Uint8Array>({
			write(chunk) {
				if (!stdin.writable) return;
				stdin.write(chunk);
			},
			close() { try { stdin.end(); } catch { } },
			abort() { try { stdin.destroy(); } catch { } },
		});

		return sdk.ndJsonStream(writable, readable);
	}

	private _maybeUpdateSessionCwdFromAbsolutePath(sessionId: string, absPath: string) {
		const p = String(absPath ?? '');
		if (!sessionId || !p || !path.isAbsolute(p)) return;

		// heuristic: infer workspace root by cutting before "/src/" or "/.void/"
		const norm = p.replace(/\\/g, '/');
		let root: string | undefined;

		const idxSrc = norm.indexOf('/src/');
		if (idxSrc > 0) root = norm.slice(0, idxSrc);

		const idxVoid = norm.indexOf('/.void/');
		if (!root && idxVoid > 0) root = norm.slice(0, idxVoid);

		if (root && root.trim()) {
			this.sessionCwdBySession.set(sessionId, root);
			this._logJson('inferred session cwd from fs path', { sessionId, cwd: root, from: absPath });
		}
	}

	private _emitChunksFromSessionUpdate(emitter: Emitter<IAcpMessageChunk>, notif: AcpSessionUpdateNotification, sessionId?: string) {
		if (sessionId && !this._hasActiveRequestForSession(sessionId)) return;

		const u: any = notif as any;
		if (!u) return;

		const emitText = (text?: string) => {
			if (typeof text === 'string') emitter.fire({ type: 'text', text });
		};

		if (u.sessionUpdate === 'agent_message_chunk' && typeof u.content === 'object' && u.content && 'type' in u.content) {
			if ((u.content as any).type === 'text') emitText((u.content as any).text);
			return;
		}

		if (u.sessionUpdate === 'llm_usage_snapshot' && sessionId) {
			const usage: LLMTokenUsage | undefined = (u as any).usage;
			if (usage) this.tokenUsageBySession.set(sessionId, usage);
			return;
		}

		if (u.sessionUpdate === 'agent_thought_chunk') {
			if (typeof u.content === 'object' && u.content && 'type' in u.content && (u.content as any).type === 'text') {
				emitter.fire({ type: 'reasoning', reasoning: (u.content as any).text });
			}
			return;
		}

		if ((u.sessionUpdate === 'plan' || u.sessionUpdate === 'todo' || u.sessionUpdate === 'todos')
			&& Array.isArray((u as any).entries)) {

			const items = (u as any).entries.map((entry: PlanEntry, i: number) => {
				const rawStatus = (entry as any)?.status;
				const st = typeof rawStatus === 'string' ? rawStatus : '';

				const state: 'pending' | 'running' | 'done' | 'error' =
					st === 'in_progress' ? 'running'
						: st === 'completed' ? 'done'
							: st === 'failed' ? 'error'
								: 'pending';

				return {
					id: String(i),
					text: String((entry as any)?.content ?? ''),
					state,
				};
			});

			emitter.fire({ type: 'plan', plan: { items } });
			return;
		}

		// -------------------------
		// tool_call
		// -------------------------
		if (u.sessionUpdate === 'tool_call') {
			const sid = sessionId;
			const toolCallId = String(u?.toolCallId ?? '');
			const kind = typeof u?.kind === 'string' ? String(u.kind) : undefined;
			const title = typeof u?.title === 'string' ? String(u.title) : undefined;

			const contentAny = Array.isArray(u?.content) ? u.content : undefined;
			const hasTerminal = !!contentAny?.some((it: any) => it?.type === 'terminal' && typeof it?.terminalId === 'string' && it.terminalId);
			const hasDiff = !!contentAny?.some((it: any) => it?.type === 'diff' && typeof it?.path === 'string' && it.path && typeof it?.newText === 'string');

			const rawInAny = u?.rawInput;
			const rawInObj: Record<string, unknown> | undefined =
				(rawInAny && typeof rawInAny === 'object' && !Array.isArray(rawInAny)) ? rawInAny : undefined;

			const rawName = typeof (rawInObj as any)?.name === 'string' ? String((rawInObj as any).name) : undefined;

			const canonicalName = this._canonicalToolName({ kind, hasDiff, hasTerminal, rawName, title });

			// args: prefer rawInput.args, fallback rawInput object
			let argsCandidate: unknown = undefined;
			if (rawInObj) argsCandidate = ('args' in rawInObj) ? (rawInObj as any).args : rawInObj;
			const args: Record<string, any> =
				(argsCandidate && typeof argsCandidate === 'object' && !Array.isArray(argsCandidate)) ? { ...(argsCandidate as any) } : {};

			// Normalize args for Void UI:
			try {
				if (sid && canonicalName === 'read_file') {
					let p: string | undefined =
						(typeof (rawInObj as any)?.path === 'string' ? String((rawInObj as any).path) : undefined)
						?? (typeof (rawInObj as any)?.uri === 'string' ? String((rawInObj as any).uri) : undefined);

					if (!p && title) {
						const m = title.match(/read_file:\s*(.+)$/i);
						if (m?.[1]) p = m[1].trim();
					}

					if (p) {
						const abs = this._resolvePathForSession(sid, p);
						args.uri = abs;
					}

					const line = (rawInObj as any)?.line;
					const limit = (rawInObj as any)?.limit;
					if (typeof line === 'number' && Number.isFinite(line)) args.startLine = line;
					if (typeof limit === 'number' && Number.isFinite(limit)) args.linesCount = limit;
				}

				if (sid && canonicalName === 'edit_file') {
					let diffPath: string | undefined;

					if (Array.isArray(contentAny)) {
						for (const it of contentAny) {
							if (it?.type === 'diff' && typeof it?.path === 'string' && it.path.trim()) {
								diffPath = String(it.path).trim();
								break;
							}
						}
					}

					if (!diffPath && typeof title === 'string' && title.trim()) {
						const m = title.match(/Patching\s+(.+?)(?:\s*\(|\s*$)/i);
						if (m?.[1]) diffPath = m[1].trim();
					}

					const p =
						diffPath
						?? (typeof (rawInObj as any)?.path === 'string' ? String((rawInObj as any).path) : undefined)
						?? (typeof (rawInObj as any)?.uri === 'string' ? String((rawInObj as any).uri) : undefined);

					if (p) {
						const abs = this._resolvePathForSession(sid, p);
						args.uri = abs;
						args.path = abs;
					}
				}

				if (canonicalName === 'run_command') {
					try {
						if (Array.isArray(contentAny)) {
							for (const it of contentAny) {
								if (it?.type === 'terminal' && typeof it?.terminalId === 'string' && it.terminalId) {
									args.terminalId = String(it.terminalId);
									break;
								}
							}
						}
					} catch { /* ignore */ }

					const cmd = (typeof (rawInObj as any)?.command === 'string')
						? String((rawInObj as any).command).trim()
						: '';

					const argv = Array.isArray((rawInObj as any)?.args)
						? (rawInObj as any).args.map((a: any) => String(a ?? '')).filter((s: string) => s.length > 0)
						: [];

					const fromPieces = cmd ? (argv.length ? `${cmd} ${argv.join(' ')}` : cmd) : '';
					const fromTitle = (typeof title === 'string') ? title.trim() : '';
					const cmdLine = (fromPieces || fromTitle || '').trim();

					if (cmdLine) {
						args.command = cmdLine;
					}
				}
			} catch (e: any) {
				this._logJson('tool_call args normalization FAILED', {
					sessionId: sid,
					toolCallId,
					canonicalName,
					error: e?.message ?? String(e)
				});
			}

			if (sid && toolCallId) {
				const k = this._toolKey(sid, toolCallId);
				this.toolNameBySessionToolCallId.set(k, canonicalName);
				this.toolKindBySessionToolCallId.set(k, kind);
				this.toolArgsBySessionToolCallId.set(k, args);

				this.activeToolCallIdBySession.set(sid, toolCallId);

				if (Array.isArray(contentAny)) {
					for (const item of contentAny) {
						if (item?.type === 'terminal' && typeof item?.terminalId === 'string' && item.terminalId) {
							this._addTerminalIdForToolCall(sid, toolCallId, String(item.terminalId));
						}
					}
				}
			}

			this._logJson('session/update tool_call', {
				sessionId: sid,
				toolCallId,
				kind,
				title,
				canonicalName,
				args,
				contentSummary: Array.isArray(contentAny) ? contentAny.map((x: any) => ({ type: x?.type, terminalId: x?.terminalId, path: x?.path })) : undefined
			});

			emitter.fire({ type: 'tool_call', toolCall: { id: toolCallId, name: canonicalName, args } });
			return;
		}

		// -------------------------
		// tool_call_update
		// -------------------------
		if (u.sessionUpdate === 'tool_call_update') {
			const sid = sessionId;
			if (!sid) return;

			const status = u?.status ?? null;
			const toolCallId = String(u?.toolCallId ?? '');
			const key = toolCallId ? this._toolKey(sid, toolCallId) : '';

			const updKind = typeof u?.kind === 'string' ? String(u.kind) : undefined;
			if (key && updKind) this.toolKindBySessionToolCallId.set(key, updKind);

			const kind = updKind ?? (key ? this.toolKindBySessionToolCallId.get(key) : undefined);
			const cachedName = key ? this.toolNameBySessionToolCallId.get(key) : undefined;

			const contentAny = Array.isArray(u?.content) ? u.content : undefined;

			const derivedDiffs: Array<{ path: string; oldText?: string; newText: string }> = [];
			const derivedTerminals: Array<{ terminalId: string }> = [];
			const derivedTexts: string[] = [];

			if (Array.isArray(contentAny) && contentAny.length) {
				for (const item of contentAny) {
					if (item?.type === 'content' && item?.content?.type === 'text' && typeof item?.content?.text === 'string') {
						derivedTexts.push(item.content.text);
					} else if (item?.type === 'diff') {
						const cand = {
							path: item?.path,
							oldText: (typeof item?.oldText === 'string') ? item.oldText : '',
							newText: item?.newText
						};
						if (this._isValidDiffItem(cand)) {
							derivedDiffs.push({ path: String(cand.path), oldText: cand.oldText, newText: String(cand.newText) });
						}
					} else if (item?.type === 'terminal') {
						if (typeof item?.terminalId === 'string' && item.terminalId) {
							derivedTerminals.push({ terminalId: String(item.terminalId) });
						}
					}
				}
			}

			if (toolCallId && derivedTerminals.length) {
				for (const t of derivedTerminals) this._addTerminalIdForToolCall(sid, toolCallId, t.terminalId);
			}

			const hasTerminal = !!(derivedTerminals.length || (toolCallId && this._getTerminalIdForToolCall(sid, toolCallId)));
			const hasDiff = derivedDiffs.length > 0;

			// rawOutput from agent
			let result: any = u?.rawOutput;
			if (typeof result === 'string') {
				const t = result.trim();
				if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
					try { result = JSON.parse(t); } catch { result = { rawOutput: result }; }
				} else {
					result = { rawOutput: result };
				}
			} else if (result !== undefined && result !== null) {
				if (typeof result !== 'object' || Array.isArray(result)) result = { value: result };
			}
			if (result === undefined || result === null) result = {};
			const rObj = this._asObject(result) ?? {};

			const canonicalName = this._canonicalToolName({
				kind,
				hasDiff,
				hasTerminal,
				rawName: cachedName,
				title: typeof u?.title === 'string' ? String(u.title) : undefined
			});

			if (key) this.toolNameBySessionToolCallId.set(key, canonicalName);

				// --- NEW: emit tool_progress for in-flight tool_call_update ---
				if (status !== 'completed' && status !== 'failed') {
					const acpMode = this.lastConnectParams?.mode ?? 'builtin';
					const shouldEmitProgress = !(canonicalName === 'run_command' && acpMode !== 'builtin');
					const terminalIdForProgress =
						(derivedTerminals.length ? String(derivedTerminals[0].terminalId) : '')
						|| (typeof (rObj as any).terminalId === 'string' ? String((rObj as any).terminalId) : '')
						|| (toolCallId ? (this._getTerminalIdForToolCall(sid, toolCallId) ?? '') : '');

					const rawOutStr =
						(typeof (rObj as any).output === 'string' && (rObj as any).output.length > 0) ? String((rObj as any).output)
							: (typeof (rObj as any).text === 'string' && (rObj as any).text.length > 0) ? String((rObj as any).text)
								: (typeof (rObj as any).content === 'string' && (rObj as any).content.length > 0) ? String((rObj as any).content)
									: '';

					const textFromContent = derivedTexts.length ? derivedTexts.join('\n') : '';
					const progressText = (rawOutStr || textFromContent || '').toString();

					const truncated =
						(typeof (rObj as any).truncated === 'boolean') ? (rObj as any).truncated : undefined;

					const exitStatus = (rObj as any)?.exitStatus;

					if (!shouldEmitProgress) {
						this._logJson('SKIP tool_progress (run_command via terminal poll)', {
							sessionId: sid,
							toolCallId,
							canonicalName,
							status,
							acpMode,
							terminalId: terminalIdForProgress || null,
							derivedTextLen: textFromContent.length,
							rawOutLen: rawOutStr.length,
							rObjKeys: Object.keys(rObj)
						});
					} else if (toolCallId && progressText) {
						this._logJson('EMIT tool_progress (from tool_call_update)', {
							sessionId: sid,
							toolCallId,
							canonicalName,
							status,
							terminalId: terminalIdForProgress || null,
							progressLen: progressText.length,
							hasDerivedTexts: derivedTexts.length,
							rObjKeys: Object.keys(rObj),
							hasExitStatus: !!exitStatus,
							truncated: truncated ?? null,
							preview: progressText.slice(0, 160)
						});

						emitter.fire({
							type: 'tool_progress',
							toolProgress: {
								id: toolCallId,
								name: canonicalName,
								...(terminalIdForProgress ? { terminalId: terminalIdForProgress } : {}),
								output: progressText,
								...(typeof truncated === 'boolean' ? { truncated } : {}),
								...(exitStatus ? { exitStatus } : {})
							} as any
						});
					} else {
						this._logJson('SKIP tool_progress (empty)', {
							sessionId: sid,
							toolCallId,
							canonicalName,
							status,
							terminalId: terminalIdForProgress || null,
							derivedTextLen: textFromContent.length,
							rawOutLen: rawOutStr.length,
							rObjKeys: Object.keys(rObj)
						});
					}
				}

			this._logJson('session/update tool_call_update', {
				sessionId: sid,
				toolCallId,
				status,
				kind,
				cachedName,
				canonicalName,
				derivedSummary: { textLen: derivedTexts.join('\n').length, diffs: derivedDiffs.length, terminals: derivedTerminals.length },
				resultKeys: Object.keys(rObj),
				contentSummary: Array.isArray(contentAny) ? contentAny.map((x: any) => ({ type: x?.type, terminalId: x?.terminalId, path: x?.path })) : undefined
			});

			if (sid && toolCallId) {
				const terminalIdForPoll =
					(derivedTerminals.length ? String(derivedTerminals[0].terminalId) : '')
					|| (typeof (rObj as any).terminalId === 'string' ? String((rObj as any).terminalId) : '')
					|| (this._getTerminalIdForToolCall(sid, toolCallId) ?? '');

				// NOTE: this poll is for "SPEC terminal/* callbacks".
				// Builtin agent uses extMethod('terminal/output') and does NOT need this poll,
				// but keep it for websocket/process agents.
				if (terminalIdForPoll && canonicalName === 'run_command' && status !== 'completed' && status !== 'failed') {
					this._startTerminalPoll(sid, toolCallId, terminalIdForPoll);
				}
			}

			if (status === 'completed' || status === 'failed') {
				if (sid && toolCallId) {
					this._stopTerminalPoll(sid, toolCallId);
				}
				const errorText = status === 'failed' ? 'Tool failed' : undefined;

				// clear active tool call
				{
					const active = this.activeToolCallIdBySession.get(sid);
					if (active && active === toolCallId) this.activeToolCallIdBySession.delete(sid);
				}

				if (canonicalName === 'edit_file') {
					const safeDiffs = derivedDiffs.filter(d => this._isValidDiffItem(d));
					emitter.fire({
						type: 'tool_result',
						toolResult: {
							id: toolCallId,
							name: 'edit_file',
							result: { ...rObj, diffs: safeDiffs },
							error: errorText
						}
					});
					return;
				}

				if (canonicalName === 'read_file') {
					const contentStr =
						(typeof (rObj as any).content === 'string') ? String((rObj as any).content)
							: (typeof (rObj as any).text === 'string' ? String((rObj as any).text) : '');

					emitter.fire({
						type: 'tool_result',
						toolResult: {
							id: toolCallId,
							name: 'read_file',
							result: { ...rObj, content: String(contentStr ?? '') },
							error: errorText
						}
					});
					return;
				}

					// run_command
					if (canonicalName === 'run_command') {
					const terminalId =
						(derivedTerminals.length ? String(derivedTerminals[0].terminalId) : '')
						|| (typeof (rObj as any).terminalId === 'string' ? String((rObj as any).terminalId) : '')
						|| (toolCallId ? (this._getTerminalIdForToolCall(sid, toolCallId) ?? '') : '');

					const emitRunCommandResult = () => {
						const info = terminalId ? this.terminalInfoById.get(terminalId) : undefined;
						const cachedOutput = (typeof info?.output === 'string') ? info.output : '';
						const fromAgentOutput = (typeof (rObj as any).output === 'string') ? String((rObj as any).output) : '';
						const output = cachedOutput.length >= fromAgentOutput.length ? cachedOutput : fromAgentOutput;

						const outResult: any = {
							...rObj,
							toolCallId,
							terminalId: terminalId || undefined,
							output: String(output ?? '')
						};

						if (typeof info?.truncated === 'boolean') outResult.truncated = info.truncated;
						if (typeof info?.command === 'string') outResult.command = info.command;
						if (typeof info?.exitCode === 'number' || info?.exitCode === null) outResult.exitCode = info.exitCode;
						if (typeof info?.signal === 'string' || info?.signal === null) outResult.signal = info.signal;

						emitter.fire({
							type: 'tool_result',
							toolResult: {
								id: toolCallId,
								name: 'run_command',
								result: outResult,
								error: errorText
							}
						});
					};

					if (terminalId) {
						this._captureTerminalOutputIntoCache(sid, terminalId).then(
							() => emitRunCommandResult(),
							() => emitRunCommandResult()
						);
						return;
					}

					emitRunCommandResult();
					return;
				}

				emitter.fire({
					type: 'tool_result',
					toolResult: {
						id: toolCallId,
						name: canonicalName,
						result: rObj ?? {},
						error: errorText
					}
				});
				return;
			}

			return;
		}

		if (u.sessionUpdate === 'available_commands_update' && Array.isArray((u as any).availableCommands)) {
			const items = (u as any).availableCommands.map((cmd: AvailableCommand, i: number) => ({
				id: String(i),
				text: `${cmd?.name ?? ''}${cmd?.description ? ` — ${cmd.description}` : ''}`.trim(),
				state: 'pending' as const
			}));
			if (items.length) emitter.fire({ type: 'plan', plan: { items } });
			return;
		}

		if (u.sessionUpdate === 'current_mode_update' && typeof (u as any).currentModeId === 'string') {
			emitText(`Mode: ${(u as any).currentModeId}`);
			return;
		}
	}

	async hostCallbackResult(resp: AcpHostCallbackResponse): Promise<void> {
		const p = this.pendingHostCallbacks.get(resp.requestId);
		if (!p) return;
		this.pendingHostCallbacks.delete(resp.requestId);
		if (resp.error) p.reject(new Error(resp.error));
		else p.resolve(resp.result);
	}
}
