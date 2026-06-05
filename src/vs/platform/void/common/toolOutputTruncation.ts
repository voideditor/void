/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Shared helper for truncating large tool outputs before sending them to an LLM
 * or displaying them in the UI.
 *
 * This helper is intentionally pure and platform-agnostic so it can be used
 * from both renderer (browser) and main/electron processes.
 */
export interface TruncatedToolOutput {
	originalLength: number;
	truncatedBody: string;
	/** true if originalLength > maxLength */
	needsTruncation: boolean;
	/**
	 * 1-based line number after the truncated prefix of the output.
	 *
	 * When {@link needsTruncation} is true, this is the line number such that
	 * consumers can read the remainder of the log starting from the line
	 * strictly after the part that was shown to the user. When not truncated,
	 * this is 0.
	 */
	lineAfterTruncation: number;
}

/**
 * Computes the truncated body of a tool output, without adding any headers
 * or file-path hints. Callers are responsible for appending explanatory
 * lines (e.g. [VOID] Tool output was truncated...) and any log-file paths.
 */
export function computeTruncatedToolOutput(originalText: string, maxLength: number): TruncatedToolOutput {
	const originalLength = originalText.length;
	const computeLineAfterTruncation = (body: string): number => {
		if (!body) {
			return 0;
		}
		// Treat all common newline sequences as line breaks.
		return body.split(/\r\n|\r|\n/).length;
	};

	if (originalLength <= maxLength || maxLength <= 0) {
		return {
			originalLength,
			truncatedBody: originalText,
			needsTruncation: false,
			lineAfterTruncation: 0,
		};
	}

	const truncatedBody = originalText.substring(0, maxLength);
	return {
		originalLength,
		truncatedBody,
		needsTruncation: true,
		lineAfterTruncation: computeLineAfterTruncation(truncatedBody),
	};
}
