/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';


export interface INuancedService {
	readonly _serviceBrand: undefined;
}

export const INuancedService = createDecorator<INuancedService>('NuancedService');




registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: true,
			id: 'void.nuanced',
			title: localize2('nuanced', 'Nuanced: Init'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Digit0,
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		console.log('hi')
		const n = accessor.get(INuancedService)
		console.log('Nuanced', n._serviceBrand)
	}
})

// on mount
class NuancedService extends Disposable implements IWorkbenchContribution, INuancedService {
	static readonly ID = 'workbench.contrib.void.nuanced'
	_serviceBrand: undefined;

	constructor(
	) {
		super()

	}
}

registerSingleton(INuancedService, NuancedService, InstantiationType.Eager);

registerWorkbenchContribution2(NuancedService.ID, NuancedService, WorkbenchPhase.BlockRestore);
