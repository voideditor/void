/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import {
	AgentSkillActivation,
	AgentSkillCatalog,
	AgentSkillDiagnostic,
	AgentSkillResolvedMention,
} from './agentSkillsTypes.js';

export interface IAgentSkillsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeCatalog: Event<void>;

	getCatalog(opts?: { forceRefresh?: boolean }): Promise<AgentSkillCatalog>;
	activateSkill(name: string): Promise<AgentSkillActivation>;
	resolveExplicitMentions(text: string, catalog?: AgentSkillCatalog): Promise<{
		resolved: AgentSkillResolvedMention[];
		diagnostics: AgentSkillDiagnostic[];
	}>;
	getDiagnostics(): AgentSkillDiagnostic[];
}

export const IAgentSkillsService = createDecorator<IAgentSkillsService>('agentSkillsService');
