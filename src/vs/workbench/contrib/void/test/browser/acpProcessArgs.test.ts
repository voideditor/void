/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseAcpProcessArgs } from '../../../../../platform/void/common/acpArgs.js';

suite('ACP process arguments parsing', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses long and short flags with equals for port', () => {
		assert.deepStrictEqual(
			parseAcpProcessArgs('--acp --port=8000'),
			['--acp', '--port=8000']
		);
		assert.deepStrictEqual(
			parseAcpProcessArgs('-acp -port=8000'),
			['-acp', '-port=8000']
		);
	});

	test('parses config flag with separate value argument', () => {
		assert.deepStrictEqual(
			parseAcpProcessArgs('--config "my_cfg_json"'),
			['--config', 'my_cfg_json']
		);
		assert.deepStrictEqual(
			parseAcpProcessArgs('-config "my_cfg_json"'),
			['-config', 'my_cfg_json']
		);
	});

	test('parses config flag with equals and quoted value as a single argument', () => {
		assert.deepStrictEqual(
			parseAcpProcessArgs('--config="my_cfg_json"'),
			['--config=my_cfg_json']
		);
	});

	test('handles mixed arguments consistently', () => {
		assert.deepStrictEqual(
			parseAcpProcessArgs('--acp --config="my_cfg_json" --port=8000'),
			['--acp', '--config=my_cfg_json', '--port=8000']
		);
	});
});
