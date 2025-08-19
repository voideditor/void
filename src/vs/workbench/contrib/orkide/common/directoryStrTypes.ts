import { URI } from '../../../../base/common/uri.js';

export type OrkideDirectoryItem = {
	uri: URI;
	name: string;
	isSymbolicLink: boolean;
	children: OrkideDirectoryItem[] | null;
	isDirectory: boolean;
	isGitIgnoredDirectory: false | { numChildren: number }; // if directory is gitignored, we ignore children
}
