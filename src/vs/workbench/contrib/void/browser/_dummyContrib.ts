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


export interface IDummyService {
	readonly _serviceBrand: undefined;
}

export const IDummyService = createDecorator<IDummyService>('DummyService');




registerAction2(class extends Action2 {
	constructor() {
		super({
			f1: true,
			id: 'void.dummy',
			title: localize2('dummy', 'dummy: Init'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Digit0,
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		console.log('hi')
		const n = accessor.get(IDummyService)
		console.log('Hi', n._serviceBrand)
	}
})

// on mount
class DummyService extends Disposable implements IWorkbenchContribution, IDummyService {
	static readonly ID = 'workbench.contrib.void.dummy'
	_serviceBrand: undefined;

	constructor(
	) {
		super()

	}
}

registerSingleton(IDummyService, DummyService, InstantiationType.Eager);

registerWorkbenchContribution2(DummyService.ID, DummyService, WorkbenchPhase.BlockRestore);
