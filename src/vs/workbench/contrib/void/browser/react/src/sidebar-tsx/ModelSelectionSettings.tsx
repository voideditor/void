/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef } from 'react'
import { FeatureName, featureNames, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidConfigTypes.js'
import { useConfigState, useService } from '../util/services.js'
import ErrorBoundary from './ErrorBoundary.js'
import { VoidSelectBox } from './inputs.js'
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
		modelOptions.push(
			{ text: 'claude 3.5 (anthropic)', value: ['dummy', 'dummy'] as [string, string] },
			{ text: 'gpt 4o (openai)', value: ['dummy', 'dummy'] as [string, string] },
			{ text: 'llama 3.2 (ollama)', value: ['dummy', 'dummy'] as [string, string] },
			{ text: 'qwen 2.5 (openrouter)', value: ['dummy', 'dummy'] as [string, string] },
		)
	}

	return <>
		<h2>{featureName}</h2>
		{
			<VoidSelectBox
				options={modelOptions}
				onChangeSelection={useCallback((newVal: [string, string]) => {
					if (isDummy) return // don't set state to the dummy value
					voidConfigService.setModelSelectionOfFeature(featureName, { providerName: newVal[0] as ProviderName, modelName: newVal[1] })
				}, [voidConfigService, featureName, isDummy])}
				// we are responsible for setting the initial state here
				onCreateInstance={useCallback((instance: SelectBox) => {
					const updateInstance = () => {
						const settingsAtProvider = voidConfigService.state.modelSelectionOfFeature[featureName]
						const index = modelOptions.findIndex(v => v.value[0] === settingsAtProvider?.providerName && v.value[1] === settingsAtProvider?.modelName)
						if (index !== -1)
							instance.select(index)
					}
					updateInstance()
					const disposable = voidConfigService.onDidGetInitState(updateInstance)
					return [disposable]
				}, [voidConfigService, modelOptions, featureName])}
			/>}

		{/* <h1>Settings - {featureName}</h1> */}
		{/* {models.map(([providerName, model], i) => <p key={i}>{providerName} - {model}</p>)} */}
	</>
}

export const ModelSelectionSettings = () => {
	return <>
		{featureNames.map(featureName => <ModelSelectionOfFeature
			key={featureName}
			featureName={featureName}
		/>)}
	</>
}

