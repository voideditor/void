/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { isJsonObject } from '../../../../platform/void/common/jsonTypes.js';
import { CHARS_PER_TOKEN_ESTIMATE } from '../../../../platform/void/common/prompt/constants.js';

export interface TerminalOutputSummaryIndicator {
	profile: string;
	reason: 'verbose' | 'hard-limit';
}

interface TerminalOutputTruncationMeta {
	summarizer: true;
	originalLength: number;
	summaryIndicator: TerminalOutputSummaryIndicator | null;
}

const getTerminalOutputTruncationMeta = (content: string): TerminalOutputTruncationMeta | null => {
	const tailStart = Math.max(0, content.length - 4000);
	const tail = content.slice(tailStart);
	const matches = [...tail.matchAll(/TRUNCATION_META:\s*(\{[^\r\n]*\})/g)];
	const match = matches[matches.length - 1];
	if (!match) return null;

	try {
		const parsed: unknown = JSON.parse(match[1]);
		if (!isJsonObject(parsed)) return null;
		if (parsed.summarizer !== true) return null;
		if (typeof parsed.originalLength !== 'number' || !Number.isFinite(parsed.originalLength)) return null;
		const summaryIndicator = parsed.summaryVersion === 2
			&& typeof parsed.profile === 'string'
			&& (parsed.summaryReason === 'verbose' || parsed.summaryReason === 'hard-limit')
			? { profile: parsed.profile, reason: parsed.summaryReason as 'verbose' | 'hard-limit' }
			: null;
		return { summarizer: true, originalLength: parsed.originalLength, summaryIndicator };
	} catch {
		return null;
	}
};

export const getTerminalOutputSavedTokens = (content: string): number | null => {
	const truncationMeta = getTerminalOutputTruncationMeta(content);
	if (!truncationMeta) return null;

	const savedTokens = Math.max(0, Math.round((truncationMeta.originalLength - content.length) / CHARS_PER_TOKEN_ESTIMATE));
	return savedTokens > 0 ? savedTokens : null;
};

export const getTerminalOutputSavedTokensLabel = (content: string): string | null => {
	const savedTokens = getTerminalOutputSavedTokens(content);
	return savedTokens === null ? null : `~${savedTokens} tokens saved`;
};

export const getTerminalOutputSummaryIndicator = (content: string): TerminalOutputSummaryIndicator | null => {
	return getTerminalOutputTruncationMeta(content)?.summaryIndicator ?? null;
};

export const getTerminalOutputSummaryIndicatorLabel = (content: string): string | null => {
	const indicator = getTerminalOutputSummaryIndicator(content);
	return indicator ? `${indicator.profile} · ${indicator.reason}` : null;
};
