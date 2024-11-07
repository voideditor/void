

import * as dom from '../../../../base/browser/dom.js';

import { ViewPane } from '../../../browser/parts/views/viewPane.js';

// import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
// import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
// import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
// import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
// import { IViewPaneOptions,  } from 'vs/workbench/browser/parts/views/viewPane';
// import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
// import { IOpenerService } from 'vs/platform/opener/common/opener';
// import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
// import { IThemeService } from 'vs/platform/theme/common/themeService';
// import { IViewDescriptorService } from 'vs/workbench/common/views';
// import { IHoverService } from 'vs/platform/hover/browser/hover';

// import { useState } from './void-imports/react.js';
// const x = useState();

export class VoidViewPane extends ViewPane {

	// constructor(
	// 	options: IViewPaneOptions,
	// 	@IInstantiationService instantiationService: IInstantiationService,
	// 	@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	// 	@IConfigurationService configurationService: IConfigurationService,
	// 	@IContextKeyService contextKeyService: IContextKeyService,
	// 	@IThemeService themeService: IThemeService,
	// 	@IContextMenuService contextMenuService: IContextMenuService,
	// 	@IKeybindingService keybindingService: IKeybindingService,
	// 	@IOpenerService openerService: IOpenerService,
	// 	@ITelemetryService telemetryService: ITelemetryService,
	// 	@IHoverService hoverService: IHoverService,
	// ) {
	// 	super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
	// }



	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);

		const container = dom.append(parent, dom.$('.search-view'));
		container.textContent = 'Hello Void!';

		console.log('Void container', container);


	}
}

// register a singleton service that mounts the ViewPane here


