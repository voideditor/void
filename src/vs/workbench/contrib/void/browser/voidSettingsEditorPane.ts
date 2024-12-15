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
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';


import { mountVoidSettings } from './react/out/void-settings-tsx/index.js'
import { getReactServices } from './reactServices.js';


// refer to preferences.contribution.ts keybindings editor

export class VoidEditorInput extends EditorInput {

	static readonly ID: string = 'workbench.input.void.settings';

	readonly resource = URI.from({
		scheme: 'void-editor-settings',
		path: 'void-settings'  // Give it a unique path
	});

	constructor() {
		super();
	}

	override get typeId(): string {
		return VoidEditorInput.ID;
	}

	override getName(): string {
		return nls.localize('voidSettingsInputsName', "Void Settings");
	}

}


class MyCustomPane extends EditorPane {
	static readonly ID = 'workbench.test.myCustomPane';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(MyCustomPane.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(container: HTMLElement): void {

		this.instantiationService.invokeFunction(accessor => {
			const services = getReactServices(accessor)
			mountVoidSettings(container, services);
		})
	}

	layout(dimension: Dimension): void {
		const container = this.getContainer();
		if (!container) return;

		container.style.width = `${dimension.width}px`;
		container.style.height = `${dimension.height}px`;
	}
}



Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(MyCustomPane, MyCustomPane.ID, nls.localize('MyCustomPane', "CustomPane")),
	[new SyncDescriptor(VoidEditorInput)]
);


// Register the action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.openVoidEditor',
			title: 'Open Void Settings',
			keybinding: {
				when: ContextKeyExpr.true(),
				primary: KeyMod.CtrlCmd | KeyCode.KeyE,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const input = instantiationService.createInstance(VoidEditorInput);
		await editorService.openEditor(input);
	}
});

