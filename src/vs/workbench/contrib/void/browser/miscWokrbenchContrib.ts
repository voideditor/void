/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
// import { IExtensionTransferService } from './extensionTransferService.js';
// import { os } from '../common/helpers/systemInfo.js';
// import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

// Onboarding contribution that mounts the component at startup
export class MiscWorkbenchContribs extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.voidMiscWorkbenchContribs';

	constructor(
		// @IExtensionTransferService private readonly extensionTransferService: IExtensionTransferService,
		// @IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.initialize();
	}

	private initialize(): void {

		// // delete blacklisted extensions once (this is for people who already installed them)
		// const deleteExtensionsStorageId = 'void-deleted-blacklist'
		// const alreadyDeleted = this.storageService.get(deleteExtensionsStorageId, StorageScope.APPLICATION)
		// if (!alreadyDeleted) {
		// 	this.storageService.store(deleteExtensionsStorageId, 'true', StorageScope.APPLICATION, StorageTarget.MACHINE)
		// 	this.extensionTransferService.deleteBlacklistExtensions(os)
		// }

	}
}

registerWorkbenchContribution2(MiscWorkbenchContribs.ID, MiscWorkbenchContribs, WorkbenchPhase.Eventually);
