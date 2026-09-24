/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('Void quick test registration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('approval orchestration suites are loaded by the curated runner', function () {
		const loadedSuites = new Set<string>();
		let root = this.test?.parent;
		while (root?.parent) root = root.parent;
		const visit = (current: Mocha.Suite): void => {
			loadedSuites.add(current.title);
			for (const child of current.suites) visit(child);
		};
		if (root) visit(root);

		for (const expected of [
			'ToolApprovalPolicy',
			'ToolTurnCoordinator',
			'ChatExecutionEngine tool turn event trace',
			'Sidebar chat tool approval controls',
			'AcpHostCallbacksService approval queue',
		]) {
			assert.ok(loadedSuites.has(expected), `Expected curated runner to load suite: ${expected}`);
		}
	});
});
