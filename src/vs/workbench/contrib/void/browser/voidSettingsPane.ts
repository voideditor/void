/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

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
import { getReactServices } from './helpers/reactServicesHelper.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';


// refer to preferences.contribution.ts keybindings editor

class VoidSettingsInput extends EditorInput {

	static readonly ID: string = 'workbench.input.void.settings';

	readonly resource = URI.from({
		scheme: 'void-editor-settings',
		path: 'void-settings'  // Give it a unique path
	});

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
		// parent.style.overflow = 'auto'
		parent.style.userSelect = 'text'


		// gets set immediately
		this.instantiationService.invokeFunction(accessor => {
			const services = getReactServices(accessor)
			const disposables: IDisposable[] | undefined = mountVoidSettings(parent, services);
			disposables?.forEach(d => this._register(d))
		})
	}

	layout(dimension: Dimension): void {
		const container = this.getContainer();
		if (!container) return;

		container.style.width = `${dimension.width}px`;
		container.style.height = `${dimension.height}px`;
	}

	override get minimumWidth() { return 512 }

}


// register Settings pane
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(VoidSettingsPane, VoidSettingsPane.ID, nls.localize('VoidSettingsPane', "Void Settings Pane")),
	[new SyncDescriptor(VoidSettingsInput)]
);


const OPEN_VOID_SETTINGS_ID = 'workbench.action.openVoidSettings'
// register the gear on the top right
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OPEN_VOID_SETTINGS_ID,
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
		const input = instantiationService.createInstance(VoidSettingsInput);
		await editorService.openEditor(input);
	}
})


// add to settings gear on bottom left
MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '0_command',
	command: {
		id: OPEN_VOID_SETTINGS_ID,
		title: nls.localize('voidSettings', "Void Settings")
	},
	order: 1
});
