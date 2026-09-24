/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEncryptionService, KnownStorageProvider } from '../../../encryption/common/encryptionService.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../storage/common/storage.js';
import { IMetricsService } from '../metricsService.js';
import { VOID_SETTINGS_STORAGE_KEY } from '../storageKeys.js';
import { VoidSettingsService } from '../voidSettingsService.js';
import { defaultGlobalSettings, globalSettingNames } from '../voidSettingsTypes.js';

class TestEncryptionService implements IEncryptionService {
	readonly _serviceBrand: undefined;

	setUsePlainTextEncryption(): Promise<void> {
		return Promise.resolve();
	}

	getKeyStorageProvider(): Promise<KnownStorageProvider> {
		return Promise.resolve(KnownStorageProvider.basicText);
	}

	encrypt(value: string): Promise<string> {
		return Promise.resolve(value);
	}

	decrypt(value: string): Promise<string> {
		return Promise.resolve(value);
	}

	isEncryptionAvailable(): Promise<boolean> {
		return Promise.resolve(true);
	}
}

class TestMetricsService implements IMetricsService {
	readonly _serviceBrand: undefined;

	capture(..._params: Parameters<IMetricsService['capture']>): void { }

	getDebuggingProperties(): Promise<object> {
		return Promise.resolve({});
	}
}

suite('Terminal output settings', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('defaults and global setting names include terminal output settings', () => {
		assert.strictEqual(defaultGlobalSettings.terminalOutputSummarization, true);
		assert.strictEqual(defaultGlobalSettings.terminalOutputHeadLines, 50);
		assert.strictEqual(defaultGlobalSettings.terminalOutputTailLines, 50);
		assert.ok(globalSettingNames.includes('terminalOutputSummarization'));
		assert.ok(globalSettingNames.includes('terminalOutputHeadLines'));
		assert.ok(globalSettingNames.includes('terminalOutputTailLines'));
	});

	test('initialization backfills terminal output settings in legacy state', async () => {
		const storageService = store.add(new InMemoryStorageService());
		await storageService.initialize();

		const {
			terminalOutputSummarization: _terminalOutputSummarization,
			terminalOutputHeadLines: _terminalOutputHeadLines,
			terminalOutputTailLines: _terminalOutputTailLines,
			...legacyGlobalSettings
		} = defaultGlobalSettings;
		const legacyState = {
			settingsOfProvider: {},
			modelSelectionOfFeature: { 'Chat': null, 'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null },
			globalSettings: { ...legacyGlobalSettings, maxToolOutputLength: 12345 },
			optionsOfModelSelection: { 'Chat': {}, 'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {} },
			overridesOfModel: {},
			customProviders: {},
			_modelOptions: [],
			mcpUserStateOfName: {},
		};
		storageService.store(
			VOID_SETTINGS_STORAGE_KEY,
			JSON.stringify(legacyState),
			StorageScope.APPLICATION,
			StorageTarget.USER
		);

		const settingsService = store.add(new VoidSettingsService(
			storageService,
			new TestEncryptionService(),
			new TestMetricsService()
		));
		await settingsService.waitForInitState;

		assert.strictEqual(settingsService.state.globalSettings.terminalOutputSummarization, true);
		assert.strictEqual(settingsService.state.globalSettings.terminalOutputHeadLines, 50);
		assert.strictEqual(settingsService.state.globalSettings.terminalOutputTailLines, 50);
		assert.strictEqual(settingsService.state.globalSettings.maxToolOutputLength, 12345);
	});

	test('delete auto-approval defaults to false and is independent from edits', async () => {
		assert.strictEqual(defaultGlobalSettings.autoApprove.delete, undefined);
		assert.strictEqual(defaultGlobalSettings.autoApprove.edits, undefined);

		const storageService = store.add(new InMemoryStorageService());
		await storageService.initialize();
		const legacyState = {
			settingsOfProvider: {},
			modelSelectionOfFeature: { 'Chat': null, 'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null },
			globalSettings: { ...defaultGlobalSettings, autoApprove: { edits: true } },
			optionsOfModelSelection: { 'Chat': {}, 'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {} },
			overridesOfModel: {},
			customProviders: {},
			_modelOptions: [],
			mcpUserStateOfName: {},
		};
		storageService.store(
			VOID_SETTINGS_STORAGE_KEY,
			JSON.stringify(legacyState),
			StorageScope.APPLICATION,
			StorageTarget.USER
		);

		const settingsService = store.add(new VoidSettingsService(
			storageService,
			new TestEncryptionService(),
			new TestMetricsService()
		));
		await settingsService.waitForInitState;

		assert.strictEqual(settingsService.state.globalSettings.autoApprove.edits, true);
		assert.strictEqual(settingsService.state.globalSettings.autoApprove.delete, false);
	});
});
