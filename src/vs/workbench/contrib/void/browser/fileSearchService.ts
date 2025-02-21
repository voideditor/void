import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export interface IRepoFilesService {
	readonly _serviceBrand: undefined;
	getWorkspaceFiles(searchText?: string): Promise<URI[]>;
	refreshFileList(searchText?: string): Promise<void>;
}

export const IRepoFilesService = createDecorator<IRepoFilesService>('repoFilesService');

class RepoFilesService extends Disposable implements IRepoFilesService {
	_serviceBrand: undefined;

	private _fileCache: URI[] = [];
	private _excludePatterns: string[] = ['**/node_modules/**', '**/.git/**'];
	// Limit for the number of files to scan
	private _maxFiles = 50;

	constructor(
		@IFileService private readonly fileService: IFileService,
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

		// await this.refreshFileList();

		// Watch for workspace changes
		// this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
		// 	this.refreshFileList();
		// }));
	}

	public async getWorkspaceFiles(searchText?: string): Promise<URI[]> {
		await this.refreshFileList(searchText);
		console.log(`Returning ${this._fileCache.length} files`);
		return this._fileCache;
	}

	public async refreshFileList(searchText?: string): Promise<void> {
		const workspaceFolders = this.workspaceService.getWorkspace().folders;
		const allFiles: URI[] = [];

		for (const folder of workspaceFolders) {
			try {
				let files: URI[];
				if (searchText) {
					files = await this._getFilteredFilesInFolder(folder.uri, searchText);
				} else {
					files = await this._getFilesInFolder(folder.uri);
				}
				console.log(`Found ${files.length} files in ${folder.uri.toString()}`);
				// Only add the first 10 files to the cache
				allFiles.push(...files);
			} catch (error) {
				console.error(`Error scanning folder ${folder.uri.toString()}:`, error);
			}
		}

		this._fileCache = allFiles;
	}

	private async _getFilesInFolder(folderUri: URI): Promise<URI[]> {
		const files: URI[] = [];

		try {
			const stat = await this.fileService.resolve(folderUri, {
				resolveMetadata: false
			});

			if (!stat.isDirectory) {
				return files;
			}

			// Process all children
			if (stat.children) {
				for (const child of stat.children) {
					// Stop if we have reached the limit
					if (files.length >= this._maxFiles) {
						break;
					}

					const childUri = child.resource;

					// Skip if matches exclude patterns
					if (this._shouldExclude(childUri)) {
						continue;
					}

					if (child.isDirectory) {
						// Recursively get files from subdirectory
						const subFiles = await this._getFilesInFolder(childUri);
						for (const file of subFiles) {
							if (files.length >= this._maxFiles) {
								break;
							}
							files.push(file);
						}
					} else {
						files.push(childUri);
					}
				}
			}
		} catch (error) {
			console.error(`Error processing ${folderUri.toString()}:`, error);
		}

		return files;
	}

	private async _getFilteredFilesInFolder(folderUri: URI, searchText: string): Promise<URI[]> {
		const files: URI[] = [];

		try {
			const stat = await this.fileService.resolve(folderUri, {
				resolveMetadata: false
			});

			if (!stat.isDirectory) {
				return files;
			}

			// Process all children
			if (stat.children) {
				for (const child of stat.children) {
					// Stop if we have reached the limit
					if (files.length >= this._maxFiles) {
						break;
					}


					const childUri = child.resource;

					// Skip if matches exclude patterns
					if (this._shouldExclude(childUri)) {
						continue;
					}

					if (child.isDirectory) {
						// Recursively get files from subdirectory
						const subFiles = await this._getFilesInFolder(childUri);
						for (const file of subFiles) {
							if (files.length >= this._maxFiles) {
								break;
							}
							const fileName = file.path.split('/').pop();
							if (fileName?.toLowerCase().startsWith(searchText.toLowerCase())) {
								files.push(file);
							}
						}
					} else {
						const fileName = childUri.path.split('/').pop();
						if (fileName?.toLowerCase().startsWith(searchText.toLowerCase())) {
							files.push(childUri);
						}
					}
				}
			}
		} catch (error) {
			console.error(`Error processing ${folderUri.toString()}:`, error);
		}

		return files;
	}

	private _shouldExclude(uri: URI): boolean {
		const path = uri.path;
		return this._excludePatterns.some(pattern => {
			// Convert glob pattern to regex
			const regexPattern = pattern
				.replace(/\*/g, '.*')
				.replace(/\?/g, '.')
				.replace(/\//g, '\\/');
			return new RegExp(regexPattern).test(path);
		});
	}
}

registerSingleton(IRepoFilesService, RepoFilesService, InstantiationType.Delayed);
