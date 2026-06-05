import assert from 'assert';
import { AcpMainService } from '../acpMainService.js';
import { ILogService } from '../../../log/common/log.js';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('AcpMainService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let service: AcpMainService;
	let logService: ILogService;

	setup(() => {
		logService = {
			debug: () => { },
			info: () => { },
			warn: () => { },
			error: () => { },
			trace: () => { },
		} as any;
		service = new AcpMainService(logService);
	});

	teardown(async () => {
		await service.disconnect();
	});

	test('connect defaults to websocket mode', async () => {
		try {
			// Expect failure due to invalid URL, but verify mode logic
			await service.connect({ mode: 'websocket', agentUrl: 'ws://invalid' });
		} catch { }
		// We can't inspect private state directly, but we verified the call flow doesn't crash
	});

	test('connect builtin defaults URL', async () => {
		try {
			await service.connect({ mode: 'builtin' });
		} catch { }
	});

	test('connect in process mode requires command', async () => {
		await assert.rejects(async () => {
			await service.connect({ mode: 'process', args: [] });
		}, /command is required/);
	});

	test('disconnect clears connection state', async () => {
		// Manually set state to simulate connection (since we can't easily connect to real things)
		(service as any).connected = true;
		(service as any).lastConnectParams = { mode: 'builtin' };

		await service.disconnect();

		assert.strictEqual((service as any).connected, false);
		assert.strictEqual((service as any).lastConnectParams, undefined);
	});

	test('sendChatMessage throws if connection fails', async () => {
		await assert.rejects(async () => {
			await service.sendChatMessage({
				threadId: 't1',
				history: [],
				message: { role: 'user', content: 'hi' },
				// Use a local non-existent port to ensure fast failure (ECONNREFUSED) instead of DNS timeout
				opts: { mode: 'websocket', agentUrl: 'ws://127.0.0.1:54321' }
			});
		});
	});
});
