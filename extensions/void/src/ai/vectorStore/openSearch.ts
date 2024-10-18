import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { Document } from "@langchain/core/documents";
import { OpenSearchVectorStore } from "@langchain/community/vectorstores/opensearch";
import { Embeddings, EmbeddingsInterface } from "@langchain/core/embeddings";
import { INDEX_NAME, VectorStoreAdapter } from ".";
import { VoidConfig } from "../../sidebar/contextForConfig";

const uploadDocuments = async (
	client: OpenSearchClient,
	embeddingApi: EmbeddingsInterface,
	documents: Document[]
) => {
	await OpenSearchVectorStore.fromDocuments(documents, embeddingApi, {
		client,
		indexName: INDEX_NAME,
	});
};

const deleteDocuments = async (client: OpenSearchClient, path: string) => {
	const hasIndexResponse = await client.indices.exists({ index: INDEX_NAME });

	if (hasIndexResponse.body) {
		await client.deleteByQuery({
			index: INDEX_NAME,
			body: {
				query: {
					match: {
						source: path,
					},
				},
			},
		});
	}
};

const getStoredMtime = async (
	client: OpenSearchClient,
	embeddingApi: EmbeddingsInterface,
	path: string
) => {
	const hasIndexResponse = await client.indices.exists({ index: INDEX_NAME });

	if (hasIndexResponse.body) {
		const vectorStore = await OpenSearchVectorStore.fromExistingIndex(
			embeddingApi,
			{ client, indexName: INDEX_NAME }
		);

		const results = await vectorStore.similaritySearch("", 1, {
			source: path,
		});

		return results?.[0]?.metadata?.mtime;
	} else {
		return null;
	}
};

export default (
	voidConfig: VoidConfig,
	embeddingApi: Embeddings
): VectorStoreAdapter => {
	const client = new OpenSearchClient({
		nodes: [voidConfig.openSearch.endpoint],
	});

	return {
		uploadDocuments: (documents: Document[]) =>
			uploadDocuments(client, embeddingApi, documents),
		deleteDocuments: (path: string) => deleteDocuments(client, path),
		getStoredMtime: (path: string) =>
			getStoredMtime(client, embeddingApi, path),
	};
};
