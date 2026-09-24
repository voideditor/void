/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { AgentSkillActivation, AgentSkillCatalog, AgentSkillRecord } from './agentSkillsTypes.js';

const sortSkills = (skills: readonly AgentSkillRecord[]): AgentSkillRecord[] =>
	[...skills].sort((a, b) => a.name.localeCompare(b.name));

export function formatAgentSkillsCatalogForToolActivation(catalog: AgentSkillCatalog): string {
	if (!catalog.skills.length) return '';

	const lines = sortSkills(catalog.skills).map(skill =>
		`- ${skill.name}: ${skill.description} (SKILL.md: ${skill.skillFileUri.toString()})`
	);

	return [
		'Agent Skills:',
		'- The user or repository may provide specialized Agent Skills.',
		'- Use `activate_skill` with the exact skill name before applying specialized instructions from a matching skill.',
		'- `activate_skill` returns the skill instructions and bundled resource paths; read resource files only if needed.',
		'- If the user explicitly mentions `$skill-name`, that skill may already be provided in the message context.',
		'Available skills:',
		...lines,
	].join('\n');
}

export function formatAgentSkillsCatalogForExternalAcp(catalog: AgentSkillCatalog): string {
	if (!catalog.skills.length) return '';

	const lines = sortSkills(catalog.skills).map(skill =>
		`- ${skill.name}: ${skill.description} (read ${skill.skillFileUri.toString()} to activate)`
	);

	return [
		'Agent Skills available in this Void workspace:',
		'- External ACP agents do not have Void `activate_skill` automatically.',
		'- To use a matching skill, read its SKILL.md file first and follow its instructions.',
		'- Relative resource paths in a skill resolve from that skill directory.',
		'Catalog:',
		...lines,
	].join('\n');
}

export function formatAgentSkillActivationContent(opts: {
	name: string;
	body: string;
	skillFileUri: string;
	skillDirUri: string;
	resources: AgentSkillActivation['resources'];
	diagnostics?: AgentSkillActivation['diagnostics'];
	alreadyActive?: boolean;
}): string {
	if (opts.alreadyActive) {
		return `<skill_content name="${opts.name}">\nSkill "${opts.name}" is already active in this thread. Continue using the previously provided skill instructions.\n</skill_content>`;
	}

	const resources = opts.resources.length
		? opts.resources.map(resource => `- ${resource.relativePath}${resource.isDirectory ? '/' : ''} (${resource.kind})`).join('\n')
		: '- No bundled resources found under scripts/, references/, or assets/.';

	const diagnostics = (opts.diagnostics ?? []).filter(d => d.severity !== 'info');
	const diagnosticsText = diagnostics.length
		? [
			'Diagnostics:',
			...diagnostics.map(d => `- ${d.severity}: ${d.message}`),
		].join('\n')
		: '';

	return [
		`<skill_content name="${opts.name}">`,
		`Skill: ${opts.name}`,
		`Skill file: ${opts.skillFileUri}`,
		`Skill directory: ${opts.skillDirUri}`,
		'Relative paths in this skill resolve from the skill directory.',
		'',
		'Instructions:',
		opts.body.trim(),
		'',
		'Bundled resources (listed only, not read):',
		resources,
		...(diagnosticsText ? ['', diagnosticsText] : []),
		`</skill_content>`,
	].join('\n');
}
