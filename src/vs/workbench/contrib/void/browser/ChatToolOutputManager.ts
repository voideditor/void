/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { defaultGlobalSettings } from '../../../../platform/void/common/voidSettingsTypes.js';
import { computeTruncatedToolOutput } from '../../../../platform/void/common/toolOutputTruncation.js';
import { summarizeTerminalOutput } from '../../../../platform/void/common/terminalOutputSummarizer.js';
import { type SummarizerOptions, type SummarizerResult } from '../../../../platform/void/common/terminalOutputSummarizerTypes.js';
import { buildTerminalOutputSummaryPipeline, type TerminalOutputSummaryPipelineResult } from '../../../../platform/void/common/terminalOutputSummaryPipeline.js';
import { shouldSummarizeTerminalOutput } from '../../../../platform/void/common/terminalOutputSummaryPolicy.js';
import { renderTerminalOutputSummary, type TerminalOutputSummaryRenderResult } from '../../../../platform/void/common/terminalOutputSummaryRenderer.js';
import { type SummaryReason, type TerminalOutputSummaryCandidate } from '../../../../platform/void/common/terminalOutputSummaryTypes.js';
import { type JsonObject, type JsonValue, type ToolOutputInput, getStringField, isJsonObject } from '../../../../platform/void/common/jsonTypes.js';

import {
	normalizeMetaLogFilePath,
	looksLikeStableToolOutputsRelPath,
	stableToolOutputsRelPath,
} from '../../../../platform/void/common/toolOutputFileNames.js';


export class ChatToolOutputManager {

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService
	) { }

	private async _getToolOutputsDir(): Promise<URI | null> {
		const workspace = this._workspaceContextService.getWorkspace();
		const folderUri = workspace.folders.length > 0 ? workspace.folders[0].uri : null;
		if (!folderUri) return null;

		const outputDir = URI.joinPath(folderUri, '.void', 'tool_outputs');
		if (!(await this._fileService.exists(outputDir))) {
			await this._fileService.createFolder(outputDir);
		}
		return outputDir;
	}

	private async _toolOutputsFileUri(relPathOrAnything: string): Promise<URI | null> {
		const outputDir = await this._getToolOutputsDir();
		if (!outputDir) return null;

		const normalized = normalizeMetaLogFilePath(relPathOrAnything);
		if (!normalized) return null;

		const base = normalized.split('/').filter(Boolean).slice(-1)[0];
		if (!base) return null;

		return URI.joinPath(outputDir, base);
	}

	private async _existsToolOutputsFile(relPathOrAnything: string): Promise<boolean> {
		try {
			const uri = await this._toolOutputsFileUri(relPathOrAnything);
			if (!uri) return false;
			return await this._fileService.exists(uri);
		} catch {
			return false;
		}
	}

	private async _writeToolOutputsFileOverwrite(relPathOrAnything: string, content: string): Promise<boolean> {
		try {
			const fileUri = await this._toolOutputsFileUri(relPathOrAnything);
			if (!fileUri) return false;
			await this._fileService.writeFile(fileUri, VSBuffer.fromString(content));
			return true;
		} catch {
			return false;
		}
	}

	private async _copyToolOutputsFileBestEffort(fromRelOrAnything: string, toRelOrAnything: string): Promise<boolean> {
		const fromUri = await this._toolOutputsFileUri(fromRelOrAnything);
		const toUri = await this._toolOutputsFileUri(toRelOrAnything);
		if (!fromUri || !toUri) return false;

		try {
			const exists = await this._fileService.exists(fromUri);
			if (!exists) return false;
		} catch {
			return false;
		}

		try {
			await this._fileService.copy(fromUri, toUri, true);
			return true;
		} catch { /* ignore */ }

		// Fallback: read+write
		try {
			const data = await this._fileService.readFile(fromUri);
			await this._fileService.writeFile(toUri, data.value);
			return true;
		} catch {
			return false;
		}
	}

	private _cleanContentForDisplay(content: string): string {
		if (!content) return '';

		let text = String(content).replace(/\r\n/g, '\n');
		let lines = text.split('\n');

		// Preserve existing behavior: remove leading absolute path line before a code fence
		if (lines.length >= 2) {
			const firstRaw = (lines[0] ?? '').trim();
			const second = (lines[1] ?? '').trim();

			const secondIsFence = /^```[a-zA-Z0-9_-]*\s*$/.test(second);

			const firstSansSuffix = firstRaw.replace(
				/\s+\(lines?\s+\d+(?:\s*-\s*\d+)?\)\s*$/i,
				''
			);

			const looksLikeAbsPath =
				(
					firstSansSuffix.startsWith('/') ||
					/^[A-Za-z]:[\\/]/.test(firstSansSuffix)
				) &&
				!firstSansSuffix.includes('```') &&
				firstSansSuffix.length < 500;

			if (looksLikeAbsPath && secondIsFence) {
				lines.shift();
				if ((lines[0] ?? '').trim() === '') {
					lines.shift();
				}
			}
		}

		text = lines.join('\n');
		text = text.replace(/^\s*```[a-zA-Z0-9_-]*\s*\n/, '');
		text = text.replace(/\n\s*```\s*$/, '');

		return text.trim();
	}

	public async processToolResult(result: ToolOutputInput, toolName?: string): Promise<{ result: ToolOutputInput; content: string; displayContent: string }> {

		const rawMax = (this._settingsService.state.globalSettings as { maxToolOutputLength?: JsonValue }).maxToolOutputLength;
		const maxToolOutputLength =
			(typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0) ? rawMax :
				(typeof rawMax === 'string' && Number.isFinite(Number(rawMax)) && Number(rawMax) > 0) ? Number(rawMax) :
					16000;

		const safeJson = (v: ToolOutputInput, max = 300): string => {
			try {
				const s = JSON.stringify(v);
				return s.length > max ? s.slice(0, max) + '…' : s;
			} catch {
				const s = String(v);
				return s.length > max ? s.slice(0, max) + '…' : s;
			}
		};

		const tool = String(toolName ?? '').trim();
		const isRunCommand = tool === 'run_command' || tool === 'run_persistent_command';
		const isReadFile = tool === 'read_file';

		const tryExtractReadFileInfo = (): { filePath?: string; startLine?: number; endLine?: number; fileTotalLines?: number } => {
			if (!resObj) return {};

			// read_file payload is often either:
			//   { uri, startLine, endLine, fileContents }
			// or:
			//   { result: { uri, startLine, endLine, fileContents } }
			const container: any = (() => {
				const r = (resObj as any).result;
				return (r && typeof r === 'object' && !Array.isArray(r)) ? r : resObj;
			})();

			const startLine = (() => {
				const n = Number(container?.startLine);
				return Number.isFinite(n) && n > 0 ? n : undefined;
			})();

			const endLine = (() => {
				const n = Number(container?.endLine);
				return Number.isFinite(n) && n > 0 ? n : undefined;
			})();

			const fileTotalLines = (() => {
				const n = Number(container?.totalNumLines);
				return Number.isFinite(n) && n > 0 ? n : undefined;
			})();

			const uriObj = container?.uri;
			if (uriObj && typeof uriObj === 'object' && !Array.isArray(uriObj)) {
				const fsPath = (uriObj as any).fsPath;
				if (typeof fsPath === 'string' && fsPath.trim()) {
					return {
						filePath: fsPath,
						startLine,
						endLine,
						fileTotalLines,
					};
				}
			}

			// Fallback: parse from output text like "/abs/path/file.ts (lines 10-200)"
			const candidate = String(fullText || uiText || '').replace(/\r\n/g, '\n');
			const firstNonEmpty = candidate.split('\n').find(l => l.trim().length > 0) ?? '';
			const m = firstNonEmpty.trim().match(/^(.+?)\s+\(lines?\s+(\d+)(?:\s*-\s*(\d+))?\)\s*$/i);
			if (m) {
				const p = (m[1] ?? '').trim();
				const s = Number(m[2]);
				const e = m[3] ? Number(m[3]) : undefined;
				return {
					filePath: p || undefined,
					startLine: Number.isFinite(s) && s > 0 ? s : undefined,
					endLine: typeof e === 'number' && Number.isFinite(e) && e > 0 ? e : undefined,
				};
			}

			return {};
		};

		const isStringInput = typeof result === 'string';
		const resObj: JsonObject | null = (!isStringInput && isJsonObject(result)) ? result : null;

		const TRUNC_META_RE = /TRUNCATION_META:\s*(\{[^\r\n]*\})/;

		const extractTruncationMetaMatch = (text: string): { meta: JsonObject; endIndex: number } | null => {
			if (!text) return null;
			const tailStart = Math.max(0, text.length - 4000);
			const tail = text.slice(tailStart);
			const matches = [...tail.matchAll(new RegExp(TRUNC_META_RE.source, 'g'))];
			const m = matches[matches.length - 1];
			if (!m || m.index === undefined) return null;
			try {
				const parsed = JSON.parse(m[1]) as JsonValue;
				if (!isJsonObject(parsed)) return null;
				return { meta: parsed, endIndex: tailStart + m.index + m[0].length };
			} catch {
				return null;
			}
		};

		const extractTruncationMeta = (text: string): JsonObject | null => {
			return extractTruncationMetaMatch(text)?.meta ?? null;
		};

		const hasTruncationFooter = (text: string): boolean => {
			if (!text) return false;
			const match = extractTruncationMetaMatch(text);
			if (!match || text.lastIndexOf('[VOID] TOOL OUTPUT TRUNCATED', match.endIndex) < 0) return false;
			const originalLength = match.meta.originalLength;
			const maxChars = match.meta.maxChars;
			const hasTrustedShape = typeof originalLength === 'number'
				&& Number.isFinite(originalLength)
				&& typeof maxChars === 'number'
				&& Number.isFinite(maxChars)
				&& (match.meta.tool === 'read_file'
					|| typeof match.meta.logFilePath === 'string'
					|| (match.meta.summaryVersion === 2 && match.meta.rawLogAvailable === false));
			if (!hasTrustedShape) return false;
			const trailingText = text.slice(match.endIndex).trim();
			return !trailingText || /^\(?(?:exit\s+(?:code|signal|status)|Command was interrupted)\b[^\n]*\)?$/i.test(trailingText);
		};

		let uiText: string;
		let uiTextSource: string;

		const footerText =
			(resObj && typeof getStringField(resObj, 'text') === 'string' && hasTruncationFooter(getStringField(resObj, 'text')!)) ? getStringField(resObj, 'text')! :
				(resObj && typeof getStringField(resObj, 'content') === 'string' && hasTruncationFooter(getStringField(resObj, 'content')!)) ? getStringField(resObj, 'content')! :
					(resObj && typeof getStringField(resObj, 'output') === 'string' && hasTruncationFooter(getStringField(resObj, 'output')!)) ? getStringField(resObj, 'output')! :
						undefined;

		const runCommandText = resObj && isRunCommand && typeof getStringField(resObj, 'text') === 'string' && typeof getStringField(resObj, 'output') === 'string'
			&& getStringField(resObj, 'text')!.startsWith(getStringField(resObj, 'output')!)
			? getStringField(resObj, 'text')!
			: undefined;

		if (typeof footerText === 'string') {
			uiText = footerText;
			uiTextSource = 'footer_any';
		} else if (typeof runCommandText === 'string') {
			uiText = runCommandText;
			uiTextSource = 'result.text';
		} else if (resObj && typeof getStringField(resObj, 'output') === 'string') {
			uiText = getStringField(resObj, 'output')!;
			uiTextSource = 'result.output';
		} else if (resObj && typeof getStringField(resObj, 'content') === 'string') {
			uiText = getStringField(resObj, 'content')!;
			uiTextSource = 'result.content';
		} else if (isStringInput) {
			uiText = result;
			uiTextSource = 'string_input';
		} else if (resObj && typeof getStringField(resObj, 'text') === 'string') {
			uiText = getStringField(resObj, 'text')!;
			uiTextSource = 'result.text';
		} else if (resObj && getStringField(resObj, '_type') === 'text' && typeof getStringField(resObj, 'content') === 'string') {
			uiText = getStringField(resObj, 'content')!;
			uiTextSource = '_type_text.content';
		} else if (resObj && typeof getStringField(resObj, 'fileContents') === 'string') {
			uiText = getStringField(resObj, 'fileContents')!;
			uiTextSource = 'fileContents_as_uiText';
		} else {
			uiText = safeJson(result, 10_000);
			uiTextSource = 'json_fallback';
		}

		const keyText =
			(resObj && typeof getStringField(resObj, 'output') === 'string') ? getStringField(resObj, 'output')! :
				(resObj && typeof getStringField(resObj, 'content') === 'string') ? getStringField(resObj, 'content')! :
					(resObj && typeof getStringField(resObj, 'text') === 'string') ? getStringField(resObj, 'text')! :
						uiText;

		const fullText =
			(resObj && typeof getStringField(resObj, 'fileContents') === 'string') ? getStringField(resObj, 'fileContents')! :
				keyText;

		const hasValidTruncationFooter = hasTruncationFooter(uiText);
		const terminalTimeoutMessageMatch = isRunCommand ? fullText.match(/\n(Terminal command run, but was stopped by Void because it exceeded the configured terminal command timeout \([^\n]+\)\.)\s*$/) : null;
		const terminalTimeoutMessage = terminalTimeoutMessageMatch?.[1];
		const fullTextWithoutTerminalTimeoutMessage = terminalTimeoutMessage ? fullText.slice(0, terminalTimeoutMessageMatch.index).trimEnd() : fullText;

		const terminalCommandHeader = resObj ? getStringField(resObj, 'commandHeader') : undefined;
		const firstTerminalLine = fullText.split(/\r\n|\r|\n/, 1)[0];
		const effectiveCommandHeader = terminalCommandHeader ?? (firstTerminalLine.startsWith('$ ') ? firstTerminalLine : undefined);
		const terminalCommand = effectiveCommandHeader?.replace(/^\$\s*/, '') ?? '';
		const bodyStartLine = effectiveCommandHeader && fullText.startsWith(`${effectiveCommandHeader}\n`) ? 1 : 0;
		const statusTextFromFullOutput = (() => {
			const lastLine = fullText.split(/\r\n|\r|\n/).at(-1);
			return lastLine && (/^\(?exit\s+(?:code|signal|status)\b/i.test(lastLine) || /^Terminal command\b/.test(lastLine) || /^\(Command was interrupted\b/.test(lastLine))
				? lastLine
				: undefined;
		})();
		const terminalBodyOutput = fullText.split(/\r\n|\r|\n/).slice(bodyStartLine, statusTextFromFullOutput ? -1 : undefined).join('\n');
		const rawLineCount = fullText ? fullText.split(/\r\n|\r|\n/).length : 0;
		const bodyLineCount = terminalBodyOutput ? terminalBodyOutput.split(/\r\n|\r|\n/).length : 0;
		const bodyEndLine = bodyStartLine + bodyLineCount;
		const processStatus = (() => {
			if (terminalTimeoutMessage || /interrupted/i.test(statusTextFromFullOutput ?? '')) { return 'failure' as const; }
			if (resObj) {
				const exitStatus = resObj.exitStatus;
				if (isJsonObject(exitStatus)) {
					const exitCode = exitStatus.exitCode;
					if (typeof exitCode === 'number' && Number.isFinite(exitCode)) { return exitCode === 0 ? 'success' as const : 'failure' as const; }
				}
				const resolveReason = resObj.resolveReason;
				if (isJsonObject(resolveReason)) {
					if (resolveReason.type === 'timeout' || resolveReason.type === 'interrupted') { return 'failure' as const; }
					if (resolveReason.type === 'done' && typeof resolveReason.exitCode === 'number') { return resolveReason.exitCode === 0 ? 'success' as const : 'failure' as const; }
				}
				const exitCode = resObj.exitCode;
				if (typeof exitCode === 'number' && Number.isFinite(exitCode)) { return exitCode === 0 ? 'success' as const : 'failure' as const; }
			}
			return 'unknown' as const;
		})();
		const processStatusText = terminalTimeoutMessage ?? statusTextFromFullOutput;
		const processStatusRange = processStatusText
			? { startLine: rawLineCount, endLine: rawLineCount }
			: processStatus === 'unknown' ? undefined : { startLine: Math.max(1, bodyEndLine), endLine: Math.max(1, bodyEndLine) };

		const makeLeanResult = (stripFileContents: boolean): ToolOutputInput => {
			if (!resObj) return result;
			if (!stripFileContents) return result;

			const lean: JsonObject = { ...resObj };
			if (typeof lean.fileContents === 'string') delete lean.fileContents;
			return lean;
		};

		const terminalId = resObj ? getStringField(resObj, 'terminalId') : undefined;
		const toolCallId = resObj ? getStringField(resObj, 'toolCallId') : undefined;

		const stablePath = stableToolOutputsRelPath({
			toolName: tool,
			terminalId,
			toolCallId,
			keyText,
			fullText,
		});

		// =========================
		// A: footer already present
		// =========================
		if (hasValidTruncationFooter) {

			if (isReadFile) {
				const uiContent = uiText;
				const displayContent = this._cleanContentForDisplay(uiContent);
				return {
					result: makeLeanResult(true),
					content: uiContent,
					displayContent,
				};
			}


			const meta = extractTruncationMeta(uiText);
			const preserveImmutableSummaryFooter = meta?.summarizer === true;

			if (meta && !preserveImmutableSummaryFooter) {
				try {
					const metaLogFilePath = typeof meta.logFilePath === 'string' ? meta.logFilePath : undefined;

					const footerNorm = metaLogFilePath ? normalizeMetaLogFilePath(metaLogFilePath) : undefined;
					const footerLooksStable = looksLikeStableToolOutputsRelPath(footerNorm);

					const desired = footerLooksStable ? (footerNorm as string | undefined) : stablePath;

					let canRewrite = false;

					if (desired && await this._existsToolOutputsFile(desired)) {
						canRewrite = true;
					} else {
						const fileContents = resObj ? getStringField(resObj, 'fileContents') : undefined;
						const hasFullForSave = typeof fileContents === 'string' && fileContents.length > maxToolOutputLength;

						if (hasFullForSave && desired) {
							canRewrite = await this._writeToolOutputsFileOverwrite(desired, fileContents);
						} else if (footerNorm && desired && footerNorm !== desired) {
							canRewrite = await this._copyToolOutputsFileBestEffort(footerNorm, desired);
						}
					}

					if (canRewrite && desired) {
						let metaChanged = false;
						if (meta.logFilePath !== desired) {
							meta.logFilePath = desired;
							metaChanged = true;
						}
						if (meta.summaryVersion === 2 && meta.rawLogAvailable !== true) {
							meta.rawLogAvailable = true;
							metaChanged = true;
						}
						if (metaChanged) {
							uiText = uiText.replace(
								/TRUNCATION_META:\s*\{[^\r\n]*\}/,
								`TRUNCATION_META: ${JSON.stringify(meta)}`
							);
						}
					} else if (meta.summaryVersion === 2 && meta.rawLogAvailable === true) {
						meta.rawLogAvailable = false;
						delete meta.logFilePath;
						uiText = uiText.replace(
							/TRUNCATION_META:\s*\{[^\r\n]*\}/,
							`TRUNCATION_META: ${JSON.stringify(meta)}`
						).replace(/^Full unsummarized output is available via read_file on logFilePath\.\n/m, '');
					}
				} catch (e) {
					console.error('failed to parse meta', e);
				}
			}

			const metaMatch = extractTruncationMetaMatch(uiText);
			let uiContent = metaMatch ? uiText.slice(0, metaMatch.endIndex) : uiText;

			if (uiTextSource === 'result.text' && resObj && typeof getStringField(resObj, 'fileContents') === 'string' && getStringField(resObj, 'fileContents')!.length) {
				const lines = uiText.split('\n');
				if (lines.length > 0 && /[\\/]/.test(lines[0]) && !lines[0].startsWith('[VOID]')) {
					lines.shift();
					if (lines.length > 0 && lines[0].trim() === '') lines.shift();
					uiContent = lines.join('\n');
				}
			}

			const displayContent = isRunCommand ? uiContent : this._cleanContentForDisplay(uiContent);
			const defaultStrip = preserveImmutableSummaryFooter
				|| ((resObj && typeof getStringField(resObj, 'fileContents') === 'string') ? getStringField(resObj, 'fileContents')!.length : 0) > maxToolOutputLength;

			return {
				result: makeLeanResult(defaultStrip),
				content: uiContent,
				displayContent,
			};
		}

		// =========================
		// B: no footer - truncate ourselves
		// =========================
		if (!fullText) {
			const displayContent = isRunCommand ? uiText : this._cleanContentForDisplay(uiText);
			return { result: makeLeanResult(false), content: uiText, displayContent };
		}

		const globalSettings = this._settingsService.state.globalSettings;
		const useSummarizer = globalSettings.terminalOutputSummarization !== false;
		if (useSummarizer && isRunCommand) {
			const headLines = globalSettings.terminalOutputHeadLines ?? defaultGlobalSettings.terminalOutputHeadLines;
			const tailLines = globalSettings.terminalOutputTailLines ?? defaultGlobalSettings.terminalOutputTailLines;
			let pipeline: TerminalOutputSummaryPipelineResult | undefined;
			try {
				pipeline = buildTerminalOutputSummaryPipeline({
					rawOutput: fullText,
					bodyOutput: terminalBodyOutput,
					bodyStartLine,
					command: terminalCommand,
					commandHeader: effectiveCommandHeader,
					commandRange: bodyStartLine === 1 ? { startLine: 1, endLine: 1 } : undefined,
					processStatus,
					processStatusText: processStatusText ?? (processStatus === 'success' ? '(exit code 0)' : processStatus === 'failure' ? '(exit status failure)' : undefined),
					processStatusRange,
					headLines,
					tailLines,
				});
			} catch {
				pipeline = undefined;
			}

			if (pipeline) {
				const makeMeta = (
					reason: SummaryReason,
					rendered: Pick<TerminalOutputSummaryRenderResult, 'body' | 'omittedRawLines' | 'omittedBlocks' | 'omittedDiagnostics'>,
					rawLogAvailable: boolean,
					compatibilitySummary?: SummarizerResult,
				): JsonObject => ({
					...(rawLogAvailable ? { logFilePath: stablePath } : {}),
					originalLength: fullText.length,
					originalLineCount: pipeline.rawLineCount,
					linesOmitted: compatibilitySummary?.linesOmitted ?? rendered.omittedRawLines,
					preservedSemanticLines: compatibilitySummary?.preservedSemanticLines ?? pipeline.protectedSignals,
					wasCharTruncated: compatibilitySummary?.wasCharTruncated ?? rendered.omittedBlocks > 0,
					maxChars: maxToolOutputLength,
					summarizer: true,
					summaryVersion: 2,
					profile: pipeline.summary.profile,
					adapter: pipeline.summary.adapter,
					confidence: pipeline.summary.confidence,
					summaryReason: reason,
					resultLength: rendered.body.length,
					omittedRawLines: rendered.omittedRawLines,
					omittedBlocks: rendered.omittedBlocks,
					omittedDiagnostics: rendered.omittedDiagnostics,
					protectedSignals: pipeline.protectedSignals,
					rawLogAvailable,
				});
				const makeFooter = (
					reason: SummaryReason,
					rendered: Pick<TerminalOutputSummaryRenderResult, 'body' | 'omittedRawLines' | 'omittedBlocks' | 'omittedDiagnostics'>,
					rawLogAvailable: boolean,
					compatibilitySummary?: SummarizerResult,
				): string => [
					`[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.`,
					`Output was deterministically summarized by the terminal output profile pipeline.`,
					...(rawLogAvailable ? [`Full unsummarized output is available via read_file on logFilePath.`] : []),
					`TRUNCATION_META: ${JSON.stringify(makeMeta(reason, rendered, rawLogAvailable, compatibilitySummary))}`,
				].join('\n');
				const renderWithFooter = (reason: SummaryReason, rawLogAvailable: boolean, compatibilitySummary?: SummarizerResult): TerminalOutputSummaryRenderResult => {
					const maximumMetrics: Pick<TerminalOutputSummaryRenderResult, 'body' | 'omittedRawLines' | 'omittedBlocks' | 'omittedDiagnostics'> = {
						body: fullText,
						omittedRawLines: pipeline.rawLineCount,
						omittedBlocks: pipeline.summary.blocks.length + pipeline.summary.counts.length + 1,
						omittedDiagnostics: pipeline.summary.diagnostics.length,
					};
					let footer = makeFooter(reason, maximumMetrics, rawLogAvailable, compatibilitySummary);
					let rendered = renderTerminalOutputSummary(pipeline.summary, {
						maxOutputLength: maxToolOutputLength,
						footer,
						rawLineCount: pipeline.rawLineCount,
					});
					for (let iteration = 0; iteration < 8; iteration++) {
						const nextFooter = makeFooter(reason, rendered, rawLogAvailable, compatibilitySummary);
						if (nextFooter === footer) { break; }
						footer = nextFooter;
						rendered = renderTerminalOutputSummary(pipeline.summary, {
							maxOutputLength: maxToolOutputLength,
							footer,
							rawLineCount: pipeline.rawLineCount,
						});
					}
					return rendered;
				};
				const candidateReason: SummaryReason = fullText.length > maxToolOutputLength ? 'hard-limit' : 'verbose';
				const makeCompatibilityOptions = (maxOutputLength: number): SummarizerOptions => ({ headLines, tailLines, maxOutputLength });
				const unbudgetedCompatibilitySummary = summarizeTerminalOutput(fullText, makeCompatibilityOptions(0));
				const candidateRender = renderWithFooter(candidateReason, true, unbudgetedCompatibilitySummary);
				const compatibilityBodyBudget = Math.max(0, maxToolOutputLength - candidateRender.footer.length - 2);
				const compatibilitySummary = compatibilityBodyBudget > 0
					? summarizeTerminalOutput(fullText, makeCompatibilityOptions(compatibilityBodyBudget))
					: { ...unbudgetedCompatibilitySummary, text: '', wasCharTruncated: unbudgetedCompatibilitySummary.text.length > 0 };
				const useCompatibilityBody = candidateReason === 'hard-limit' && pipeline.summary.profile === 'generic';
				const compatibilityCandidateRender = useCompatibilityBody
					? renderWithFooter(candidateReason, true, compatibilitySummary)
					: candidateRender;
				const candidateText = useCompatibilityBody
					? (compatibilitySummary.text ? `${compatibilitySummary.text}\n\n${compatibilityCandidateRender.footer}` : compatibilityCandidateRender.footer)
					: candidateRender.text;
				const candidate: TerminalOutputSummaryCandidate = {
					summary: pipeline.summary,
					text: candidateText,
					mandatorySignals: pipeline.mandatorySignals,
					verboseEvidence: pipeline.verboseEvidence,
				};
				const decision = shouldSummarizeTerminalOutput(fullText.length, maxToolOutputLength, candidate);
				if (decision.kind === 'pass-through') {
					return { result: makeLeanResult(false), content: uiText, displayContent: uiText };
				}

				const rawLogAvailable = await this._writeToolOutputsFileOverwrite(stablePath, fullText);
				if (!rawLogAvailable && decision.kind === 'verbose') {
					return { result: makeLeanResult(false), content: uiText, displayContent: uiText };
				}
				const rendered = rawLogAvailable
					? renderWithFooter(decision.kind, true, compatibilitySummary)
					: renderWithFooter('hard-limit', false, compatibilitySummary);
				const finalText = useCompatibilityBody
					? (compatibilitySummary.text ? `${compatibilitySummary.text}\n\n${rendered.footer}` : rendered.footer)
					: rendered.text;
				return {
					result: makeLeanResult(true),
					content: finalText,
					displayContent: finalText,
				};
			}

			if (fullText.length > maxToolOutputLength) {
				const makeOptions = (maxOutputLength: number): SummarizerOptions => ({ headLines, tailLines, maxOutputLength });
				const makeMeta = (summary: SummarizerResult, rawLogAvailable: boolean): JsonObject => ({
					...(rawLogAvailable ? { logFilePath: stablePath } : {}),
					originalLength: summary.originalLength,
					originalLineCount: summary.originalLineCount,
					linesOmitted: summary.linesOmitted,
					preservedSemanticLines: summary.preservedSemanticLines,
					wasCharTruncated: summary.wasCharTruncated,
					maxChars: maxToolOutputLength,
					summarizer: true,
					rawLogAvailable,
				});
				const rawLogAvailable = await this._writeToolOutputsFileOverwrite(stablePath, fullText);
				const unbudgetedSummary = summarizeTerminalOutput(fullText, makeOptions(0));
				const makeFooter = (summary: SummarizerResult): string => [
					`[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.`,
					`Output was summarized (deduplicated, head/tail with semantic preservation).`,
					...(rawLogAvailable ? [`Full unsummarized output is available via read_file on logFilePath.`] : []),
					`TRUNCATION_META: ${JSON.stringify(makeMeta(summary, rawLogAvailable))}`,
				].join('\n');
				const reservedFooter = makeFooter({ ...unbudgetedSummary, wasCharTruncated: false });
				const bodyBudget = Math.max(0, maxToolOutputLength - reservedFooter.length - 2);
				const summary = bodyBudget > 0
					? summarizeTerminalOutput(fullText, makeOptions(bodyBudget))
					: { ...unbudgetedSummary, text: '', wasCharTruncated: unbudgetedSummary.text.length > 0 };
				const footer = makeFooter(summary);
				const finalText = summary.text ? `${summary.text}\n\n${footer}` : footer;
				return { result: makeLeanResult(true), content: finalText, displayContent: finalText };
			}
		}

		if (fullText.length <= maxToolOutputLength) {
			const displayContent = isRunCommand ? uiText : this._cleanContentForDisplay(uiText);
			return { result: makeLeanResult(false), content: uiText, displayContent };
		}

		const { truncatedBody, originalLength, needsTruncation, lineAfterTruncation } =
			computeTruncatedToolOutput(fullTextWithoutTerminalTimeoutMessage, maxToolOutputLength);

		if (!needsTruncation) {
			const displayContent = isRunCommand ? uiText : this._cleanContentForDisplay(uiText);
			return { result: makeLeanResult(false), content: uiText, displayContent };
		}

		const startLineExclusive = lineAfterTruncation > 0 ? lineAfterTruncation : 0;

		const headerLines = [
			`[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.`,
			`Only the first ${maxToolOutputLength} characters are included in this message.`,
			`Display limit: maxToolOutputLength = ${maxToolOutputLength} characters.`,
		];

		let instructionsLines: string[];
		let meta: any;

		if (isReadFile) {
			const info = tryExtractReadFileInfo();
			const filePath = info.filePath;

			const { truncatedBody, originalLength, needsTruncation, lineAfterTruncation } =
				computeTruncatedToolOutput(fullText, maxToolOutputLength);

			if (!needsTruncation) {
				const displayContent = isRunCommand ? uiText : this._cleanContentForDisplay(uiText);
				return { result: makeLeanResult(false), content: uiText, displayContent };
			}

			const startLineExclusive = lineAfterTruncation > 0 ? lineAfterTruncation : 0;
			const requestedStartLine = info.startLine ?? 1;
			const nextStartLine = requestedStartLine + startLineExclusive;

			const rawChunk = (this._settingsService.state.globalSettings as { readFileChunkLines?: JsonValue }).readFileChunkLines;
			const chunkSize =
				(typeof rawChunk === 'number' && Number.isFinite(rawChunk) && rawChunk > 0) ? rawChunk :
					(typeof rawChunk === 'string' && Number.isFinite(Number(rawChunk)) && Number(rawChunk) > 0) ? Number(rawChunk) :
						defaultGlobalSettings.readFileChunkLines;
			const suggestedEndLine = nextStartLine + chunkSize - 1;
			const fileTotalLines = info.fileTotalLines;
			const suggested = filePath ? {
				startLine: nextStartLine,
				endLine: suggestedEndLine,
				chunkLines: chunkSize,
				endLineIsFileEnd: false,
			} : undefined;

			const headerLines = [
				`[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.`,
				`Only the first ${maxToolOutputLength} characters are included in this message.`,
				`Display limit: maxToolOutputLength = ${maxToolOutputLength} characters.`,
			];

			const instructionsLines = filePath ? [
				`IMPORTANT FOR THE MODEL:`,
				`  1. Do NOT guess based only on this truncated output.`,
				`  2. Continue by calling read_file on the ORIGINAL uri (NOT on a tool-output log):`,
				`     read_file({ uri: ${JSON.stringify(filePath)}, startLine: ${nextStartLine}, endLine: ${suggestedEndLine} })`,
				`  3. IMPORTANT: endLine above is a chunk boundary, NOT the end of file.`,
				`  4. Recommended next chunk size: readFileChunkLines = ${chunkSize}.`,
				...(typeof fileTotalLines === 'number'
					? [`     Known total file lines (from tool): ${fileTotalLines}.`]
					: []),
				`  5. If still truncated, increase startLine by about ${chunkSize} and repeat.`,
			] : [
				`IMPORTANT FOR THE MODEL:`,
				`  1. Do NOT guess based only on this truncated output.`,
				`  2. Re-run read_file with a smaller range (startLine/endLine).`,
			];

			const meta = {
				tool: 'read_file',
				uri: filePath,
				requestedStartLine,
				nextStartLine,
				suggested,
				...(typeof fileTotalLines === 'number' ? { fileTotalLines } : {}),
				maxChars: maxToolOutputLength,
				originalLength
			};

			const finalText =
				`${truncatedBody}...\n\n` +
				`${headerLines.join('\n')}\n` +
				`${instructionsLines.join('\n')}\n` +
				`TRUNCATION_META: ${JSON.stringify(meta)}`;

			const displayContent = isRunCommand ? finalText : this._cleanContentForDisplay(finalText);
			return { result: makeLeanResult(true), content: finalText, displayContent };
		} else {
			await this._writeToolOutputsFileOverwrite(stablePath, fullText);

			instructionsLines = [
				`IMPORTANT FOR THE MODEL:`,
				`  1. Do NOT guess based only on this truncated output.`,
				`  2. To see the rest of this tool output, you MUST call your file-reading tool (for example, read_file)`,
				`     on logFilePath, starting from line startLineExclusive + 1.`,
			];

			meta = { logFilePath: stablePath, startLineExclusive, maxChars: maxToolOutputLength, originalLength };
		}

		const metaLine = `TRUNCATION_META: ${JSON.stringify(meta)}`;

		const finalText =
			`${truncatedBody}...\n\n` +
			`${headerLines.join('\n')}\n` +
			`${instructionsLines.join('\n')}\n` +
			`${terminalTimeoutMessage ? `${terminalTimeoutMessage}\n` : ''}` +
			`${metaLine}`;

		const displayContent = isRunCommand ? finalText : this._cleanContentForDisplay(finalText);

		return {
			result: makeLeanResult(true),
			content: finalText,
			displayContent,
		};
	}
}
