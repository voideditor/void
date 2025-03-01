/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import Severity from '../../../../base/common/severity.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IMetricsService } from '../common/metricsService.js';
import { IVoidUpdateService } from '../common/voidUpdateService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';




const notifyYesUpdate = (notifService: INotificationService, msg?: string) => {
	const message = msg || 'This is a very old version of void, please download the latest version! [Void Editor](https://voideditor.com/download-beta)!'
	notifService.notify({
		severity: Severity.Info,
		message: message,
	})
}
const notifyNoUpdate = (notifService: INotificationService) => {
	notifService.notify({
		severity: Severity.Info,
		message: 'Void is up-to-date!',
	})
}
const notifyErrChecking = (notifService: INotificationService) => {
	const message = `Void Error: There was an error checking for updates. If this persists, please get in touch or reinstall Void [here](https://voideditor.com/download-beta)!`
	notifService.notify({
		severity: Severity.Info,
		message: message,
	})
}



// Action
registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: true,
			id: 'void.voidCheckUpdate',
			title: localize2('voidCheckUpdate', 'Void: Check for Updates'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voidUpdateService = accessor.get(IVoidUpdateService)
		const notifService = accessor.get(INotificationService)
		const metricsService = accessor.get(IMetricsService)

		metricsService.capture('Void Update Manual: Checking...', {})
		const res = await voidUpdateService.check()
		if (!res) { notifyErrChecking(notifService); metricsService.capture('Void Update Manual: Error', { res }) }
		else if (res.hasUpdate) { notifyYesUpdate(notifService, res.message); metricsService.capture('Void Update Manual: Yes', { res }) }
		else if (!res.hasUpdate) { notifyNoUpdate(notifService); metricsService.capture('Void Update Manual: No', { res }) }
	}
})

// on mount
class VoidUpdateWorkbenchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.void.voidUpdate'
	constructor(
		@IVoidUpdateService private readonly voidUpdateService: IVoidUpdateService,
		@IMetricsService private readonly metricsService: IMetricsService,
		@INotificationService private readonly notifService: INotificationService,
	) {
		super()
		const autoCheck = async () => {
			this.metricsService.capture('Void Update Startup: Checking...', {})
			const res = await this.voidUpdateService.check()
			if (!res) { notifyErrChecking(this.notifService); this.metricsService.capture('Void Update Startup: Error', { res }) }
			else if (res.hasUpdate) { notifyYesUpdate(this.notifService, res.message); this.metricsService.capture('Void Update Startup: Yes', { res }) }
			else if (!res.hasUpdate) { this.metricsService.capture('Void Update Startup: No', { res }) } // display nothing if up to date
		}

		// check once 5 seconds after mount

		const initId = setTimeout(() => autoCheck(), 5 * 1000)
		this._register({ dispose: () => clearTimeout(initId) })

		// check every 3 hours
		const intervalId = setInterval(() => autoCheck(), 3 * 60 * 60 * 1000)
		this._register({ dispose: () => clearInterval(intervalId) })

	}
}
registerWorkbenchContribution2(VoidUpdateWorkbenchContribution.ID, VoidUpdateWorkbenchContribution, WorkbenchPhase.BlockRestore);
