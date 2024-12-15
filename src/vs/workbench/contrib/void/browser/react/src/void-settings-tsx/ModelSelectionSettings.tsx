/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { FeatureName, featureNames, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidConfigTypes.js'
import { dummyModelData } from '../../../../../../../platform/void/common/voidConfigModelDefaults.js'
import { useConfigState, useRefreshModelState, useService } from '../util/services.js'
import { VoidSelectBox } from '../sidebar-tsx/inputs.js'
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js'


export const ModelSelectionOfFeature = ({ featureName }: { featureName: FeatureName }) => {

	const voidConfigService = useService('configStateService')
	const voidConfigState = useConfigState()

	const modelOptions: { text: string, value: [string, string] }[] = []

	for (const providerName of providerNames) {
		const providerConfig = voidConfigState[providerName]
		if (providerConfig.enabled !== 'true') continue
		providerConfig.models?.forEach(model => {
			modelOptions.push({ text: `${model} (${providerName})`, value: [providerName, model] })
		})
	}


	const isDummy = modelOptions.length === 0
	if (isDummy) {
		for (const [providerName, models] of Object.entries(dummyModelData)) {
			for (let model of models) {
				modelOptions.push({ text: `${model} (${providerName})`, value: ['dummy', 'dummy'] })
			}
		}
	}

	let weChangedText = false

	return <>
		<h2>{featureName}</h2>
		{
			<VoidSelectBox
				options={modelOptions}
				onChangeSelection={useCallback((newVal: [string, string]) => {
					if (isDummy) return // don't set state to the dummy value
					if (weChangedText) return

					voidConfigService.setModelSelectionOfFeature(featureName, { providerName: newVal[0] as ProviderName, modelName: newVal[1] })
				}, [voidConfigService, featureName, isDummy])}
				// we are responsible for setting the initial state here. always sync instance when state changes.
				onCreateInstance={useCallback((instance: SelectBox) => {
					const syncInstance = () => {
						const settingsAtProvider = voidConfigService.state.modelSelectionOfFeature[featureName]
						const index = modelOptions.findIndex(v => v.value[0] === settingsAtProvider?.providerName && v.value[1] === settingsAtProvider?.modelName)
						if (index !== -1) {
							weChangedText = true
							instance.select(index)
							weChangedText = false
						}
					}
					syncInstance()
					const disposable = voidConfigService.onDidChangeState(syncInstance)
					return [disposable]
				}, [voidConfigService, modelOptions, featureName])}
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

