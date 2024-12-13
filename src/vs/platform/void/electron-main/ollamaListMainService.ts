/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';

import { IOllamaListService } from '../common/ollamaListService.js';
import { getDefaultOllamaModels } from './llmMessage/ollama.js';


export class OllamaListMainService extends Disposable implements IOllamaListService {
	_serviceBrand: undefined;

	constructor() {
		super()
	}

	list: IOllamaListService['list'] = (...params) => {
		return getDefaultOllamaModels(...params)
	}
}


