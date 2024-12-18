import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import { ProviderName, SettingName, displayInfoOfSettingName, titleOfProviderName, providerNames, ModelInfo } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidInputBox, VoidSelectBox } from '../util/inputs.js'
import { useIsDark, useRefreshModelState, useService, useSettingsState } from '../util/services.js'
import { X } from 'lucide-react'



// models

const RefreshableModels = () => {
	const settingsState = useSettingsState()

	const refreshModelState = useRefreshModelState()
	const refreshModelService = useService('refreshModelService')

	if (!settingsState.settingsOfProvider.ollama.enabled)
		return null

	return <div>
		<button onClick={() => refreshModelService.refreshOllamaModels()}>refresh Ollama built-in models</button>
		{refreshModelState === 'loading' ? 'loading...' : 'good!'}
	</div>
}



const AddModelMenu = ({ onSubmit }: { onSubmit: () => void }) => {
	const settingsStateService = useService('settingsStateService')
	const settingsState = useSettingsState()

	const providerNameRef = useRef<ProviderName | null>(null)
	const modelNameRef = useRef<string | null>(null)

	const [errorString, setErrorString] = useState('')

	const providerOptions = useMemo(() => providerNames.map(providerName => ({ text: titleOfProviderName(providerName), value: providerName })), [providerNames])

	return <>
		<div className='flex justify-center items-center gap-4'>
			{/* model */}
			<div className='max-w-40 w-full'>
				<VoidInputBox
					placeholder='Model Name'
					onChangeText={useCallback((modelName) => { modelNameRef.current = modelName }, [])}
					multiline={false}
				/>
			</div>

			{/* provider */}
			<div className='max-w-40 w-full'>
				<VoidSelectBox
					onCreateInstance={useCallback(() => { providerNameRef.current = providerOptions[0].value }, [providerOptions])} // initialize state
					onChangeSelection={useCallback((providerName: ProviderName) => { providerNameRef.current = providerName }, [])}
					options={providerOptions}
				/>
			</div>

			{/* button */}
			<div className='max-w-40 w-full'>
				<button
					onClick={() => {
						const providerName = providerNameRef.current
						const modelName = modelNameRef.current

						if (providerName === null) {
							setErrorString('Please select a provider.')
							return
						}
						if (!modelName) {
							setErrorString('Please enter a model name.')
							return
						}
						// if model already exists here
						if (settingsState.settingsOfProvider[providerName].models.find(m => m.modelName === modelName)) {
							setErrorString(`This model already exists under ${providerName}.`)
							return
						}

						settingsStateService.addModel(providerName, modelName)
						onSubmit()

					}}>Add model</button>
			</div>
		</div>

		{!errorString ? null : <div className='text-center text-red-500'>
			{errorString}
		</div>}
	</>

}

const AddModelButton = () => {
	const [open, setOpen] = useState(false)

	return <>
		{open ?
			<AddModelMenu onSubmit={() => { setOpen(false) }} />
			: <button onClick={() => setOpen(true)}>Add Model</button>
		}
	</>
}


export const ModelDump = () => {

	const settingsStateService = useService('settingsStateService')
	const settingsState = useSettingsState()

	// a dump of all the enabled providers' models
	const modelDump: (ModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []
	for (let providerName of providerNames) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		// if (!providerSettings.enabled) continue
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: providerSettings.enabled })))
	}

	return <div className=''>
		{modelDump.map(m => {
			const { isHidden, isDefault, modelName, providerName, providerEnabled } = m

			return <div key={`${modelName}${providerName}`} className='flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-200/10 py-1 px-3 rounded-sm overflow-hidden cursor-default'>
				{/* left part is width:full */}
				<div className='w-full flex items-center gap-4'>
					<span>{`${modelName} (${providerName})`}</span>
				</div>
				{/* right part is anything that fits */}
				<div className='w-fit flex items-center gap-4'>
					<span className='opacity-50 whitespace-nowrap'>{isDefault ? '' : '(custom model)'}</span>
					<button disabled={!providerEnabled} onClick={() => { settingsStateService.toggleModelHidden(providerName, modelName) }}>{(!providerEnabled || isHidden) ? '❌' : '✅'}</button>
					<div className='w-5 flex items-center justify-center'>
						{isDefault ? null : <button onClick={() => { settingsStateService.deleteModel(providerName, modelName) }}><X className='size-4' /></button>}
					</div>
				</div>
			</div>
		})}
	</div>
}



// providers

const ProviderSetting = ({ providerName, settingName }: { providerName: ProviderName, settingName: SettingName }) => {

	const { title, placeholder, } = displayInfoOfSettingName(providerName, settingName)
	const voidSettingsService = useService('settingsStateService')


	let weChangedTextRef = false

	return <ErrorBoundary>
		<div className='my-1'>
			<VoidInputBox
				placeholder={`Enter your ${title} here (${placeholder}).`}
				onChangeText={useCallback((newVal) => {
					if (weChangedTextRef) return
					voidSettingsService.setSettingOfProvider(providerName, settingName, newVal)
				}, [voidSettingsService, providerName, settingName])}

				// we are responsible for setting the initial value. always sync the instance whenever there's a change to state.
				onCreateInstance={useCallback((instance: InputBox) => {
					const syncInstance = () => {
						const settingsAtProvider = voidSettingsService.state.settingsOfProvider[providerName];
						const stateVal = settingsAtProvider[settingName as SettingName]
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
		</div>
	</ErrorBoundary>

}

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidSettingsState = useSettingsState()
	const voidSettingsService = useService('settingsStateService')

	const { models, enabled, ...others } = voidSettingsState.settingsOfProvider[providerName]

	return <>

		<div className='flex items-center gap-4'>
			<h3 className='text-xl'>{titleOfProviderName(providerName)}</h3>
			<button onClick={() => { voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabled) }}>{enabled ? '✅' : '❌'}</button>
		</div>
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

	const [tab, setTab] = useState<'models' | 'features'>('models')

	return <div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
		<div className='w-full h-full px-10 py-10 select-none'>

			<div className='max-w-5xl mx-auto'>

				<h1 className='text-2xl w-full'>Void Settings</h1>

				{/* separator */}
				<div className='w-full h-[1px] my-4' />

				<div className='flex items-stretch'>

					{/* tabs */}
					<div className='flex flex-col w-full max-w-32'>
						<button className={`text-left p-1 my-0.5 rounded-sm overflow-hidden ${tab === 'models' ? 'bg-vscode-button-hover-bg' : 'bg-vscode-button-active-bg'} hover:bg-vscode-button-hover-bg active:bg-vscode-button-active-bg`}
							onClick={() => { setTab('models') }}
						>Models</button>
						<button className={`text-left p-1 my-0.5 rounded-sm overflow-hidden ${tab === 'features' ? 'bg-vscode-button-hover-bg' : 'bg-vscode-button-active-bg'} hover:bg-vscode-button-hover-bg active:bg-vscode-button-active-bg`}
							onClick={() => { setTab('features') }}
						>Features</button>
					</div>

					{/* separator */}
					<div className='w-[1px] mx-4' />


					{/* content */}
					<div className='w-full overflow-y-auto'>

						<div className={`${tab !== 'models' ? 'hidden' : ''}`}>
							<h2 className={`text-3xl mb-2`}>Models</h2>
							<ErrorBoundary>
								<ModelDump />
								<AddModelButton />
								<RefreshableModels />
							</ErrorBoundary>
							<h2 className={`text-3xl mt-4 mb-2`}>Providers</h2>
							<ErrorBoundary>
								<VoidProviderSettings />
							</ErrorBoundary>
						</div>

						<div className={`${tab !== 'features' ? 'hidden' : ''}`}>
							<h2 className={`text-3xl mb-2`} onClick={() => { setTab('features') }}>Features</h2>
						</div>

					</div>
				</div>

			</div>
		</div>

	</div>
}
