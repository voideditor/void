/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { FeatureName, featureNames, ModelSelection, modelSelectionsEqual, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { useSettingsState, useRefreshModelState, useService } from '../util/services.js'
import { VoidSelectBox } from '../sidebar-tsx/inputs.js'
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js'


export const ModelSelectionOfFeature = ({ featureName }: { featureName: FeatureName }) => {

	const voidSettingsService = useService('settingsStateService')
	const settingsState = useSettingsState()

	let weChangedText = false
	return <>
		{settingsState._modelsList.length === 0 ?

			'Please add a provider!'
			: <VoidSelectBox
				options={settingsState._modelsList}
				onChangeSelection={useCallback((newVal: ModelSelection) => {
					if (weChangedText) return
					voidSettingsService.setModelSelectionOfFeature(featureName, newVal)
				}, [voidSettingsService, featureName])}
				// we are responsible for setting the initial state here. always sync instance when state changes.
				onCreateInstance={useCallback((instance: SelectBox) => {
					const syncInstance = () => {
						const modelsListRef = voidSettingsService.state._modelsList // as a ref
						const settingsAtProvider = voidSettingsService.state.modelSelectionOfFeature[featureName]
						const selectionIdx = settingsAtProvider === null ? -1 : modelsListRef.findIndex(v => modelSelectionsEqual(v.value, settingsAtProvider))
						weChangedText = true
						instance.select(selectionIdx === -1 ? 0 : selectionIdx)
						weChangedText = false
					}
					syncInstance()
					const disposable = voidSettingsService.onDidChangeState(syncInstance)
					return [disposable]
				}, [voidSettingsService, featureName])}
			/>}
	</>
}

const RefreshModels = () => {
	const refreshModelState = useRefreshModelState()
	const refreshModelService = useService('refreshModelService')

	return <>
		<button onClick={() => refreshModelService.refreshOllamaModels()}>
			refresh
		</button>
		{refreshModelState === 'loading' ? 'loading...' : '✅'}
	</>
}

export const ModelSelectionSettings = () => {
	return <>
		{featureNames.map(featureName => <ModelSelectionOfFeature
			key={featureName}
			featureName={featureName}
		/>)}

		<RefreshModels />
	</>
}

