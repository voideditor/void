/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IExtensionTransferService } from './extensionTransferService.js';
import { os } from '../common/helpers/systemInfo.js';

// Onboarding contribution that mounts the component at startup
export class MiscWorkbenchContribs extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.voidMiscWorkbenchContribs';

	constructor(
		@IExtensionTransferService private readonly extensionTransferService: IExtensionTransferService,
	) {
		super();
		this.initialize();
	}

	private initialize(): void {
		// delete blacklisted extensions
		this.extensionTransferService.deleteBlacklistExtensions(os)

	}
}

registerWorkbenchContribution2(MiscWorkbenchContribs.ID, MiscWorkbenchContribs, WorkbenchPhase.Eventually);
