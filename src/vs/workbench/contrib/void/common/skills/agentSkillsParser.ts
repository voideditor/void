/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import {
	AgentSkillDiagnostic,
	AgentSkillParsedFrontmatter,
	AgentSkillParseResult,
} from './agentSkillsTypes.js';

const FRONTMATTER_DELIMITER = '---';

const stripYamlScalar = (value: string): string => {
	let v = String(value ?? '').trim();
	if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) {
		v = v.slice(1, -1);
	}
	return v.trim();
};

const parseInlineArray = (value: string): string[] | undefined => {
	const trimmed = value.trim();
	if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return undefined;
	return trimmed
		.slice(1, -1)
		.split(',')
		.map(part => stripYamlScalar(part))
		.filter(Boolean);
};

const parseYamlLikeFrontmatter = (raw: string, diagnostics: AgentSkillDiagnostic[], uri?: URI): AgentSkillParsedFrontmatter => {
	const metadata: Record<string, string | string[]> = {};
	const lines = raw.split(/\r?\n/);

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!match) {
			diagnostics.push({
				severity: 'warning',
				code: 'frontmatter_line_ignored',
				message: `Ignored malformed frontmatter line ${i + 1}.`,
				uri,
			});
			continue;
		}

		const key = match[1].trim();
		const rest = match[2] ?? '';
		const inlineArray = parseInlineArray(rest);
		if (inlineArray) {
			metadata[key] = inlineArray;
			continue;
		}

		if (!rest.trim()) {
			const items: string[] = [];
			let j = i + 1;
			while (j < lines.length) {
				const child = lines[j];
				const childTrimmed = child.trim();
				if (!childTrimmed) {
					j += 1;
					continue;
				}
				if (!childTrimmed.startsWith('- ')) break;
				items.push(stripYamlScalar(childTrimmed.slice(2)));
				j += 1;
			}
			if (items.length) {
				metadata[key] = items.filter(Boolean);
				i = j - 1;
				continue;
			}
		}

		metadata[key] = stripYamlScalar(rest);
	}

	const name = typeof metadata.name === 'string' ? metadata.name.trim() : undefined;
	const description = typeof metadata.description === 'string' ? metadata.description.trim() : undefined;
	const allowedToolsRaw = metadata['allowed-tools'] ?? metadata.allowedTools;
	const allowedTools = Array.isArray(allowedToolsRaw)
		? allowedToolsRaw.map(v => String(v).trim()).filter(Boolean)
		: typeof allowedToolsRaw === 'string'
			? allowedToolsRaw.split(',').map(v => v.trim()).filter(Boolean)
			: undefined;

	return {
		name,
		description,
		allowedTools,
		metadata,
	};
};

export function parseAgentSkillMarkdown(contents: string, opts?: {
	uri?: URI;
	expectedDirectoryName?: string;
}): AgentSkillParseResult {
	const diagnostics: AgentSkillDiagnostic[] = [];
	const text = String(contents ?? '').replace(/^\uFEFF/, '');

	if (!text.startsWith(FRONTMATTER_DELIMITER)) {
		diagnostics.push({
			severity: 'error',
			code: 'missing_frontmatter',
			message: 'SKILL.md must start with YAML frontmatter delimited by ---.',
			uri: opts?.uri,
		});
		return {
			frontmatter: { metadata: {} },
			body: text.trim(),
			diagnostics,
		};
	}

	const lines = text.split(/\r?\n/);
	let closingLine = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].trim() === FRONTMATTER_DELIMITER) {
			closingLine = i;
			break;
		}
	}

	if (closingLine === -1) {
		diagnostics.push({
			severity: 'error',
			code: 'unterminated_frontmatter',
			message: 'SKILL.md frontmatter must include a closing --- delimiter.',
			uri: opts?.uri,
		});
		return {
			frontmatter: { metadata: {} },
			body: text.trim(),
			diagnostics,
		};
	}

	const rawFrontmatter = lines.slice(1, closingLine).join('\n');
	const body = lines.slice(closingLine + 1).join('\n').replace(/^\s*\n/, '').trim();
	const frontmatter = parseYamlLikeFrontmatter(rawFrontmatter, diagnostics, opts?.uri);

	if (!frontmatter.name) {
		diagnostics.push({
			severity: 'error',
			code: 'missing_name',
			message: 'SKILL.md frontmatter must include a non-empty name.',
			uri: opts?.uri,
		});
	}

	if (!frontmatter.description) {
		diagnostics.push({
			severity: 'error',
			code: 'missing_description',
			message: 'SKILL.md frontmatter must include a non-empty description.',
			uri: opts?.uri,
			name: frontmatter.name,
		});
	}

	if (frontmatter.name && opts?.expectedDirectoryName && frontmatter.name !== opts.expectedDirectoryName) {
		diagnostics.push({
			severity: 'warning',
			code: 'directory_name_mismatch',
			message: `Skill name "${frontmatter.name}" does not match directory name "${opts.expectedDirectoryName}".`,
			uri: opts.uri,
			name: frontmatter.name,
		});
	}

	if (frontmatter.name && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(frontmatter.name)) {
		diagnostics.push({
			severity: 'warning',
			code: 'non_standard_name',
			message: `Skill name "${frontmatter.name}" is accepted but does not match the recommended name pattern.`,
			uri: opts?.uri,
			name: frontmatter.name,
		});
	}

	return {
		frontmatter,
		body,
		diagnostics,
	};
}
