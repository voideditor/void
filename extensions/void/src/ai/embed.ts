import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
	RecursiveCharacterTextSplitter,
	SupportedTextSplitterLanguage,
} from "@langchain/textsplitters";
import { JSONLoader } from "langchain/document_loaders/fs/json";
import { TextLoader } from "langchain/document_loaders/fs/text";
import getVectorStore from "./vectorStore";
import { ApiConfig, ApiProvider, getApiConfig } from "../config";

enum FileType {
	UNKNOWN = "unknown",
	CODE = "code",
	TEXT = "text",
	JSON = "json",
}

const detectFileType = (
	file: vscode.Uri
): { type: FileType; language?: SupportedTextSplitterLanguage } => {
	switch (path.extname(file.fsPath)) {
		case ".js":
		case ".ts":
			return { type: FileType.CODE, language: "js" };
		case ".py":
			return { type: FileType.CODE, language: "python" };
		case ".md":
			return { type: FileType.CODE, language: "markdown" };
		case ".tex":
			return { type: FileType.CODE, language: "latex" };
		case ".html":
			return { type: FileType.CODE, language: "html" };
		case ".php":
			return { type: FileType.CODE, language: "php" };
		case ".txt":
		case ".csv":
			return { type: FileType.TEXT };
		case ".json":
			return { type: FileType.JSON };
		default:
			return { type: FileType.UNKNOWN };
	}
};

const getSplitter = (
	type: FileType,
	language?: SupportedTextSplitterLanguage
) => {
	switch (type) {
		case FileType.CODE:
			return (
				language &&
				RecursiveCharacterTextSplitter.fromLanguage(language, {
					chunkSize: 300,
					chunkOverlap: 50,
					separators: ["\n\n", "\n", " ", ""],
				})
			);

		case FileType.TEXT:
			return new RecursiveCharacterTextSplitter({
				chunkSize: 1000,
				chunkOverlap: 100,
			});

		default:
			return null;
	}
};

const getLoader = (type: FileType, file: vscode.Uri) => {
	switch (type) {
		case FileType.JSON:
			return new JSONLoader(file.fsPath);

		case FileType.TEXT:
		case FileType.CODE:
			return new TextLoader(file.fsPath);

		default:
			return null;
	}
};

const getEmbeddingClient = (apiConfig: ApiConfig) => {
	switch (apiConfig.embeddingApi) {
		case ApiProvider.OPENAI:
			return new OpenAIEmbeddings({
				model: apiConfig.openAI.embedding,
				apiKey: apiConfig.openAI.apikey,
			});
		default:
			return null;
	}
};

export const embedWorkspaceFiles = async () => {
	const apiConfig = getApiConfig();
	const embeddingClient = getEmbeddingClient(apiConfig);
	const vectorStore = await getVectorStore(embeddingClient);

	// if embedding and vector store keys are configured, proceed
	if (embeddingClient && vectorStore) {
		const excludePatterns = Object.keys(
			vscode.workspace.getConfiguration("files").get("exclude") || {}
		).join(",");

		const files = await vscode.workspace.findFiles(
			"**",
			`{${excludePatterns}}`
		);

		files?.map(async (file) => {
			// check if file has been modified since last embedding
			const stat = fs.statSync(file.fsPath);
			const mtime = stat.mtime.getTime();
			const storedMtime = await vectorStore.getStoredMtime(file.fsPath);

			// either file is new or has been modified since last embedding
			if (!storedMtime || mtime > storedMtime) {
				const { type, language } = detectFileType(file);
				const textSplitter = getSplitter(type, language);
				const fileLoader = getLoader(type, file);

				// for already embedded files, delete the old embeddings so they don't show up in search results
				if (storedMtime) {
					await vectorStore.deleteDocuments(file.fsPath);
				}

				// if we handle this file type, embed it and save to vector store
				if (textSplitter && fileLoader) {
					const docs = await fileLoader.load();

					const docsWithMetadata = docs.map((doc) => ({
						...doc,
						metadata: {
							...doc.metadata,
							mtime,
						},
					}));

					const chunks = await textSplitter.splitDocuments(docsWithMetadata);

					await vectorStore.uploadDocuments(chunks);
				}
			}
		});
	}
};
