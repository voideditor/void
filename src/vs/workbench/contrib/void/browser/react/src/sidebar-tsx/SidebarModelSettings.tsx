/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react'
import { FeatureName, featureNames, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidConfigTypes.js'
import { useConfigState, useService } from '../util/services.js'
import ErrorBoundary from './ErrorBoundary.js'
import { VoidSelectBox } from './inputs.js'
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js'




export const SidebarModelSettingsForFeature = ({ featureName }: { featureName: FeatureName }) => {

	const voidConfigService = useService('configStateService')
	const voidConfigState = useConfigState()

	const models: [string, string][] = []
	for (const providerName of providerNames) {
		const providerConfig = voidConfigState[providerName]
		if (providerConfig.enabled !== 'true') continue
		providerConfig.models?.forEach(model => {
			models.push([providerName, model])
		})
	}

	const wasEmpty = models.length === 0
	if (wasEmpty) {
		models.push(['Provider', 'Model'])
	}

	const selectBoxRef = useRef<SelectBox | null>(null)

	useEffect(() => {
		// this is really just to sync the state on initial mount, when init value hasn't been set yet
		let synced = false
		const syncStateOnMount = () => {
			if (!selectBoxRef.current) return
			if (synced) return
			synced = true
			const settingsAtProvider = voidConfigService.state.modelSelectionOfFeature[featureName]
			const index = models.findIndex(v => v[0] === settingsAtProvider?.providerName && v[1] === settingsAtProvider?.modelName)
			if (index !== -1)
				selectBoxRef.current.select(index)
		}
		syncStateOnMount()
		synced = false // sync the next time state changes (but not after that - the "current.value = ..." triggers a state change, causing an infinite loop!)
		const disposable = voidConfigService.onDidChangeState(syncStateOnMount)
		return () => disposable.dispose()
	}, [selectBoxRef, voidConfigService, models, featureName])



	return <>
		<h2>{featureName}</h2>
		{
			<VoidSelectBox
				initVal={models[0]}
				options={wasEmpty ? [{ text: 'Please add a Provider!', value: models[0] }] : models.map(s => ({ text: s.join(' - '), value: s }))}
				onChangeSelection={(newVal) => { voidConfigService.setModelSelectionOfFeature(featureName, { providerName: newVal[0] as ProviderName, modelName: newVal[1] }) }}
				selectBoxRef={selectBoxRef}
			/>}

		{/* <h1>Settings - {featureName}</h1> */}
		{/* {models.map(([providerName, model], i) => <p key={i}>{providerName} - {model}</p>)} */}
	</>
}

export const SidebarModelSettings = () => {
	return <>
		{featureNames.map(featureName => <SidebarModelSettingsForFeature key={featureName} featureName={featureName} />)}
	</>
}

