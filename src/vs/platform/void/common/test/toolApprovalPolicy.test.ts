/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { classifyToolCall } from '../toolExecutionPolicy.js';
import { getToolApprovalRequirement, getToolApprovalSettingLabel, isBuiltinManualApprovalTool, toolApprovalTypes, type ToolApprovalRequirement } from '../toolApprovalPolicy.js';
import { toolNames } from '../toolsRegistry.js';
import type { ToolName } from '../toolsServiceTypes.js';

suite('ToolApprovalPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('defines an exhaustive approval requirement for every builtin tool', () => {
		const expected: Record<ToolName, ToolApprovalRequirement> = {
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
		};

		assert.deepStrictEqual([...toolNames].sort(), Object.keys(expected).sort());
		for (const toolName of toolNames) {
			assert.deepStrictEqual(getToolApprovalRequirement(toolName), expected[toolName], toolName);
		}
	});

	test('keeps missing builtin entries separate from dynamic policy', () => {
		assert.deepStrictEqual(getToolApprovalRequirement('read_file'), { kind: 'none' });
		assert.deepStrictEqual(getToolApprovalRequirement('mcp__example'), { kind: 'dynamic-policy' });
		assert.strictEqual(isBuiltinManualApprovalTool('read_file'), false);
		assert.strictEqual(isBuiltinManualApprovalTool('mcp__example'), false);
	});

	test('has an independent delete category', () => {
		assert.deepStrictEqual([...toolApprovalTypes], ['edits', 'delete', 'terminal']);
		assert.deepStrictEqual(getToolApprovalRequirement('edit_file'), { kind: 'manual', category: 'edits' });
		assert.deepStrictEqual(getToolApprovalRequirement('rewrite_file'), { kind: 'manual', category: 'edits' });
		assert.deepStrictEqual(getToolApprovalRequirement('delete_file_or_folder'), { kind: 'manual', category: 'delete' });
		assert.strictEqual(getToolApprovalSettingLabel('edits'), 'Auto-approve edits');
		assert.strictEqual(getToolApprovalSettingLabel('delete'), 'Auto-approve delete');
	});

	test('keeps approval independent from execution kind', () => {
		assert.strictEqual(classifyToolCall({ id: 'create', name: 'create_file_or_folder', rawParams: { uri: './new' } }).kind, 'mutating');
		assert.deepStrictEqual(getToolApprovalRequirement('create_file_or_folder'), { kind: 'none' });

		assert.strictEqual(classifyToolCall({ id: 'delete', name: 'delete_file_or_folder', rawParams: { uri: './old' } }).kind, 'mutating');
		assert.deepStrictEqual(getToolApprovalRequirement('delete_file_or_folder'), { kind: 'manual', category: 'delete' });

		assert.strictEqual(classifyToolCall({ id: 'terminal', name: 'run_command', rawParams: { command: 'git status --short' } }).kind, 'read-only-terminal');
		assert.deepStrictEqual(getToolApprovalRequirement('run_command'), { kind: 'manual', category: 'terminal' });
	});
});
