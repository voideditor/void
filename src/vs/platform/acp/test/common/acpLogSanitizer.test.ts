import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { redactEnvForLog } from '../../common/acpLogSanitizer.js';

suite('acpLogSanitizer.redactEnvForLog', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('redacts *_KEY / *_TOKEN / password-like fields', () => {
		const env = {
			MISTRAL_API_KEY: 'secret1',
			OPENAI_TOKEN: 'secret2',
			password: 'secret3',
			PATH: '/bin',
			NORMAL: 'ok',
		};

		const out = redactEnvForLog(env);

		assert.deepStrictEqual(out, {
			MISTRAL_API_KEY: '<redacted>',
			OPENAI_TOKEN: '<redacted>',
			password: '<redacted>',
			PATH: '/bin',
			NORMAL: 'ok',
		});
	});

	test('returns non-object as-is', () => {
		assert.strictEqual(redactEnvForLog(null), null);
		assert.strictEqual(redactEnvForLog(undefined), undefined);
		assert.strictEqual(redactEnvForLog('x' as any), 'x');
	});
});
