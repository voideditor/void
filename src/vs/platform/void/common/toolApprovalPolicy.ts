/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ToolName } from './toolsServiceTypes.js';

// Manual approval is independent from execution serialization: create remains a
// serialized mutation elsewhere, while delete is manual unless its dedicated setting is enabled.
const builtinToolApprovalPolicy = {
	read_file: { kind: 'none' },
	ls_dir: { kind: 'none' },
	get_dir_tree: { kind: 'none' },
	search_pathnames_only: { kind: 'none' },
	search_for_files: { kind: 'none' },
	search_in_file: { kind: 'none' },
	read_lint_errors: { kind: 'none' },
	activate_skill: { kind: 'none' },
	rewrite_file: { kind: 'manual', category: 'edits' },
	edit_file: { kind: 'manual', category: 'edits' },
	create_file_or_folder: { kind: 'none' },
	delete_file_or_folder: { kind: 'manual', category: 'delete' },
	run_command: { kind: 'manual', category: 'terminal' },
} as const satisfies Record<ToolName,
	| { readonly kind: 'manual'; readonly category: 'terminal' | 'edits' | 'delete' }
	| { readonly kind: 'none' }>;

export type BuiltinManualApprovalTool = {
	[Tool in ToolName]: (typeof builtinToolApprovalPolicy)[Tool] extends { readonly kind: 'manual' } ? Tool : never
}[ToolName];

export type ToolApprovalType = Extract<(typeof builtinToolApprovalPolicy)[ToolName], { readonly kind: 'manual' }>['category'];

export type ToolApprovalRequirement =
	| (typeof builtinToolApprovalPolicy)[ToolName]
	| { readonly kind: 'dynamic-policy' };

const isBuiltinToolName = (toolName: string): toolName is ToolName =>
	Object.prototype.hasOwnProperty.call(builtinToolApprovalPolicy, toolName);

export function getToolApprovalRequirement(toolName: string): ToolApprovalRequirement {
	if (!isBuiltinToolName(toolName)) return { kind: 'dynamic-policy' };
	return builtinToolApprovalPolicy[toolName];
}

export function isBuiltinManualApprovalTool(toolName: string): toolName is BuiltinManualApprovalTool {
	return getToolApprovalRequirement(toolName).kind === 'manual';
}

export const toolApprovalTypes: ReadonlySet<ToolApprovalType> = (() => {
	const categories = new Set<ToolApprovalType>();
	for (const requirement of Object.values(builtinToolApprovalPolicy)) {
		if (requirement.kind === 'manual') categories.add(requirement.category);
	}
	return categories;
})();

export function getToolApprovalSettingLabel(approvalType: ToolApprovalType): string {
	return `Auto-approve ${approvalType}`;
}
