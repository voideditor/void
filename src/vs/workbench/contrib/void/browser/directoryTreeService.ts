/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as path from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { FilesFilter } from '../../files/browser/views/explorerViewer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IExplorerService } from '../../files/browser/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export interface IDirectoryTreeService {
	readonly _serviceBrand: undefined;
	getDirectoryTreeWithVSCodeIgnores(directoryPath: string): Promise<{ content: string, cutOff: boolean }>;
}

export const IDirectoryTreeService = createDecorator<IDirectoryTreeService>('voidDirectoryTreeService');

class DirectoryTreeService extends Disposable implements IDirectoryTreeService {
	_serviceBrand: undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
	}

	/**
	 * Prints a directory structure in a tree-like format, respecting gitignore patterns
	 * @param directoryPath The path to the directory to print
	 * @returns Object containing the formatted tree as a string and whether it was cut off
	 */
	public async getDirectoryTreeWithVSCodeIgnores(directoryPath: string): Promise<{ content: string, cutOff: boolean }> {
		// Create a files filter instance
		const filesFilter = new FilesFilter(
			this.workspaceContextService,
			this._configService,
			this.explorerService,
			this.editorService,
			this.uriIdentityService,
			this._fileService
		);

		const isPathIgnored = this.createVSCodeIgnoreCheck(
			directoryPath,
			filesFilter,
		);

		const MAX_CHARS = 20_000;
		const result = await this.printDirectoryTree(this._fileService, directoryPath, '', isPathIgnored, MAX_CHARS);

		return {
			content: result.content,
			cutOff: result.cutOff
		};
	}

	/**
	 * Prints a directory structure in a tree-like format, respecting gitignore patterns
	 * @param fileService The file service to use
	 * @param directoryPath The path to the directory to print
	 * @param indent Optional indentation for nested calls
	 * @param isPathIgnored Optional function to check if a path is ignored
	 * @param maxChars Maximum number of characters before cutting off
	 * @returns Object containing the formatted tree and cut-off status
	 */
	private async printDirectoryTree(
		fileService: IFileService,
		directoryPath: string,
		indent: string = '',
		isPathIgnored?: (path: string, isDirectory: boolean) => boolean,
		maxChars: number = Infinity
	): Promise<{ content: string, cutOff: boolean }> {
		let resolve: (result: { content: string, cutOff: boolean }) => void = () => undefined
		const p = new Promise<{ content: string, cutOff: boolean }>((res) => { resolve = res });

		try {
			const directoryUri = URI.file(directoryPath);
			const stat = await fileService.resolve(directoryUri);
			if (!stat.isDirectory) {
				resolve({ content: '', cutOff: false });
				return p;
			}

			// For root level only
			let result = '';
			let cutOff = false;

			if (indent === '') {
				const baseName = path.basename(directoryPath);
				result += baseName + '\n';

				if (result.length >= maxChars) {
					resolve({ content: result.substring(0, maxChars), cutOff: true });
					return p;
				}
			}

			// Separate directories and files
			const directories: string[] = [];
			const files: string[] = [];

			for (const entry of stat.children || []) {
				const itemPath = entry.resource.fsPath;
				const isDirectory = entry.isDirectory;

				// Skip ignored files/folders if isPathIgnored is provided
				if (isPathIgnored && isPathIgnored(itemPath, isDirectory)) {
					continue;
				}

				if (isDirectory) {
					directories.push(entry.name);
				} else {
					files.push(entry.name);
				}
			}

			// Process directories first, then files
			const sortedItems = [...directories.sort(), ...files.sort()];

			// Process each visible item
			for (let i = 0; i < sortedItems.length; i++) {
				// Check if we've reached the character limit
				if (result.length >= maxChars) {
					cutOff = true;
					break;
				}

				const item = sortedItems[i];
				const isLast = i === sortedItems.length - 1;
				const itemPath = path.join(directoryPath, item);
				const isDirectory = directories.includes(item);

				// Add the current item to the result
				const itemLine = `${indent}|--${item}\n`;

				// Check if adding this line would exceed the limit
				if (result.length + itemLine.length > maxChars) {
					result += itemLine.substring(0, maxChars - result.length);
					cutOff = true;
					break;
				}

				result += itemLine;

				// Recursively process directories
				if (isDirectory) {
					// Next level indentation
					const childIndent = `${indent}${isLast ? '   ' : '|  '}`;
					const childResult = await this.printDirectoryTree(
						fileService,
						itemPath,
						childIndent,
						isPathIgnored,
						maxChars - result.length
					);

					result += childResult.content;

					if (childResult.cutOff) {
						cutOff = true;
						break;
					}
				}
			}

			resolve({ content: result, cutOff });
		} catch (error) {
			const errorMessage = `Error: ${error.message}\n`;
			const cutOff = errorMessage.length > maxChars;
			resolve({
				content: cutOff ? errorMessage.substring(0, maxChars) : errorMessage,
				cutOff
			});
		}
		return p;
	}

	/**
	 * Creates a function that checks if a path should be ignored based on VS Code's FilesFilter
	 * @param directoryPath Root directory path
	 * @param filesFilter VS Code's FilesFilter instance
	 * @param fileService VS Code's FileService instance
	 * @param configService VS Code's ConfigurationService instance
	 * @param filesConfigService VS Code's FilesConfigurationService instance
	 * @returns A function that checks if a path is ignored
	 */
	private createVSCodeIgnoreCheck(
		directoryPath: string,
		filesFilter: FilesFilter,
	): (path: string, isDirectory: boolean) => boolean {
		// Create a workspace folder URI (root explorer item)
		const workspaceUri = URI.file(directoryPath);

		return (itemPath: string, isDirectory: boolean): boolean => {
			try {
				const itemUri = URI.file(itemPath);

				// Use FilesFilter.isIgnored to check if the item should be hidden based on VS Code's excludes
				return filesFilter.isIgnored(itemUri, workspaceUri, isDirectory);
			} catch (error) {
				console.error(`Error checking if path is ignored: ${itemPath}`, error);
				return false;
			}
		};
	}
}

registerSingleton(IDirectoryTreeService, DirectoryTreeService, InstantiationType.Delayed);
