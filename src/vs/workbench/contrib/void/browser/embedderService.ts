import { ITreeSitterParseResult, ITreeSitterParserService } from '../../../../editor/common/services/treeSitterParserService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { generateUuid as uuid } from '../../../../base/common/uuid.js';
import { TreeSitterTextModelService } from '../../../../editor/browser/services/treeSitter/treeSitterParserService.js';

/*
Instructions to run Tree-Sitter
Using Tree-Sitter can be enabled with:

  "editor.experimental.preferTreeSitter": [
	"typescript"
  ],

There are still bugs.
*/

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
			if (["if_statement", "for_statement", "while_statement", "method_definition", "class_declaration", "class_definition", "function_definition"].includes(cursor.nodeType)) {
				snippets.push({
					id: uuid(),
					snippet: cursor.nodeText,
					filename: filename,
				});
			}

			while (cursor.gotoNextSibling()) {
				if (["class_declaration", "class_definition", "function_definition"].includes(cursor.nodeType)) {
					snippets.push({
						id: uuid(),
						snippet: cursor.nodeText,
						filename: filename,
					});
				}
			}
		}
		console.log('Embedding count: %d', snippets.length)

		return snippets;
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
		@ITreeSitterParserService private readonly treeSitterService: TreeSitterTextModelService,
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

	async createEmbeddings(model: ITextModel) {
		console.log("Embedding Service: Attempting to embed file %s", model.uri.toString());

		// Check if language is supported
		const language = model.getLanguageId();
		if (!language) {
			console.log("Embedding Service: No language detected for file %s", model.uri.toString());
			return;
		}
		console.log("Embedding Service: Language", language, "detected for file ", model.uri.toString());

		// Try to get parser
		try {
			// Ensure the parser is initialized before proceeding
			await this.treeSitterService.getOrInitLanguage(language);
			let tree = this.treeSitterService.getParseResult(model);
			while (!tree || !tree.tree) {
				console.log("Embedding Service: No parse tree available yet for %s", model.uri.toString());
				await new Promise(resolve => setTimeout(resolve, 1000));
				tree = this.treeSitterService.getParseResult(model);
			}
			console.log("Embedding Service: Successfully parsed file %s", model.uri.toString());
			const embeddings = EmbedderService.vectorStoreService.createEmbeddings(tree, model.uri.toString());
			EmbedderService.vectorStoreService.storeEmbeddings(model.uri.toString(), embeddings);
		} catch (e) {
			console.error("Embedding Service: Error parsing file %s: %s", model.uri.toString(), e);
		}
	}
}

// registerSingleton(IEmbedderService, EmbedderService, InstantiationType.Eager);
registerWorkbenchContribution2(EmbedderService.ID, EmbedderService, WorkbenchPhase.AfterRestored);


