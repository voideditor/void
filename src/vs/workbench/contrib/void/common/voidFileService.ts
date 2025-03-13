/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

export interface IVoidFileService {
	readonly _serviceBrand: undefined;

	readFile(uri: URI, range?: { startLineNumber: number, endLineNumber: number }): Promise<string | null>;
	readModel(uri: URI, range?: { startLineNumber: number, endLineNumber: number }): string | null;

	saveOrWriteFileAssumingModelExists(uri: URI): Promise<void>;
}

export const IVoidFileService = createDecorator<IVoidFileService>('VoidFileService');

// implemented by calling channel
export class VoidFileService implements IVoidFileService {
	readonly _serviceBrand: undefined;

	constructor(
		@IModelService private readonly modelService: IModelService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly _editorService: IEditorService,
	) {

	}

	readFile = async (uri: URI, range?: { startLineNumber: number, endLineNumber: number }): Promise<string | null> => {

		// attempt to read the model
		const modelResult = this.readModel(uri, range);
		if (modelResult) return modelResult;

		// if no model, read the raw file
		const fileResult = await this._readFileRaw(uri, range);
		if (fileResult) return fileResult;

		return null;
	}

	_readFileRaw = async (uri: URI, range?: { startLineNumber: number, endLineNumber: number }): Promise<string | null> => {

		try { // this throws an error if no file exists (eg it was deleted)
			const res = await this.fileService.readFile(uri);
			const str = res.value.toString().replace(/\r\n/g, '\n'); // even if not on Windows, might read a file with \r\n
			if (range) return str.split('\n').slice(range.startLineNumber - 1, range.endLineNumber).join('\n')
			return str;
		} catch (e) {
			return null;
		}
	}


	readModel = (uri: URI, range?: { startLineNumber: number, endLineNumber: number }): string | null => {

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
			return model.getValueInRange({ startLineNumber: range.startLineNumber, endLineNumber: range.endLineNumber, startColumn: 1, endColumn: Number.MAX_VALUE }, EndOfLinePreference.LF);
		} else {
			return model.getValue(EndOfLinePreference.LF)
		}

	}



	saveOrWriteFileAssumingModelExists = async (uri: URI): Promise<void> => {

		const editorsOpen = [...this._editorService.findEditors(uri)]
		if (editorsOpen.length !== 0) {
			this._editorService.save(editorsOpen)
		}
		else {
			// write the file using the contents of the existing model
			const fileStr = this.modelService.getModel(uri)?.getValue()
			if (fileStr === undefined) {
				console.error('model not found for uri', uri.fsPath)
				return
			}
			const buffer = VSBuffer.fromString(fileStr)
			await this.fileService.writeFile(uri, buffer);
		}
	}

}

registerSingleton(IVoidFileService, VoidFileService, InstantiationType.Eager);
