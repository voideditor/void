import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { defaultGlobalSettings } from '../../../../platform/void/common/voidSettingsTypes.js';
import { computeTruncatedToolOutput } from '../../../../platform/void/common/toolOutputTruncation.js';
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

		// Prefer native copy if available
		try {
			const fileService = this._fileService as { copy?: (from: URI, to: URI, overwrite: boolean) => Promise<any> };
			if (typeof fileService.copy === 'function') {
				await fileService.copy(fromUri, toUri, true);
				return true;
			}
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

		const TRUNC_META_RE = /TRUNCATION_META:\s*(\{[\s\S]*\})\s*$/;

		const extractTruncationMeta = (text: string): JsonObject | null => {
			if (!text) return null;
			const tail = text.slice(-4000);
			const m = tail.match(TRUNC_META_RE);
			if (!m) return null;
			try {
				const parsed = JSON.parse(m[1]) as JsonValue;
				return isJsonObject(parsed) ? parsed : null;
			} catch {
				return null;
			}
		};

		const hasTruncationFooter = (text: string): boolean => {
			if (!text) return false;
			const tail = text.slice(-4000);
			return tail.includes('[VOID] TOOL OUTPUT TRUNCATED') && !!extractTruncationMeta(text);
		};

		let uiText: string;
		let uiTextSource: string;

		const footerText =
			(resObj && typeof getStringField(resObj, 'text') === 'string' && hasTruncationFooter(getStringField(resObj, 'text')!)) ? getStringField(resObj, 'text')! :
				(resObj && typeof getStringField(resObj, 'content') === 'string' && hasTruncationFooter(getStringField(resObj, 'content')!)) ? getStringField(resObj, 'content')! :
					(resObj && typeof getStringField(resObj, 'output') === 'string' && hasTruncationFooter(getStringField(resObj, 'output')!)) ? getStringField(resObj, 'output')! :
						undefined;

		if (typeof footerText === 'string') {
			uiText = footerText;
			uiTextSource = 'footer_any';
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
				const displayContent = isRunCommand ? uiContent : this._cleanContentForDisplay(uiContent);
				return {
					result: makeLeanResult(true),
					content: uiContent,
					displayContent,
				};
			}


			const metaMatch = uiText.match(TRUNC_META_RE);

			if (metaMatch) {
				try {
					const parsed = JSON.parse(metaMatch[1]) as JsonValue;
					if (isJsonObject(parsed)) {
						const meta = parsed;

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

						if (canRewrite && desired && meta.logFilePath !== desired) {
							meta.logFilePath = desired;
							uiText = uiText.replace(
								/TRUNCATION_META:\s*\{[\s\S]*\}\s*$/m,
								`TRUNCATION_META: ${JSON.stringify(meta)}`
							);
						}
					}
				} catch (e) {
					console.error('failed to parse meta', e);
				}
			}

			let uiContent = uiText;

			if (uiTextSource === 'result.text' && resObj && typeof getStringField(resObj, 'fileContents') === 'string' && getStringField(resObj, 'fileContents')!.length) {
				const lines = uiText.split('\n');
				if (lines.length > 0 && /[\\/]/.test(lines[0]) && !lines[0].startsWith('[VOID]')) {
					lines.shift();
					if (lines.length > 0 && lines[0].trim() === '') lines.shift();
					uiContent = lines.join('\n');
				}
			}

			const displayContent = isRunCommand ? uiContent : this._cleanContentForDisplay(uiContent);
			const defaultStrip = ((resObj && typeof getStringField(resObj, 'fileContents') === 'string') ? getStringField(resObj, 'fileContents')!.length : 0) > maxToolOutputLength;

			return {
				result: makeLeanResult(defaultStrip),
				content: uiContent,
				displayContent,
			};
		}

		// =========================
		// B: no footer — truncate ourselves
		// =========================
		if (!fullText || fullText.length <= maxToolOutputLength) {
			const displayContent = isRunCommand ? uiText : this._cleanContentForDisplay(uiText);
			return { result: makeLeanResult(false), content: uiText, displayContent };
		}

		const { truncatedBody, originalLength, needsTruncation, lineAfterTruncation } =
			computeTruncatedToolOutput(fullText, maxToolOutputLength);

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
			`${metaLine}`;

		const displayContent = isRunCommand ? finalText : this._cleanContentForDisplay(finalText);

		return {
			result: makeLeanResult(true),
			content: finalText,
			displayContent,
		};
	}
}
