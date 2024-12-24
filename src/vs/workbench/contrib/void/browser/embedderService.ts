import { ITreeSitterParseResult, ITreeSitterParserService } from '../../../../editor/common/services/treeSitterParserService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { generateUuid as uuid } from '../../../../base/common/uuid.js';

export interface IVectorStoreService {
	readonly _serviceBrand: undefined;
	createEmbeddings: (tree: ITreeSitterParseResult, filename: string) => any;
	storeEmbeddings: (uri: string, embeddings: any) => void;
}

interface CodeSnippet {
	id: string;
	snippet: string;
	filename: string;
}

class VectorStoreService implements IVectorStoreService, IWorkbenchContribution {
	readonly _serviceBrand: undefined;
	static readonly ID = 'workbench.contrib.startupVectorStoreService';

	constructor(
	) {
		console.error("Sarvesh got here")
	}

	createEmbeddings(tree: ITreeSitterParseResult, filename: string) {
		// Implementation for creating embeddings from the parse tree
		let cursor = tree.tree?.walk()
		let snippets: CodeSnippet[] = [];

		while (cursor?.gotoFirstChild()) {
			if (["class_definition", "function_definition"].includes(cursor.nodeType)) {
				snippets.push({
					id: uuid(),
					snippet: cursor.nodeText,
					filename: filename,
				});
			}

			while (cursor.gotoNextSibling()) {
				if (["class_definition", "function_definition"].includes(cursor.nodeType)) {
					snippets.push({
						id: uuid(),
						snippet: cursor.nodeText,
						filename: filename,
					});
				}
			}
		}
		console.log('Embedding count: %d', snippets.length)
	}

	storeEmbeddings(uri: string, embeddings: any) {
		// Implementation for storing embeddings in ChromaDB
	}

}

export const IEmbedderService = createDecorator<IEmbedderService>('embedderService');

export interface IEmbedderService {
	readonly _serviceBrand: undefined;
	createEmbeddings: (model: ITextModel) => void;
}

export class EmbedderService implements IEmbedderService, IWorkbenchContribution {
	readonly _serviceBrand: undefined;
	static readonly ID = 'workbench.contrib.startupEmbedderService';
	static readonly vectorStoreService = new VectorStoreService();

	constructor(
		@ITreeSitterParserService private readonly treeSitterService: ITreeSitterParserService,
		@IModelService private readonly modelService: IModelService
	) {
		console.error("Sarvesh also got here")
		this.modelService.onModelAdded((model: ITextModel) => {
			this.createEmbeddings(model);
		});

		this.treeSitterService.onDidUpdateTree((e: { textModel: ITextModel; ranges: Range[] }) => {
			// TODO update Embeddings
			// this.createEmbeddings(e.textModel);
			console.error("Sarvesh also got here")

		});
	}

	createEmbeddings(model: ITextModel) {
		console.log("Embedding Service: Embedding triggered for file %s \n", model.uri)
		const tree = this.treeSitterService.getParseResult(model);
		if (tree) {
			const embeddings = EmbedderService.vectorStoreService.createEmbeddings(tree, model.uri.toString());
			EmbedderService.vectorStoreService.storeEmbeddings(model.uri.toString(), embeddings);
		} else {
			console.error("Embedding Service: Failed to get parse result for file %s \n", model.uri);
		}
	}
}


// registerSingleton(IEmbedderService, EmbedderService, InstantiationType.Eager);
registerWorkbenchContribution2(EmbedderService.ID, EmbedderService, WorkbenchPhase.AfterRestored);


