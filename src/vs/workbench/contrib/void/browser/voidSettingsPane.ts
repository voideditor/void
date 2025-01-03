/*------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for more information.
 *-----------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import * as nls from '../../../../nls.js';
import { EditorExtensions } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';


import { mountVoidSettings } from './react/out/void-settings-tsx/index.js'
import { Codicon } from '../../../../base/common/codicons.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';


// refer to preferences.contribution.ts keybindings editor

class VoidSettingsInput extends EditorInput {

	static readonly ID: string = 'workbench.input.void.settings';

	static readonly RESOURCE = URI.from({ // I think this scheme is invalid, it just shuts up TS
		scheme: 'void',  // Custom scheme for our editor
		path: 'settings'
	})
	readonly resource = VoidSettingsInput.RESOURCE;

	constructor() {
		super();
	}

	override get typeId(): string {
		return VoidSettingsInput.ID;
	}

	override getName(): string {
		return nls.localize('voidSettingsInputsName', 'Void Settings');
	}

	override getIcon() {
		return Codicon.checklist // symbol for the actual editor pane
	}

}


class VoidSettingsPane extends EditorPane {
	static readonly ID = 'workbench.test.myCustomPane';

	private _scrollbar: DomScrollableElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(VoidSettingsPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';

		const scrollableContent = document.createElement('div');
		scrollableContent.style.height = '100%';
		scrollableContent.style.width = '100%';

		this._scrollbar = this._register(new DomScrollableElement(scrollableContent, {}));
		parent.appendChild(this._scrollbar.getDomNode());
		this._scrollbar.scanDomNode();

		// Mount React into the scrollable content
		this.instantiationService.invokeFunction(accessor => {
			const disposables: IDisposable[] | undefined = mountVoidSettings(scrollableContent, accessor);

			setTimeout(() => { // this is a complete hack and I don't really understand how scrollbar works here
				this._scrollbar?.scanDomNode();
			}, 1000)
			disposables?.forEach(d => this._register(d));
		});
	}

	layout(dimension: Dimension): void {
		if (!this._scrollbar) return;

		this._scrollbar.getDomNode().style.height = `${dimension.height}px`;
		this._scrollbar.getDomNode().style.width = `${dimension.width}px`;
		this._scrollbar.scanDomNode();

	}


	override get minimumWidth() { return 700 }

}

// register Settings pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(VoidSettingsPane, VoidSettingsPane.ID, nls.localize('VoidSettingsPane', "Void Settings Pane")),
	[new SyncDescriptor(VoidSettingsInput)]
);


export const VOID_OPEN_SETTINGS_ACTION_ID = 'workbench.action.openVoidSettings'
// register the gear on the top right
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_OPEN_SETTINGS_ACTION_ID,
			title: nls.localize2('voidSettings', "Void: Settings"),
			f1: true,
			icon: Codicon.settingsGear,
			menu: [
				{
					id: MenuId.LayoutControlMenuSubmenu,
					group: 'z_end',
				},
				{
					id: MenuId.LayoutControlMenu,
					when: ContextKeyExpr.equals('config.workbench.layoutControl.type', 'both'),
					group: 'z_end'
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);

		const openEditors = editorService.findEditors(VoidSettingsInput.RESOURCE);

		// close all instances if found
		if (openEditors.length > 0) {
			await editorService.closeEditors(openEditors);
			return;
		}

		// else open it
		const input = instantiationService.createInstance(VoidSettingsInput);
		await editorService.openEditor(input);
	}
})


// add to settings gear on bottom left
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '0_command',
	command: {
		id: VOID_OPEN_SETTINGS_ACTION_ID,
		title: nls.localize('voidSettings', "Void Settings")
	},
	order: 1
});
