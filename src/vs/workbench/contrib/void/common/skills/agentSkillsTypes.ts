/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';

export type AgentSkillScope = 'project' | 'user';
export type AgentSkillSource = 'void' | 'agents';

export type AgentSkillDiagnosticSeverity = 'info' | 'warning' | 'error';

export type AgentSkillDiagnostic = {
	severity: AgentSkillDiagnosticSeverity;
	code: string;
	message: string;
	uri?: URI;
	name?: string;
};

export type AgentSkillRecord = {
	name: string;
	description: string;
	skillFileUri: URI;
	skillDirUri: URI;
	rootUri: URI;
	scope: AgentSkillScope;
	source: AgentSkillSource;
	allowedTools?: string[];
	diagnostics: AgentSkillDiagnostic[];
};

export type AgentSkillCatalog = {
	skills: AgentSkillRecord[];
	diagnostics: AgentSkillDiagnostic[];
	computedAt: string;
};

export type AgentSkillResourceKind = 'scripts' | 'references' | 'assets';

export type AgentSkillResource = {
	kind: AgentSkillResourceKind;
	relativePath: string;
	uri: URI;
	isDirectory: boolean;
};

export type AgentSkillActivation = {
	name: string;
	body: string;
	skillFileUri: URI;
	skillDirUri: URI;
	resources: AgentSkillResource[];
	diagnostics: AgentSkillDiagnostic[];
	contentForModel: string;
	alreadyActive?: boolean;
};

export type AgentSkillActiveMetadata = {
	activatedAt: string;
	source: 'tool' | 'explicit';
	skillFileUri: string;
};

export type AgentSkillsSettings = {
	enabled: boolean;
	disabledSkillNames: string[];
	externalAcpFallbackEnabled: boolean;
};

export type AgentSkillParsedFrontmatter = {
	name?: string;
	description?: string;
	allowedTools?: string[];
	metadata: Record<string, string | string[]>;
};

export type AgentSkillParseResult = {
	frontmatter: AgentSkillParsedFrontmatter;
	body: string;
	diagnostics: AgentSkillDiagnostic[];
};

export type AgentSkillResolvedMention = {
	raw: string;
	name: string;
	record: AgentSkillRecord;
};
