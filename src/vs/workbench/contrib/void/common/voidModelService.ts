/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextFileEditorModel, ITextFileService } from '../../../services/textfile/common/textfiles.js';


type VoidModelType = { model: ITextModel | null, editorModel: ITextFileEditorModel | null }
export interface IVoidModelService {
	readonly _serviceBrand: undefined;

	initializeModel(uri: URI): Promise<void>
	getModel(uri: URI): VoidModelType
	getModelSafe(uri: URI): Promise<VoidModelType>
}

export const IVoidModelService = createDecorator<IVoidModelService>('voidVoidModelService');
class VoidModelService extends Disposable implements IVoidModelService {
	_serviceBrand: undefined;

	static readonly ID = 'voidVoidModelService';

	private readonly _modelRefOfURI: Record<string, ITextFileEditorModel> = {}

	constructor(
		@ITextFileService private readonly _textFileService: ITextFileService,
	) {
		super()
	}

	initializeModel = async (uri: URI) => {
		if (uri.fsPath in this._modelRefOfURI) return
		if (uri.scheme !== 'file') return
		const model = await this._textFileService.files.resolve(uri)

		this._modelRefOfURI[uri.fsPath] = model
	}
	getModel = (uri: URI) => {
		const editorModel = this._modelRefOfURI[uri.fsPath]
		if (!editorModel) return { model: null, editorModel: null }
		const model = editorModel.textEditorModel
		if (!model)
			return { model: null, editorModel }
		return { model, editorModel }
	}

	getModelSafe = async (uri: URI) => {
		if (!(uri.fsPath in this._modelRefOfURI)) await this.initializeModel(uri)
		return this.getModel(uri)
	}

	override dispose() {
		super.dispose()
		for (const [_, reference] of Object.entries(this._modelRefOfURI)) {
			reference?.dispose()
		}
	}

}

registerSingleton(IVoidModelService, VoidModelService, InstantiationType.Eager);

