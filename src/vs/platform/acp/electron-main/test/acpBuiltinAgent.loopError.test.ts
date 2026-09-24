import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { LOOP_DETECTED_MESSAGE } from '../../../../platform/void/common/loopGuard.js';
import { __test } from '../acpBuiltinAgent.js';

suite('acpBuiltinAgent loop error', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		__test.reset();
	});

	test('Loop detected surfaces as error.message (not sessionId) and details', async () => {
		let callNo = 0;

		__test.setSendChatRouter(async (opts: any) => {
			callNo++;
			if (callNo === 1) {
				await opts.onFinalMessage({
					fullText: 'same',
					toolCall: { id: 'tc1', name: 'fake_tool', rawParams: {}, isDone: true }
				});
				return;
			}

			await opts.onFinalMessage({ fullText: 'same' });
		});

		const conn: any = {
			async extMethod(method: string) {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: {},
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						loopGuard: { maxTurnsPerPrompt: 1, maxSameAssistantPrefix: 1 },
						requestParams: null,
						providerRouting: null,
						dynamicRequestConfig: {
							apiStyle: 'openai-compatible',
							endpoint: 'https://example.invalid',
							headers: {},
							specialToolFormat: 'openai-style',
							supportsSystemMessage: 'system-role',
						},
						additionalTools: null,
					};
				}
				throw new Error(`Unexpected extMethod: ${method}`);
			},

			async sessionUpdate() { /* noop */ },

			async requestPermission() {
				// Reject -> treated as skip -> get 2nd LLM turn
				return { outcome: { outcome: 'selected', optionId: 'reject_once' } };
			},
		};

		const agent = new __test.VoidPipelineAcpAgent(conn, new NullLogService());
		const { sessionId } = await agent.newSession({} as any);

		await assert.rejects(
			() => agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'hi' }] } as any),
			(e: any) => {
				assert.ok(e instanceof Error);
				assert.strictEqual(e.message, LOOP_DETECTED_MESSAGE);

				const anyErr = e as any;
				const details = anyErr?.data?.details ?? anyErr?.details ?? '';
				assert.ok(typeof details === 'string');
				assert.ok(details.includes(LOOP_DETECTED_MESSAGE));

				return true;
			}
		);
	});
});
