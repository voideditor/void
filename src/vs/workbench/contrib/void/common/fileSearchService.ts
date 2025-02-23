import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
// import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

// Using the ISearchService imports
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ISearchService, IFileQuery, QueryType } from '../../../../workbench/services/search/common/search.js';

// Minimal least path import
import { shorten } from '../../../../base/common/labels.js';

export interface IRepoFilesService {
	readonly _serviceBrand: undefined;
	searchFilesByName(searchText?: string): Promise<URI[]>;
	getFilesByName(searchText?: string): Promise<IFileDisplayInfo[]>;
	refreshFileList(searchText?: string): Promise<void>;
}

export interface IFileDisplayInfo {
	fileName: string;
	uri: URI;
	hasDuplicate: boolean;
	shortPath?: string;
}

export const IRepoFilesService = createDecorator<IRepoFilesService>('repoFilesService');

class RepoFilesService extends Disposable implements IRepoFilesService {
	_serviceBrand: undefined;

	private _fileCache: URI[] = [];
	private _excludePatterns: string[] = ['**/node_modules/**', '**/.git/**'];
	// Limit for the number of files to scan
	private _maxFiles = 50;
	private _workspaceFolders: URI[] = [];

	constructor(
		// @IFileService private readonly fileService: IFileService,
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this._initialize();
	}

	private async _initialize(): Promise<void> {
		// Load exclude patterns from settings
		const config = this.configurationService.getValue<{ exclude: { [key: string]: boolean } }>('files');
		if (config?.exclude) {
			this._excludePatterns = [
				...this._excludePatterns,
				...Object.keys(config.exclude).filter(pattern => config.exclude[pattern])
			];
		}

		// Get workspace folders
		this._workspaceFolders = this.workspaceService.getWorkspace().folders.map(folder => folder.uri);

		// await this.refreshFileList();

		// Watch for workspace changes
		// this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
		// 	this.refreshFileList();
		// }));
	}

	// public async getWorkspaceFiles(searchText?: string): Promise<URI[]> {
	// 	await this.refreshFileList(searchText);
	// 	console.log(`Returning ${this._fileCache.length} files`);
	// 	return this._fileCache;
	// }

	public async refreshFileList(searchText?: string): Promise<void> {

		try {
			await this._getFiles(searchText || '');
			console.log(`Found ${this._fileCache.length} files`);
		} catch (error) {
			console.error(`Error refreshing files:`, error);
		}
	}

	private async _getFiles(
		searchText: string,
	): Promise<void> {
		const folderQueries = this._workspaceFolders.map(folder => ({ folder }));
		const globPattern = `**/*${searchText}*`; // Search for file names that contain the search text recursively
		const query: IFileQuery = {
			type: QueryType.File,
			folderQueries,
			filePattern: globPattern,
			maxResults: this._maxFiles,
			shouldGlobMatchFilePattern: true, // Use glob pattern for file search
		};

		const result = await this.searchService.fileSearch(query, CancellationToken.None);
		this._fileCache = result.results.map(match => match.resource);
	};

	// private getDuplicateFiles(): Map<string, URI[]> {
	// 	const fileMap = new Map<string, URI[]>();
	// 	this._fileCache.forEach(file => {
	// 		const fileName = file.path.split('/').pop();
	// 		if (fileName) {
	// 			const files = fileMap.get(fileName) || [];
	// 			files.push(file);
	// 			fileMap.set(fileName, files);
	// 		}
	// 	});

	// 	return new Map([...fileMap.entries()].filter(entry => entry[1].length > 1));
	// }



	// private async _getFilesInFolder(folderUri: URI): Promise<URI[]> {
	// 	const files: URI[] = [];

	// 	try {
	// 		const stat = await this.fileService.resolve(folderUri, {
	// 			resolveMetadata: false
	// 		});

	// 		if (!stat.isDirectory) {
	// 			return files;
	// 		}

	// 		// Process all children
	// 		if (stat.children) {
	// 			for (const child of stat.children) {
	// 				// Stop if we have reached the limit
	// 				if (files.length >= this._maxFiles) {
	// 					break;
	// 				}

	// 				const childUri = child.resource;

	// 				// Skip if matches exclude patterns
	// 				if (this._shouldExclude(childUri)) {
	// 					continue;
	// 				}

	// 				if (child.isDirectory) {
	// 					// Recursively get files from subdirectory
	// 					const subFiles = await this._getFilesInFolder(childUri);
	// 					for (const file of subFiles) {
	// 						if (files.length >= this._maxFiles) {
	// 							break;
	// 						}
	// 						files.push(file);
	// 					}
	// 				} else {
	// 					files.push(childUri);
	// 				}
	// 			}
	// 		}
	// 	} catch (error) {
	// 		console.error(`Error processing ${folderUri.toString()}:`, error);
	// 	}

	// 	return files;
	// }

	// private async _getFilteredFilesInFolder(folderUri: URI, searchText: string): Promise<URI[]> {
	// 	const files: URI[] = [];

	// 	try {
	// 		const stat = await this.fileService.resolve(folderUri, {
	// 			resolveMetadata: false
	// 		});

	// 		if (!stat.isDirectory) {
	// 			return files;
	// 		}

	// 		// Process all children
	// 		if (stat.children) {
	// 			for (const child of stat.children) {
	// 				// Stop if we have reached the limit
	// 				if (files.length >= this._maxFiles) {
	// 					break;
	// 				}


	// 				const childUri = child.resource;

	// 				// Skip if matches exclude patterns
	// 				if (this._shouldExclude(childUri)) {
	// 					continue;
	// 				}

	// 				if (child.isDirectory) {
	// 					// Recursively get files from subdirectory
	// 					const subFiles = await this._getFilesInFolder(childUri);
	// 					for (const file of subFiles) {
	// 						if (files.length >= this._maxFiles) {
	// 							break;
	// 						}
	// 						const fileName = file.path.split('/').pop();
	// 						if (fileName?.toLowerCase().startsWith(searchText.toLowerCase())) {
	// 							files.push(file);
	// 						}
	// 					}
	// 				} else {
	// 					const fileName = childUri.path.split('/').pop();
	// 					if (fileName?.toLowerCase().startsWith(searchText.toLowerCase())) {
	// 						files.push(childUri);
	// 					}
	// 				}
	// 			}
	// 		}
	// 	} catch (error) {
	// 		console.error(`Error processing ${folderUri.toString()}:`, error);
	// 	}

	// 	return files;
	// }

	// private _shouldExclude(uri: URI): boolean {
	// 	const path = uri.path;
	// 	return this._excludePatterns.some(pattern => {
	// 		// Convert glob pattern to regex
	// 		const regexPattern = pattern
	// 			.replace(/\*/g, '.*')
	// 			.replace(/\?/g, '.')
	// 			.replace(/\//g, '\\/');
	// 		return new RegExp(regexPattern).test(path);
	// 	});
	// }

	// ISearchService implementation methods
	// private currentSearchCancellationTokenSource: CancellationTokenSource | null = null;

	public async searchFilesByName(searchText?: string): Promise<URI[]> {
		try {
			await this.refreshFileList(searchText);
			return this._fileCache;
		} catch (error) {
			console.error(`Error searching files:`, error);
			return [];
		}
	}

	public async getFilesByName(searchText?: string): Promise<IFileDisplayInfo[]> {
		// Update the file cache with the latest files
		await this.refreshFileList(searchText);

		// Create fileInfo objects in the original order.
		const fileInfos: IFileDisplayInfo[] = this._fileCache.map(uri => ({
			fileName: uri.path.split('/').pop() || '',
			uri,
			hasDuplicate: false,
			shortPath: undefined
		}));

		// Group fileInfos by fileName.
		const duplicatesMap = new Map<string, IFileDisplayInfo[]>();
		for (const info of fileInfos) {
			if (!duplicatesMap.has(info.fileName)) {
				duplicatesMap.set(info.fileName, []);
			}
			duplicatesMap.get(info.fileName)!.push(info);
		}

		// Update the original fileInfos based on the grouping.
		duplicatesMap.forEach(group => {
			if (group.length > 1) {
				group.forEach(info => info.hasDuplicate = true);
				const fullPaths = group.map(info => info.uri.toString());
				const shortenedPaths = shorten(fullPaths);
				group.forEach((info, index) => {
					info.shortPath = shortenedPaths[index];
				});
			}
		});

		// The order of fileInfos remains the same as the original _fileCache order.
		return fileInfos;
	}

}

registerSingleton(IRepoFilesService, RepoFilesService, InstantiationType.Delayed);
