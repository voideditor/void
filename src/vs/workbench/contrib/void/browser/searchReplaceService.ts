/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILLMMessageService } from '../common/llmMessageService.js';



export interface ISearchReplaceService {
	readonly _serviceBrand: undefined;
}

export const ISearchReplaceService = createDecorator<ISearchReplaceService>('SearchReplaceService');
class SearchReplaceService extends Disposable implements ISearchReplaceService {
	_serviceBrand: undefined;

	static readonly ID = 'SearchReplaceService';

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	constructor(
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
	) {
		super()
		// this.llmMessageService.sendLLMMessage({})

	}

}

registerSingleton(ISearchReplaceService, SearchReplaceService, InstantiationType.Eager);
