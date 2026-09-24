/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ILanguageFeaturesService } from '../../../../editor/common/language/services/languageFeatures.js';
import { ITextModelService } from '../../../../editor/common/language/services/resolverService.js';
import { Range } from '../../../../editor/common/language/core/range.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CodeActionContext, CodeActionTriggerType } from '../../../../editor/common/language/languages.js';
import * as dom from '../../../../base/browser/dom.js';

export interface IMarkerCheckService {
	readonly _serviceBrand: undefined;
}

export const IMarkerCheckService = createDecorator<IMarkerCheckService>('markerCheckService');

class MarkerCheckService extends Disposable implements IMarkerCheckService {
	_serviceBrand: undefined;

	constructor(
		@IMarkerService private readonly _markerService: IMarkerService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ITextModelService private readonly _textModelService: ITextModelService,
	) {
		super();
		const check = async () => {
			const allMarkers = this._markerService.read();
			const errors = allMarkers.filter(marker => marker.severity === MarkerSeverity.Error);

			if (errors.length === 0) {
				return;
			}

			const errorsByResource = new Map<string, typeof errors>();
			for (const error of errors) {
				const key = error.resource.toString();
				const group = errorsByResource.get(key);
				if (group) {
					group.push(error);
				} else {
					errorsByResource.set(key, [error]);
				}
			}

			for (const resourceErrors of errorsByResource.values()) {
				const resource = resourceErrors[0].resource;
				let modelReference: Awaited<ReturnType<ITextModelService['createModelReference']>> | undefined;

				try {
					modelReference = await this._textModelService.createModelReference(resource);
					const model = modelReference.object.textEditorModel;
					const providers = this._languageFeaturesService.codeActionProvider.ordered(model);
					if (providers.length === 0) continue;

					for (const error of resourceErrors) {
						console.log(`----------------------------------------------`);
						console.log(`${error.resource.fsPath}: ${error.startLineNumber} ${error.message} ${error.severity}`);

						const range = new Range(
							error.startLineNumber,
							error.startColumn,
							error.endLineNumber,
							error.endColumn
						);

						for (const provider of providers) {
							const context: CodeActionContext = {
								trigger: CodeActionTriggerType.Invoke,
								only: 'quickfix'
							};

							const actions = await provider.provideCodeActions(
								model,
								range,
								context,
								CancellationToken.None
							);

							if (!actions?.actions?.length) continue;

							const quickFixes = actions.actions.filter(action => action.isPreferred);
							if (quickFixes.length > 0) {
								console.log('Available Quick Fixes:');
								quickFixes.forEach(action => {
									console.log(`- ${action.title}`);
								});
							}
						}
					}
				} catch (e) {
					console.error('Error getting quick fixes:', e);
				} finally {
					modelReference?.dispose();
				}
			}
		}
		const { window } = dom.getActiveWindow()
		window.setInterval(check, 5000);
	}
}

registerSingleton(IMarkerCheckService, MarkerCheckService, InstantiationType.Eager);
