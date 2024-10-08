import * as vscode from "vscode";
import * as path from "path";
import { OpenAI } from "@langchain/openai";
import { LLMChainExtractor } from "langchain/retrievers/document_compressors/chain_extract";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { ApiConfig } from "../common/sendLLMMessage";

const detectLanguage = (file: vscode.Uri) => {
	switch (path.extname(file.fsPath)) {
		case ".js":
		case ".ts":
			return "js";
		case ".py":
			return "python";
		case ".md":
			return "markdown";
		case ".tex":
			return "latex";
		case ".html":
			return "html";
		case ".php":
			return "php";
		default:
			return null;
	}
};

export const embedWorkspaceFiles = async (apiConfig: ApiConfig) => {
	const model = new OpenAI({
		model: apiConfig.openai.embedding,
		apiKey: apiConfig.openai.apikey,
	});
	const baseCompressor = LLMChainExtractor.fromLLM(model);

	const excludePatterns = Object.keys(
		vscode.workspace.getConfiguration("files").get("exclude") || {}
	).join(",");

	const files = await vscode.workspace.findFiles("**", `{${excludePatterns}}`);

	if (files.length) {
		// FIXME
		[files[6]].map(async (file) => {
			const content = await vscode.workspace.fs.readFile(file);
			const contentString = new TextDecoder().decode(content);
			const language = detectLanguage(file);

			const textSplitter = language
				? RecursiveCharacterTextSplitter.fromLanguage(language, {
						chunkSize: 300,
						chunkOverlap: 50,
						separators: ["\n\n", "\n", " ", ""],
				})
				: new RecursiveCharacterTextSplitter({
						chunkSize: 1000,
						chunkOverlap: 100,
				});

			const docs = await textSplitter.createDocuments([contentString]);
			console.log({ docs });
		});
	}
};
