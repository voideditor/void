/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions,
	IViewDescriptorService,
} from '../../../common/views.js';

import * as nls from '../../../../nls.js';

// import { Codicon } from '../../../../base/common/codicons.js';
// import { localize } from '../../../../nls.js';
// import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
// import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';


import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';

import { mountSidebar } from './react/out/sidebar-tsx/index.js';

import { IViewsService } from '../../../services/views/common/viewsService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { getReactServices } from './reactServices.js';


// compare against search.contribution.ts and debug.contribution.ts, scm.contribution.ts (source control)

export type VoidSidebarState = {
	isHistoryOpen: boolean;
	currentTab: 'chat';
}

// ---------- Define viewpane ----------

class VoidSidebarViewPane extends ViewPane {

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService)

	}



	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		parent.style.overflow = 'auto'
		parent.style.userSelect = 'text'

		// gets set immediately
		this.instantiationService.invokeFunction(accessor => {
			const services = getReactServices(accessor)

			// mount react
			const disposables: IDisposable[] | undefined = mountSidebar(parent, services);
			disposables?.forEach(d => this._register(d))
		});
	}

}



// ---------- Register viewpane inside the void container ----------

// const voidThemeIcon = Codicon.symbolObject;
// const voidViewIcon = registerIcon('void-view-icon', voidThemeIcon, localize('voidViewIcon', 'View icon of the Void chat view.'));

// called VIEWLET_ID in other places for some reason
export const VOID_VIEW_CONTAINER_ID = 'workbench.view.void'
export const VOID_VIEW_ID = VOID_VIEW_CONTAINER_ID // simplicity

// Register view container
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewContainer = viewContainerRegistry.registerViewContainer({
	id: VOID_VIEW_CONTAINER_ID,
	title: nls.localize2('void chat', 'Void Chat'), // this is used to say "Void" (Ctrl + L)
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VOID_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	hideIfEmpty: false,
	// icon: voidViewIcon,
	order: 1,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true, isDefault: true });



// Register search default location to the container (sidebar)
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([{
	id: VOID_VIEW_ID,
	hideByDefault: false, // start open
	// containerIcon: voidViewIcon,
	name: nls.localize2('chat', 'Chat'), // this says ... : CHAT
	ctorDescriptor: new SyncDescriptor(VoidSidebarViewPane),
	canToggleVisibility: false,
	canMoveView: true,
	// openCommandActionDescriptor: {
	// 	id: viewContainer.id,
	// 	keybindings: {
	// 		primary: KeyMod.CtrlCmd | KeyCode.KeyL,
	// 	},
	// 	order: 1
	// },
}], viewContainer);



// ---------- Register service that manages sidebar's state ----------

export interface IVoidSidebarStateService {
	readonly _serviceBrand: undefined;

	readonly state: VoidSidebarState; // readonly to the user
	setState(newState: Partial<VoidSidebarState>): void;
	onDidChangeState: Event<void>;

	onDidFocusChat: Event<void>;
	onDidBlurChat: Event<void>;
	fireFocusChat(): void;
	fireBlurChat(): void;

	openSidebarView(): void;
}

export const IVoidSidebarStateService = createDecorator<IVoidSidebarStateService>('voidSidebarStateService');
class VoidSidebarStateService extends Disposable implements IVoidSidebarStateService {
	_serviceBrand: undefined;

	static readonly ID = 'voidSidebarStateService';

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onFocusChat = new Emitter<void>();
	readonly onDidFocusChat: Event<void> = this._onFocusChat.event;

	private readonly _onBlurChat = new Emitter<void>();
	readonly onDidBlurChat: Event<void> = this._onBlurChat.event;


	// state
	state: VoidSidebarState

	constructor(
		@IViewsService private readonly _viewsService: IViewsService,
	) {
		super()

		// initial state
		this.state = { isHistoryOpen: false, currentTab: 'chat', }
	}


	setState(newState: Partial<VoidSidebarState>) {
		// make sure view is open if the tab changes
		if ('currentTab' in newState) {
			this.openSidebarView()
		}

		this.state = { ...this.state, ...newState }
		this._onDidChangeState.fire()
	}

	fireFocusChat() {
		this._onFocusChat.fire()
	}

	fireBlurChat() {
		this._onBlurChat.fire()
	}

	openSidebarView() {
		this._viewsService.openViewContainer(VOID_VIEW_CONTAINER_ID);
		this._viewsService.openView(VOID_VIEW_ID);
	}

}

registerSingleton(IVoidSidebarStateService, VoidSidebarStateService, InstantiationType.Eager);
