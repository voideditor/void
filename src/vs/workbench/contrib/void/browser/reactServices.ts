import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IContextViewService, IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ILLMMessageService } from '../../../../platform/void/common/llmMessageService.js';
import { IRefreshModelService } from '../../../../platform/void/common/refreshModelService.js';
import { IVoidConfigStateService } from '../../../../platform/void/common/voidConfigService.js';
import { IInlineDiffsService } from './registerInlineDiffs.js';
import { IVoidSidebarStateService } from './registerSidebar.js';
import { IThreadHistoryService } from './registerThreads.js';

export type ReactServicesType = {
	sidebarStateService: IVoidSidebarStateService;
	configStateService: IVoidConfigStateService;
	threadsStateService: IThreadHistoryService;
	fileService: IFileService;
	modelService: IModelService;
	inlineDiffService: IInlineDiffsService;
	llmMessageService: ILLMMessageService;
	clipboardService: IClipboardService;
	refreshModelService: IRefreshModelService;

	themeService: IThemeService,
	hoverService: IHoverService,

	contextViewService: IContextViewService;
	contextMenuService: IContextMenuService;
}


export const getReactServices = (accessor: ServicesAccessor): ReactServicesType => {
	return {
		configStateService: accessor.get(IVoidConfigStateService),
		sidebarStateService: accessor.get(IVoidSidebarStateService),
		threadsStateService: accessor.get(IThreadHistoryService),
		fileService: accessor.get(IFileService),
		modelService: accessor.get(IModelService),
		inlineDiffService: accessor.get(IInlineDiffsService),
		llmMessageService: accessor.get(ILLMMessageService),
		clipboardService: accessor.get(IClipboardService),
		themeService: accessor.get(IThemeService),
		hoverService: accessor.get(IHoverService),
		refreshModelService: accessor.get(IRefreshModelService),
		contextViewService: accessor.get(IContextViewService),
		contextMenuService: accessor.get(IContextMenuService),
	}
}

