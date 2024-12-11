/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions,
	IViewDescriptorService,
} from '../../../common/views.js';

import * as nls from '../../../../nls.js';

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';


import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';

import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IThreadHistoryService } from './registerThreads.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
// import { IVoidConfigService } from './registerSettings.js';
// import { IEditorService } from '../../../services/editor/common/editorService.js';

import mountFn from './react/out/sidebar-tsx/Sidebar.js';

import { IVoidConfigStateService } from '../../../../platform/void/common/voidConfigService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInlineDiffsService } from './registerInlineDiffs.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ISendLLMMessageService } from '../../../../platform/void/browser/llmMessageService.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';


// import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';


// compare against search.contribution.ts and debug.contribution.ts, scm.contribution.ts (source control)

export type VoidSidebarState = {
	isHistoryOpen: boolean;
	currentTab: 'chat' | 'settings';
}

export type ReactServicesType = {
	sidebarStateService: IVoidSidebarStateService;
	configStateService: IVoidConfigStateService;
	threadsStateService: IThreadHistoryService;
	fileService: IFileService;
	modelService: IModelService;
	inlineDiffService: IInlineDiffsService;
	sendLLMMessageService: ISendLLMMessageService;
	clipboardService: IClipboardService;

	themeService: IThemeService,
	hoverService: IHoverService,

	contextViewService: IContextViewService;
	contextMenuService: IContextMenuService;
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
			const services: ReactServicesType = {
				configStateService: accessor.get(IVoidConfigStateService),
				sidebarStateService: accessor.get(IVoidSidebarStateService),
				threadsStateService: accessor.get(IThreadHistoryService),
				fileService: accessor.get(IFileService),
				modelService: accessor.get(IModelService),
				inlineDiffService: accessor.get(IInlineDiffsService),
				sendLLMMessageService: accessor.get(ISendLLMMessageService),
				clipboardService: accessor.get(IClipboardService),
				themeService: accessor.get(IThemeService),
				hoverService: accessor.get(IHoverService),
				contextViewService: accessor.get(IContextViewService),
				contextMenuService: accessor.get(IContextMenuService),
			}
			mountFn(parent, services);
		});
	}

}



// ---------- Register viewpane inside the void container ----------

const voidThemeIcon = Codicon.symbolObject;
const voidViewIcon = registerIcon('void-view-icon', voidThemeIcon, localize('voidViewIcon', 'View icon of the Void chat view.'));

// called VIEWLET_ID in other places for some reason
export const VOID_VIEW_CONTAINER_ID = 'workbench.view.void'
export const VOID_VIEW_ID = VOID_VIEW_CONTAINER_ID // not sure if we can change this

// Register view container
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewContainer = viewContainerRegistry.registerViewContainer({
	id: VOID_VIEW_CONTAINER_ID,
	title: nls.localize2('void', 'Void'), // this is used to say "Void" (Ctrl + L)
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VOID_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	hideIfEmpty: false,
	icon: voidViewIcon,
	order: 1,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true, });



// Register search default location to the container (sidebar)
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([{
	id: VOID_VIEW_ID,
	hideByDefault: false, // start open
	containerIcon: voidViewIcon,
	name: nls.localize2('void chat', "Chat"), // this says ... : CHAT
	ctorDescriptor: new SyncDescriptor(VoidSidebarViewPane),
	canToggleVisibility: false,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: viewContainer.id,
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyCode.KeyL,
		},
		order: 1
	},
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

	openView(): void;
}


export const IVoidSidebarStateService = createDecorator<IVoidSidebarStateService>('voidSidebarStateService');
class VoidSidebarStateService extends Disposable implements IVoidSidebarStateService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onFocusChat = new Emitter<void>();
	readonly onDidFocusChat: Event<void> = this._onFocusChat.event;

	private readonly _onBlurChat = new Emitter<void>();
	readonly onDidBlurChat: Event<void> = this._onBlurChat.event;


	// state
	state: VoidSidebarState


	setState(newState: Partial<VoidSidebarState>) {
		// make sure view is open if the tab changes
		if ('currentTab' in newState) {
			this.openView()
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

	openView() {
		this._viewsService.openViewContainer(VOID_VIEW_CONTAINER_ID);
		this._viewsService.openView(VOID_VIEW_ID);
	}

	constructor(
		@IViewsService private readonly _viewsService: IViewsService,
		// @IThreadHistoryService private readonly _threadHistoryService: IThreadHistoryService,
	) {
		super()
		// auto open the view on mount (if it bothers you this is here, this is technically just initializing the state of the view)
		this.openView()

		// initial state
		this.state = {
			isHistoryOpen: false,
			currentTab: 'chat',
		}

	}

}

registerSingleton(IVoidSidebarStateService, VoidSidebarStateService, InstantiationType.Eager);
