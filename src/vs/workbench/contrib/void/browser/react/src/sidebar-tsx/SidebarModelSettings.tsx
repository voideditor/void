/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { FeatureName, featureNames, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidConfigTypes.js'
import { useConfigState, useService } from '../util/services.js'
import ErrorBoundary from './ErrorBoundary.js'
import { VoidSelectBox } from './inputs.js'




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

	return <>
		<h2>{featureName}</h2>
		{
			<VoidSelectBox
				initVal={models[0]}
				options={wasEmpty ? [{ text: 'Please add a Provider!', value: models[0] }] : models.map(s => ({ text: s.join(' - '), value: s }))}
				onChangeSelection={(newVal) => { voidConfigService.setModelSelectionOfFeature(featureName, { providerName: newVal[0] as ProviderName, modelName: newVal[1] }) }}
				selectBoxRef={{ current: null }}
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

