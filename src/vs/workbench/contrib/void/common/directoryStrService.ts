/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ShallowDirectoryItem, ToolCallParams, ToolResultType } from './toolsServiceTypes.js';
import { MAX_CHILDREN_URIs_PAGE, MAX_DIRSTR_CHARS_TOTAL_BEGINNING, MAX_DIRSTR_CHARS_TOTAL_TOOL } from './prompt/prompts.js';


const MAX_FILES_TOTAL = 1000;


const START_MAX_DEPTH = Infinity;
const START_MAX_ITEMS_PER_DIR = Infinity; // Add start value as Infinity

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ITEMS_PER_DIR = 3;

export interface IDirectoryStrService {
	readonly _serviceBrand: undefined;

	getDirectoryStrTool(uri: URI): Promise<string>
	getAllDirectoriesStr(opts: { cutOffMessage: string }): Promise<string>

	getAllURIsInDirectory(uri: URI, opts: { maxResults: number }): Promise<URI[]>

}
export const IDirectoryStrService = createDecorator<IDirectoryStrService>('voidDirectoryStrService');




// Check if it's a known filtered type like .git
const shouldExcludeDirectory = (name: string) => {
	if (name === '.git' ||
		name === 'node_modules' ||
		name.startsWith('.') ||
		name === 'dist' ||
		name === 'build' ||
		name === 'out' ||
		name === 'bin' ||
		name === 'coverage' ||
		name === '__pycache__' ||
		name === 'env' ||
		name === 'venv' ||
		name === 'tmp' ||
		name === 'temp' ||
		name === 'artifacts' ||
		name === 'target' ||
		name === 'obj' ||
		name === 'vendor' ||
		name === 'logs' ||
		name === 'cache' ||
		name === 'resource' ||
		name === 'resources'

	) {
		return true;
	}

	if (name.match(/\bout\b/)) return true
	if (name.match(/\bbuild\b/)) return true

	return false;
}

// ---------- ONE LAYER DEEP ----------

export const computeDirectoryTree1Deep = async (
	fileService: IFileService,
	rootURI: URI,
	pageNumber: number = 1,
): Promise<ToolResultType['ls_dir']> => {
	const stat = await fileService.resolve(rootURI, { resolveMetadata: false });
	if (!stat.isDirectory) {
		return { children: null, hasNextPage: false, hasPrevPage: false, itemsRemaining: 0 };
	}

	const nChildren = stat.children?.length ?? 0;

	const fromChildIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1);
	const toChildIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1; // INCLUSIVE
	const listChildren = stat.children?.slice(fromChildIdx, toChildIdx + 1);

	const children: ShallowDirectoryItem[] = listChildren?.map(child => ({
		name: child.name,
		uri: child.resource,
		isDirectory: child.isDirectory,
		isSymbolicLink: child.isSymbolicLink
	})) ?? [];

	const hasNextPage = (nChildren - 1) > toChildIdx;
	const hasPrevPage = pageNumber > 1;
	const itemsRemaining = Math.max(0, nChildren - (toChildIdx + 1));

	return {
		children,
		hasNextPage,
		hasPrevPage,
		itemsRemaining
	};
};

export const stringifyDirectoryTree1Deep = (params: ToolCallParams['ls_dir'], result: ToolResultType['ls_dir']): string => {
	if (!result.children) {
		return `Error: ${params.uri} is not a directory`;
	}

	let output = '';
	const entries = result.children;

	if (!result.hasPrevPage) { // is first page
		output += `${params.uri.fsPath}\n`;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const isLast = i === entries.length - 1 && !result.hasNextPage;
		const prefix = isLast ? '└── ' : '├── ';

		output += `${prefix}${entry.name}${entry.isDirectory ? '/' : ''}${entry.isSymbolicLink ? ' (symbolic link)' : ''}\n`;
	}

	if (result.hasNextPage) {
		output += `└── (${result.itemsRemaining} results remaining...)\n`;
	}

	return output;
};


// ---------- IN GENERAL ----------

const resolveChildren = async (children: undefined | IFileStat[], fileService: IFileService): Promise<IFileStat[]> => {
	const res = await fileService.resolveAll(children ?? [])
	const stats = res.map(s => s.success ? s.stat : null).filter(s => !!s)
	return stats
}

// Remove the old computeDirectoryTree function and replace with a combined version that handles both computation and rendering
const computeAndStringifyDirectoryTree = async (
	eItem: IFileStat,
	fileService: IFileService,
	MAX_CHARS: number,
	fileCount: { count: number } = { count: 0 },
	options: { maxDepth?: number, currentDepth?: number, maxItemsPerDir?: number } = {}
): Promise<{ content: string, wasCutOff: boolean }> => {
	// Set default values for options
	const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
	const currentDepth = options.currentDepth ?? 0;
	const maxItemsPerDir = options.maxItemsPerDir ?? DEFAULT_MAX_ITEMS_PER_DIR;

	// Check if we've reached the max depth
	if (currentDepth > maxDepth) {
		return { content: '', wasCutOff: true };
	}

	// Check if we've reached the file limit
	if (fileCount.count >= MAX_FILES_TOTAL) {
		return { content: '', wasCutOff: true };
	}

	// If we're already exceeding the max characters, return immediately
	if (MAX_CHARS <= 0) {
		return { content: '', wasCutOff: true };
	}

	// Increment file count
	fileCount.count++;

	// Add the root node first (without tree characters)
	const nodeLine = `${eItem.name}${eItem.isDirectory ? '/' : ''}${eItem.isSymbolicLink ? ' (symbolic link)' : ''}\n`;

	if (nodeLine.length > MAX_CHARS) {
		return { content: '', wasCutOff: true };
	}

	let content = nodeLine;
	let wasCutOff = false;
	let remainingChars = MAX_CHARS - nodeLine.length;

	// Check if it's a directory we should skip
	const isGitIgnoredDirectory = eItem.isDirectory && shouldExcludeDirectory(eItem.name);


	// Fetch and process children if not a filtered directory
	if (eItem.isDirectory && !isGitIgnoredDirectory) {
		// Fetch children with Modified sort order to show recently modified first
		const eChildren = await resolveChildren(eItem.children, fileService)

		// Then recursively add all children with proper tree formatting
		if (eChildren && eChildren.length > 0) {
			const { childrenContent, childrenCutOff } = await renderChildrenCombined(
				eChildren,
				remainingChars,
				'',
				fileService,
				fileCount,
				{ maxDepth, currentDepth, maxItemsPerDir } // Pass maxItemsPerDir to the render function
			);
			content += childrenContent;
			wasCutOff = childrenCutOff;
		}
	}

	return { content, wasCutOff };
};

// Helper function to render children with proper tree formatting
const renderChildrenCombined = async (
	children: IFileStat[],
	maxChars: number,
	parentPrefix: string,
	fileService: IFileService,
	fileCount: { count: number },
	options: { maxDepth: number, currentDepth: number, maxItemsPerDir?: number }
): Promise<{ childrenContent: string, childrenCutOff: boolean }> => {
	const { maxDepth, currentDepth } = options; // Remove maxItemsPerDir from destructuring
	// Get maxItemsPerDir separately and make sure we use it
	// For first level (currentDepth = 0), always use Infinity regardless of what was passed
	const maxItemsPerDir = currentDepth === 0 ?
		Infinity :
		(options.maxItemsPerDir ?? DEFAULT_MAX_ITEMS_PER_DIR);
	const nextDepth = currentDepth + 1;

	let childrenContent = '';
	let childrenCutOff = false;
	let remainingChars = maxChars;

	// Check if we've reached max depth
	if (nextDepth > maxDepth) {
		return { childrenContent: '', childrenCutOff: true };
	}

	// Apply maxItemsPerDir limit - only process the specified number of items
	const itemsToProcess = maxItemsPerDir === Infinity ? children : children.slice(0, maxItemsPerDir);
	const hasMoreItems = children.length > itemsToProcess.length;

	for (let i = 0; i < itemsToProcess.length; i++) {
		// Check if we've reached the file limit
		if (fileCount.count >= MAX_FILES_TOTAL) {
			childrenCutOff = true;
			break;
		}

		const child = itemsToProcess[i];
		const isLast = (i === itemsToProcess.length - 1) && !hasMoreItems;

		// Create the tree branch symbols
		const branchSymbol = isLast ? '└── ' : '├── ';
		const childLine = `${parentPrefix}${branchSymbol}${child.name}${child.isDirectory ? '/' : ''}${child.isSymbolicLink ? ' (symbolic link)' : ''}\n`;

		// Check if adding this line would exceed the limit
		if (childLine.length > remainingChars) {
			childrenCutOff = true;
			break;
		}

		childrenContent += childLine;
		remainingChars -= childLine.length;
		fileCount.count++;

		const nextLevelPrefix = parentPrefix + (isLast ? '    ' : '│   ');

		// Skip processing children for git ignored directories
		const isGitIgnoredDirectory = child.isDirectory && shouldExcludeDirectory(child.name);

		// Create the prefix for the next level (continuation line or space)
		if (child.isDirectory && !isGitIgnoredDirectory) {
			// Fetch children with Modified sort order to show recently modified first
			const eChildren = await resolveChildren(child.children, fileService)

			if (eChildren && eChildren.length > 0) {
				const {
					childrenContent: grandChildrenContent,
					childrenCutOff: grandChildrenCutOff
				} = await renderChildrenCombined(
					eChildren,
					remainingChars,
					nextLevelPrefix,
					fileService,
					fileCount,
					{ maxDepth, currentDepth: nextDepth, maxItemsPerDir }
				);

				if (grandChildrenContent.length > 0) {
					childrenContent += grandChildrenContent;
					remainingChars -= grandChildrenContent.length;
				}

				if (grandChildrenCutOff) {
					childrenCutOff = true;
				}
			}
		}
	}

	// Add a message if we truncated the items due to maxItemsPerDir
	if (hasMoreItems) {
		const remainingCount = children.length - itemsToProcess.length;
		const truncatedLine = `${parentPrefix}└── (${remainingCount} more items not shown...)\n`;

		if (truncatedLine.length <= remainingChars) {
			childrenContent += truncatedLine;
			remainingChars -= truncatedLine.length;
		}
		childrenCutOff = true;
	}

	return { childrenContent, childrenCutOff };
};


// ------------------------- FOLDERS -------------------------

export async function getAllUrisInDirectory(
	directoryUri: URI,
	maxResults: number,
	fileService: IFileService,
): Promise<URI[]> {
	const result: URI[] = [];

	// Helper function to recursively collect URIs
	async function visitAll(folderStat: IFileStat): Promise<boolean> {
		// Stop if we've reached the limit
		if (result.length >= maxResults) {
			return false;
		}

		try {

			if (!folderStat.isDirectory || !folderStat.children) {
				return true;
			}

			const eChildren = await resolveChildren(folderStat.children, fileService)

			// Process files first (common convention to list files before directories)
			for (const child of eChildren) {
				if (!child.isDirectory) {
					result.push(child.resource);

					// Check if we've hit the limit
					if (result.length >= maxResults) {
						return false;
					}
				}
			}

			// Then process directories recursively
			for (const child of eChildren) {
				const isGitIgnored = shouldExcludeDirectory(child.name)
				if (child.isDirectory && !isGitIgnored) {
					const shouldContinue = await visitAll(child);
					if (!shouldContinue) {
						return false;
					}
				}
			}

			return true;
		} catch (error) {
			console.error(`Error processing directory ${folderStat.resource.fsPath}: ${error}`);
			return true; // Continue despite errors in a specific directory
		}
	}

	const rootStat = await fileService.resolve(directoryUri)
	await visitAll(rootStat);
	return result;
}



// --------------------------------------------------


class DirectoryStrService extends Disposable implements IDirectoryStrService {
	_serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
	}

	async getAllURIsInDirectory(uri: URI, opts: { maxResults: number }): Promise<URI[]> {
		return getAllUrisInDirectory(uri, opts.maxResults, this.fileService)
	}

	async getDirectoryStrTool(uri: URI) {
		const eRoot = await this.fileService.resolve(uri)
		if (!eRoot) throw new Error(`The folder ${uri.fsPath} does not exist.`)

		const maxItemsPerDir = START_MAX_ITEMS_PER_DIR; // Use START_MAX_ITEMS_PER_DIR

		// First try with START_MAX_DEPTH
		const { content: initialContent, wasCutOff: initialCutOff } = await computeAndStringifyDirectoryTree(
			eRoot,
			this.fileService,
			MAX_DIRSTR_CHARS_TOTAL_TOOL,
			{ count: 0 },
			{ maxDepth: START_MAX_DEPTH, currentDepth: 0, maxItemsPerDir }
		);

		// If cut off, try again with DEFAULT_MAX_DEPTH and DEFAULT_MAX_ITEMS_PER_DIR
		let content, wasCutOff;
		if (initialCutOff) {
			const result = await computeAndStringifyDirectoryTree(
				eRoot,
				this.fileService,
				MAX_DIRSTR_CHARS_TOTAL_TOOL,
				{ count: 0 },
				{ maxDepth: DEFAULT_MAX_DEPTH, currentDepth: 0, maxItemsPerDir: DEFAULT_MAX_ITEMS_PER_DIR }
			);
			content = result.content;
			wasCutOff = result.wasCutOff;
		} else {
			content = initialContent;
			wasCutOff = initialCutOff;
		}

		let c = content.substring(0, MAX_DIRSTR_CHARS_TOTAL_TOOL)
		c = `Directory of ${uri.fsPath}:\n${content}`
		if (wasCutOff) c = `${c}\n...Result was truncated...`

		return c
	}

	async getAllDirectoriesStr({ cutOffMessage, }: { cutOffMessage: string, }) {
		let str: string = '';
		let cutOff = false;
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0)
			return '(NO WORKSPACE OPEN)';

		// Use START_MAX_ITEMS_PER_DIR if not specified
		const startMaxItemsPerDir = START_MAX_ITEMS_PER_DIR;

		for (let i = 0; i < folders.length; i += 1) {
			if (i > 0) str += '\n';

			// this prioritizes filling 1st workspace before any other, etc
			const f = folders[i];
			str += `Directory of ${f.uri.fsPath}:\n`;
			const rootURI = f.uri;

			const eRoot = await this.fileService.resolve(rootURI)
			if (!eRoot) continue;

			// First try with START_MAX_DEPTH and startMaxItemsPerDir
			const { content: initialContent, wasCutOff: initialCutOff } = await computeAndStringifyDirectoryTree(
				eRoot,
				this.fileService,
				MAX_DIRSTR_CHARS_TOTAL_BEGINNING - str.length,
				{ count: 0 },
				{ maxDepth: START_MAX_DEPTH, currentDepth: 0, maxItemsPerDir: startMaxItemsPerDir }
			);

			// If cut off, try again with DEFAULT_MAX_DEPTH and DEFAULT_MAX_ITEMS_PER_DIR
			let content, wasCutOff;
			if (initialCutOff) {
				const result = await computeAndStringifyDirectoryTree(
					eRoot,
					this.fileService,
					MAX_DIRSTR_CHARS_TOTAL_BEGINNING - str.length,
					{ count: 0 },
					{ maxDepth: DEFAULT_MAX_DEPTH, currentDepth: 0, maxItemsPerDir: DEFAULT_MAX_ITEMS_PER_DIR }
				);
				content = result.content;
				wasCutOff = result.wasCutOff;
			} else {
				content = initialContent;
				wasCutOff = initialCutOff;
			}

			str += content;
			if (wasCutOff) {
				cutOff = true;
				break;
			}
		}

		const ans = cutOff ? `${str.trimEnd()}\n${cutOffMessage}` : str
		return ans
	}
}

registerSingleton(IDirectoryStrService, DirectoryStrService, InstantiationType.Delayed);
