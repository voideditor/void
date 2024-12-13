/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { SettingsOfProvider } from './voidConfigTypes.js';


export type OllamaListFnParams = {
	settingsOfProvider: SettingsOfProvider;
	onSuccess: (param: { models: ModelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}


export interface IOllamaListService {
	readonly _serviceBrand: undefined;
	list(params: OllamaListFnParams): void;
}

export const IOllamaListService = createDecorator<IOllamaListService>('ollamaListService');






// These are from 'ollama' SDK
interface ModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

type ModelResponse = {
	name: string;
	modified_at: Date;
	size: number;
	digest: string;
	details: ModelDetails;
	expires_at: Date;
	size_vram: number;
}

