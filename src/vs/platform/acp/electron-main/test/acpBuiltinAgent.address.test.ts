/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ILogService } from '../../../log/common/log.js';
import { resolveAcpAgentAddress } from '../../common/acpAgentAddress.js';
import { __test, startBuiltinAcpAgent } from '../acpBuiltinAgent.js';

class FakeWebSocketServer extends EventEmitter {
	readonly clients = new Set<unknown>();

	close(): void {
		this.emit('close');
	}
}

suite('ACP builtin agent address', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let originalEnvHost: string | undefined;
	let originalEnvPort: string | undefined;

	setup(() => {
		originalEnvHost = process.env.VOID_ACP_AGENT_HOST;
		originalEnvPort = process.env.VOID_ACP_AGENT_PORT;
		delete process.env.VOID_ACP_AGENT_HOST;
		delete process.env.VOID_ACP_AGENT_PORT;
		__test.reset();
	});

	teardown(() => {
		__test.reset();
		restoreEnv();
	});

	test('uses custom listen host and port', () => {
		const { options } = installFakeServer();

		startBuiltinAcpAgent(testLog(), undefined, undefined, resolveAcpAgentAddress({ cliAddr: '127.0.0.1:8720' }));

		assert.strictEqual(options.value?.host, '127.0.0.1');
		assert.strictEqual(options.value?.port, 8720);
	});

	test('uses default listen address', () => {
		const { options } = installFakeServer();

		startBuiltinAcpAgent(testLog());

		assert.strictEqual(options.value?.host, '127.0.0.1');
		assert.strictEqual(options.value?.port, 8719);
	});

	test('startup log includes resolved wsUrl', () => {
		const { server } = installFakeServer();
		const log = testLog();

		startBuiltinAcpAgent(log, undefined, undefined, resolveAcpAgentAddress({ cliAddr: '127.0.0.1:8720' }));
		server.value?.emit('listening');

		assert.ok(log.infoMessages.some(message => message.includes('ws://127.0.0.1:8720')));
	});

	test('occupied custom port diagnostic resets started state', () => {
		const { server } = installFakeServer();
		const log = testLog();

		startBuiltinAcpAgent(log, undefined, undefined, resolveAcpAgentAddress({ cliAddr: '127.0.0.1:8720' }));
		server.value?.emit('error', Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }));

		assert.strictEqual(__test.isBuiltinAgentStarted(), false);
		assert.ok(log.warnMessages.some(message => message.includes('ws://127.0.0.1:8720')));
		assert.ok(log.warnMessages.some(message => message.includes('EADDRINUSE')));
	});

	test('runtime ACP code does not hardcode builtin default URL outside shared address module', () => {
		const runtimeFiles = [
			'src/vs/platform/acp/electron-main/acpBuiltinAgent.ts',
			'src/vs/platform/acp/electron-main/acpMainService.ts',
			'src/vs/code/electron-main/app.ts'
		];

		const offenders = runtimeFiles.filter(file => {
			const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
			return text.includes('ws://127.0.0.1:8719') || text.includes('127.0.0.1:8719');
		});

		assert.deepStrictEqual(offenders, []);
	});

	function installFakeServer(): { server: { value?: FakeWebSocketServer }; options: { value?: { host?: string; port?: number } } } {
		const server: { value?: FakeWebSocketServer } = {};
		const options: { value?: { host?: string; port?: number } } = {};
		__test.setWebSocketServerFactory((opts) => {
			options.value = opts as { host?: string; port?: number };
			server.value = new FakeWebSocketServer();
			return server.value as any;
		});
		return { server, options };
	}

	function testLog(): ILogService & { infoMessages: string[]; warnMessages: string[] } {
		const infoMessages: string[] = [];
		const warnMessages: string[] = [];
		const stringify = (value: unknown) => {
			if (value instanceof Error) {
				return `${value.message} ${(value as { code?: string }).code ?? ''}`.trim();
			}
			return String(value);
		};

		return {
			infoMessages,
			warnMessages,
			debug: () => { },
			error: () => { },
			trace: () => { },
			info: (...args: unknown[]) => infoMessages.push(args.map(stringify).join(' ')),
			warn: (...args: unknown[]) => warnMessages.push(args.map(stringify).join(' ')),
		} as unknown as ILogService & { infoMessages: string[]; warnMessages: string[] };
	}

	function restoreEnv(): void {
		if (originalEnvHost === undefined) {
			delete process.env.VOID_ACP_AGENT_HOST;
		} else {
			process.env.VOID_ACP_AGENT_HOST = originalEnvHost;
		}
		if (originalEnvPort === undefined) {
			delete process.env.VOID_ACP_AGENT_PORT;
		} else {
			process.env.VOID_ACP_AGENT_PORT = originalEnvPort;
		}
	}
});
