/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseAgentSkillMarkdown } from '../../common/skills/agentSkillsParser.js';

suite('Agent Skills parser', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses valid frontmatter and body', () => {
		const result = parseAgentSkillMarkdown(`---
name: code-review
description: Review code carefully
allowed-tools: [read_file, search_for_files]
---

Use this skill for focused code review.
`, { expectedDirectoryName: 'code-review' });

		assert.strictEqual(result.frontmatter.name, 'code-review');
		assert.strictEqual(result.frontmatter.description, 'Review code carefully');
		assert.deepStrictEqual(result.frontmatter.allowedTools, ['read_file', 'search_for_files']);
		assert.strictEqual(result.body, 'Use this skill for focused code review.');
		assert.deepStrictEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
	});

	test('keeps common malformed YAML lines as warnings while recovering required fields', () => {
		const result = parseAgentSkillMarkdown(`---
name: "pdf-processing"
bad yaml line
description: 'Process PDFs'
---
Body
`);

		assert.strictEqual(result.frontmatter.name, 'pdf-processing');
		assert.strictEqual(result.frontmatter.description, 'Process PDFs');
		assert.ok(result.diagnostics.some(d => d.code === 'frontmatter_line_ignored'));
	});

	test('reports missing description as invalid', () => {
		const result = parseAgentSkillMarkdown(`---
name: no-description
---
Body
`);

		assert.ok(result.diagnostics.some(d => d.code === 'missing_description' && d.severity === 'error'));
	});

	test('extracts body after closing delimiter only', () => {
		const result = parseAgentSkillMarkdown(`---
name: body-test
description: Body test
---
---
This delimiter is body content.
`);

		assert.strictEqual(result.body, '---\nThis delimiter is body content.');
	});

	test('warns on directory/name mismatch', () => {
		const uri = URI.file('/tmp/skills/actual/SKILL.md');
		const result = parseAgentSkillMarkdown(`---
name: declared
description: Mismatch
---
Body
`, { uri, expectedDirectoryName: 'actual' });

		assert.ok(result.diagnostics.some(d => d.code === 'directory_name_mismatch'));
	});
});
