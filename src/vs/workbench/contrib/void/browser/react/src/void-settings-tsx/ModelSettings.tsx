/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { ModelInfo, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { useRefreshModelState, useService, useSettingsState } from '../util/services.js'






const Refreshables = () => {
	const settingsState = useSettingsState()

	const refreshModelState = useRefreshModelState()
	const refreshModelService = useService('refreshModelService')

	if (settingsState.settingsOfProvider.ollama.enabled !== 'true')
		return null

	return <>
		<button onClick={() => refreshModelService.refreshOllamaModels()}>refresh Ollama built-in models</button>
		{refreshModelState === 'loading' ? 'loading...' : 'good!'}
	</>
}




export const ModelMenu = () => {

	const settingsStateService = useService('settingsStateService')
	const settingsState = useSettingsState()

	// a dump of all the enabled providers' models
	const models: (ModelInfo & { providerName: ProviderName })[] = []
	for (let providerName of providerNames) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		if (providerSettings.enabled !== 'true') continue
		models.push(...providerSettings.models.map(model => ({ ...model, providerName })))
	}

	return <>
		{models.map(m => {
			const { isHidden, isDefault, modelName, providerName } = m

			return <div key={`${modelName}${providerName}`} className='flex items-center justify-between gap-4'>
				<span>{modelName} {isDefault ? '' : '(custom)'}</span>
				<span>{providerName}</span>
				<span onClick={() => { settingsStateService.toggleModelHidden(providerName, modelName) }}>{isHidden ? 'hidden' : '✅'}</span>
			</div>
		})}

		<Refreshables />
	</>
}
