import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { VOID_VIEW_CONTAINER_ID, VOID_VIEW_ID } from './sidebarPane.js';


// service that manages sidebar's state
export type VoidSidebarState = {
	isHistoryOpen: boolean;
	currentTab: 'chat';
}

export interface ISidebarStateService {
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

export const ISidebarStateService = createDecorator<ISidebarStateService>('voidSidebarStateService');
class VoidSidebarStateService extends Disposable implements ISidebarStateService {
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

registerSingleton(ISidebarStateService, VoidSidebarStateService, InstantiationType.Eager);
