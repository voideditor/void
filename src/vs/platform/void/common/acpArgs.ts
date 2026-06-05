/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Parse a shell-like arguments string into an array suitable for process spawn.
// Behaviour is intentionally close to typical POSIX shell splitting:
// - Whitespace outside quotes splits arguments
// - Double quotes are removed and everything inside is kept verbatim
//   (so "my cfg.json" -> "my cfg.json")
// - Flags with equals are preserved as-is, including combined forms like
//   --config=my_cfg_json or --config="my_cfg_json" (quotes stripped)
export const parseAcpProcessArgs = (raw: string): string[] => {
	const out: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch === '"') {
			// Toggle quote state, but do not include the quote character itself.
			inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes && /\s/.test(ch)) {
			if (current.length > 0) {
				out.push(current);
				current = '';
			}
			continue;
		}
		current += ch;
	}

	if (current.length > 0) {
		out.push(current);
	}

	return out;
};
