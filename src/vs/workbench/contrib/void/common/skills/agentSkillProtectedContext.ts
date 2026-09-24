/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';

export type ProtectedSkillContent = {
	name: string;
	content: string;
};

const SKILL_CONTENT_RE = /<skill_content\s+name=["']([^"']+)["']\s*>[\s\S]*?<\/skill_content>/gi;

export function extractSkillContentBlocks(text: string): ProtectedSkillContent[] {
	const blocks: ProtectedSkillContent[] = [];
	const value = String(text ?? '');
	for (const match of value.matchAll(SKILL_CONTENT_RE)) {
		const name = String(match[1] ?? '').trim();
		const content = match[0];
		if (!name || !content) continue;
		blocks.push({ name, content });
	}
	return blocks;
}

export function messageHasProtectedSkillContent(message: ChatMessage): boolean {
	if (message.role === 'tool' && message.name === 'activate_skill') return true;
	if (message.role === 'tool') return extractSkillContentBlocks(message.content ?? '').length > 0;
	if (message.role === 'user') return extractSkillContentBlocks(message.content ?? '').length > 0;
	if (message.role === 'assistant') return extractSkillContentBlocks(message.displayContent ?? '').length > 0;
	return false;
}

export function collectProtectedSkillContent(messages: readonly ChatMessage[]): ProtectedSkillContent[] {
	const latestByName = new Map<string, ProtectedSkillContent>();

	for (const message of messages) {
		if (message.role === 'checkpoint' || message.role === 'interrupted_streaming_tool') continue;

		const text =
			message.role === 'tool' ? message.content :
				message.role === 'user' ? message.content :
					message.role === 'assistant' ? message.displayContent :
						'';

		const blocks = extractSkillContentBlocks(text ?? '');
		for (const block of blocks) {
			latestByName.set(block.name, block);
		}
	}

	return Array.from(latestByName.values());
}

export function formatProtectedSkillContextForPrompt(messages: readonly ChatMessage[]): string {
	const blocks = collectProtectedSkillContent(messages);
	if (!blocks.length) return '';

	return [
		'Protected active skill instructions:',
		...blocks.map(block => block.content.trim()),
	].join('\n\n');
}
