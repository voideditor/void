/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';

import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IEnvironmentMainService } from '../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { StorageTarget, StorageScope } from '../../../platform/storage/common/storage.js';
import { IApplicationStorageMainService } from '../../../platform/storage/electron-main/storageMainService.js';
import { IMetricsService } from '../common/metricsService.js';
import { defaultGlobalSettings, DISABLE_TELEMETRY_KEY } from '../../void/common/voidSettingsTypes.js';

const POSTHOG_API_KEY = 'phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2';
const POSTHOG_HOST = 'https://us.i.posthog.com';

const require = createRequire(import.meta.url);

type PostHogModule = typeof import('posthog-node');
const { PostHog } = require('posthog-node') as PostHogModule;
type PostHogClient = import('posthog-node').PostHog;


const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null
const _getOSInfo = () => {
	try {
		const { platform, arch } = process // see platform.ts
		return { platform, arch }
	}
	catch (e) {
		return { osInfo: { platform: '??', arch: '??' } }
	}
}
const osInfo = _getOSInfo()

// we'd like to use devDeviceId on telemetryService, but that gets sanitized by the time it gets here as 'someValue.devDeviceId'

export class MetricsMainService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	private client: PostHogClient | undefined
	private _initProperties: object = {}


	// helper - looks like this is stored in a .vscdb file in ~/Library/Application Support/Void
	private _memoStorage(key: string, target: StorageTarget, setValIfNotExist?: string) {
		const currVal = this._appStorage.get(key, StorageScope.APPLICATION)
		if (currVal !== undefined) return currVal
		const newVal = setValIfNotExist ?? generateUuid()
		this._appStorage.store(key, newVal, StorageScope.APPLICATION, target)
		return newVal
	}


	// this is old, eventually we can just delete this since all the keys will have been transferred over
	// returns 'NULL' or the old key
	private get oldId() {
		// check new storage key first
		const newKey = 'void.app.oldMachineId'
		const newOldId = this._appStorage.get(newKey, StorageScope.APPLICATION)
		if (newOldId) return newOldId

		// put old key into new key if didn't already
		const oldValue = this._appStorage.get('void.machineId', StorageScope.APPLICATION) ?? 'NULL' // the old way of getting the key
		this._appStorage.store(newKey, oldValue, StorageScope.APPLICATION, StorageTarget.MACHINE)
		return oldValue

		// in a few weeks we can replace above with this
		// private get oldId() {
		// 	return this._memoStorage('void.app.oldMachineId', StorageTarget.MACHINE, 'NULL')
		// }
	}

	private _getTelemetryDisabled(): boolean {
		const val = this._appStorage.get(DISABLE_TELEMETRY_KEY, StorageScope.APPLICATION);
		return typeof val === 'boolean' ? val : defaultGlobalSettings.disableTelemetry;
	}

	private _ensureDefaultTelemetryFlag(): void {
		const existing = this._appStorage.get(DISABLE_TELEMETRY_KEY, StorageScope.APPLICATION);
		if (existing === undefined) {
			this._appStorage.store(
				DISABLE_TELEMETRY_KEY,
				defaultGlobalSettings.disableTelemetry,
				StorageScope.APPLICATION,
				StorageTarget.USER
			);
		}
	}

	private _ensureClient(): void {
		if (!this.client) {
			this.client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
		}
	}

	private _shutdownClient(): void {
		this.client?.shutdown?.();
		this.client = undefined;
	}

	private _updateClientStateFromFlag(): void {
		if (this._getTelemetryDisabled()) {
			this._shutdownClient();
		} else {
			this._ensureClient();
		}
	}

	private _buildInitProperties(): object {
		const { commit, version, voidVersion, release, quality } = this._productService;
		const isDevMode = !this._envMainService.isBuilt;

		return {
			commit,
			vscodeVersion: version,
			voidVersion: voidVersion,
			release,
			os,
			quality,
			distinctId: this.distinctId,
			distinctIdUser: this.userId,
			oldId: this.oldId,
			isDevMode,
			...osInfo,
		};
	}

	private _identifyIfActive(): void {
		if (!this.client || this._getTelemetryDisabled()) return;
		const identifyMessage = {
			distinctId: this.distinctId,
			properties: this._initProperties,
		};
		this.client.identify(identifyMessage);
		console.log('Void posthog metrics info:', JSON.stringify(identifyMessage, null, 2));
	}

	private _subscribeToTelemetryChanges(): void {
		const changeStore = this._register(new DisposableStore());

		const onAppTelemetryChange = this._appStorage.onDidChangeValue(
			StorageScope.APPLICATION,
			DISABLE_TELEMETRY_KEY,
			changeStore
		);

		this._register(
			onAppTelemetryChange(() => {
				const disabled = this._getTelemetryDisabled();
				if (disabled) {
					this._shutdownClient();
				} else {
					const hadClient = !!this.client;
					this._ensureClient();
					
					if (!hadClient) {
						this._identifyIfActive();
					}
				}
			})
		);
	}


	// the main id
	private get distinctId() {
		const oldId = this.oldId
		const setValIfNotExist = oldId === 'NULL' ? undefined : oldId
		return this._memoStorage('void.app.machineId', StorageTarget.MACHINE, setValIfNotExist)
	}

	// just to see if there are ever multiple machineIDs per userID (instead of this, we should just track by the user's email)
	private get userId() {
		return this._memoStorage('void.app.userMachineId', StorageTarget.USER)
	}

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IApplicationStorageMainService private readonly _appStorage: IApplicationStorageMainService,
	) {
		super();
		this.initialize() // async
	}

	async initialize() {
		
		await this._appStorage.whenReady;

		
		this._ensureDefaultTelemetryFlag();

		
		this._initProperties = this._buildInitProperties();

		
		this._updateClientStateFromFlag();

		
		this._identifyIfActive();

		
		this._subscribeToTelemetryChanges();
	}

	capture: IMetricsService['capture'] = (event, params) => {
		
		if (!this.client) return;

		const capture = { distinctId: this.distinctId, event, properties: params } as const;
		this.client.capture(capture);
	};


	async getDebuggingProperties() {
		return this._initProperties
	}
}


