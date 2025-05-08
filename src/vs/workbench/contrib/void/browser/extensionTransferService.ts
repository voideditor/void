/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { env } from '../../../../base/common/process.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TransferEditorType, TransferFilesInfo } from './extensionTransferTypes.js';


export interface IExtensionTransferService {
	readonly _serviceBrand: undefined; // services need this, just leave it undefined
	transferExtensions(os: 'mac' | 'windows' | 'linux' | null, fromEditor: TransferEditorType): Promise<string | undefined>
	deleteBlacklistExtensions(os: 'mac' | 'windows' | 'linux' | null): Promise<void>

}

export const IExtensionTransferService = createDecorator<IExtensionTransferService>('ExtensionTransferService');





// Define extensions to skip when transferring
const extensionBlacklist = [
	// ignore extensions
	'ms-vscode-remote.remote', // ms-vscode-remote.remote-ssh, ms-vscode-remote.remote-wsl
	// ignore other AI copilots that could conflict with Void keybindings
	'sourcegraph.cody-ai',
	'continue.continue',
	'codeium.codeium',
	'saoudrizwan.claude-dev', // cline
	'rooveterinaryinc.roo-cline', // roo
	'supermaven.supermaven' // supermaven
	// 'github.copilot',
];



class ExtensionTransferService extends Disposable implements IExtensionTransferService {
	_serviceBrand: undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService,
	) {
		super()
	}

	async transferExtensions(os: 'mac' | 'windows' | 'linux' | null, fromEditor: TransferEditorType) {
		const transferTheseFiles = transferTheseFilesOfOS(os, fromEditor)
		const fileService = this._fileService

		let errAcc = ''

		for (const { from, to, isExtensions } of transferTheseFiles) {
			// Check if the source file exists before attempting to copy
			try {
				if (!isExtensions) {
					console.log('transferring item', from, to)

					const exists = await fileService.exists(from)
					if (exists) {
						// Ensure the destination directory exists
						const toParent = URI.joinPath(to, '..')
						const toParentExists = await fileService.exists(toParent)
						if (!toParentExists) {
							await fileService.createFolder(toParent)
						}
						await fileService.copy(from, to, true)
					} else {
						console.log(`Skipping file that doesn't exist: ${from.toString()}`)
					}
				}
				// extensions folder
				else {
					console.log('transferring extensions...', from, to)
					const exists = await fileService.exists(from)
					if (exists) {
						const stat = await fileService.resolve(from)
						const toParent = URI.joinPath(to) // extensions/
						const toParentExists = await fileService.exists(toParent)
						if (!toParentExists) {
							await fileService.createFolder(toParent)
						}
						for (const extensionFolder of stat.children ?? []) {
							if (extensionBlacklist.find(bItem => extensionFolder.resource.path.includes(bItem))) {
								console.log('Skipping...', extensionFolder.resource.path)
								continue
							}
							const from = extensionFolder.resource
							const to = URI.joinPath(toParent, extensionFolder.name)
							await fileService.copy(from, to, true)
						}
						// Ensure the destination directory exists
					} else {
						console.log(`Skipping file that doesn't exist: ${from.toString()}`)
					}
					console.log('done transferring extensions.')
				}
			}
			catch (e) {
				console.error('Error copying file:', e)
				errAcc += `Error copying ${from.toString()}: ${e}\n`
			}
		}

		if (errAcc) return errAcc
		return undefined
	}

	async deleteBlacklistExtensions(os: 'mac' | 'windows' | 'linux' | null) {
		const extensionsURI = getExtensionsFolder(os)
		if (!extensionsURI) return
		const eURI = await this._fileService.resolve(extensionsURI)
		for (const child of eURI.children ?? []) {

			// if is not blacklisted, continue
			if (!extensionBlacklist.find(bItem => child.resource.path.includes(bItem))) {
				continue
			}

			try {
				console.log('Deleting extension', child.resource.fsPath)
				await this._fileService.del(child.resource, { recursive: true, useTrash: true })
			}
			catch (e) {
				console.error('Could not delete extension', child.resource.fsPath, e)
			}
		}
	}
}


registerSingleton(IExtensionTransferService, ExtensionTransferService, InstantiationType.Eager); // lazily loaded, even if Eager









const transferTheseFilesOfOS = (os: 'mac' | 'windows' | 'linux' | null, fromEditor: TransferEditorType = 'VS Code'): TransferFilesInfo => {
	if (os === null)
		throw new Error(`One-click switch is not possible in this environment.`)
	if (os === 'mac') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`$HOME not found`)

		if (fromEditor === 'VS Code') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.vscode', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.cursor', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.windsurf', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		}
	}

	if (os === 'linux') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`variable for $HOME location not found`)

		if (fromEditor === 'VS Code') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.vscode', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Cursor', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Cursor', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.cursor', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Windsurf', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Windsurf', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.windsurf', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		}
	}

	if (os === 'windows') {
		const appdata = env['APPDATA']
		if (!appdata) throw new Error(`variable for %APPDATA% location not found`)
		const userprofile = env['USERPROFILE']
		if (!userprofile) throw new Error(`variable for %USERPROFILE% location not found`)

		if (fromEditor === 'VS Code') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.vscode', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Cursor', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Cursor', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.cursor', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Windsurf', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Windsurf', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.windsurf', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.void-editor', 'extensions'),
				isExtensions: true,
			}]
		}
	}

	throw new Error(`os '${os}' not recognized or editor type '${fromEditor}' not supported for this OS`)
}


const getExtensionsFolder = (os: 'mac' | 'windows' | 'linux' | null) => {
	const t = transferTheseFilesOfOS(os, 'VS Code') // from editor doesnt matter
	return t.find(f => f.isExtensions)?.to
}
