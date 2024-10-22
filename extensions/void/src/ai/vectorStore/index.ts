import { Document } from "@langchain/core/documents";
import openSearchInstance from "./openSearch";
import { Embeddings } from "@langchain/core/embeddings";
import { VoidConfig } from "../../sidebar/contextForConfig";
import { VectorStore } from "../constants";

export const INDEX_NAME = "void";

export interface VectorStoreAdapter {
	uploadDocuments: (documents: Document[]) => Promise<void>;
	deleteDocuments: (path: string) => Promise<void>;
	getStoredMtime: (path: string) => Promise<number | null>;
}

export const getVectorStoreClient = (
	voidConfig: VoidConfig,
	embeddingApi: Embeddings
) => {
	switch (voidConfig.default.vectorStore) {
		case VectorStore.OPENSEARCH:
			return openSearchInstance(voidConfig, embeddingApi);
		default:
			return null;
	}
};
