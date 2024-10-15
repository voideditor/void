import { Document } from "@langchain/core/documents";
import { getApiConfig, VectorStore } from "../../config";
import openSearchInstance from "./openSearch";
import { Embeddings } from "@langchain/core/embeddings";

export const INDEX_NAME = "void";

export interface VectorStoreAdapter {
	uploadDocuments: (documents: Document[]) => Promise<void>;
	deleteDocuments: (path: string) => Promise<void>;
	getStoredMtime: (path: string) => Promise<number | null>;
}

const getVectorStoreClient = (embeddingApi: Embeddings) => {
	const apiConfig = getApiConfig();

	switch (apiConfig.vectorStore) {
		case VectorStore.OPENSEARCH:
			return openSearchInstance(embeddingApi);
		default:
			return null;
	}
};

export default getVectorStoreClient;
