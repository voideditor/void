/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { mountVoidTooltip } from './react/out/void-tooltip/index.js';
import { h, getActiveWindow } from '../../../../base/browser/dom.js';

// Tooltip contribution that mounts the component at startup
export class TooltipContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.voidTooltip';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.initializeTooltip();
	}

	private initializeTooltip(): void {
		// Get the active window reference for multi-window support
		const targetWindow = getActiveWindow();

		// Find the monaco-workbench element using the proper window reference
		const workbench = targetWindow.document.querySelector('.monaco-workbench');

		if (workbench) {
			// Create a container element for the tooltip using h function
			const tooltipContainer = h('div.void-tooltip-container').root;
			workbench.appendChild(tooltipContainer);

			// Mount the React component
			this.instantiationService.invokeFunction((accessor: ServicesAccessor) => {
				const result = mountVoidTooltip(tooltipContainer, accessor);
				if (result && typeof result.dispose === 'function') {
					this._register(toDisposable(result.dispose));
				}
			});

			// Register cleanup for the DOM element
			this._register(toDisposable(() => {
				if (tooltipContainer.parentElement) {
					tooltipContainer.parentElement.removeChild(tooltipContainer);
				}
			}));
		}
	}
}

// Register the contribution to be initialized during the AfterRestored phase
registerWorkbenchContribution2(TooltipContribution.ID, TooltipContribution, WorkbenchPhase.AfterRestored);
