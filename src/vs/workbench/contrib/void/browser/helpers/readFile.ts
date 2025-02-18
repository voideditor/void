import { URI } from '../../../../../base/common/uri'
import { EndOfLinePreference } from '../../../../../editor/common/model'
import { IModelService } from '../../../../../editor/common/services/model.js'
import { IFileService } from '../../../../../platform/files/common/files'


// attempts to read URI of currently opened model, then of raw file
export const VSReadFile = async (modelService: IModelService, fileService: IFileService, uri: URI) => {

	const modelResult = await _VSReadModel(modelService, uri)
	if (modelResult) return modelResult

	const fileResult = await _VSReadFileRaw(fileService, uri)
	if (fileResult) return fileResult

	return ''

}

// read files from VSCode. preferred (but appears to only work if the model of this URI already exists. If it doesn't use the other function.)
export const _VSReadModel = async (modelService: IModelService, uri: URI): Promise<string | null> => {

	// attempt to read saved model (doesn't work if application was reloaded...)
	const model = modelService.getModel(uri)
	if (model) {
		return model.getValue(EndOfLinePreference.LF)
	}

	// look at all opened models and check if they have the same `fsPath`
	const models = modelService.getModels();
	for (const model of models) {
		if (model.uri.fsPath.toString() === uri.fsPath.toString()) {
			return model.getValue(EndOfLinePreference.LF);
		}
	}

	return null
}

export const _VSReadFileRaw = async (fileService: IFileService, uri: URI) => {
	try {
		const res = await fileService.readFile(uri)
		const str = res.value.toString()
		return str
	} catch (e) {
		return ''
	}

}
