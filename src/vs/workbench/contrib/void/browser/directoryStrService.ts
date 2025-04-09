/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ShallowDirectoryItem, ToolCallParams, ToolResultType } from '../common/toolsServiceTypes.js';
import { MAX_CHILDREN_URIs_PAGE } from './toolsService.js';
import { IExplorerService } from '../../files/browser/files.js';
import { SortOrder } from '../../files/common/files.js';
import { ExplorerItem } from '../../files/common/explorerModel.js';
import { VoidDirectoryItem } from '../common/directoryStrTypes.js';
import { MAX_DIRSTR_CHARS_TOTAL_BEGINNING, MAX_DIRSTR_CHARS_TOTAL_TOOL } from '../common/prompt/prompts.js';


// const MAX_FILES_TOTAL = 200


export interface IDirectoryStrService {
	readonly _serviceBrand: undefined;

	getDirectoryStrTool(uri: URI): Promise<string>
	getAllDirectoriesStr(opts: { cutOffMessage: string }): Promise<string>

}
export const IDirectoryStrService = createDecorator<IDirectoryStrService>('voidDirectoryStrService');




// Check if it's a known filtered type like .git
const shouldExcludeDirectory = (item: ExplorerItem) => {
	if (item.name === '.git' ||
		item.name === 'node_modules' ||
		item.name.startsWith('.') ||
		item.name === 'dist' ||
		item.name === 'build' ||
		item.name === 'out' ||
		item.name === 'bin' ||
		item.name === 'coverage' ||
		item.name === '__pycache__' ||
		item.name === 'env' ||
		item.name === 'venv' ||
		item.name === 'tmp' ||
		item.name === 'temp' ||
		item.name === 'artifacts' ||
		item.name === 'target' ||
		item.name === 'obj' ||
		item.name === 'vendor' ||
		item.name === 'logs' ||
		item.name === 'cache'

	) {
		return true;
	}
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
		return `Error: ${params.rootURI} is not a directory`;
	}

	let output = '';
	const entries = result.children;

	if (!result.hasPrevPage) { // is first page
		output += `${params.rootURI.fsPath}\n`;
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


// if the filter exists use it to filter out files and folders when creating the tree
const computeDirectoryTree = async (
	eItem: ExplorerItem,
	explorerService: IExplorerService
): Promise<VoidDirectoryItem> => {
	// Fetch children with default sort order
	const eChildren = await eItem.fetchChildren(SortOrder.FilesFirst);

	const isGitIgnoredDirectory = eItem.isDirectory && shouldExcludeDirectory(eItem)

	// Process children recursively
	const children = !isGitIgnoredDirectory ? await Promise.all(
		eChildren.map(async c => await computeDirectoryTree(c, explorerService))
	) : null

	// Create our directory item
	const item: VoidDirectoryItem = {
		uri: eItem.resource,
		name: eItem.name,
		isDirectory: eItem.isDirectory,
		isSymbolicLink: eItem.isSymbolicLink,
		children,
		isGitIgnoredDirectory: isGitIgnoredDirectory && { numChildren: eItem.children.size },
	};

	return item;
};


const stringifyDirectoryTree = (
	node: VoidDirectoryItem,
	MAX_CHARS: number,
): { content: string, wasCutOff: boolean } => {
	let content = '';
	let wasCutOff = false;

	// If we're already exceeding the max characters, return immediately
	if (MAX_CHARS <= 0) {
		return { content, wasCutOff: true };
	}

	// Add the root node first (without tree characters)
	const nodeLine = `${node.name}${node.isDirectory ? '/' : ''}${node.isSymbolicLink ? ' (symbolic link)' : ''}\n`;

	if (nodeLine.length > MAX_CHARS) {
		return { content: '', wasCutOff: true };
	}

	content += nodeLine;
	let remainingChars = MAX_CHARS - nodeLine.length;

	// Then recursively add all children with proper tree formatting
	if (node.children && node.children.length > 0) {
		const { childrenContent, childrenCutOff } = renderChildren(
			node.children,
			remainingChars,
			''
		);
		content += childrenContent;
		wasCutOff = childrenCutOff;
	}
	return { content, wasCutOff };
};

// Helper function to render children with proper tree formatting
const renderChildren = (
	children: VoidDirectoryItem[],
	maxChars: number,
	parentPrefix: string
): { childrenContent: string, childrenCutOff: boolean } => {
	let childrenContent = '';
	let childrenCutOff = false;

	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		const isLast = i === children.length - 1;

		// Create the tree branch symbols
		const branchSymbol = isLast ? '└── ' : '├── ';
		const childLine = `${parentPrefix}${branchSymbol}${child.name}${child.isDirectory ? '/' : ''}${child.isSymbolicLink ? ' (symbolic link)' : ''}\n`;

		// Check if adding this line would exceed the limit
		if (childrenContent.length + childLine.length > maxChars) {
			childrenCutOff = true;
			break;
		}
		childrenContent += childLine;

		const nextLevelPrefix = parentPrefix + (isLast ? '    ' : '│   ');


		// if gitignored, just say the number of children
		if (child.isDirectory && child.isGitIgnoredDirectory && child.isGitIgnoredDirectory.numChildren > 0) {
			childrenContent += `${nextLevelPrefix}└── ... (${child.isGitIgnoredDirectory.numChildren} children) ...\n`
		}

		// Create the prefix for the next level (continuation line or space)
		else if (child.children && child.children.length > 0) {

			const {
				childrenContent: grandChildrenContent,
				childrenCutOff: grandChildrenCutOff
			} = renderChildren(
				child.children,
				maxChars,
				nextLevelPrefix
			);

			// If adding grandchildren content would exceed the limit
			if (childrenContent.length + grandChildrenContent.length > maxChars) {
				childrenCutOff = true;
				break;
			}

			childrenContent += grandChildrenContent;

			if (grandChildrenCutOff) {
				childrenCutOff = true;
				break;
			}
		}
	}

	return { childrenContent, childrenCutOff };
};


// ---------------------------------------------------


class DirectoryStrService extends Disposable implements IDirectoryStrService {
	_serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IExplorerService private readonly explorerService: IExplorerService,
	) {
		super();
	}

	async getDirectoryStrTool(uri: URI) {
		const eRoot = this.explorerService.findClosest(uri)
		if (!eRoot) throw new Error(`There was a problem reading the URI: ${uri.fsPath}.`)

		const dirTree = await computeDirectoryTree(eRoot, this.explorerService);
		const { content, wasCutOff } = stringifyDirectoryTree(dirTree, MAX_DIRSTR_CHARS_TOTAL_TOOL);

		let c = content.substring(0, MAX_DIRSTR_CHARS_TOTAL_TOOL)
		c = `Directory of ${uri.fsPath}:\n${content}`
		if (wasCutOff) c = `${c}\n...Result was truncated...`

		return c
	}

	async getAllDirectoriesStr({ cutOffMessage }: { cutOffMessage: string }) {
		let str: string = '';
		let cutOff = false;
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0)
			return '(NO WORKSPACE OPEN)';

		for (let i = 0; i < folders.length; i += 1) {
			if (i > 0) str += '\n';

			// this prioritizes filling 1st workspace before any other, etc
			const f = folders[i];
			str += `Directory of ${f.uri.fsPath}:\n`;
			const rootURI = f.uri;

			const eRoot = this.explorerService.findClosestRoot(rootURI);
			if (!eRoot) continue;

			// Use our new approach with direct explorer service
			const dirTree = await computeDirectoryTree(eRoot, this.explorerService);
			const { content, wasCutOff } = stringifyDirectoryTree(dirTree, MAX_DIRSTR_CHARS_TOTAL_BEGINNING - str.length);
			str += content;
			if (wasCutOff) {
				cutOff = true;
				break;
			}
		}

		if (cutOff) {
			return `${str}\n${cutOffMessage}`
		}
		return str
	}
}

registerSingleton(IDirectoryStrService, DirectoryStrService, InstantiationType.Delayed);
