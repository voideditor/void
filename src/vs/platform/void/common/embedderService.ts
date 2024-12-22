import { ITreeSitterParserService } from '../../../editor/common/services/treeSitterParserService.js';
import { IVectorStoreService } from './vectorStoreService.js';
import { IModelService } from '../../../editor/common/services/model.js';
import { ITextModel } from '../../../editor/common/model.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Range } from '../../../editor/common/core/range.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';


export const IEmbedderService = createDecorator<IEmbedderService>('embedderService');

export interface IEmbedderService {
	readonly _serviceBrand: undefined;
	createEmbeddings: (model: ITextModel) => void;
}

export class EmbedderService implements IEmbedderService {
	readonly _serviceBrand: undefined;

	constructor(
		@ITreeSitterParserService private readonly treeSitterService: ITreeSitterParserService,
		@IVectorStoreService private readonly vectorStoreService: IVectorStoreService,
		@IModelService private readonly modelService: IModelService
	) {
		this.modelService.onModelAdded((model: ITextModel) => {
			this.createEmbeddings(model);
		});

		this.treeSitterService.onDidUpdateTree((e: { textModel: ITextModel; ranges: Range[] }) => {
			// TODO update Embeddings
			// this.createEmbeddings(e.textModel);

		});
	}

	createEmbeddings(model: ITextModel) {
		console.log("Embedding Service: Embedding triggered for file %s \n", model.id)
		const tree = this.treeSitterService.getParseResult(model);
		if (tree) {
			const embeddings = this.vectorStoreService.createEmbeddings(tree, model.uri.toString());
			this.vectorStoreService.storeEmbeddings(model.uri.toString(), embeddings);
		} else {
			console.error("Embedding Service: Failed to get parse result for file %s \n", model.id);
		}
	}
}

registerSingleton(IEmbedderService, EmbedderService, InstantiationType.Eager);

