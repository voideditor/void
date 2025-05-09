import { localize2 } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { readFile, DEFAULT_FILE_SIZE_LIMIT } from '../common/prompt/prompts.js';



async function filePrompt(fileService: IFileService, uri: URI, clipboardService: IClipboardService): Promise<string> {
	const { val } = await readFile(fileService, uri, DEFAULT_FILE_SIZE_LIMIT)
	const fileName = uri.fsPath.split('/').pop() ?? ''
	if (!val) {
		throw new Error('Failed to copy prompt')
	}
	const prompt = `
${fileName}:
\`\`\`
${val}
\`\`\``.trim()
	return prompt
}

/**
 * Add a menu item to the explorer context menu that copies a prompt for the selected file or directory.
 *
 * Example file prompt:
 *
 * ```
 * index.js:
 * \`\`\`
 * console.log('Hello World!');
 * \`\`\`
 *
 * Example directory prompt:
 * ```
 * Directory of /path/to/src:
 * src/
 * ├── index.ts
 * ├── src.ts
 * ├── latest/
 * │   ├── index.ts
 * │   └── src.ts
 * ├── types.ts
 * └── util.ts
 * ```
 */
class FilePromptActionService extends Action2 {
	private static readonly VOID_COPY_FILE_PROMPT_ID = 'void.copyfileprompt'

	constructor() {
		super({
			id: FilePromptActionService.VOID_COPY_FILE_PROMPT_ID,
			title: localize2('voidCopyPrompt', "Void: Copy Prompt"),
			menu: [{
				id: MenuId.ExplorerContext,
				group: '8_void',
				order: 1,
			}]
		});
	}

	async run(accessor: ServicesAccessor, uri: URI): Promise<void> {
		try {
			const fileService = accessor.get(IFileService);
			const clipboardService = accessor.get(IClipboardService)
			const directoryStrService = accessor.get(IDirectoryStrService)
			const stat = await fileService.resolve(uri)
			const prompt = stat.isFile
				? await filePrompt(fileService, uri, clipboardService)
				: await directoryStrService.getDirectoryStrTool(uri)
			await clipboardService.writeText(prompt)
		} catch (error) {
			const notificationService = accessor.get(INotificationService)
			FilePromptActionService._onError(notificationService, error)
		}
	}

	private static _onError(notificationService: INotificationService, error: Error) {
		const errorMessage = localize2('voidCopyPromptError', 'Failed to copy prompt')
		notificationService.error(errorMessage.value)
		throw error
	}
}

registerAction2(FilePromptActionService)
