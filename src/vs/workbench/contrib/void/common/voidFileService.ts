/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';


// linebreak symbols
export const allLinebreakSymbols = ['\r\n', '\n']
export const _ln = isWindows ? allLinebreakSymbols[0] : allLinebreakSymbols[1]

export interface IVoidFileService {
	readonly _serviceBrand: undefined;

	readFile(uri: URI, range?: { startLineNumber: number, endLineNumber: number }): Promise<string>;

}

export const IVoidFileService = createDecorator<IVoidFileService>('VoidFileService');

// implemented by calling channel
export class VoidFileService implements IVoidFileService {
	readonly _serviceBrand: undefined;

	constructor(
		@IModelService private readonly modelService: IModelService,
		@IFileService private readonly fileService: IFileService,
	) {

	}

	readFile = async (uri: URI, range?: { startLineNumber: number, endLineNumber: number }): Promise<string> => {

		// attempt to read the model
		const modelResult = await this._readModel(uri, range);
		if (modelResult) return modelResult;

		// if no model, read the raw file
		const fileResult = await this._readFileRaw(uri, range);
		if (fileResult) return fileResult;

		return '';
	}

	_readFileRaw = async (uri: URI, range?: { startLineNumber: number, endLineNumber: number }): Promise<string | null> => {

		try { // this throws an error if no file exists (eg it was deleted)

			const res = await this.fileService.readFile(uri);

			if (range) {
				return res.value.toString()
					.split(_ln)
					.slice(range.startLineNumber - 1, range.endLineNumber)
					.join(_ln)
			}

			return res.value.toString();


		} catch (e) {
			return null;
		}
	}


	_readModel = async (uri: URI, range?: { startLineNumber: number, endLineNumber: number }): Promise<string | null> => {

		// read saved model (sometimes null if the user reloads application)
		let model = this.modelService.getModel(uri);

		// check all opened models for the same `fsPath`
		if (!model) {
			const models = this.modelService.getModels();
			for (const m of models) {
				if (m.uri.fsPath === uri.fsPath) {
					model = m
					break;
				}
			}
		}

		// if still not found, return
		if (!model) { return null }

		// if range, read it
		if (range) {
			return model.getValueInRange({
				startLineNumber: range.startLineNumber,
				endLineNumber: range.endLineNumber,
				startColumn: 1,
				endColumn: Number.MAX_VALUE
			}, EndOfLinePreference.LF);
		} else {
			return model.getValue(EndOfLinePreference.LF)
		}

	}

}

registerSingleton(IVoidFileService, VoidFileService, InstantiationType.Eager);
