/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AcpAgentAddressError, resolveAcpAgentAddress } from '../../common/acpAgentAddress.js';

suite('resolveAcpAgentAddress', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses default address without CLI or env overrides', () => {
		assert.deepStrictEqual(resolveAcpAgentAddress(), {
			host: '127.0.0.1',
			port: 8719,
			wsUrl: 'ws://127.0.0.1:8719',
			source: 'default'
		});
	});

	test('uses CLI address override', () => {
		assert.deepStrictEqual(resolveAcpAgentAddress({ cliAddr: '127.0.0.1:8720' }), {
			host: '127.0.0.1',
			port: 8720,
			wsUrl: 'ws://127.0.0.1:8720',
			source: 'cli'
		});
	});

	test('CLI address takes precedence over env overrides', () => {
		const address = resolveAcpAgentAddress({
			cliAddr: '127.0.0.1:8720',
			env: {
				VOID_ACP_AGENT_HOST: '127.0.0.1',
				VOID_ACP_AGENT_PORT: '8730'
			}
		});

		assert.strictEqual(address.port, 8720);
		assert.strictEqual(address.wsUrl, 'ws://127.0.0.1:8720');
		assert.strictEqual(address.source, 'cli');
	});

	test('uses env fallback endpoint', () => {
		assert.deepStrictEqual(resolveAcpAgentAddress({
			env: {
				VOID_ACP_AGENT_HOST: 'localhost',
				VOID_ACP_AGENT_PORT: '8730'
			}
		}), {
			host: 'localhost',
			port: 8730,
			wsUrl: 'ws://localhost:8730',
			source: 'env'
		});
	});

	test('formats IPv6 loopback URL with brackets', () => {
		assert.deepStrictEqual(resolveAcpAgentAddress({ cliAddr: '[::1]:8720' }), {
			host: '::1',
			port: 8720,
			wsUrl: 'ws://[::1]:8720',
			source: 'cli'
		});

		assert.strictEqual(resolveAcpAgentAddress({ cliAddr: '::1:8721' }).wsUrl, 'ws://[::1]:8721');
	});

	test('rejects invalid address values', () => {
		assertAddressError('127.0.0.1', 'must use <host>:<port>');
		assertAddressError('127.0.0.1:notaport', 'must be an integer from 1 through 65535');
		assertAddressError('127.0.0.1:0', 'must be an integer from 1 through 65535');
		assertAddressError('127.0.0.1:65536', 'must be an integer from 1 through 65535');
		assertAddressError(':8720', 'must include a host');
		assertAddressError('0.0.0.0:8720', 'must use a loopback host');
		assertAddressError('192.168.1.10:8720', 'must use a loopback host');
	});

	function assertAddressError(cliAddr: string, expectedMessagePart: string): void {
		try {
			resolveAcpAgentAddress({ cliAddr });
			assert.fail(`Expected ${cliAddr} to throw`);
		} catch (e) {
			const err = e as AcpAgentAddressError;
			assert.strictEqual(err.name, 'AcpAgentAddressError');
			assert.ok(err.message.includes(expectedMessagePart), `Expected "${err.message}" to include "${expectedMessagePart}"`);
		}
	}
});
