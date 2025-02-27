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

// Minimal least path import
import { shorten } from '../../../../base/common/labels.js';

export interface IRepoFilesService {
	readonly _serviceBrand: undefined;
	// searchFilesByName(searchText?: string): Promise<URI[]>;
	getFilesByName(searchText?: string): Promise<IFileDisplayInfo[]>;
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
	// Limit for the number of files to scan.
	// Note that this affects showing duplicates and filepaths because
	// it only shows the duplicates of the loaded files.
	private _maxFiles = 50;
	private _workspaceFolders: URI[] = [];
	private _excludePatterns: string[] = [
		'out/**',
		'build/**',
		'.git/**',
		'node_modules/**',
		'**/__pycache__/**',
		'**/*.egg-info/**',
		'**/env/**',
		'**/venv/**',
		'**/.venv/**',
		'**/.env/**'
	];
	private _timeoutId: NodeJS.Timeout | null = null

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
	}

	private _getExcludePatternObject(): IExpression {
		const excludePatternObject: IExpression = {};
		this._excludePatterns.forEach(pattern => {
			excludePatternObject[pattern] = true;
		});
		return excludePatternObject;
	}

	private async _refreshFileList(searchText?: string): Promise<void> {

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
			excludePattern: this._getExcludePatternObject(),
			maxResults: this._maxFiles,
			shouldGlobMatchFilePattern: true, // Use glob pattern for file search
		};

		const result = await this.searchService.fileSearch(query, CancellationToken.None);
		this._fileCache = result.results.map(match => match.resource);
	};

	private debounceify<T extends (...args: any[]) => Promise<any>>(func: T, delay: number) {
		console.log("Setting up debounce for function:", func.name);
		const debouncedFunction = (...args: Parameters<T>): Promise<ReturnType<T>> => {
			return new Promise((resolve, reject) => {
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

	public async getFilesByName(searchText?: string): Promise<IFileDisplayInfo[]> {

		// Create debounced version of refreshFileList
		const debouncedRefreshFileList = this.debounceify(this._refreshFileList.bind(this), 300);

		// Update the file cache with the latest files
		await debouncedRefreshFileList(searchText);

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
				const shortenedPaths = shorten(fullPaths); // Get short file path to be rendered for duplicates fileNames
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
