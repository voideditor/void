/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CodeActionContext, CodeActionTriggerType } from '../../../../editor/common/languages.js';
import { URI } from '../../../../base/common/uri.js';
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

			if (errors.length > 0) {
				for (const error of errors) {

					console.log(`----------------------------------------------`);

					console.log(`${error.resource.fsPath}: ${error.startLineNumber} ${error.message} ${error.severity}`); // ! all errors in the file

					try {
						// Get the text model for the file
						const modelReference = await this._textModelService.createModelReference(error.resource);
						const model = modelReference.object.textEditorModel;

						// Create a range from the marker
						const range = new Range(
							error.startLineNumber,
							error.startColumn,
							error.endLineNumber,
							error.endColumn
						);

						// Get code action providers for this model
						const codeActionProvider = this._languageFeaturesService.codeActionProvider;
						const providers = codeActionProvider.ordered(model);

						if (providers.length > 0) {
							// Request code actions from each provider
							for (const provider of providers) {
								const context: CodeActionContext = {
									trigger: CodeActionTriggerType.Invoke, // keeping 'trigger' since it works
									only: 'quickfix'  // adding this to filter for quick fixes
								};

								const actions = await provider.provideCodeActions(
									model,
									range,
									context,
									CancellationToken.None
								);

								if (actions?.actions?.length) {

									const quickFixes = actions.actions.filter(action => action.isPreferred);  // ! all quickFixes for the error
									// const quickFixesForImports = actions.actions.filter(action => action.isPreferred && action.title.includes('import'));  // ! all possible imports
									// quickFixesForImports

									if (quickFixes.length > 0) {
										console.log('Available Quick Fixes:');
										quickFixes.forEach(action => {
											console.log(`- ${action.title}`);
										});
									}
								}
							}
						}

						// Dispose the model reference
						modelReference.dispose();
					} catch (e) {
						console.error('Error getting quick fixes:', e);
					}
				}
			}
		}
		const { window } = dom.getActiveWindow()
		window.setInterval(check, 5000);
	}




	fixErrorsInFiles(uris: URI[], contextSoFar: []) {
		// const allMarkers = this._markerService.read();


		// check errors in files


		// give LLM errors in files



	}

	// private _onMarkersChanged = (changedResources: readonly URI[]): void => {
	// 	for (const resource of changedResources) {
	// 		const markers = this._markerService.read({ resource });

	// 		if (markers.length === 0) {
	// 			console.log(`${resource.fsPath}: No diagnostics`);
	// 			continue;
	// 		}

	// 		console.log(`Diagnostics for ${resource.fsPath}:`);
	// 		markers.forEach(marker => this._logMarker(marker));
	// 	}
	// };


}

registerSingleton(IMarkerCheckService, MarkerCheckService, InstantiationType.Eager);
