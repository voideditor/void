/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../../../platform/environment/electron-main/environmentMainService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { IVoidUpdateService } from '../common/voidUpdateService.js';



export class VoidMainUpdateService extends Disposable implements IVoidUpdateService {
	_serviceBrand: undefined;

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
		@IUpdateService private readonly _updateService: IUpdateService
	) {
		super()
	}

	nIgnores = 0
	async check(explicit: boolean) {

		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts

		if (isDevMode) {
			return { hasUpdate: false } as const
		}

		this._updateService.checkForUpdates(false) // implicity check, then handle result ourselves

		if (this._updateService.state.type === StateType.Ready) {
			return { hasUpdate: true, message: 'Restart Void to update!' }
		}

		const wasAutomaticCheck = !explicit // ignore the first auto check, just use it to call updateService.check()
		if (wasAutomaticCheck && this.nIgnores < 1) {
			this.nIgnores += 1
			return { hasUpdate: false } as const
		}

		try {
			const res = await fetch(`https://updates.voideditor.dev/api/v0/${this._productService.commit}`)
			const resJSON = await res.json()

			if (!resJSON) return null // null means error

			const { hasUpdate, downloadMessage } = resJSON ?? {}
			if (hasUpdate === undefined)
				return null

			const after = (downloadMessage || '') + ''
			return { hasUpdate: !!hasUpdate, message: after }
		}
		catch (e) {
			return null
		}
	}
}

