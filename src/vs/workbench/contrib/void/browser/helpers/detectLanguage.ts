
// eg "bash" -> "shell"
export const nameToVscodeLanguage: { [key: string]: string } = {
	// Web Technologies
	'html': 'html',
	'css': 'css',
	'scss': 'scss',
	'sass': 'scss',
	'less': 'less',
	'javascript': 'typescript',
	'js': 'typescript', // use more general renderer
	'jsx': 'typescript',
	'typescript': 'typescript',
	'ts': 'typescript',
	'tsx': 'typescript',
	'json': 'json',
	'jsonc': 'json',

	// Programming Languages
	'python': 'python',
	'py': 'python',
	'java': 'java',
	'cpp': 'cpp',
	'c++': 'cpp',
	'c': 'c',
	'csharp': 'csharp',
	'cs': 'csharp',
	'c#': 'csharp',
	'go': 'go',
	'golang': 'go',
	'rust': 'rust',
	'rs': 'rust',
	'ruby': 'ruby',
	'rb': 'ruby',
	'php': 'php',
	'shell': 'shell',
	'bash': 'shell',
	'sh': 'shell',
	'zsh': 'shell',

	// Markup and Config
	'markdown': 'markdown',
	'md': 'markdown',
	'xml': 'xml',
	'svg': 'xml',
	'yaml': 'yaml',
	'yml': 'yaml',
	'ini': 'ini',
	'toml': 'ini',

	// Database and Query Languages
	'sql': 'sql',
	'mysql': 'sql',
	'postgresql': 'sql',
	'graphql': 'graphql',
	'gql': 'graphql',

	// Others
	'dockerfile': 'dockerfile',
	'docker': 'dockerfile',
	'makefile': 'makefile',
	'plaintext': 'plaintext',
	'text': 'plaintext'
};



// eg ".ts" -> "typescript"
const fileExtensionToVscodeLanguage: { [key: string]: string } = {
	// Web
	'html': 'html',
	'htm': 'html',
	'css': 'css',
	'scss': 'scss',
	'less': 'less',
	'js': 'javascript',
	'jsx': 'javascript',
	'ts': 'typescript',
	'tsx': 'typescript',
	'json': 'json',
	'jsonc': 'json',

	// Programming Languages
	'py': 'python',
	'java': 'java',
	'cpp': 'cpp',
	'cc': 'cpp',
	'c': 'c',
	'h': 'cpp',
	'hpp': 'cpp',
	'cs': 'csharp',
	'go': 'go',
	'rs': 'rust',
	'rb': 'ruby',
	'php': 'php',
	'sh': 'shell',
	'bash': 'shell',
	'zsh': 'shell',

	// Markup/Config
	'md': 'markdown',
	'markdown': 'markdown',
	'xml': 'xml',
	'svg': 'xml',
	'yaml': 'yaml',
	'yml': 'yaml',
	'ini': 'ini',
	'toml': 'ini',

	// Other
	'sql': 'sql',
	'graphql': 'graphql',
	'gql': 'graphql',
	'dockerfile': 'dockerfile',
	'docker': 'dockerfile',
	'mk': 'makefile',

	// Config Files and Dot Files
	'npmrc': 'ini',
	'env': 'ini',
	'gitignore': 'ignore',
	'dockerignore': 'ignore',
	'eslintrc': 'json',
	'babelrc': 'json',
	'prettierrc': 'json',
	'stylelintrc': 'json',
	'editorconfig': 'ini',
	'htaccess': 'apacheconf',
	'conf': 'ini',
	'config': 'ini',

	// Package Files
	'package': 'json',
	'package-lock': 'json',
	'gemfile': 'ruby',
	'podfile': 'ruby',
	'rakefile': 'ruby',

	// Build Systems
	'cmake': 'cmake',
	'makefile': 'makefile',
	'gradle': 'groovy',

	// Shell Scripts
	'bashrc': 'shell',
	'zshrc': 'shell',
	'fish': 'shell',

	// Version Control
	'gitconfig': 'ini',
	'hgrc': 'ini',
	'svnconfig': 'ini',

	// Web Server
	'nginx': 'nginx',

	// Misc Config
	'properties': 'properties',
	'cfg': 'ini',
	'reg': 'ini'
};


export function filenameToVscodeLanguage(filename: string): string | undefined {

	const ext = filename.toLowerCase().split('.').pop();
	if (!ext) return undefined;

	return fileExtensionToVscodeLanguage[ext];
}
