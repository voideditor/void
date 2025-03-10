import { URI } from '../../../../../base/common/uri'
import { EndOfLinePreference } from '../../../../../editor/common/model'
import { IModelService } from '../../../../../editor/common/services/model.js'
import { IFileService } from '../../../../../platform/files/common/files'

// read files from VSCode. preferred (but appears to only work if the model of this URI already exists. If it doesn't use the other function.)
export const VSReadFile = async (modelService: IModelService, uri: URI): Promise<string | null> => {
	const model = modelService.getModel(uri)
	if (!model) return null
	return model.getValue(EndOfLinePreference.LF)
}

export const VSReadFileRaw = async (fileService: IFileService, uri: URI) => {
	const res = await fileService.readFile(uri)
	const str = res.value.toString()
	return str
}
