/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IOllamaListService } from '../common/ollamaListService.js';

// BROWSER IMPLEMENTATION, calls channel

export class OllamaListService implements IOllamaListService {

	readonly _serviceBrand: undefined;
	private readonly ollamaListService: IOllamaListService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService // (only usable on client side)
	) {
		this.ollamaListService = ProxyChannel.toService<IOllamaListService>(mainProcessService.getChannel('void-channel-ollama-list'));
	}

	list: IOllamaListService['list'] = (...params) => {
		this.ollamaListService.list(...params);
	}
}

registerSingleton(IOllamaListService, OllamaListService, InstantiationType.Eager);

