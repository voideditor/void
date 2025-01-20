/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';

import { IProductService } from '../../product/common/productService.js';

import { IVoidUpdateService } from '../common/voidUpdateService.js';



export class VoidMainUpdateService extends Disposable implements IVoidUpdateService {
	_serviceBrand: undefined;

	constructor(
		@IProductService private readonly _productService: IProductService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
	) {
		super()
	}

	async check() {
		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts
		if (isDevMode) {
			console.log('Checking for updates in dev mode')
			// return { message: `` }
		}

		try {
			const res = await fetch(`https://updates.voideditor.dev/api/v0/${this._productService.commit}`)
			const resJSON = await res.json()
			if (!resJSON) return null

			const { downloadMessage } = resJSON ?? {}
			if (!downloadMessage) return null

			const after = downloadMessage
			return { message: after }
		}
		catch (e) {
			return null
		}
	}
}

