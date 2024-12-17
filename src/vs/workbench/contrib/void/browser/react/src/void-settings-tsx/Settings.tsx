import React, { useCallback } from 'react'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import { ProviderName, SettingName, displayInfoOfSettingName, titleOfProviderName, providerNames, ModelInfo } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidInputBox } from '../util/inputs.js'
import { useIsDark, useRefreshModelState, useService, useSettingsState } from '../util/services.js'



// models

const RefreshableModels = () => {
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
	const modelDump: (ModelInfo & { providerName: ProviderName })[] = []
	for (let providerName of providerNames) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		if (providerSettings.enabled !== 'true') continue
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName })))
	}

	return <>
		{modelDump.map(m => {
			const { isHidden, isDefault, modelName, providerName } = m

			return <div key={`${modelName}${providerName}`} className='flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-white/10'>
				<span>{modelName} {isDefault ? '' : '(custom)'}</span>
				<span>{providerName}</span>
				<span onClick={() => { settingsStateService.toggleModelHidden(providerName, modelName) }}>{isHidden ? 'hidden' : '✅'}</span>
			</div>
		})}
	</>
}



// providers

const ProviderSetting = ({ providerName, settingName }: { providerName: ProviderName, settingName: SettingName }) => {

	const { title, placeholder } = displayInfoOfSettingName(providerName, settingName)
	const voidSettingsService = useService('settingsStateService')


	let weChangedTextRef = false

	return <><ErrorBoundary>
		<label>{title}</label>
		<VoidInputBox
			placeholder={placeholder}
			onChangeText={useCallback((newVal) => {
				if (weChangedTextRef) return
				voidSettingsService.setSettingOfProvider(providerName, settingName, newVal)
			}, [voidSettingsService, providerName, settingName])}

			// we are responsible for setting the initial value. always sync the instance whenever there's a change to state.
			onCreateInstance={useCallback((instance: InputBox) => {
				const syncInstance = () => {
					const settingsAtProvider = voidSettingsService.state.settingsOfProvider[providerName];
					const stateVal = settingsAtProvider[settingName as keyof typeof settingsAtProvider]
					// console.log('SYNCING TO', providerName, settingName, stateVal)
					weChangedTextRef = true
					instance.value = stateVal as string
					weChangedTextRef = false
				}
				syncInstance()
				const disposable = voidSettingsService.onDidChangeState(syncInstance)
				return [disposable]
			}, [voidSettingsService, providerName, settingName])}
			multiline={false}
		/>
	</ErrorBoundary></>

}

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidSettingsState = useSettingsState()
	const { models, ...others } = voidSettingsState.settingsOfProvider[providerName]

	return <>
		<h1 className='text-xl'>{titleOfProviderName(providerName)}</h1>
		{/* settings besides models (e.g. api key) */}
		{Object.keys(others).map((sName, i) => {
			const settingName = sName as keyof typeof others
			return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
		})}
	</>
}


export const VoidProviderSettings = () => {
	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} />
		)}
	</>
}



// full settings

export const Settings = () => {
	const isDark = useIsDark()
	return <div className={`@@void-scope ${isDark ? 'dark' : ''} px-2 lg:px-10`}>
		<div className='w-full h-full'>

			<div className='max-w-3xl mx-auto'>
				<ErrorBoundary>
					<ModelMenu />
					<RefreshableModels />
				</ErrorBoundary>
			</div>

			<ErrorBoundary>
				<VoidProviderSettings />
			</ErrorBoundary>
		</div>

	</div>
}
