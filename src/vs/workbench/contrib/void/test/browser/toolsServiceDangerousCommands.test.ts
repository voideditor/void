/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isDangerousTerminalCommand } from '../../common/toolsService.js';

suite('ToolsService - isDangerousTerminalCommand', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects rm -rf / with or without sudo and extra whitespace', () => {
		assert.ok(isDangerousTerminalCommand('rm -rf /'));
		assert.ok(isDangerousTerminalCommand('sudo   rm   -rf    /'));
		assert.ok(isDangerousTerminalCommand('  rm   -rf   /   '));
	});

	test('detects dd writing to /dev devices', () => {
		assert.ok(isDangerousTerminalCommand('dd if=/dev/zero of=/dev/sda'));
		assert.ok(isDangerousTerminalCommand('sudo dd of=/dev/nvme0n1 bs=1M'));
	});

	test('does not flag common safe commands as dangerous', () => {
		assert.ok(!isDangerousTerminalCommand('ls -la'));
		assert.ok(!isDangerousTerminalCommand('echo "hello world"'));
		assert.ok(!isDangerousTerminalCommand('cat /etc/hosts'));
	});
});
