import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { QuickEdit } from './quickEditActions.js';



// service that manages state
export type VoidQuickEditState = {
	quickEditsOfDocument: { [uri: string]: QuickEdit }
}

export interface IQuickEditStateService {
	readonly _serviceBrand: undefined;

	readonly state: VoidQuickEditState; // readonly to the user
	setState(newState: Partial<VoidQuickEditState>): void;
	onDidChangeState: Event<void>;

	onDidFocusChat: Event<void>;
	onDidBlurChat: Event<void>;
	fireFocusChat(): void;
	fireBlurChat(): void;

}

export const IQuickEditStateService = createDecorator<IQuickEditStateService>('voidQuickEditStateService');
class VoidQuickEditStateService extends Disposable implements IQuickEditStateService {
	_serviceBrand: undefined;

	static readonly ID = 'voidQuickEditStateService';

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onFocusChat = new Emitter<void>();
	readonly onDidFocusChat: Event<void> = this._onFocusChat.event;

	private readonly _onBlurChat = new Emitter<void>();
	readonly onDidBlurChat: Event<void> = this._onBlurChat.event;


	// state
	state: VoidQuickEditState

	constructor(
		// @IViewsService private readonly _viewsService: IViewsService,
	) {
		super()

		// initial state
		this.state = { quickEditsOfDocument: {} }
	}


	setState(newState: Partial<VoidQuickEditState>) {
		// make sure view is open if the tab changes
		// if ('currentTab' in newState) {
		// 	this.addQuickEdit()
		// }

		this.state = { ...this.state, ...newState }
		this._onDidChangeState.fire()
	}

	fireFocusChat() {
		this._onFocusChat.fire()
	}

	fireBlurChat() {
		this._onBlurChat.fire()
	}

	// addQuickEdit() {
	// 	this._viewsService.openViewContainer(VOID_VIEW_CONTAINER_ID);
	// 	this._viewsService.openView(VOID_VIEW_ID);
	// }

}

registerSingleton(IQuickEditStateService, VoidQuickEditStateService, InstantiationType.Eager);
