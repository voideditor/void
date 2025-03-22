import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

// Using the ISearchService imports
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ISearchService, IFileQuery, QueryType } from '../../../../workbench/services/search/common/search.js';
import { IExpression } from '../../../../base/common/glob.js';
import { FileChangesEvent, IFileService } from '../../../../platform/files/common/files.js';

// Minimal least path import
import { shorten } from '../../../../base/common/labels.js';

export interface IRepoFilesService {
	readonly _serviceBrand: undefined;
	readonly _isInitialized: boolean;
	getFirstPage(searchText?: string): IFileDisplayInfo[];
	getNextPage(previousLastFile: IFileDisplayInfo, getNextPage?: string): IFileDisplayInfo[];
	setSearchState(searchText?: string): Promise<void>;
	removeSearchState(): Promise<void>;
	getNumberOfFiles(searchText?: string): number;
	clearData(): void;
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
	_isInitialized: boolean = false;
	private _fileCache: IFileDisplayInfo[] = [];
	private _searchFilesCache: IFileDisplayInfo[] = [];
	// Limit for the number of files to scan.
	// Note that this affects showing duplicates and filepaths because
	// it only shows the duplicates of the loaded files.
	private _workspaceFolders: URI[] = [];
	private _excludePatterns: string[] = [
		'**/out/**',
		'**/build/**',
		'**/.git/**',
		'**/node_modules/**',
		'**/__pycache__/**',
		'**/*.egg-info/**',
		'**/env/**',
		'**/venv/**',
		'**/.venv/**',
		'**/.env/**',
		'**/src[0-9]*/**'
	];
	private _timeoutId: NodeJS.Timeout | null = null
	private _pageFetchSize = 50;
	private _debounceDelayMillis = 300;

	constructor(
		// @IFileService private readonly fileService: IFileService,
		@ISearchService private readonly searchService: ISearchService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this._initialize();
		// Set up file change listener
		this._register(this.fileService.onDidFilesChange(e => this._onDidFilesChange(e)));
	}

	private async _initialize(): Promise<void> {
		// Load exclude patterns from settings
		const config = this.configurationService.getValue<{ exclude: { [key: string]: boolean } }>('files');
		console.log("INITIALIZING REPO FILES SERVICE");
		if (config?.exclude) {
			this._excludePatterns = [
				...this._excludePatterns,
				...Object.keys(config.exclude).filter(pattern => config.exclude[pattern])
			];
		}

		// Get workspace folders. THIS MUST BE CALLED BEFORE _setFiles
		this._workspaceFolders = this.workspaceService.getWorkspace().folders.map(folder => folder.uri);

		// Load all files to cache once
		await this._setFiles();

		this._isInitialized = true;
	}

	private _convertsExcludePatternsToExpression(): IExpression {
		const excludePatternObject: IExpression = {};
		this._excludePatterns.forEach(pattern => {
			excludePatternObject[pattern] = true;
		});
		return excludePatternObject;
	}

	private async _refreshFileList(searchText?: string): Promise<void> {

		try {
			const uris = await this._getFiles(searchText || '');
			const fileInfos = await this._formatFiles(uris);
			this._fileCache = fileInfos
			console.log(`Found ${this._fileCache.length} files`);
		} catch (error) {
			console.error(`Error refreshing files:`, error);
		}
	}

	// NOTE: rawAdded and rawDeleted are deprecated but
	// don't have a viable alternative yet
	private async _onDidFilesChange(e: FileChangesEvent): Promise<void> {
		if (e.gotAdded()) {
			// Add new files to cache
			const newFiles = e.rawAdded;
			const fileNamesMap = new Map<string, Array<URI>>();

			// Group files by name
			for (const uri of newFiles) {
				const fileName = uri.path.split('/').pop() || '';
				if (!fileNamesMap.has(fileName)) {
					fileNamesMap.set(fileName, []);
				}
				fileNamesMap.get(fileName)!.push(uri);
			}

			// Process each group of files
			for (const [fileName, uris] of fileNamesMap) {
				const filesWithSameName = this._fileCache.filter(file => file.fileName === fileName);
				const hasDuplicate = filesWithSameName.length > 0;
				const fileURIs = filesWithSameName.map(file => file.uri).concat(uris);

				// Get the shortened paths
				const updatedFiles = await this._formatFiles(fileURIs);

				// Update the cache
				updatedFiles.forEach(updatedFile => {
					const index = this._fileCache.findIndex(file => file.uri.fsPath === updatedFile.uri.fsPath);
					if (index !== -1) {
						this._fileCache[index] = updatedFile;
					} else {
						this._fileCache.push(updatedFile);
					}
				});

				// Log added files
				uris.forEach(uri => {
					const newFile = updatedFiles.find(file => file.uri === uri);
					const fileInfo: IFileDisplayInfo = {
						fileName,
						uri,
						hasDuplicate,
						shortPath: newFile?.shortPath
					};
					console.log("File added:", fileInfo.fileName);
				});
			}
		}

		if (e.gotDeleted()) {
			// Remove deleted files from cache
			const deletedFiles = e.rawDeleted
			for (const uri of deletedFiles) {
				// Remove these files from the cache
				const index = this._fileCache.findIndex(file => file.uri.fsPath === uri.fsPath);
				if (index !== -1) {
					const deletedFile = this._fileCache.splice(index, 1)[0];
					console.log("File deleted:", deletedFile.fileName);
				}
			}
		}
	}

	private async _getFiles(
		searchText: string,
	): Promise<URI[]> {
		const folderQueries = this._workspaceFolders.map(folder => ({ folder }));
		const globPattern = `**/*${searchText}*`; // Search for file names that contain the search text recursively
		const query: IFileQuery = {
			type: QueryType.File,
			folderQueries,
			filePattern: globPattern,
			excludePattern: this._convertsExcludePatternsToExpression(),
			shouldGlobMatchFilePattern: true, // Use glob pattern for file search
		};

		const result = await this.searchService.fileSearch(query, CancellationToken.None);
		return result.results.map(match => match.resource);
	};

	private async _formatFiles(fileUris: URI[]): Promise<IFileDisplayInfo[]> {
		// One-pass approach to identify duplicates
		const filenameCount = new Map<string, number>();

		// First count occurrences of each filename
		for (const uri of fileUris) {
			const fileName = uri.path.split('/').pop() || '';
			filenameCount.set(fileName, (filenameCount.get(fileName) || 0) + 1);
		}

		// Create fileInfos with duplicate flag already set
		const fileInfos: IFileDisplayInfo[] = fileUris.map(uri => {
			const fileName = uri.path.split('/').pop() || '';
			return {
				fileName,
				uri,
				hasDuplicate: (filenameCount.get(fileName) || 0) > 1,
				shortPath: undefined
			};
		});

		// Only process paths for files with duplicates
		if (fileInfos.some(info => info.hasDuplicate)) {
			// Group duplicates for path processing
			const duplicateGroups = new Map<string, IFileDisplayInfo[]>();

			// Only collect duplicates
			for (const info of fileInfos) {
				if (info.hasDuplicate) {
					if (!duplicateGroups.has(info.fileName)) {
						duplicateGroups.set(info.fileName, []);
					}
					duplicateGroups.get(info.fileName)!.push(info);
				}
			}

			// Process paths only for duplicates
			duplicateGroups.forEach(group => {
				const fullPaths = group.map(info => info.uri.fsPath);
				const shortenedPaths = shorten(fullPaths);

				// Simplify path modification
				group.forEach((info, index) => {
					if (shortenedPaths[index]) {
						info.shortPath = shortenedPaths[index].replace(/^\/[^/]+\//, '');
					}
				});
			});
		}

		return fileInfos;
	}

	private _debounceify<T extends (...args: any[]) => Promise<any>>(func: T, delay: number) {
		console.log("Setting up debounce for function:", func.name);
		const debouncedFunction = (...args: Parameters<T>): Promise<ReturnType<T>> => {
			return new Promise((resolve, reject) => {
				// Cancel the previous timeout
				if (this._timeoutId) clearTimeout(this._timeoutId);
				this._timeoutId = setTimeout(async () => {
					try {
						console.log("Debounced function called with args:", args);
						const result = await func(...args);
						this._timeoutId = null;
						resolve(result);
					} catch (error) {
						reject(error);
					}
				}, delay);
			});
		};

		debouncedFunction.cancel = () => {
			if (this._timeoutId) {
				clearTimeout(this._timeoutId);
				this._timeoutId = null;
			}
		};

		return debouncedFunction as T & { cancel: () => void };
	}

	private async _setFiles(searchText?: string): Promise<void> {

		// Clear the file cache
		this._fileCache = [];

		// Create debounced version of refreshFileList
		const DEBOUNCE_DELAY_MS = 300
		const debouncedRefreshFileList = this._debounceify(this._refreshFileList.bind(this), DEBOUNCE_DELAY_MS);

		// Update the file cache with the latest files
		await debouncedRefreshFileList(searchText);

		return;
	}

	private async _setSearchFilesFromFileCache(searchText: string): Promise<void> {
		// Clear the search file cache
		this._searchFilesCache = [];

		// Filter files that contain the search text
		this._searchFilesCache = this._fileCache.filter(file => file.fileName.toLowerCase().includes(searchText.toLowerCase()));

		return;
	}

	public async setSearchState(searchText?: string): Promise<void> {

		if (!searchText) return;

		// Clear the search file cache
		this._searchFilesCache = [];

		// Create debounced version of setSearchFilesFromFileCache
		const debouncedSetSearchFilesFromFileCache = this._debounceify(this._setSearchFilesFromFileCache.bind(this), this._debounceDelayMillis);

		// Update the search file cache with the latest files
		await debouncedSetSearchFilesFromFileCache(searchText);

		return;
	}

	public async removeSearchState(): Promise<void> {
		this._searchFilesCache = [];

		// Check for debounce timeout and cancel it
		if (this._timeoutId) {
			clearTimeout(this._timeoutId);
			this._timeoutId = null;
		}

		return;
	}

	public getFirstPage(searchText?: string): IFileDisplayInfo[] {
		if (searchText) {
			console.log("Returning search files cache")
			return this._searchFilesCache.slice(0, this._pageFetchSize);
		} else {
			console.log("Returning file cache")
			return this._fileCache.slice(0, this._pageFetchSize);
		}
	}

	public getNextPage(previousLastFile: IFileDisplayInfo, searchText?: string): IFileDisplayInfo[] {
		if (searchText) {
			const index = this._searchFilesCache.indexOf(previousLastFile);
			if (index === -1) {
				return [];
			}
			return this._searchFilesCache.slice(index + 1, index + this._pageFetchSize + 1);
		} else {
			const index = this._fileCache.indexOf(previousLastFile);
			if (index === -1) {
				return [];
			}
			return this._fileCache.slice(index + 1, index + this._pageFetchSize + 1);
		}
	}

	public getNumberOfFiles(searchText?: string): number {
		if (searchText) {
			return this._searchFilesCache.length;
		} else {
			return this._fileCache.length;
		}
	}

	public clearData(): void {

		if (this._timeoutId) {
			clearTimeout(this._timeoutId);
			this._timeoutId = null;
		}
	}

}

registerSingleton(IRepoFilesService, RepoFilesService, InstantiationType.Delayed);
