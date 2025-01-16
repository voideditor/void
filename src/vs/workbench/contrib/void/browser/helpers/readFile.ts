import { URI } from '../../../../../base/common/uri'
import { EndOfLinePreference } from '../../../../../editor/common/model'
import { IModelService } from '../../../../../editor/common/services/model.js'

// read files from VSCode
export const VSReadFile = async (modelService: IModelService, uri: URI): Promise<string | null> => {
	const model = modelService.getModel(uri)
	if (!model) return null
	return model.getValue(EndOfLinePreference.LF)
}
