/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { env } from '../../../../base/common/process.js';
import { URI } from '../../../../base/common/uri.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { TransferEditorType, TransferFilesInfo } from './extensionTransferTypes.js';

export interface IProfileTransferService {
	readonly _serviceBrand: undefined; // services need this, just leave it undefined
	transferProfiles(os: 'mac' | 'windows' | 'linux' | null, fromEditor: TransferEditorType): Promise<string | undefined>
}

export const IProfileTransferService = createDecorator<IProfileTransferService>('ProfileTransferService');



class ProfileTransferService extends Disposable implements IProfileTransferService {
	_serviceBrand: undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IHostService private readonly _hostService: IHostService,
		@IDialogService private readonly _dialogService: IDialogService,
	) {
		super()
	}

	async transferProfiles(os: 'mac' | 'windows' | 'linux' | null, fromEditor: TransferEditorType): Promise<string | undefined> {
		const transferTheseFiles = transferTheseFilesOfOS(os, fromEditor)
		const fileService = this._fileService

		let errAcc = ''

		for (const { from, to } of transferTheseFiles) {
			// Check if the source file exists before attempting to copy
			try {
				console.log("Transferring profile from", from, "to", to)

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

			catch (e) {
				console.error('Error copying file:', e)
				errAcc += `Error copying ${from.toString()}: ${e}\n`
			}
		}

		if (errAcc) return errAcc

		const { confirmed } = await this._dialogService.confirm({
			title: `Profiles transferred successfully from ${fromEditor}`,
			message: `Would you like to relaunch Void? \nOtherwise the new profiles will be loaded when you next open Void.`,
			primaryButton: 'Relaunch',
			cancelButton: 'Later',
		})

		if (confirmed) {
			setTimeout(() => {
				this._hostService.restart()
			}, 1000)
		}

		return undefined
	}
}


registerSingleton(IProfileTransferService, ProfileTransferService, InstantiationType.Eager); // lazily loaded, even if Eager









const transferTheseFilesOfOS = (os: 'mac' | 'windows' | 'linux' | null, fromEditor: TransferEditorType = 'VS Code'): TransferFilesInfo => {
	if (os === null)
		throw new Error(`One-click switch is not possible in this environment.`)
	if (os === 'mac') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`$HOME not found`)

		if (fromEditor === 'VS Code') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'profiles'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'globalStorage'),
			}]
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'profiles'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'globalStorage'),
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'profiles'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'globalStorage'),
			}]
		}
	}

	if (os === 'linux') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`variable for $HOME location not found`)

		if (fromEditor === 'VS Code') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'profiles'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'globalStorage'),
			}]
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Cursor', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'profiles'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Cursor', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'globalStorage'),
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Windsurf', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'profiles'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Windsurf', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'globalStorage'),
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
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'code-oss-dev', 'User', 'profiles'), // Change this to Void
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'code-oss-dev', 'temp_global', 'globalStorage'), // Change this to Void
			}]
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Cursor', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'code-oss-dev', 'User', 'profiles'), // Change this to Void
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Cursor', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'code-oss-dev', 'User', 'globalStorage'), // Change this to Void
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Windsurf', 'User', 'profiles'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'code-oss-dev', 'User', 'profiles'), // Change this to Void
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Windsurf', 'User', 'globalStorage'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'code-oss-dev', 'User', 'globalStorage'), // Change this to Void
			}]
		}
	}

	throw new Error(`os '${os}' not recognized or editor type '${fromEditor}' not supported for this OS`)
}

