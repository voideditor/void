/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { _VoidSelectBox, VoidCustomMentionDropdownBox } from '../util/inputs.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { useAccessor } from '../util/services.js'
import { IFileDisplayInfo } from '../../../../common/fileSearchService.js'

// const optionsEqual = (m1: ModelOption[], m2: ModelOption[]) => {
// 	if (m1.length !== m2.length) return false
// 	for (let i = 0; i < m1.length; i++) {
// 		if (!modelSelectionsEqual(m1[i].selection, m2[i].selection)) return false
// 	}
// 	return true
// }


export const FileSelectBox = ({ onClickOption, onClose, position, isTextAreaAtBottom, searchText }: { onClickOption: (option: IFileDisplayInfo) => void,
	onClose: () => void,
	position: {
	top: number,
	left: number,
	height: number,
}, isTextAreaAtBottom: boolean, searchText?: string }) => {

	// Mention dropdown state
	const accessor = useAccessor();
	const repoFilesService = accessor.get('IRepoFilesService');
	const chatThreadsService = accessor.get('IChatThreadService');
	const [workspaceFiles, setWorkspaceFiles] = useState<IFileDisplayInfo[]>([]);
	const [loading, setLoading] = useState(false);

	// Add this effect to load and log files when component mounts
	useEffect(() => {
		const loadFiles = async () => {
			try {
				setLoading(true);
				// Clean up state
				setWorkspaceFiles([]);

				const files = await repoFilesService.getFilesByName(searchText);

				setWorkspaceFiles(files)
			} catch (error) {
				console.error('Error loading workspace files:', error);
			} finally {
				setLoading(false);
			}
		};
		loadFiles()
	}, [repoFilesService, searchText]);

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			if (!target.closest('.mentions-dropdown')) {
				onClose();
			}
		};

		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [onClose]);

	const addFileToStaging = (file: IFileDisplayInfo) => {
		console.log("Adding file to staging: ", file.fileName)
		// Add file to staging
		try {
			const currentThread = chatThreadsService.getCurrentThreadState().stagingSelections;
			if (currentThread && !currentThread.some((s) => s.fileURI.fsPath === file.uri.fsPath)) {
				chatThreadsService.setCurrentThreadState({
					stagingSelections: [{
						type: 'File',
						fileURI: file.uri,
						selectionStr: null,
						range: null,
						state: {
							// How do I check if a file is opened or not?
							isOpened: false,
						}
					}, ...currentThread]
				})
			}
		} catch (error) {
			console.error('Error adding file to staging:', error);
		}
	}

	const onSelectFile = useCallback((file: IFileDisplayInfo) => {
		addFileToStaging(file);
		onClickOption(file);
	}, [addFileToStaging, onClickOption]);

	// const handleChange = useCallback((newOption: IFileDisplayInfo) => {
    //     onClickOption(newOption)
    // }, [onClickOption])

	return <VoidCustomMentionDropdownBox
		options={workspaceFiles}
		onClickOption={onSelectFile}
		getOptionDropdownName={(option) => option.fileName}
		getOptionDropdownDetail={(option) => option.shortPath || ""}
		className='text-xs text-void-fg-3'
		matchInputWidth={false}
		position={position}
		isTextAreaAtBottom={isTextAreaAtBottom}
		isLoading={loading}
		noOptionsText='No files found'
	/>
}
