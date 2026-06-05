import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITerminalToolService } from '../../void/browser/terminalToolService.js';
import { IChatThreadService } from '../../void/browser/chatThreadService.js';
import { normalizeAcpToolName } from '../../void/browser/ChatAcpHandler.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { defaultGlobalSettings } from '../../../../platform/void/common/voidSettingsTypes.js';
import { approvalTypeOfToolName } from '../../../../platform/void/common/toolsServiceTypes.js';
import { isAToolName } from '../../void/common/prompt/prompts.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { computeTruncatedToolOutput } from '../../../../platform/void/common/toolOutputTruncation.js';

import {
	toolOutputFileName,
	normalizeMetaLogFilePath,
	stableToolOutputsRelPath,
} from '../../../../platform/void/common/toolOutputFileNames.js';

type EnvVar = { name: string; value: string };
type TerminalExitStatus = { exitCode: number | null; signal: string | null };

export class AcpHostCallbacksService {

	constructor(
		private readonly instantiationService: IInstantiationService,
		private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) { }

	private _terminalSuggestedFileName(terminalId: string): string {
		// stable: .void/tool_outputs/terminal_<8hex>.log (keyed by terminalId)
		return stableToolOutputsRelPath({ toolName: 'run_command', terminalId });
	}

	private _getTerminalToolService(): ITerminalToolService | null {
		try { return this.instantiationService.invokeFunction(accessor => accessor.get(ITerminalToolService)); }
		catch { return null; }
	}

	private _getWorkspaceRoot(): URI | null {
		try {
			const ws = this.instantiationService.invokeFunction(a => a.get(IWorkspaceContextService));
			const w = ws.getWorkspace();
			return w.folders?.length ? w.folders[0].uri : null;
		} catch {
			return null;
		}
	}

	private _unwrapDeepRunResult(res: any): any {
		// Some terminal services return { result, resolveReason } (and sometimes nested result.result...)
		let cur = res;
		for (let i = 0; i < 4; i++) {
			if (!cur || typeof cur !== 'object') break;
			if ('result' in cur) {
				cur = (cur as any).result;
				continue;
			}
			break;
		}
		return cur;
	}

	private _getMaxToolOutputLength(): number {
		try {
			const vss = this.instantiationService.invokeFunction(a => a.get(IVoidSettingsService));
			const raw = (vss?.state as any)?.globalSettings?.maxToolOutputLength;
			const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw) : NaN);
			if (Number.isFinite(n) && n > 0) return n;
		} catch { /* ignore */ }
		return 16000;
	}

	private _getReadFileChunkLines(): number {
		try {
			const vss = this.instantiationService.invokeFunction(a => a.get(IVoidSettingsService));
			const raw = (vss?.state as any)?.globalSettings?.readFileChunkLines;
			const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw) : NaN);
			if (Number.isFinite(n) && n > 0) return n;
		} catch { /* ignore */ }
		return defaultGlobalSettings.readFileChunkLines;
	}

	private _countLines(text: string): number {
		if (!text) return 0;
		return text.split(/\r?\n/).length;
	}

	private _asUriFromPathOrUri(pathOrUri: unknown): URI {
		const s = String(pathOrUri ?? '').trim();

		// Real URI with scheme (file://, vscode-remote://, etc)
		// Important: don't treat "C:foo" as a scheme URI
		const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) && !/^[a-zA-Z]:[\\/]/.test(s);
		if (hasScheme) return URI.parse(s);

		// Absolute paths
		const isWindowsDriveAbs = /^[a-zA-Z]:[\\/]/.test(s);
		const isPosixAbs = s.startsWith('/');
		if (isWindowsDriveAbs || isPosixAbs) return URI.file(s);

		// Workspace-relative paths (e.g. ".void/tool_outputs/x.log")
		const root = this._getWorkspaceRoot();
		if (root) {
			let rel = s;
			if (rel.startsWith('./')) rel = rel.slice(2);
			else if (rel.startsWith('.\\')) rel = rel.slice(2);

			const parts = rel.split(/[/\\]/).filter(Boolean);
			if (parts.length) return URI.joinPath(root, ...parts);
		}

		// Fallback
		return URI.file(s);
	}

	private _shellQuoteArg(arg: string): string {
		if (!/[ \t\r\n"]/.test(arg)) return arg;
		return `"${arg.replace(/"/g, '\\"')}"`;
	}

	private _buildCommandLine(command: string, args: unknown): string {
		const arr = Array.isArray(args) ? args.map(a => String(a ?? '')) : [];
		if (!arr.length) return command;
		return `${command} ${arr.map(a => this._shellQuoteArg(a)).join(' ')}`;
	}

	private async _saveToToolOutputs(fullText: string, suggestedFileNameOrPath?: string): Promise<string | null> {
		try {
			const root = this._getWorkspaceRoot();
			if (!root) return null;

			const outputDir = URI.joinPath(root, '.void', 'tool_outputs');
			if (!(await this.fileService.exists(outputDir))) {
				await this.fileService.createFolder(outputDir);
			}

			// normalize suggested to ".void/tool_outputs/<basename>" and take basename
			let fileName: string | null = null;
			if (suggestedFileNameOrPath) {
				const norm = normalizeMetaLogFilePath(suggestedFileNameOrPath);
				if (norm) fileName = norm.split('/').filter(Boolean).slice(-1)[0] ?? null;
			}

			// fallback: output_<8hex>.log
			if (!fileName) {
				fileName = toolOutputFileName('output', String(fullText ?? ''));
			}

			const fileUri = URI.joinPath(outputDir, fileName);

			// IMPORTANT: overwrite always (otherwise polling produces stale/partial logs)
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(String(fullText ?? '')));

			// IMPORTANT: return workspace-relative path
			return `.void/tool_outputs/${fileName}`;
		} catch {
			return null;
		}
	}

	private async _finalizeTerminalIfNeeded(terminalId: string): Promise<void> {
		const st = this._terminalStateById.get(terminalId);
		if (!st || !st.done) return;
		if (st.finalized) return;

		const max = this._getMaxToolOutputLength();
		const effectiveMax =
			(st.outputByteLimit && Number.isFinite(st.outputByteLimit) && st.outputByteLimit > 0)
				? Math.min(max, st.outputByteLimit)
				: max;

		const full = String(st.finalOutput ?? '');
		const suggested = this._terminalSuggestedFileName(terminalId);

		if (full.length > effectiveMax) {
			const t = await this._truncateWithMetaIfNeeded(
				full,
				effectiveMax,
				suggested,
				{ includeMeta: true, saveToFile: true }
			);
			st.finalResponseText = t.text;
			st.finalResponseTruncated = true;
			st.finalSavedPath = t.savedPath;
		} else {
			st.finalResponseText = full;
			st.finalResponseTruncated = false;
			st.finalSavedPath = null;
		}

		st.finalized = true;
	}

	private async _truncateReadTextFileWithMeta(
		fullText: string,
		maxChars: number,
		pathOrUri: string,
		requestedLine?: number,
		_requestedLimit?: number,
		fileTotalLines?: number
	): Promise<{ text: string; didTruncateForMax: boolean }> {
		const s = String(fullText ?? '');
		if (!s) return { text: '', didTruncateForMax: false };
		if (!Number.isFinite(maxChars) || maxChars <= 0) return { text: '', didTruncateForMax: true };
		if (s.length <= maxChars) return { text: s, didTruncateForMax: false };

		const originalLength = s.length;

		const requestedStartLine =
			(typeof requestedLine === 'number' && Number.isFinite(requestedLine) && requestedLine > 0)
				? requestedLine
				: 1;

		const chunk = this._getReadFileChunkLines();
		const normalizedFileTotalLines =
			(typeof fileTotalLines === 'number' && Number.isFinite(fileTotalLines) && fileTotalLines > 0)
				? Math.floor(fileTotalLines)
				: undefined;

		// fit suffix into maxChars by shrinking body
		let bodyMax = maxChars;

		for (let iter = 0; iter < 4; iter++) {
			// computeTruncatedToolOutput(max<=0) returns the full string.
			// For footer-fitting loops we need an empty body when no body budget remains.
			const { truncatedBody, lineAfterTruncation } =
				bodyMax > 0
					? computeTruncatedToolOutput(s, bodyMax)
					: { truncatedBody: '', lineAfterTruncation: 0 };
			const startLineExclusive = lineAfterTruncation > 0 ? lineAfterTruncation : 0;
			const nextStartLine = requestedStartLine + startLineExclusive;
			const suggestedEndLine = nextStartLine + chunk - 1;

			const headerLines = [
				`[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.`,
				`Only the first ${maxChars} characters are included in this message.`,
				`Display limit: maxToolOutputLength = ${maxChars} characters.`,
			];

			const uriStr = String(pathOrUri ?? '');

			const instructionsLines = [
				`IMPORTANT FOR THE MODEL:`,
				`  1. Do NOT guess based only on this truncated output.`,
				`  2. Continue by calling read_file on the ORIGINAL uri (NOT on a tool-output log):`,
				`     read_file({ uri: ${JSON.stringify(uriStr)}, startLine: ${nextStartLine}, endLine: ${suggestedEndLine} })`,
				`  3. IMPORTANT: endLine above is a chunk boundary, NOT the end of file.`,
				`  4. Recommended next chunk size: readFileChunkLines = ${chunk}.`,
				...(normalizedFileTotalLines !== undefined
					? [`     Known total file lines: ${normalizedFileTotalLines}.`]
					: []),
				`  5. If still truncated, increase startLine by about ${chunk} and repeat.`,
			];

			const meta = {
				tool: 'read_file',
				uri: uriStr,
				requestedStartLine,
				nextStartLine,
				suggested: {
					startLine: nextStartLine,
					endLine: suggestedEndLine,
					chunkLines: chunk,
					endLineIsFileEnd: false,
				},
				...(normalizedFileTotalLines !== undefined ? { fileTotalLines: normalizedFileTotalLines } : {}),
				maxChars,
				originalLength,
			};

			const metaLine = `TRUNCATION_META: ${JSON.stringify(meta)}`;
			const suffix = `...\n\n${headerLines.join('\n')}\n${instructionsLines.join('\n')}\n${metaLine}`;
			const nextBodyMax = Math.max(0, maxChars - suffix.length);

			if (nextBodyMax === bodyMax || iter === 3) {
				const finalText = `${truncatedBody}${suffix}`;
				return { text: finalText.slice(0, maxChars), didTruncateForMax: true };
			}
			bodyMax = nextBodyMax;
		}
		return { text: s.slice(0, maxChars), didTruncateForMax: true };
	}

	private async _truncateWithMetaIfNeeded(
		fullText: string,
		maxChars: number,
		suggestedFileNameOrPath?: string,
		opts?: { includeMeta?: boolean; saveToFile?: boolean }
	): Promise<{ text: string; didTruncateForMax: boolean; savedPath: string | null }> {

		const s = String(fullText ?? '');
		const includeMeta = opts?.includeMeta !== false;
		const saveToFile = opts?.saveToFile === true;

		if (!s) return { text: '', didTruncateForMax: false, savedPath: null };
		if (!Number.isFinite(maxChars) || maxChars <= 0) return { text: '', didTruncateForMax: true, savedPath: null };
		if (s.length <= maxChars) return { text: s, didTruncateForMax: false, savedPath: null };

		if (!includeMeta) {
			return { text: s.slice(0, maxChars), didTruncateForMax: true, savedPath: null };
		}

		let savedPath: string | null = null;
		const originalLength = s.length;

		if (saveToFile) {
			savedPath = await this._saveToToolOutputs(s, suggestedFileNameOrPath);
		}

		let bodyMax = maxChars;
		for (let iter = 0; iter < 4; iter++) {
			// computeTruncatedToolOutput(max<=0) returns the full string.
			// For footer-fitting loops we need an empty body when no body budget remains.
			const { truncatedBody, lineAfterTruncation } =
				bodyMax > 0
					? computeTruncatedToolOutput(s, bodyMax)
					: { truncatedBody: '', lineAfterTruncation: 0 };
			const startLineExclusive = lineAfterTruncation > 0 ? lineAfterTruncation : 0;

			const headerLines = [
				`[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.`,
				`Only the first ${maxChars} characters are included in this message.`,
				`Display limit: maxToolOutputLength = ${maxChars} characters.`,
			];

			const instructionsLines = savedPath
				? [
					`IMPORTANT FOR THE MODEL:`,
					`  1. Do NOT guess based only on this truncated output.`,
					`  2. To see the rest of this tool output, call read_file on logFilePath, starting from line startLineExclusive + 1.`,
				]
				: [
					`IMPORTANT FOR THE MODEL:`,
					`  1. Do NOT guess based only on this truncated output when the missing tail is critical.`,
					`  2. In this environment the full log file path is not available; you can only work with the visible part.`,
				];

			const meta = { logFilePath: savedPath, startLineExclusive, maxChars, originalLength };
			const metaLine = `TRUNCATION_META: ${JSON.stringify(meta)}`;

			const suffix = `...\n\n${headerLines.join('\n')}\n${instructionsLines.join('\n')}\n${metaLine}`;
			const nextBodyMax = Math.max(0, maxChars - suffix.length);

			if (nextBodyMax === bodyMax || iter === 3) {
				const finalText = `${truncatedBody}${suffix}`;
				return { text: finalText.slice(0, maxChars), didTruncateForMax: true, savedPath };
			}

			bodyMax = nextBodyMax;
		}

		return { text: s.slice(0, maxChars), didTruncateForMax: true, savedPath };
	}

	private readonly _terminalStateById = new Map<string, {
		done: boolean;
		exitCode: number | null;
		signal: string | null;
		runPromise: Promise<void>;
		outputPumpPromise?: Promise<void>;
		outputByteLimit?: number;
		commandLine?: string;
		runType?: 'ephemeral' | 'persistent';
		finalOutput?: string;

		startedAt?: number;
		lastOutputAt?: number;
		inactivityTimeoutSeconds?: number;

		finalized?: boolean;
		finalResponseText?: string;
		finalResponseTruncated?: boolean;
		finalSavedPath?: string | null;
	}>();

	private _markTerminalDone(terminalId: string, exitCode: number | null, signal: string | null) {
		const st = this._terminalStateById.get(terminalId);
		if (!st) return;
		st.done = true;
		st.exitCode = exitCode;
		st.signal = signal;
	}

	private _extractExitStatusFromRunResult(res: any): TerminalExitStatus {
		try {
			const r = this._unwrapDeepRunResult(res) ?? {};
			let exitCode: number | null = null;
			let signal: string | null = null;

			// ACP-ish nested shape: { exitStatus: { exitCode, signal } }
			const es = (r && typeof r === 'object') ? (r as any).exitStatus : undefined;
			if (es && typeof es === 'object') {
				const ec = (es as any).exitCode;
				const sg = (es as any).signal;
				if (typeof ec === 'number' && Number.isFinite(ec)) exitCode = ec;
				else if (ec === null) exitCode = null;
				if (typeof sg === 'string') signal = sg;
				else if (sg === null) signal = null;
				return { exitCode, signal };
			}

			// Common direct shapes
			if (typeof (r as any).exitCode === 'number' && Number.isFinite((r as any).exitCode)) exitCode = (r as any).exitCode;
			else if ((r as any).exitCode === null) exitCode = null;

			else if (typeof (r as any).code === 'number' && Number.isFinite((r as any).code)) exitCode = (r as any).code;
			else if (typeof (r as any).status === 'number' && Number.isFinite((r as any).status)) exitCode = (r as any).status;

			if (typeof (r as any).signal === 'string') signal = (r as any).signal;
			else if ((r as any).signal === null) signal = null;

			return { exitCode, signal };
		} catch {
			return { exitCode: null, signal: null };
		}
	}

	private _extractOutputFromRunResult(res: any): string {
		try {
			const r0 = this._unwrapDeepRunResult(res);

			if (typeof r0 === 'string') return r0;
			if (!r0 || typeof r0 !== 'object') return '';

			const r: any = r0;

			// Common shapes
			if (typeof r.output === 'string') return String(r.output);
			if (typeof r.combinedOutput === 'string') return String(r.combinedOutput);

			// stdout/stderr pairs
			const stdout = typeof r.stdout === 'string' ? String(r.stdout) : '';
			const stderr = typeof r.stderr === 'string' ? String(r.stderr) : '';
			if (stdout || stderr) return `${stdout}${stderr}`;

			// sometimes "text" / "value" / "result" is used
			if (typeof r.text === 'string') return String(r.text);
			if (typeof r.value === 'string') return String(r.value);
			if (typeof r.result === 'string') return String(r.result);

			return '';
		} catch {
			return '';
		}
	}

	private _normalizeReadTerminalValue(v: any): string {
		try {
			if (typeof v === 'string') return v;
			if (!v || typeof v !== 'object') return '';

			if (typeof (v as any).output === 'string') return String((v as any).output);
			if (typeof (v as any).value === 'string') return String((v as any).value);

			// some services return { lines: string[] }
			if (Array.isArray((v as any).lines)) return (v as any).lines.map((x: any) => String(x ?? '')).join('\n');

			return '';
		} catch {
			return '';
		}
	}

	private async _readTerminalBestEffort(termSvc: any, terminalId: string): Promise<string> {
		// Long-running commands often don't produce output immediately.
		// Bump retries a bit so external agents don't see "empty" too often.
		let out = '';
		for (let i = 0; i < 10; i++) {
			try {
				const v = await termSvc.readTerminal(terminalId).catch(() => undefined);
				const s = this._normalizeReadTerminalValue(v);
				if (s && s.length >= out.length) out = s;
			} catch { /* ignore */ }

			await new Promise(r => setTimeout(r, 50));
		}
		return out;
	}

	private async _awaitFinalRunResult(startRes: any): Promise<any> {
		try {
			const p = (startRes && typeof startRes === 'object') ? (startRes as any).resPromise : undefined;
			if (p && typeof p.then === 'function') {
				return await p;
			}
		} catch { /* ignore */ }
		return startRes;
	}

	private _startTerminalOutputPump(termSvc: any, terminalId: string): void {
		const st = this._terminalStateById.get(terminalId);
		if (!st) return;
		if (st.outputPumpPromise) return;

		st.outputPumpPromise = (async () => {
			try {
				for (let i = 0; i < 1000000; i++) {
					const cur = this._terminalStateById.get(terminalId);
					if (!cur) return;

					try {
						const fresh = await this._readTerminalBestEffort(termSvc, terminalId);
						if (fresh) {
							const prev = String(cur.finalOutput ?? '');

							// IMPORTANT:
							// only accept monotonic extension, otherwise DO NOT overwrite
							// (readTerminal can return a "different window" not starting from the beginning).
							if (!prev || fresh.startsWith(prev)) {
								if (fresh.length > prev.length) {
									cur.finalOutput = fresh;
									cur.lastOutputAt = Date.now();
								}
							}
						}
					} catch { /* ignore */ }

					if (cur.done) break;
					await new Promise(r => setTimeout(r, 250));
				}

				// final refresh after done (still monotonic)
				try {
					const fresh2 = await this._readTerminalBestEffort(termSvc, terminalId);
					const cur2 = this._terminalStateById.get(terminalId);
					if (cur2 && fresh2) {
						const prev2 = String(cur2.finalOutput ?? '');
						if (!prev2 || fresh2.startsWith(prev2)) {
							if (fresh2.length > prev2.length) {
								cur2.finalOutput = fresh2;
								cur2.lastOutputAt = Date.now();
							}
						}
					}
				} catch { /* ignore */ }
			} catch { /* ignore */ }
		})();
	}

	async handle(kind: string, params: any, threadId: string | undefined): Promise<any> {
		if (kind !== 'terminalOutput') {
			this.logService.debug(`[AcpHostCallbacksService] handle INPUT: kind="${kind}" threadId="${threadId}"`);
			this.logService.debug(`[AcpHostCallbacksService] handle PARAMS:`, JSON.stringify(params, null, 2));
		}

		const p = params ?? {};

		// -------------------------
		// Permissions
		// -------------------------
		if (kind === 'requestPermission') {
			try {
				const vss = this.instantiationService.invokeFunction(a => a.get(IVoidSettingsService));
				const autos = vss.state.globalSettings.autoApprove ?? {};
				const mcpAuto = vss.state.globalSettings.mcpAutoApprove === true;
				const chat = this.instantiationService.invokeFunction(a => a.get(IChatThreadService));

				const toolCallId: string | undefined =
					p?.toolCall?.toolCallId ?? p?.toolCallId;

				let rawName: string =
					p?.toolCall?.rawInput?.name
					?? p?.toolCall?.name
					?? p?.toolCall?.function?.name
					?? p?.toolCall?.title
					?? p?.title
					?? 'tool';

				let rawArgs: Record<string, any> =
					(p?.toolCall?.rawInput?.args && typeof p.toolCall.rawInput.args === 'object')
						? p.toolCall.rawInput.args
						: (p?.toolCall?.rawInput && typeof p.toolCall.rawInput === 'object')
							? p.toolCall.rawInput
							: {};

				// External ACP often stores name in llmInfo.toolCallSoFar
				if (threadId) {
					const st = chat.streamState[threadId];
					const toolCallSoFar = (st as any)?.llmInfo?.toolCallSoFar;
					if ((rawName === 'tool' || !rawName) && toolCallId && toolCallSoFar && String(toolCallSoFar.id) === String(toolCallId)) {
						rawName = String(toolCallSoFar.name ?? rawName);
						rawArgs = (toolCallSoFar.rawParams && typeof toolCallSoFar.rawParams === 'object') ? toolCallSoFar.rawParams : rawArgs;
					}
				}

				const normName = normalizeAcpToolName(String(rawName));

				if (!threadId || !toolCallId) {
					return { outcome: { outcome: 'selected', optionId: 'reject_once' } };
				}

				const isBuiltin = isAToolName(normName);
				const approvalType = isBuiltin ? approvalTypeOfToolName[normName] : undefined;

				if (isBuiltin && !approvalType) {
					return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
				}

				if (isBuiltin && approvalType) {
					const autoApprove = !!(autos as any)[approvalType];
					if (autoApprove) {
						return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
					}
				}

				if (!isBuiltin && mcpAuto) {
					return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
				}

				chat.enqueueToolRequestFromAcp(threadId, {
					id: toolCallId,
					name: normName,
					rawParams: rawArgs
				});

				const decision = await new Promise<'approved' | 'rejected' | 'skipped'>((resolve) => {
					const disposable = chat.onExternalToolDecision(({ threadId: t, toolCallId: id, decision }) => {
						if (t === threadId && id === toolCallId) {
							disposable.dispose();
							resolve(decision);
						}
					});
				});

				return decision === 'approved'
					? { outcome: { outcome: 'selected', optionId: 'allow_once' } }
					: { outcome: { outcome: 'selected', optionId: 'reject_once' } };

			} catch (err) {
				this.logService.error(`[AcpHostCallbacksService] requestPermission ERROR:`, err);
				return { outcome: { outcome: 'selected', optionId: 'reject_once' } };
			}
		}

		// -------------------------
		// FS
		// -------------------------
		if (kind === 'readTextFile') {
			try {
				const path = p?.path ?? p?.uri;
				this.logService.debug(`[AcpHostCallbacksService] fs/read_text_file: Reading "${path}"`);

				if (!path) throw new Error('fs/read_text_file: missing path');
				const uri = this._asUriFromPathOrUri(path);
				const file = await this.fileService.readFile(uri);
				const fullText = file.value.toString();

				const line = typeof p?.line === 'number' && Number.isFinite(p.line) ? p.line : undefined;
				const limit = typeof p?.limit === 'number' && Number.isFinite(p.limit) ? p.limit : undefined;

				let content: string;
				let totalFileLines: number;
				if (!line && !limit) {
					content = fullText;
					totalFileLines = this._countLines(fullText);
				} else {
					const rawLines = fullText.split(/\r?\n/);
					totalFileLines = rawLines.length;
					const startIdx = Math.max(0, (line ?? 1) - 1);
					const endIdx = limit ? Math.min(rawLines.length, startIdx + Math.max(0, limit)) : rawLines.length;
					const sliced = rawLines.slice(startIdx, endIdx).join('\n');
					const hadTrailingNl = /\r?\n$/.test(fullText);
					content = hadTrailingNl ? (sliced + '\n') : sliced;
				}

				const max = this._getMaxToolOutputLength();

				// IMPORTANT: for read_file, NEVER point model to .void/tool_outputs.
				// Continue by re-calling read_file on the ORIGINAL path/uri with increased line.
				const pathOrUriStr = String(path ?? '');

				const t = await this._truncateReadTextFileWithMeta(content, max, pathOrUriStr, line ?? 1, limit, totalFileLines);
				return { content: t.text };
			} catch (err) {
				this.logService.error(`[AcpHostCallbacksService] fs/read_text_file ERROR:`, err);
				throw err;
			}
		}

		if (kind === 'writeTextFile') {
			try {
				const path = p?.path ?? p?.uri;
				const content = p?.content;
				this.logService.debug(`[AcpHostCallbacksService] fs/write_text_file: Writing to "${path}" (${content?.length ?? 0} chars)`);

				if (!path) throw new Error('fs/write_text_file: missing path');
				if (typeof content !== 'string') throw new Error('fs/write_text_file: missing content');

				// Ensure .void/tool_outputs exists when agent writes logs there
				try {
					const s = String(path ?? '').trim();
					const isToolOutputsRel =
						/^\.\/?\.void[\\/]+tool_outputs[\\/]+/i.test(s) ||
						/^\.void[\\/]+tool_outputs[\\/]+/i.test(s);

					if (isToolOutputsRel) {
						const root = this._getWorkspaceRoot();
						if (root) {
							const outputDir = URI.joinPath(root, '.void', 'tool_outputs');
							if (!(await this.fileService.exists(outputDir))) {
								await this.fileService.createFolder(outputDir);
							}
						}
					}
				} catch { /* ignore */ }

				const uri = this._asUriFromPathOrUri(path);
				await this.fileService.writeFile(uri, VSBuffer.fromString(content));
				return null;
			} catch (err) {
				this.logService.error(`[AcpHostCallbacksService] fs/write_text_file ERROR:`, err);
				throw err;
			}
		}

		if (kind === 'createTerminal') {
			try {
				const termSvc = this._getTerminalToolService();
				if (!termSvc) throw new Error('Terminal service unavailable');

				const command = String(p?.command ?? '');
				this.logService.debug(`[AcpHostCallbacksService] terminal/create: Command="${command}"`);
				if (!command) throw new Error('terminal/create: missing command');

				const args = p?.args;
				const cwd: string | null = (p?.cwd ?? null) === null ? null : String(p?.cwd);

				const envArr: EnvVar[] = Array.isArray(p?.env) ? p.env : [];
				const envObj: Record<string, string> = {};
				for (const item of envArr) {
					if (!item) continue;
					const name = String((item as any).name ?? '');
					if (!name) continue;
					envObj[name] = String((item as any).value ?? '');
				}

				const terminalId = String(p?.terminalId ?? generateUuid());
				const cmdLine = this._buildCommandLine(command, args);

				const existing = this._terminalStateById.get(terminalId);
				if (existing && existing.done === false) {
					if (existing.commandLine === cmdLine) {
						this.logService.debug(`[AcpHostCallbacksService] terminal/create: DEDUP running terminalId=${terminalId}`);
						return { terminalId };
					}
					this._terminalStateById.delete(terminalId);
				}

				const outputByteLimit =
					(typeof p?.outputByteLimit === 'number' && Number.isFinite(p.outputByteLimit) && p.outputByteLimit > 0)
						? p.outputByteLimit
						: undefined;

				// IMPORTANT: external agents + our TerminalToolService API => use EPHEMERAL deterministically
				const runType: 'ephemeral' = 'ephemeral';

				const inactivityTimeoutSeconds =
					(typeof p?.inactivityTimeoutSeconds === 'number' && Number.isFinite(p.inactivityTimeoutSeconds) && p.inactivityTimeoutSeconds > 0)
						? p.inactivityTimeoutSeconds
						: 600;

				// Create state BEFORE starting run so onOutput can append immediately
				const stObj = {
					done: false,
					exitCode: null,
					signal: null,
					runPromise: Promise.resolve(),
					outputByteLimit,
					commandLine: cmdLine,
					runType,
					finalOutput: '',
					startedAt: Date.now(),
					lastOutputAt: Date.now(),
					inactivityTimeoutSeconds,
					finalized: false,
					finalResponseText: undefined,
					finalResponseTruncated: undefined,
					finalSavedPath: undefined,
				};
				this._terminalStateById.set(terminalId, stObj);

				const appendOutput = (chunk: string) => {
					const st = this._terminalStateById.get(terminalId);
					if (!st || st.done) return;
					const s = String(chunk ?? '');
					if (!s) return;
					st.finalOutput = (st.finalOutput ?? '') + s;
					st.lastOutputAt = Date.now();
				};

				const runPromise = (async () => {
					try {
						const startRes = await (termSvc as any).runCommand(cmdLine, {
							type: 'ephemeral',
							cwd,
							terminalId,
							env: Object.keys(envObj).length ? envObj : undefined,
							inactivityTimeoutSeconds,
							onOutput: appendOutput,
						});

						const finalRes = await this._awaitFinalRunResult(startRes);
						const payload = this._unwrapDeepRunResult(finalRes);

						// merge final output (prefer longer)
						let out = this._extractOutputFromRunResult(payload);
						const st = this._terminalStateById.get(terminalId);
						if (st) {
							const prev = String(st.finalOutput ?? '');
							if (out && out.length >= prev.length) st.finalOutput = out;
							else if (!out) out = prev;
						}

						// resolveReason mapping (timeout vs done)
						const rr = payload && typeof payload === 'object' ? (payload as any).resolveReason : undefined;
						const rrType = rr && typeof rr === 'object' ? String((rr as any).type ?? '') : '';

						if (rrType === 'timeout') {
							// Host-side inactivity timeout
							this._markTerminalDone(terminalId, 124, 'VOID_INACTIVITY_TIMEOUT');
						} else if (rrType === 'done' && typeof (rr as any)?.exitCode === 'number') {
							this._markTerminalDone(terminalId, (rr as any).exitCode, null);
						} else {
							const { exitCode, signal } = this._extractExitStatusFromRunResult(payload);
							this._markTerminalDone(terminalId, exitCode, signal);
						}
					} catch {
						this._markTerminalDone(terminalId, 1, null);
					}
				})();

				stObj.runPromise = runPromise;

				return { terminalId };
			} catch (err) {
				this.logService.error(`[AcpHostCallbacksService] terminal/create ERROR:`, err);
				throw err;
			}
		}

		if (kind === 'terminalOutput') {
			try {
				const termSvc = this._getTerminalToolService();
				if (!termSvc) throw new Error('Terminal service unavailable');

				const terminalId = String(p?.terminalId ?? '');
				if (!terminalId) throw new Error('terminal/output: missing terminalId');

				const st = this._terminalStateById.get(terminalId);

				// If unknown terminalId, best-effort read (no file writes here)
				if (!st) {
					let out = '';
					try { out = await this._readTerminalBestEffort(termSvc as any, terminalId); } catch { /* ignore */ }
					const max = this._getMaxToolOutputLength();
					const t = await this._truncateWithMetaIfNeeded(out, max, undefined, { includeMeta: false, saveToFile: false });
					return { output: t.text, truncated: t.didTruncateForMax, isRunning: true };
				}

				// Don't start pump if we already have accumulated output (onOutput should be the source of truth).
				if (!(st.finalOutput && st.finalOutput.length > 0)) {
					this._startTerminalOutputPump(termSvc as any, terminalId);
				}

				// Refresh (best-effort) but NEVER overwrite accumulated output with non-prefix snapshots
				{
					try {
						const fresh = await this._readTerminalBestEffort(termSvc as any, terminalId);
						if (fresh) {
							const prev = String(st.finalOutput ?? '');
							// Only accept fresh if it extends previous (monotonic, same start).
							if (!prev || fresh.startsWith(prev)) {
								st.finalOutput = fresh;
								st.lastOutputAt = Date.now();
							}
						}
					} catch { /* ignore */ }
				}

				const byteLimitFromState = st.outputByteLimit;
				const byteLimitFromCall =
					(typeof p?.outputByteLimit === 'number' && Number.isFinite(p.outputByteLimit) && p.outputByteLimit > 0)
						? p.outputByteLimit
						: undefined;

				const byteLimit =
					(byteLimitFromState && byteLimitFromCall)
						? Math.min(byteLimitFromState, byteLimitFromCall)
						: (byteLimitFromCall ?? byteLimitFromState);

				const max = this._getMaxToolOutputLength();
				const effectiveMax =
					(byteLimit && Number.isFinite(byteLimit) && byteLimit > 0)
						? Math.min(max, byteLimit)
						: max;

				// -------------------------
				// DONE: finalize ONCE (this is the ONLY place that may write the log file)
				// -------------------------
				if (st.done) {
					// If already finalized, return cached stable result
					if (!st.finalized) {
						// One last best-effort read before finalization, but only if monotonic
						try {
							const fresh2 = await this._readTerminalBestEffort(termSvc as any, terminalId);
							if (fresh2) {
								const prev2 = String(st.finalOutput ?? '');
								if (!prev2 || fresh2.startsWith(prev2)) {
									st.finalOutput = fresh2;
									st.lastOutputAt = Date.now();
								}
							}
						} catch { /* ignore */ }

						await this._finalizeTerminalIfNeeded(terminalId);
					}

					const output = String(st.finalResponseText ?? st.finalOutput ?? '');
					const truncated = !!st.finalResponseTruncated;

					const exitStatus: TerminalExitStatus = { exitCode: st.exitCode, signal: st.signal };

					return {
						output,
						truncated,
						isRunning: false,
						exitStatus
					};
				}

				// -------------------------
				// RUNNING: never write a file; never TRUNCATION_META
				// Show from start; if too long – show start + footer.
				// -------------------------
				const outputFull = String(st.finalOutput ?? '');
				if (outputFull.length <= effectiveMax) {
					return { output: outputFull, truncated: false, isRunning: true };
				}

				const footer =
					`\n\n[VOID] OUTPUT EXCEEDS DISPLAY LIMIT DURING RUN.\n` +
					`Current captured length: ${outputFull.length} chars.\n` +
					`Full output (and TRUNCATION_META + log file) will be produced after completion if needed.\n`;

				const bodyMax = Math.max(0, effectiveMax - footer.length);
				const output = `${outputFull.slice(0, bodyMax)}${footer}`;

				return { output, truncated: true, isRunning: true };

			} catch (err) {
				throw err;
			}
		}

		if (kind === 'waitForTerminalExit') {
			try {
				const terminalId = String(p?.terminalId ?? '');
				if (!terminalId) throw new Error('terminal/wait_for_exit: missing terminalId');

				const st = this._terminalStateById.get(terminalId);
				if (st) {
					await st.runPromise.catch(() => { });
					return { exitCode: st.exitCode, signal: st.signal };
				}
				return { exitCode: null, signal: null };
			} catch (err) {
				this.logService.error(`[AcpHostCallbacksService] terminal/wait_for_exit ERROR:`, err);
				throw err;
			}
		}

		if (kind === 'killTerminal') {
			try {
				const termSvc = this._getTerminalToolService();
				if (!termSvc) throw new Error('Terminal service unavailable');

				const terminalId = String(p?.terminalId ?? '');
				if (!terminalId) throw new Error('terminal/kill: missing terminalId');

				try {
					const anySvc = termSvc as any;
					if (typeof anySvc.killTemporaryTerminal === 'function') await anySvc.killTemporaryTerminal(terminalId);
					else if (typeof anySvc.killTerminal === 'function') await anySvc.killTerminal(terminalId);
					else if (typeof anySvc.killPersistentTerminal === 'function') await anySvc.killPersistentTerminal(terminalId);
				} catch { }

				this._markTerminalDone(terminalId, null, 'SIGTERM');
				return null;
			} catch (err) {
				this.logService.error(`[AcpHostCallbacksService] terminal/kill ERROR:`, err);
				throw err;
			}
		}

		if (kind === 'releaseTerminal') {
			try {
				const termSvc = this._getTerminalToolService();
				if (!termSvc) throw new Error('Terminal service unavailable');

				const terminalId = String(p?.terminalId ?? '');
				if (!terminalId) throw new Error('terminal/release: missing terminalId');

				try {
					const out = await this._readTerminalBestEffort(termSvc as any, terminalId);
					const st = this._terminalStateById.get(terminalId);
					if (st && out && out.length >= (st.finalOutput?.length ?? 0)) st.finalOutput = out;
				} catch { /* ignore */ }

				try {
					const anySvc = termSvc as any;
					if (typeof anySvc.releaseTemporaryTerminal === 'function') await anySvc.releaseTemporaryTerminal(terminalId);
					else if (typeof anySvc.releaseTerminal === 'function') await anySvc.releaseTerminal(terminalId);
					else if (typeof anySvc.killTemporaryTerminal === 'function') await anySvc.killTemporaryTerminal(terminalId);
					else if (typeof anySvc.killPersistentTerminal === 'function') await anySvc.killPersistentTerminal(terminalId);
				} catch { }

				this._markTerminalDone(
					terminalId,
					(this._terminalStateById.get(terminalId)?.exitCode ?? null),
					(this._terminalStateById.get(terminalId)?.signal ?? null)
				);
				return null;
			} catch (err) {
				this.logService.error(`[AcpHostCallbacksService] terminal/release ERROR:`, err);
				throw err;
			}
		}

		throw new Error(`Unknown host callback: ${kind}`);
	}
}
