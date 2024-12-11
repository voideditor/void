/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { FeatureName, featureNames, providerNames } from '../../../../../../../platform/void/common/voidConfigTypes.js'
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

	return <><ErrorBoundary>
		<h2>{'Models'}</h2>
		{models.length === 0 ?
			<p>{'Please add a provider!'}</p>
			:
			<VoidSelectBox
				initVal={models[0].join(' - ')}
				options={models.map(s => s.join(' - '))}
				onChangeSelection={(newVal) => { /*voidConfigService.setFeatureState(providerName, 'model', newVal)*/ }}
				selectBoxRef={{ current: null }}
			/>}

		{/* <h1>Settings - {featureName}</h1> */}
		{/* {models.map(([providerName, model], i) => <p key={i}>{providerName} - {model}</p>)} */}
	</ErrorBoundary></>
}

export const SidebarModelSettings = () => {
	return <>
		{featureNames.map(featureName => <SidebarModelSettingsForFeature key={featureName} featureName={featureName} />)}
	</>
}

