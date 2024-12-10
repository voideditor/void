/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { FeatureName, featureNames, providerNames } from '../../../../../../../platform/void/common/configTypes.js'
import { useConfigState } from '../util/services.js'




export const SidebarModelSettingsForFeature = ({ featureName }: { featureName: FeatureName }) => {

	const voidConfigState = useConfigState()

	const models: [string, string][] = []
	for (const providerName of providerNames) {
		const providerConfig = voidConfigState[providerName]
		if (providerConfig.enabled !== 'true') continue
		providerConfig.models?.forEach(model => {
			models.push([providerName, model])
		})
	}

	return <>
		<h1>Settings - {featureName}</h1>
		{models.map(([providerName, model], i) => <p key={i}>{providerName} - {model}</p>)}
	</>
}

export const SidebarModelSettings = () => {
	return <>
		{featureNames.map(featureName => <SidebarModelSettingsForFeature key={featureName} featureName={featureName} />)}
	</>
}

