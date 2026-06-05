/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type InferredSelection = { text: string; range: [number, number] };
export type AstCandidateRange = {
	startOffset: number;
	endOffset: number;
	nodeType?: string;
};
export type InferenceAstContext = {
	candidates: AstCandidateRange[];
	languageId?: string;
	source?: 'service' | 'bundled';
};

const isInformativeLine = (line: string): boolean => {
	const s = line.trim();
	if (s.length < 8) return false;
	if (/^\s*(\/\/|#|'|\*\s)/.test(line)) return false; // comments
	if (/^[{}()[\];,:]*$/.test(s)) return false; // only punctuation
	return /[A-Za-z0-9]/.test(s);
};

const normalizeLine = (line: string): string => line.trim().toLowerCase();

const buildLineMatchPrefix = (lines: string[], codeSet: Set<string>): number[] => {
	const prefix = new Array<number>(lines.length + 1);
	prefix[0] = 0;

	for (let i = 0; i < lines.length; i += 1) {
		prefix[i + 1] = prefix[i] + (codeSet.has(normalizeLine(lines[i])) ? 1 : 0);
	}

	return prefix;
};

const countLineMatchesInRange = (prefix: number[], startLine: number, endLine: number): number => {
	const startIdx = Math.max(0, startLine - 1);
	const endIdxExclusive = Math.min(prefix.length - 1, endLine);
	if (endIdxExclusive <= startIdx) return 0;
	return prefix[endIdxExclusive] - prefix[startIdx];
};

const pickBestAstCandidate = ({
	codeStr,
	fileText,
	astContext
}: {
	codeStr: string;
	fileText: string;
	astContext?: InferenceAstContext;
}): { startOffset: number; endOffset: number; score: number; overlap: number; anchorHits: number } | null => {
	const candidates = astContext?.candidates;
	if (!candidates || candidates.length === 0) return null;

	const codeLinesRaw = codeStr.split('\n');
	const codeSet = new Set(codeLinesRaw.map(normalizeLine).filter(s => s.length >= 4));
	const anchors = codeLinesRaw
		.map(l => l.trim())
		.filter(isInformativeLine)
		.sort((a, b) => b.length - a.length)
		.slice(0, 8);
	const lowerAnchors = anchors.map(anchor => anchor.toLowerCase());

	let best: { startOffset: number; endOffset: number; score: number; overlap: number; anchorHits: number } | null = null;
	const maxCandidates = Math.min(1500, candidates.length);

	for (let i = 0; i < maxCandidates; i += 1) {
		const rawStart = Math.max(0, Math.min(fileText.length, Math.floor(candidates[i].startOffset)));
		const rawEnd = Math.max(0, Math.min(fileText.length, Math.floor(candidates[i].endOffset)));
		const startOffset = Math.min(rawStart, rawEnd);
		const endOffset = Math.max(rawStart, rawEnd);
		if (endOffset - startOffset < 8) continue;

		const candidateText = fileText.slice(startOffset, endOffset);
		const candidateLines = candidateText.split('\n');

		let overlap = 0;
		for (const ln of candidateLines) {
			if (codeSet.has(normalizeLine(ln))) overlap += 1;
		}

		const candidateTextLower = candidateText.toLowerCase();
		let anchorHits = 0;
		for (const lowerAnchor of lowerAnchors) {
			if (candidateTextLower.includes(lowerAnchor)) anchorHits += 1;
		}

		const expectedLines = Math.max(1, codeLinesRaw.length);
		const lineSpan = Math.max(1, candidateLines.length);
		const sizePenalty = lineSpan > expectedLines * 10
			? Math.min(6, Math.floor(lineSpan / Math.max(1, expectedLines * 3)))
			: 0;

		const score = overlap * 5 + anchorHits * 9 - sizePenalty;
		if (!best || score > best.score) {
			best = { startOffset, endOffset, score, overlap, anchorHits };
		}
	}

	if (!best) return null;

	const minOverlap = Math.max(1, Math.floor(codeLinesRaw.length * 0.12));
	if (best.overlap < minOverlap && best.anchorHits === 0) return null;
	if (best.score < 4) return null;

	return best;
};

export const inferSelectionFromCode = ({
	codeStr,
	fileText,
	astContext
}: {
	codeStr: string;
	fileText: string;
	astContext?: InferenceAstContext;
}): InferredSelection | null => {
	if (!codeStr || !fileText) return null;

	const astBest = pickBestAstCandidate({ codeStr, fileText, astContext });
	if (astBest) {
		const fileLineOffsets = buildLineOffsets(fileText);
		const startLine = charIdxToLine(astBest.startOffset, fileLineOffsets);
		const endLine = charIdxToLine(astBest.endOffset - 1, fileLineOffsets);
		const text = fileText.slice(astBest.startOffset, astBest.endOffset);
		return { text, range: [startLine, endLine] };
	}

	const fileLines = fileText.split('\n');
	const codeLinesRaw = codeStr.split('\n');
	const codeLinesNorm = codeLinesRaw.map(normalizeLine);

	const anchors: { text: string; codeIdx: number }[] = [];
	for (let i = 0; i < codeLinesRaw.length; i += 1) {
		const ln = codeLinesRaw[i];
		if (!isInformativeLine(ln)) continue;
		anchors.push({ text: ln.trim(), codeIdx: i });
	}
	// prefer longer anchors; cap to 5
	anchors.sort((a, b) => b.text.length - a.text.length);
	const topAnchors = anchors.slice(0, 5);
	if (topAnchors.length === 0) return null;

	const fileLineOffsets = buildLineOffsets(fileText);

	const codeSet = new Set(codeLinesNorm.filter(s => s.length >= 5));
	const lineMatchPrefix = buildLineMatchPrefix(fileLines, codeSet);

	let best: { start: number; end: number; score: number } | null = null;

	for (const a of topAnchors) {
		const anchor = a.text;
		let fromIdx = 0;
		while (fromIdx <= fileText.length) {
			const hit = fileText.indexOf(anchor, fromIdx);
			if (hit === -1) break;
			const hitLine = charIdxToLine(hit, fileLineOffsets); // 1-indexed

			// align window by anchor's position in code
			const startLine = Math.max(1, hitLine - a.codeIdx);
			const endLine = Math.min(fileLines.length, startLine + codeLinesRaw.length - 1);

			// score overlap in O(1) using prefix sums
			const score = countLineMatchesInRange(lineMatchPrefix, startLine, endLine);

			if (!best || score > best.score) {
				best = { start: startLine, end: endLine, score };
			}

			fromIdx = hit + Math.max(1, Math.floor(anchor.length / 2));
		}
	}

	if (!best) return null;

	// require minimal confidence: at least 2 overlapping lines or 15% of code lines
	const minOverlap = Math.max(2, Math.floor(codeLinesRaw.length * 0.15));
	if (best.score < minOverlap) return null;

	const text = fileLines.slice(best.start - 1, best.end).join('\n');
	return { text, range: [best.start, best.end] };
};

export type InferredBlock = {
	text: string
	range: [number, number]
	offsets: [number, number]            // [startOffset, endOffsetExclusive]
	occurrence: number                   // 1-based
}

const buildLineOffsets = (text: string): number[] => {
	const offs: number[] = [0]
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10 /* \n */) offs.push(i + 1)
	}
	return offs
}

const charIdxToLine = (charIdx: number, lineOffsets: number[]): number => {
	let lo = 0, hi = lineOffsets.length - 1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (lineOffsets[mid] <= charIdx) lo = mid + 1; else hi = mid - 1
	}
	return Math.max(1, Math.min(lineOffsets.length, hi + 1))
}

const countOccurrencesBefore = (haystack: string, needle: string, endOffsetExclusive: number): number => {
	if (!needle) return 0
	let count = 0
	let idx = 0
	while (idx < endOffsetExclusive) {
		const hit = haystack.indexOf(needle, idx)
		if (hit === -1 || hit >= endOffsetExclusive) break
		count++
		idx = hit + Math.max(1, Math.floor(needle.length / 2))
	}
	return count
}

export const inferExactBlockFromCode = ({
	codeStr,
	fileText,
	astContext
}: {
	codeStr: string;
	fileText: string;
	astContext?: InferenceAstContext;
}): InferredBlock | null => {
	if (!codeStr || !fileText) return null;

	const fileLF = fileText.replace(/\r\n/g, '\n');

	const astBest = pickBestAstCandidate({ codeStr, fileText, astContext });
	if (astBest) {
		const text = fileText.substring(astBest.startOffset, astBest.endOffset);
		const lineOffsets = buildLineOffsets(fileLF);
		const startLine = charIdxToLine(astBest.startOffset, lineOffsets);
		const endLine = charIdxToLine(astBest.endOffset - 1, lineOffsets);
		const occurrence = countOccurrencesBefore(fileText, text, astBest.startOffset) + 1;
		return {
			text,
			range: [startLine, endLine],
			offsets: [astBest.startOffset, astBest.endOffset],
			occurrence
		};
	}


	const codeLines = codeStr.split('\n');
	let anchor = '';
	for (const line of codeLines) {
		const t = line.trim();
		if (t.length < 5) continue;
		const patterns = [
			/^(function|class|const|let|var|export|async|interface|type|enum|namespace|declare|abstract)\s/,
			/^(public|private|protected|static|readonly|override)\s/,
			/^(def|class|async def|@\w+)[\s(]/,
			/^(public|private|protected|internal|static|final|abstract|sealed|virtual|override|partial)\s/,
			/^(class|interface|enum|struct|record)\s/,
			/^(void|int|char|float|double|bool|auto|const|static|extern|inline|virtual|template|typename)\s/,
			/^(class|struct|enum|union|namespace|using)\s/,
			/^(func|type|interface|struct|package|var|const)\s/,
			/^(fn|pub|impl|trait|struct|enum|mod|use|const|static|async|unsafe|extern)\s/,
			/^(def|class|module|begin|if|unless|case|while|until|for)\s/,
			/^(function|class|interface|trait|namespace|use|public|private|protected|static|abstract|final)\s/,
			/^<\?php/,
			/^(func|class|struct|enum|protocol|extension|var|let|init|deinit|typealias)\s/,
			/^(public|private|internal|fileprivate|open|static|final|lazy|weak|unowned)\s/,
			/^(fun|class|interface|object|enum|data class|sealed class|companion object|val|var)\s/,
			/^(public|private|protected|internal|override|abstract|final|open|lateinit|inline)\s/,
			/^(def|class|object|trait|case class|sealed|abstract|override|implicit|lazy)\s/,

			/^\w+\s*(<[^>]+>)?\s*\([^)]*\)\s*\{/,

			/^\w+\s*(<[^>]+>)?\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/
		];
		if (patterns.some(rx => rx.test(t)) || t.length > 10) { anchor = t; break; }
	}
	if (!anchor) {
		anchor = codeLines.find(l => {
			const t = l.trim();
			return t.length > 5 && !/^(\/\/|#|\*|\/\*)/.test(t);
		})?.trim() || '';
	}
	if (!anchor) return null;


	const startIdx = fileText.indexOf(anchor);
	if (startIdx === -1) return null;

	let startOffset = startIdx;
	let endOffsetExclusive = startIdx;


	const anchorEnd = startIdx + anchor.length;
	const afterAnchorRaw = fileText.slice(anchorEnd);
	const anchorHasBrace = anchor.includes('{');
	const nextNonWsIsBrace = /^\s*\{/.test(afterAnchorRaw);
	const arrowNear = anchor.includes('=>') || /^\s*=>/.test(afterAnchorRaw);
	const usesArrowWithoutBrace = arrowNear && !anchorHasBrace && !nextNonWsIsBrace;

	if (usesArrowWithoutBrace) {

		const scanFrom = anchorEnd;
		const semi = fileText.indexOf(';', scanFrom);
		const nl = fileText.indexOf('\n', scanFrom);
		if (semi !== -1 && (nl === -1 || semi < nl)) endOffsetExclusive = semi + 1;
		else if (nl !== -1) endOffsetExclusive = nl;
		else endOffsetExclusive = fileText.length;
	} else {

		let inS = false, inD = false, inT = false, inSL = false, inML = false;
		let openPos = -1;
		for (let pos = startIdx; pos < fileText.length; pos++) {
			const c = fileText[pos];
			const next = pos + 1 < fileText.length ? fileText[pos + 1] : '';

			if (!inS && !inD && !inT) {
				if (!inML && !inSL && c === '/' && next === '/') { inSL = true; pos++; continue; }
				if (!inML && !inSL && c === '/' && next === '*') { inML = true; pos++; continue; }
				if (inSL && c === '\n') { inSL = false; continue; }
				if (inML && c === '*' && next === '/') { inML = false; pos++; continue; }
				if (inSL || inML) continue;
			}
			if (!inML && !inSL) {
				if (!inD && !inT && c === '\'') { inS = !inS; continue; }
				if (!inS && !inT && c === '"') { inD = !inD; continue; }
				if (!inS && !inD && c === '`') { inT = !inT; continue; }
			}
			if (inS || inD || inT) continue;

			if (c === '{') { openPos = pos; break; }
		}
		if (openPos === -1) return null;


		let depth = 0;
		inS = inD = inT = inSL = inML = false;
		for (let pos = openPos; pos < fileText.length; pos++) {
			const c = fileText[pos];
			const next = pos + 1 < fileText.length ? fileText[pos + 1] : '';

			if (!inS && !inD && !inT) {
				if (!inML && !inSL && c === '/' && next === '/') { inSL = true; pos++; continue; }
				if (!inML && !inSL && c === '/' && next === '*') { inML = true; pos++; continue; }
				if (inSL && c === '\n') { inSL = false; continue; }
				if (inML && c === '*' && next === '/') { inML = false; pos++; continue; }
				if (inSL || inML) continue;
			}
			if (!inML && !inSL) {
				if (!inD && !inT && c === '\'') { inS = !inS; continue; }
				if (!inS && !inT && c === '"') { inD = !inD; continue; }
				if (!inS && !inD && c === '`') { inT = !inT; continue; }
			}
			if (inS || inD || inT) continue;

			if (c === '{') {
				if (depth === 0) startOffset = startIdx;
				depth++;
			} else if (c === '}') {
				depth--;
				if (depth === 0) { endOffsetExclusive = pos + 1; break; }
			}
		}
		if (endOffsetExclusive <= startOffset) return null;
	}

	const text = fileText.substring(startOffset, endOffsetExclusive);

	const lineOffsets = buildLineOffsets(fileLF);
	const startLine = charIdxToLine(startOffset, lineOffsets);
	const endLine = charIdxToLine(endOffsetExclusive - 1, lineOffsets);

	const occurrence = countOccurrencesBefore(fileText, text, startOffset) + 1;

	return { text, range: [startLine, endLine], offsets: [startOffset, endOffsetExclusive], occurrence };
};
