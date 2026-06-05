/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../base/common/uuid.js'
import { endsWithAnyPrefixOf } from '../../common/helpers/extractCodeFromResult.js'
import { availableTools, InternalToolInfo } from '../../common/toolsRegistry.js'
import { ToolName, ToolParamName } from '../../common/toolsServiceTypes.js'
import { OnFinalMessage, OnText, RawToolCallObj, RawToolParamsObj } from '../../common/sendLLMMessageTypes.js'
import { ChatMode } from '../../common/voidSettingsTypes.js'


const escapeRegExp = (s: string) =>
	s.replace(/[\\\^\$\.\*\+\?\(\)\[\]\{\}\|\/\-]/g, '\\$&');

type ToolOfToolName = { [toolName: string]: InternalToolInfo | undefined }

//this need if llm tool (edit_file) call with  CDATA block
const extractParamValue = (
	str: string,
	paramName: string,
	toolName: string
): { value: string | undefined; endIndex: number } => {
	const needsCDATA = toolName === 'edit_file' &&
		(paramName === 'original_snippet' || paramName === 'updated_snippet');

	const esc = escapeRegExp(paramName);
	const openRe = new RegExp(`<${esc}\\b[^>]*>`, 'i');   // <param ...>
	const closeRe = new RegExp(`</${esc}\\s*>`, 'i');     // </param>

	const openMatch = openRe.exec(str);
	if (!openMatch) return { value: undefined, endIndex: -1 };

	const contentStart = (openMatch.index ?? 0) + openMatch[0].length;

	if (needsCDATA) {
		const cStart = str.indexOf('<![CDATA[', contentStart);
		if (cStart !== -1) {
			const cEnd = str.indexOf(']]>', cStart + 9);
			if (cEnd !== -1) {
				const tailAfterCdata = str.slice(cEnd + 3);
				const closeMatchAfter = closeRe.exec(tailAfterCdata);
				if (closeMatchAfter) {
					const value = str.slice(cStart + 9, cEnd);
					const endIndex = (cEnd + 3) + ((closeMatchAfter.index ?? 0) + closeMatchAfter[0].length);
					return { value, endIndex };
				}
			}
		}
	}

	const tail = str.slice(contentStart);
	const closeMatch = closeRe.exec(tail);
	if (!closeMatch) return { value: undefined, endIndex: -1 };

	const valueEnd = contentStart + (closeMatch.index ?? 0);
	const value = str.slice(contentStart, valueEnd);
	return { value, endIndex: valueEnd + closeMatch[0].length };
};


const getRequiredParamNames = (
	toolName: ToolName,
	toolOfToolName: ToolOfToolName
): ToolParamName[] => {
	const def: any = toolOfToolName[toolName]?.params;
	if (!def) return [];
	const required: ToolParamName[] = [];
	for (const key of Object.keys(def)) {
		const meta = def[key];
		if (meta && typeof meta === 'object' && (meta.required === true || meta?.schema?.required === true)) {
			required.push(key as ToolParamName);
		}
	}
	return required;
};

const hasAllRequiredParams = (
	toolName: ToolName,
	paramsObj: RawToolParamsObj,
	toolOfToolName: ToolOfToolName
): boolean => {
	const required = getRequiredParamNames(toolName, toolOfToolName);
	if (required.length === 0) return false;
	return required.every(p => paramsObj[p] !== undefined);
};


const findLastOpenBefore = (s: string, toolName: string, beforeIdx: number): { index: number; len: number } | null => {
	const esc = escapeRegExp(toolName);
	const openReG = new RegExp(`<${esc}\\b[^>]*>`, 'ig');
	let lastIdx = -1;
	let lastLen = 0;
	let m: RegExpExecArray | null;
	while ((m = openReG.exec(s))) {
		if (m.index < beforeIdx) {
			lastIdx = m.index;
			lastLen = m[0].length;
		} else {
			break;
		}
	}
	return lastIdx >= 0 ? { index: lastIdx, len: lastLen } : null;
};


const findParamAnchorBefore = (
	s: string,
	toolName: ToolName,
	beforeIdx: number,
	toolOfToolName: ToolOfToolName
): number => {
	const params = Object.keys(toolOfToolName[toolName]?.params ?? {});
	if (params.length === 0) return -1;
	const alt = params.map(escapeRegExp).join('|');
	const re = new RegExp(`<(?:${alt})\\b[^>]*>`, 'ig');

	let firstIdx = -1;
	let lastIdx = -1;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) {
		if (m.index < beforeIdx) {
			if (firstIdx === -1) firstIdx = m.index;
			lastIdx = m.index;
		} else {
			break;
		}
	}
	return firstIdx >= 0 ? firstIdx : lastIdx;
};

const maskCodeBlocks = (s: string): string => {
	if (!s) return s;
	const len = s.length;
	const mask = new Uint8Array(len);


	const mark = (from: number, to: number) => {
		if (from < 0 || to <= from) return;
		const a = Math.max(0, Math.min(len, from));
		const b = Math.max(0, Math.min(len, to));
		for (let i = a; i < b; i++) mask[i] = 1;
	};


	{
		const re = /```[\s\S]*?```/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(s))) {
			mark(m.index, m.index + m[0].length);
		}
	}


	{
		const re = /~~~[\s\S]*?~~~/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(s))) {
			mark(m.index, m.index + m[0].length);
		}
	}


	{
		const re = /`[^`\n]+`/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(s))) {
			mark(m.index, m.index + m[0].length);
		}
	}

	
	if (!mask.includes(1)) return s;
	const out: string[] = new Array(len);
	for (let i = 0; i < len; i++) {
		out[i] = mask[i] ? ' ' : s[i];
	}
	return out.join('');
};


type ToolRegion =
	| { kind: 'self'; toolName: ToolName; start: number; end: number }
	| { kind: 'openOnly'; toolName: ToolName; start: number; end: number }
	| { kind: 'openClose'; toolName: ToolName; start: number; end: number }
	| { kind: 'closeOnly'; toolName: ToolName; start: number; end: number };

const findFirstToolRegionEnhanced = (
	text: string,
	tools: InternalToolInfo[],
	toolOfToolName: ToolOfToolName
): ToolRegion | null => {
	if (!text || !tools.length) return null;

	const namesAlt = tools.map(t => escapeRegExp(t.name)).join('|');
	if (!namesAlt) return null;

	
	const anyTagRe = new RegExp(`<\\/?(${namesAlt})\\b[^>]*?>`, 'ig');
	const first = anyTagRe.exec(text);
	if (!first) return null;

	const idx = first.index;
	const raw = first[0];
	const name = (first[1] || '').toLowerCase() as ToolName;

	const isClose = raw.startsWith('</');
	const isSelf = !isClose && /\/\s*>$/i.test(raw);

	if (isSelf) {
		return { kind: 'self', toolName: name, start: idx, end: idx + raw.length };
	}

	if (!isClose) {
		
		const esc = escapeRegExp(name);
		const openLen = raw.length;
		const tail = text.slice(idx + openLen);
		const closeRe = new RegExp(`</${esc}\\s*>`, 'i');
		const mClose = closeRe.exec(tail);
		if (mClose && mClose.index !== undefined) {
			const end = (idx + openLen) + mClose.index + mClose[0].length;
			return { kind: 'openClose', toolName: name, start: idx, end };
		}
		return { kind: 'openOnly', toolName: name, start: idx, end: text.length };
	}

	
	const closeLen = raw.length;
	const mOpenPrev = findLastOpenBefore(text, name, idx);
	if (mOpenPrev) {
		return { kind: 'openClose', toolName: name, start: mOpenPrev.index, end: idx + closeLen };
	}

	
	const anchor = findParamAnchorBefore(text, name, idx, toolOfToolName);
	const start = (anchor >= 0 ? anchor : idx);
	return { kind: 'closeOnly', toolName: name, start, end: idx + closeLen };
};


const normalizeParamName = (s: string) => {
	let out = (s || '').trim();
	out = out.replace(/-/g, '_');
	// camelCase -> snake_case
	out = out.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
	return out;
};

// If we ever wrap CDATA, avoid breaking on "]]>"
const escapeForCdata = (s: string) => {
	if (!s) return s;
	return s.includes(']]>') ? s.split(']]>').join(']]]]><![CDATA[>') : s;
};

const findToolCallRegion = (maskedText: string): { start: number; end: number } | null => {
	const openRe = /<tool_call\b[^>]*>/i;
	const mOpen = openRe.exec(maskedText);
	if (!mOpen || mOpen.index === undefined) return null;

	const start = mOpen.index;

	// try find close
	const tail = maskedText.slice(start + mOpen[0].length);
	const mClose = /<\/tool_call\s*>/i.exec(tail);
	if (mClose && mClose.index !== undefined) {
		const end = (start + mOpen[0].length) + mClose.index + mClose[0].length;
		return { start, end };
	}

	// no close yet (streaming) -> treat as open until end
	return { start, end: maskedText.length };
};

const buildVoidXmlFromToolCallWrapper = (
	wrapperXml: string,
	toolOfToolName: { [toolName: string]: InternalToolInfo | undefined }
): { toolName: ToolName; xml: string } | null => {
	// function name variants:
	// 1) <function=search_in_file>...</function>
	// 2) <function name="search_in_file">...</function>
	const fnMatch =
		/<function\s*=\s*([a-zA-Z0-9_\-]+)\s*>/i.exec(wrapperXml) ||
		/<function\b[^>]*\bname\s*=\s*["']?([a-zA-Z0-9_\-]+)["']?[^>]*>/i.exec(wrapperXml);

	if (!fnMatch) return null;

	const toolNameRaw = (fnMatch[1] || '').toLowerCase();
	const toolName = toolNameRaw as ToolName;

	// Only transform if tool is actually known/allowed in this context
	if (!toolOfToolName[toolName]) return null;

	const allowedParams = new Set(Object.keys(toolOfToolName[toolName]?.params ?? {}));

	// parameter variants:
	// 1) <parameter=uri>...</parameter>
	// 2) <parameter name="uri">...</parameter>
	const params: Array<{ name: string; value: string }> = [];
	const paramRe =
		/<parameter\s*=\s*([a-zA-Z0-9_\-]+)\s*>([\s\S]*?)<\/parameter\s*>|<parameter\b[^>]*\bname\s*=\s*["']?([a-zA-Z0-9_\-]+)["']?[^>]*>([\s\S]*?)<\/parameter\s*>/ig;

	let m: RegExpExecArray | null;
	while ((m = paramRe.exec(wrapperXml))) {
		const rawName = (m[1] ?? m[3] ?? '').trim();
		const rawVal = (m[2] ?? m[4] ?? '');

		if (!rawName) continue;

		const name = normalizeParamName(rawName);

		// If tool has a known param set, keep only matching ones (optional, but safer)
		if (allowedParams.size > 0 && !allowedParams.has(name)) {
			continue;
		}
		const needsCdata = toolName === 'edit_file' && (name === 'original_snippet' || name === 'updated_snippet');
		const value = needsCdata ? rawVal : rawVal.trim();

		params.push({ name, value });
	}

	// Build void XML
	const inner = params.map(p => {
		const needsCdata = toolName === 'edit_file' && (p.name === 'original_snippet' || p.name === 'updated_snippet');
		if (needsCdata) {
			return `<${p.name}><![CDATA[${escapeForCdata(p.value)}]]></${p.name}>`;
		}
		return `<${p.name}>${p.value}</${p.name}>`;
	}).join('\n');

	// If wrapper has </tool_call> we can close; if not, leave open (streaming-friendly)
	const hasClose = /<\/tool_call\s*>/i.test(wrapperXml);
	const xml = hasClose
		? `<${toolName}>\n${inner}\n</${toolName}>`
		: `<${toolName}>\n${inner}\n`;

	return { toolName, xml };
};

const parseXMLPrefixToToolCall = (
	toolName: ToolName,
	toolId: string,
	str: string,
	toolOfToolName: ToolOfToolName
): RawToolCallObj => {

	const paramsObj: RawToolParamsObj = {};
	const doneParams: ToolParamName[] = [];
	let isDone = false;

	const getAnswer = (): RawToolCallObj => {
		for (const p in paramsObj) {
			const paramName = p as ToolParamName;
			const orig = paramsObj[paramName];
			if (orig === undefined) continue;

			const isCDATAParam = toolName === 'edit_file' &&
				(paramName === 'original_snippet' || paramName === 'updated_snippet');
			if (!isCDATAParam) {
				paramsObj[paramName] = trimBeforeAndAfterNewLines(orig as string);
			}
		}
		return {
			name: toolName,
			rawParams: paramsObj,
			doneParams,
			isDone,
			id: toolId,
		};
	};

	const esc = escapeRegExp(toolName);
	const openRe = new RegExp(`<${esc}\\b[^>]*>`, 'i');    // <tool ...>
	const closeRe = new RegExp(`</${esc}\\s*>`, 'i');      // </tool>
	const selfRe = new RegExp(`<${esc}\\b[^>]*/>`, 'i');   // <tool .../>

	const openMatch = openRe.exec(str);
	const selfMatch = selfRe.exec(str);

	
	if (!openMatch && !selfMatch) return getAnswer();

	
	if (selfMatch && (!openMatch || (selfMatch.index ?? 0) < (openMatch.index ?? 0))) {
		isDone = true;
		return getAnswer();
	}

	
	const start = (openMatch!.index ?? 0) + openMatch![0].length;
	const tail = str.slice(start);
	const closeMatch = closeRe.exec(tail);

	let inner = '';
	if (!closeMatch) {
		
		inner = tail;
	} else {
		inner = tail.slice(0, closeMatch.index ?? 0);
		isDone = true;
	}

	const allowedParams = Object.keys(toolOfToolName[toolName]?.params ?? {}) as ToolParamName[];
	for (const paramName of allowedParams) {
		const { value } = extractParamValue(inner, paramName, toolName);
		if (value !== undefined) {
			paramsObj[paramName] = value;
			doneParams.push(paramName);
		}
	}

	if (!isDone) {
		const allRequiredPresent = hasAllRequiredParams(toolName, paramsObj, toolOfToolName);
		const allAllowedPresent = allowedParams.length > 0 && doneParams.length === allowedParams.length;
		if (allRequiredPresent || allAllowedPresent) {
			isDone = true;
		}
	}

	return getAnswer();
};

const splitProviderReasoning = (s: string, tags: [string, string] | null): { reasoning: string; after: string } => {
	if (!s) return { reasoning: '', after: '' };
	if (!tags) return { reasoning: s, after: '' };

	const [openTag, closeTag] = tags;

	
	const closeIdx = s.lastIndexOf(closeTag);
	if (closeIdx >= 0) {
		const beforeClose = s.slice(0, closeIdx);
		const after = s.slice(closeIdx + closeTag.length);
		const reasoning = beforeClose.split(openTag).join('').split(closeTag).join('');
		return { reasoning, after };
	}

	
	const reasoning = s.split(openTag).join('').split(closeTag).join('');
	return { reasoning, after: '' };
};


type ExtractReasoningWrapperOpts = {
	toolsListOverride?: InternalToolInfo[];
	enableXmlToolParsing?: boolean;
};

export const extractReasoningAndXMLToolsWrapper = (
	onText: OnText,
	onFinalMessage: OnFinalMessage,
	thinkTagsInit: [string, string] | null,
	chatMode: ChatMode | null,
	opts?: ExtractReasoningWrapperOpts
): { newOnText: OnText; newOnFinalMessage: OnFinalMessage } => {

	// Tools
	const enableXmlToolParsing = opts?.enableXmlToolParsing !== false;
	const allowed = enableXmlToolParsing && chatMode ? availableTools(chatMode) : null;
	const toolsList: InternalToolInfo[] =
		!enableXmlToolParsing
			? []
			: (opts?.toolsListOverride && opts.toolsListOverride.length)
				? opts.toolsListOverride
				: (Array.isArray(allowed)
					? allowed
					: (allowed ? Object.values(allowed) : []));

	type ToolOfToolName = { [toolName: string]: InternalToolInfo | undefined };
	const toolOfToolName: ToolOfToolName = {};
	for (const t of toolsList) toolOfToolName[t.name] = t;

	const toolId = generateUuid();

	const toolTagHints = toolsList.map(t => String(t.name || '').toLowerCase()).filter(Boolean);
	const incrementLookbackChars = 96;
	const reasoningPrefixProbeLen = 96;
	let lastReasoningParseObservedLen = 0;
	let lastThinkDetectObservedLen = 0;

	
	let r_foundTag1 = false;
	let r_foundTag2 = false;
	let r_latestAddIdx = 0;
	let r_fullTextSoFar = '';
	let r_fullReasoningSoFar = '';
	let r_providerReasoningAcc = '';

	
	let lastReasoning = '';
	let latestToolCall: RawToolCallObj | undefined = undefined;

	
	let activeThinkTags: [string, string] | null = thinkTagsInit;

	const likelyContainsToolMarkup = (s: string): boolean => {
		if (!s || s.indexOf('<') === -1) return false;
		const lower = s.toLowerCase();

		if (
			lower.includes('<tool_call') ||
			lower.includes('</tool_call') ||
			lower.includes('<function') ||
			lower.includes('</function') ||
			lower.includes('<parameter') ||
			lower.includes('</parameter')
		) {
			return true;
		}

		for (const hint of toolTagHints) {
			if (lower.includes(`<${hint}`) || lower.includes(`</${hint}`)) return true;
		}
		return false;
	};

	const toolOpenMarkers = [
		'<tool_call',
		'</tool_call',
		'<function',
		'</function',
		'<parameter',
		'</parameter',
		...toolTagHints.map(h => `<${h}`),
		...toolTagHints.map(h => `</${h}`),
	];

	const stripTrailingPartialToolMarker = (s: string): string => {
		if (!s || !enableXmlToolParsing || toolOpenMarkers.length === 0) return s;
		if (s.indexOf('<') === -1) return s;

		const lower = s.toLowerCase();
		let trimLen = 0;

		for (const marker of toolOpenMarkers) {
			const m = endsWithAnyPrefixOf(lower, marker);
			if (!m) continue;

			// marker itself still represents an unfinished open/close sequence in streaming context,
			// so trim both partial prefixes and exact marker matches.
			const curr = m.length;
			if (curr > trimLen) trimLen = curr;
		}

		if (trimLen <= 0) return s;
		return s.slice(0, Math.max(0, s.length - trimLen)).trimEnd();
	};

	const shouldParseByIncrement = (full: string, prevLen: number): boolean => {
		if (!enableXmlToolParsing || toolsList.length === 0 || !full) return false;
		const safePrev = Math.max(0, Math.min(prevLen, full.length));
		const start = Math.max(0, safePrev - incrementLookbackChars);
		return likelyContainsToolMarkup(full.slice(start));
	};

	const stripThinkTagsFromText = (s: string): string => {
		if (!s || !activeThinkTags) return s;
		const [openTag, closeTag] = activeThinkTags;
		return s.split(openTag).join('').split(closeTag).join('');
	};

	const stripToolCallWrapperOnce = (s: string): string => {
		if (!s) return s;

		
		const full = s.replace(/<tool_call\b[\s\S]*?<\/tool_call\s*>/i, '');
		if (full !== s) return full.trim();

		
		return s.replace(/<tool_call\b[\s\S]*$/i, '').trimEnd();
	};

	const isBlockToolCall = (beforeText: string): boolean => {
		
		const lastNl = beforeText.lastIndexOf('\n');
		const tail = lastNl >= 0 ? beforeText.slice(lastNl + 1) : beforeText;
		return tail.trim() === '';
	};

	// ============ Utils ============
	const stripToolXmlOnce = (s: string, toolName: string): string => {
		if (!s) return s;
		const esc = escapeRegExp(toolName);
		const re = new RegExp(`<${esc}\\b[\\s\\S]*?<\\/${esc}>`, 'i');
		return s.replace(re, '').trim();
	};

	const stripToolXmlOrOpenTailOnce = (s: string, toolName: string): string => {
		if (!s) return s;
		const esc = escapeRegExp(toolName);

		// Prefer removing a closed block first.
		const closedRe = new RegExp(`<${esc}\\b[\\s\\S]*?<\\/${esc}>`, 'i');
		const removedClosed = s.replace(closedRe, '').trim();
		if (removedClosed !== s) return removedClosed;

		// Streaming/open-only fallback: drop everything from opening tag to end.
		const openTailRe = new RegExp(`<${esc}\\b[^>]*>[\\s\\S]*$`, 'i');
		const removedOpenTail = s.replace(openTailRe, '').trimEnd();
		if (removedOpenTail !== s) return removedOpenTail;

		return s;
	};

	const stripFakeResultTail = (s: string): string => {
		if (!s) return s;
		const m = s.match(/<\w+_result\b[\s\S]*$/i);
		if (!m || m.index === undefined || m.index < 0) return s;
		return s.slice(0, m.index).trimEnd();
	};

	const parseToolFromText = (
		text: string,
		opts?: { skipLikelihoodCheck?: boolean }
	): { beforeText: string; call?: RawToolCallObj; source?: 'tool_call' | 'tool_tag' } => {
		if (!text) return { beforeText: '' };
		if (!enableXmlToolParsing || !toolsList.length) return { beforeText: text };
		if (!opts?.skipLikelihoodCheck && !likelyContainsToolMarkup(text)) return { beforeText: text };

		const masked = (text.includes('`') || text.includes('~')) ? maskCodeBlocks(text) : text;

		
		const toolCallRegion = findToolCallRegion(masked);

		
		const region = findFirstToolRegionEnhanced(masked, toolsList, toolOfToolName);

		const toolCallStartsFirst =
			toolCallRegion &&
			(!region || toolCallRegion.start < region.start);

		if (toolCallStartsFirst) {
			const beforeText = text.slice(0, toolCallRegion.start);

			const wrapperSlice = text.slice(toolCallRegion.start, toolCallRegion.end);
			const built = buildVoidXmlFromToolCallWrapper(wrapperSlice, toolOfToolName);
			if (built) {
				const call = parseXMLPrefixToToolCall(
					built.toolName,
					toolId,
					built.xml,
					toolOfToolName
				);
				return { beforeText, call, source: 'tool_call' };
			}
			return { beforeText };
		}

		if (!region) return { beforeText: text };

		const before = text.slice(0, region.start);
		let xmlForParse = '';

		if (region.kind === 'closeOnly') {
			
			const esc = escapeRegExp(region.toolName);
			const slice = text.slice(region.start, region.end);
			const inner = slice.replace(new RegExp(`</${esc}\\s*>\\s*$`, 'i'), '');
			xmlForParse = `<${region.toolName}>` + inner + `</${region.toolName}>`;
		} else {
			
			xmlForParse = text.slice(region.start);
		}

		const call = parseXMLPrefixToToolCall(
			region.toolName as ToolName,
			toolId,
			xmlForParse,
			toolOfToolName
		);

		return { beforeText: before, call, source: 'tool_tag' };
	};

	const mergeToolCall = (curr: RawToolCallObj | undefined, cand: RawToolCallObj | undefined) => {
		if (!cand) return curr;
		if (!curr) return cand;

		
		if (curr.name === cand.name) {
			const rawParams = { ...(curr.rawParams ?? {}), ...(cand.rawParams ?? {}) } as RawToolParamsObj;
			const doneParams = Array.from(new Set([...(curr.doneParams ?? []), ...(cand.doneParams ?? [])])) as ToolParamName[];

			let isDone = !!(curr.isDone || cand.isDone);
			if (!isDone) {
				try {
					isDone = hasAllRequiredParams(curr.name as ToolName, rawParams, toolOfToolName);
				} catch { }
			}

			return {
				...curr,
				rawParams,
				doneParams,
				isDone,
			};
		}

		
		if (curr.isDone) return curr;
		if (cand.isDone) return cand;
		return curr;
	};

	
	const THINK_PAIRS: [string, string][] = [
		['<think>', '</think>'],
		['<thinking>', '</thinking>'],
		['◁think▷', '◁/think▷'],
		['◁thinking▷', '◁/thinking▷'],
		['‹think›', '‹/think›'],
		['〈think〉', '〈/think〉'],
		['【think】', '【/think】'],
		['【thinking】', '【/thinking】'],
	];

	const detectThinkTags = (s: string): [string, string] | null => {
		if (!s) return null;
		for (const [open, close] of THINK_PAIRS) {
			if (s.includes(open)) return [open, close];
			const partial = endsWithAnyPrefixOf(s, open);
			if (partial && partial !== '') return [open, close];
		}
		return null;
	};

	const maxThinkOpenTagLen = THINK_PAIRS.reduce((m, [open]) => Math.max(m, open.length), 0);
	const detectThinkTagsByIncrement = (full: string): [string, string] | null => {
		if (!full) return null;
		const safePrev = full.length < lastThinkDetectObservedLen
			? 0
			: Math.max(0, Math.min(lastThinkDetectObservedLen, full.length));
		const start = Math.max(0, safePrev - maxThinkOpenTagLen);
		const maybe = detectThinkTags(full.slice(start));
		lastThinkDetectObservedLen = full.length;
		return maybe;
	};

	const extractReasoningViaTags = (
		fullText_: string,
		tags: [string, string]
	): { textOut: string; reasoningOut: string; earlyReturn?: boolean } => {
		const [openTag, closeTag] = tags;

		
		if (!r_foundTag1) {
			const endsWithOpen = endsWithAnyPrefixOf(fullText_, openTag);
			if (endsWithOpen && endsWithOpen !== openTag) {
				return { textOut: r_fullTextSoFar, reasoningOut: r_fullReasoningSoFar, earlyReturn: true };
			}
			const tag1Index = fullText_.indexOf(openTag);
			if (tag1Index !== -1) {
				r_foundTag1 = true;
				r_fullTextSoFar += fullText_.substring(0, tag1Index);
				r_latestAddIdx = tag1Index + openTag.length;
			} else {
				r_fullTextSoFar = fullText_;
				r_latestAddIdx = fullText_.length;
				return { textOut: r_fullTextSoFar, reasoningOut: r_fullReasoningSoFar };
			}
		}

		
		if (!r_foundTag2) {
			const endsWithClose = endsWithAnyPrefixOf(fullText_, closeTag);
			if (endsWithClose && endsWithClose !== closeTag) {
				if (fullText_.length > r_latestAddIdx) {
					r_fullReasoningSoFar += fullText_.substring(r_latestAddIdx);
					r_latestAddIdx = fullText_.length;
				}
				return { textOut: r_fullTextSoFar, reasoningOut: r_fullReasoningSoFar, earlyReturn: true };
			}
			const tag2Index = fullText_.indexOf(closeTag, r_latestAddIdx);
			if (tag2Index !== -1) {
				r_fullReasoningSoFar += fullText_.substring(r_latestAddIdx, tag2Index);
				r_foundTag2 = true;
				r_latestAddIdx = tag2Index + closeTag.length;
			} else {
				if (fullText_.length > r_latestAddIdx) {
					r_fullReasoningSoFar += fullText_.substring(r_latestAddIdx);
					r_latestAddIdx = fullText_.length;
				}
				return { textOut: r_fullTextSoFar, reasoningOut: r_fullReasoningSoFar };
			}
		}

		
		if (fullText_.length > r_latestAddIdx) {
			r_fullTextSoFar += fullText_.substring(r_latestAddIdx);
			r_latestAddIdx = fullText_.length;
		}
		return { textOut: r_fullTextSoFar, reasoningOut: r_fullReasoningSoFar };
	};

	// ============ Handlers ============

	const isValidToolCall = (t?: RawToolCallObj): t is RawToolCallObj =>
		!!(t && t.name && String(t.name).trim().length > 0);

	const newOnText: OnText = (params) => {
		const rawFullText = params.fullText || '';
		const providerReasoning = params.fullReasoning ?? undefined;
		const incomingPlan = params.plan;

		let textForXml = rawFullText;
		let reasoningForSearch = lastReasoning;

		
		if (providerReasoning !== undefined) {
			if (!r_providerReasoningAcc) {
				r_providerReasoningAcc = providerReasoning;
			} else {
				const prevLen = r_providerReasoningAcc.length;
				const probeLen = Math.min(reasoningPrefixProbeLen, prevLen, providerReasoning.length);
				const hasSamePrefix =
					probeLen > 0 &&
					providerReasoning.slice(0, probeLen) === r_providerReasoningAcc.slice(0, probeLen);

				if (providerReasoning.length > prevLen && hasSamePrefix) {
					
					r_providerReasoningAcc = providerReasoning;
				} else if (providerReasoning.length < prevLen && hasSamePrefix) {
					
					r_providerReasoningAcc = providerReasoning;
				} else if (!(providerReasoning.length === prevLen && hasSamePrefix)) {
					
					r_providerReasoningAcc += providerReasoning;
				}
			}

			
			if (!activeThinkTags) {
				const maybe = detectThinkTagsByIncrement(r_providerReasoningAcc);
				if (maybe) { activeThinkTags = maybe; }
			}

			
			if (activeThinkTags) {
				const [openTag, closeTag] = activeThinkTags;
				const pOpen = endsWithAnyPrefixOf(providerReasoning, openTag);
				const pClose = endsWithAnyPrefixOf(providerReasoning, closeTag);
				if ((pOpen && pOpen !== openTag) || (pClose && pClose !== closeTag)) {
					return;
				}
			}

			
			const { reasoning, after } = splitProviderReasoning(r_providerReasoningAcc, activeThinkTags);
			reasoningForSearch = reasoning;
			textForXml = (textForXml || '') + (after || '');
		} else {
			
			if (!activeThinkTags) {
				const maybe = detectThinkTagsByIncrement(rawFullText);
				if (maybe) { activeThinkTags = maybe; }
			}

			
			if (activeThinkTags) {
				const r = extractReasoningViaTags(rawFullText, activeThinkTags);
				if (r.earlyReturn) {
					return;
				}
				textForXml = r.textOut;
				reasoningForSearch = r.reasoningOut;
			}
		}

		lastReasoning = reasoningForSearch;
		textForXml = stripThinkTagsFromText(textForXml);

		const shouldParseMainText =
			enableXmlToolParsing &&
			toolsList.length > 0 &&
			likelyContainsToolMarkup(textForXml);
		const { beforeText, call: callFromText } = shouldParseMainText
			? parseToolFromText(textForXml, { skipLikelihoodCheck: true })
			: { beforeText: textForXml };
		let uiText = beforeText;
		if (chatMode && chatMode !== 'normal') {
			const shouldParseReasoning = shouldParseByIncrement(reasoningForSearch, lastReasoningParseObservedLen);
			lastReasoningParseObservedLen = reasoningForSearch.length;
			const parsedR = shouldParseReasoning
				? parseToolFromText(reasoningForSearch, { skipLikelihoodCheck: true })
				: { beforeText: reasoningForSearch };
			if (parsedR.call && (parsedR.source === 'tool_call' || isBlockToolCall(parsedR.beforeText))) {
				latestToolCall = mergeToolCall(latestToolCall, parsedR.call);
			}
		}


		const inboundTool = params.toolCall;
		latestToolCall = mergeToolCall(latestToolCall, callFromText);
		if (isValidToolCall(inboundTool)) {
			latestToolCall = mergeToolCall(latestToolCall, inboundTool);
		}

		let uiReasoning = lastReasoning;
		if (latestToolCall?.isDone) {
			uiText = stripToolCallWrapperOnce(uiText);
			uiText = stripToolXmlOrOpenTailOnce(uiText, latestToolCall.name);
			uiReasoning = stripToolCallWrapperOnce(uiReasoning);
			uiReasoning = stripToolXmlOnce(uiReasoning, latestToolCall.name);
			uiText = stripFakeResultTail(uiText);
		}
		uiText = stripThinkTagsFromText(uiText);
		uiText = stripTrailingPartialToolMarker(uiText);
		uiReasoning = stripTrailingPartialToolMarker(uiReasoning);

		onText({
			fullText: uiText.trim(),
			fullReasoning: uiReasoning,
			toolCall: isValidToolCall(latestToolCall)
				? latestToolCall
				: (isValidToolCall(inboundTool) ? inboundTool : undefined),
			plan: incomingPlan,
			// propagate provider token usage unchanged
			tokenUsage: (params as any).tokenUsage,
		});
	};

	const newOnFinalMessage: OnFinalMessage = (params) => {

		newOnText(params);

		const providerReasoning = params.fullReasoning ?? '';
		if (!activeThinkTags) {
			const maybe = detectThinkTags(providerReasoning || params.fullText || '');
			if (maybe) activeThinkTags = maybe;
		}

		let extraFromReasoning = '';
		let finalReasoning = lastReasoning;
		if (providerReasoning) {
			const { reasoning, after } = splitProviderReasoning(providerReasoning, activeThinkTags);
			finalReasoning = reasoning;
			extraFromReasoning = after;
		}

		const baseTextForUiRaw = (params.fullText || '') + (extraFromReasoning || '');
		let baseTextForUi = stripThinkTagsFromText(baseTextForUiRaw);
		const plan = params.plan;

		if (latestToolCall && !latestToolCall.isDone && typeof latestToolCall.name === 'string') {
			try {
				if (hasAllRequiredParams(latestToolCall.name as ToolName, latestToolCall.rawParams as RawToolParamsObj, toolOfToolName)) {
					latestToolCall = { ...latestToolCall, isDone: true };
				}
			} catch { }
		}

		const inboundTool = params.toolCall;

		if ((latestToolCall && !latestToolCall.isDone) && !(isValidToolCall(inboundTool) && inboundTool.isDone)) {
			onFinalMessage({
				fullText: baseTextForUi.trim(),
				fullReasoning: finalReasoning,
				anthropicReasoning: params.anthropicReasoning,
				toolCall: undefined,
				plan,
				// preserve original token usage info
				tokenUsage: (params as any).tokenUsage,
			});
			return;
		}

		const { beforeText, call } = parseToolFromText(baseTextForUi);
		let uiText = beforeText.trim();
		let uiReasoning = finalReasoning;
		if (chatMode && chatMode !== 'normal') {
			const parsedR = parseToolFromText(finalReasoning);
			if (parsedR.call && (parsedR.source === 'tool_call' || isBlockToolCall(parsedR.beforeText))) {
				latestToolCall = mergeToolCall(latestToolCall, parsedR.call);
			}
		}

		if (call?.isDone) {
			uiText = stripToolXmlOrOpenTailOnce(uiText, call.name);
			uiReasoning = stripToolXmlOnce(uiReasoning, call.name);
			uiText = stripFakeResultTail(uiText);
		}

		uiText = stripThinkTagsFromText(uiText);

		// Parse Plan again if needed?
		// We already parsed from baseTextForUi which is the source for uiText (via parseToolFromText).
		// parseToolFromText returns a slice. If we stripped plan from baseTextForUi, it's gone from uiText too.
		// So we don't need to parse again.

		const finalTool =
			(isValidToolCall(inboundTool) && inboundTool.isDone ? inboundTool : undefined) ||
			(isValidToolCall(latestToolCall) && latestToolCall.isDone ? latestToolCall : undefined) ||
			(isValidToolCall(call) && call.isDone ? call : undefined);

		if (finalTool?.isDone) {
			uiText = stripToolCallWrapperOnce(uiText);
			uiText = stripToolXmlOrOpenTailOnce(uiText, finalTool.name);
			uiReasoning = stripToolCallWrapperOnce(uiReasoning);
			uiReasoning = stripToolXmlOnce(uiReasoning, finalTool.name);
		}

		onFinalMessage({
			fullText: uiText,
			fullReasoning: uiReasoning,
			anthropicReasoning: params.anthropicReasoning,
			toolCall: finalTool,
			plan,
			// preserve original token usage info
			tokenUsage: (params as any).tokenUsage,
		});
	};

	return { newOnText, newOnFinalMessage };
};

export const extractReasoningWrapper = (
	onText: OnText,
	onFinalMessage: OnFinalMessage,
	thinkTagsInit: [string, string] | null,
	chatMode: ChatMode | null
): { newOnText: OnText; newOnFinalMessage: OnFinalMessage } => {
	return extractReasoningAndXMLToolsWrapper(
		onText,
		onFinalMessage,
		thinkTagsInit,
		chatMode,
		{ enableXmlToolParsing: false }
	);
};


// trim all whitespace up until the first newline, and all whitespace up until the last newline
const trimBeforeAndAfterNewLines = (s: string) => {
	if (!s) return s;
	const firstNewLineIndex = s.indexOf('\n');
	if (firstNewLineIndex !== -1 && s.substring(0, firstNewLineIndex).trim() === '') {
		s = s.substring(firstNewLineIndex + 1, Infinity)
	}
	const lastNewLineIndex = s.lastIndexOf('\n');
	if (lastNewLineIndex !== -1 && s.substring(lastNewLineIndex + 1, Infinity).trim() === '') {
		s = s.substring(0, lastNewLineIndex)
	}
	return s
}
