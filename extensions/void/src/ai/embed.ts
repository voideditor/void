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
import { Embeddings } from "@langchain/core/embeddings";
import { getVectorStoreClient } from "./vectorStore/index";
import { VoidConfig } from "../sidebar/contextForConfig";
import { ApiProvider } from "./constants";

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
		case ".jsx":
		case ".tsx":
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

const getEmbeddingClient = (voidConfig: VoidConfig): Embeddings | null => {
	switch (voidConfig.default.whichApi) {
		case ApiProvider.OPENAI:
			return new OpenAIEmbeddings({
				model: voidConfig.openAI.embedding,
				apiKey: voidConfig.openAI.apikey,
			});
		default:
			return null;
	}
};

export const embedWorkspaceFiles = async (voidConfig: VoidConfig) => {
	const embeddingClient = getEmbeddingClient(voidConfig);
	const vectorStore =
		embeddingClient && getVectorStoreClient(voidConfig, embeddingClient);

	// if embedding and vector store keys are configured, proceed
	if (embeddingClient && vectorStore) {
		const excludePatterns = Object.keys(
			vscode.workspace.getConfiguration("files").get("exclude") || {}
		).join(",");

		const files = await vscode.workspace.findFiles(
			"**",
			`{${excludePatterns}}`
		);

		files?.forEach(async (file) => {
			console.debug(`Embedding file: ${file.fsPath}`);

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
					console.debug(`File ${file.fsPath} modified since last embedding`);
					await vectorStore.deleteDocuments(file.fsPath);
				} else {
					console.debug(`File ${file.fsPath} is new`);
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

					console.debug(`File ${file.fsPath} embedded`);
				} else {
					console.debug(`File ${file.fsPath} is of an unsupported type`);
				}
			} else {
				console.debug(`File ${file.fsPath} is up to date, skipping embedding`);
			}
		});
	} else {
		console.error("Embedding client or vector store client not configured", {
			embeddingClient,
			vectorStore,
		});
	}
};
