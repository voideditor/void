import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions, IViewContainersRegistry,
	ViewContainerLocation, IViewsRegistry, Extensions as ViewExtensions,
	IViewDescriptorService,
} from '../../../common/views.js';

import * as nls from '../../../../nls.js';
import * as dom from '../../../../base/browser/dom.js';

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';

import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';


import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IThreadHistoryService } from './registerThreadsHistory.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
// import { IVoidConfigService } from './registerSettings.js';
// import { IEditorService } from '../../../services/editor/common/editorService.js';

import mountFn from './react/out/sidebar-tsx/Sidebar.js';
import './react/out/styles.css';

import { IVoidConfigStateService } from './registerConfig.js';
// import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';

// const mountFn = (...params: any) => { }


// compare against search.contribution.ts and https://app.greptile.com/chat/w1nsmt3lauwzculipycpn?repo=github%3Amain%3Amicrosoft%2Fvscode
// and debug.contribution.ts, scm.contribution.ts (source control)

export type VoidSidebarState = {
	isHistoryOpen: boolean;
	currentTab: 'chat' | 'settings';
}

export type ReactServicesType = {
	sidebarStateService: IVoidSidebarStateService;
	configStateService: IVoidConfigStateService;
	threadHistoryService: IThreadHistoryService;
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
		// Void:
		// @IVoidSidebarStateService private readonly _voidSidebarStateService: IVoidSidebarStateService,
		// @IThreadHistoryService private readonly _threadHistoryService: IThreadHistoryService,
		// TODO chat service
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService)

	}



	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);

		// <div className={`flex flex-col h-screen w-full`}>

		const { root } = dom.h('div@root')
		dom.append(parent, root);

		// gets set immediately
		this.instantiationService.invokeFunction(accessor => {
			mountFn(root, {
				configStateService: accessor.get(IVoidConfigStateService),
				sidebarStateService: accessor.get(IVoidSidebarStateService),
				threadHistoryService: accessor.get(IThreadHistoryService),
			});
		});
	}



	// private _renderChat(element: HTMLElement) {

	// 	// useEffect(() => {
	// 	// 	this._voidSidebarStateService.onDidChange(() => {
	// 	// 	})
	// 	// 	this._voidSidebarStateService.onFocusChat(() => {
	// 	// 	})
	// 	// 	this._voidSidebarStateService.onBlurChat(() => {
	// 	// 	})
	// 	// })


	// }


	// private _renderHistory(element: HTMLElement) {
	// 	// 	<div className={`mb-2 h-[30vh] ${tab !== 'threadSelector' ? 'hidden' : ''}`}>
	// 	// 	<SidebarThreadSelector onClose={() => setTab('chat')} />
	// 	// </div>


	// 	this._voidSidebarStateService.onDidChange(() => {
	// 	})

	// 	this._threadHistoryService.onDidChangeCurrentThread(() => {

	// 	})

	// }

	// private _renderSettings(element: HTMLElement) {
	// 	// <div className={`${tab !== 'settings' ? 'hidden' : ''}`}>
	// 	// 	<SidebarSettings />
	// 	// </div>

	// }


}



// ---------- Register viewpane inside the void container ----------

const voidThemeIcon = Codicon.array;
const voidViewIcon = registerIcon('void-view-icon', voidThemeIcon, localize('voidViewIcon', 'View icon of the Void chat view.'));

// called VIEWLET_ID in other places for some reason
const VOID_VIEW_CONTAINER_ID = 'workbench.view.void'
const SIDEBAR_VIEW_ID = VOID_VIEW_CONTAINER_ID // not sure if we can change this

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
	id: SIDEBAR_VIEW_ID,
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

	state: VoidSidebarState;
	setState(newState: Partial<VoidSidebarState>): void;
	onDidChangeState: Event<void>;

	onDidFocusChat: Event<void>;
	onDidBlurChat: Event<void>;
	fireFocusChat(): void;
	fireBlurChat(): void;
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
		if ('currentTab' in newState)
			this._viewsService.openView(SIDEBAR_VIEW_ID);

		this.state = { ...this.state, ...newState }
		this._onDidChangeState.fire()
	}

	fireFocusChat() {
		this._onFocusChat.fire()
	}

	fireBlurChat() {
		this._onBlurChat.fire()
	}

	constructor(
		@IViewsService private readonly _viewsService: IViewsService,
	) {
		super()
		// auto open the view on mount (if it bothers you this is here, this is technically just initializing the state of the view)
		this._viewsService.openView(SIDEBAR_VIEW_ID);

		// initial state
		this.state = {
			isHistoryOpen: false,
			currentTab: 'chat',
		}

	}

}

registerSingleton(IVoidSidebarStateService, VoidSidebarStateService, InstantiationType.Eager);



// ---------- Register commands and keybindings ----------

// Action: when press ctrl+L, show the sidebar chat and add to the selection
registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'void.ctrl+l', title: 'Show Sidebar', keybinding: { primary: KeyMod.CtrlCmd | KeyCode.KeyL, weight: KeybindingWeight.WorkbenchContrib } });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(IVoidSidebarStateService)
		stateService.setState({ isHistoryOpen: false, currentTab: 'chat' })
		stateService.fireFocusChat()

		// const selection = accessor.get(IEditorService).activeTextEditorControl?.getSelection()


		// chat state:
		// // if user pressed ctrl+l, add their selection to the sidebar
		// useOnVSCodeMessage('ctrl+l', (m) => {
		// 	setSelection(m.selection)
		// 	const filepath = m.selection.filePath

		// 	// add current file to the context if it's not already in the files array
		// 	if (!files.find(f => f.fsPath === filepath.fsPath))
		// 		setFiles(files => [...files, filepath])
		// })


	}
});


// New chat menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.newChatAction',
			title: 'View past chats',
			icon: { id: 'add' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SIDEBAR_VIEW_ID), }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(IVoidSidebarStateService)
		stateService.setState({ isHistoryOpen: false, currentTab: 'chat' })
		stateService.fireFocusChat()

		const historyService = accessor.get(IThreadHistoryService)
		historyService.startNewThread()
	}
})

// History menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.historyAction',
			title: 'View past chats',
			icon: { id: 'history' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SIDEBAR_VIEW_ID), }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(IVoidSidebarStateService)
		stateService.setState({ isHistoryOpen: !stateService.state.isHistoryOpen })
		stateService.fireBlurChat()
	}
})

// Settings (API config) menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.viewSettings',
			title: 'Void settings',
			icon: { id: 'settings-gear' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', SIDEBAR_VIEW_ID), }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(IVoidSidebarStateService)
		stateService.setState({ isHistoryOpen: false, currentTab: 'settings' })
		stateService.fireBlurChat()
	}
})
