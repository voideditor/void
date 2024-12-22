import { ITreeSitterParseResult } from '../../../editor/common/services/treeSitterParserService.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { generateUuid as uuid } from '../../../base/common/uuid.js';


export const IVectorStoreService = createDecorator<IVectorStoreService>('vectorStoreService');

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

export class VectorStoreService implements IVectorStoreService {
	readonly _serviceBrand: undefined;

	constructor(
	) { }

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

