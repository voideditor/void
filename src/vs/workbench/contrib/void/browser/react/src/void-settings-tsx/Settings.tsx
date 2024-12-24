import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidModelInfo, featureFlagNames, displayInfoOfFeatureFlag, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, defaultProviderSettings } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidCheckBox, VoidInputBox, VoidSelectBox, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check } from 'lucide-react'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'

const SubtleButton = ({ onClick, text, icon, disabled }: { onClick: () => void, text: string, icon: React.ReactNode, disabled: boolean }) => {

	return <div className='flex items-center px-3 rounded-sm overflow-hidden gap-2 hover:bg-black/10 dark:hover:bg-gray-200/10'>
		<button className='flex items-center' disabled={disabled} onClick={onClick}>
			{icon}
		</button>
		<span className='opacity-50'>
			{text}
		</span>
	</div>
}

// models
const RefreshModelButton = ({ providerName }: { providerName: RefreshableProviderName }) => {
	const refreshModelState = useRefreshModelState()

	const accessor = useAccessor()
	const refreshModelService = accessor.get('IRefreshModelService')

	const [justFinished, setJustSucceeded] = useState(false)

	useRefreshModelListener(
		useCallback((providerName2, refreshModelState) => {
			if (providerName2 !== providerName) return
			const { state } = refreshModelState[providerName]
			if (state !== 'success') return
			// now we know we just entered 'success' state for this providerName
			setJustSucceeded(true)
			const tid = setTimeout(() => { setJustSucceeded(false) }, 2000)
			return () => clearTimeout(tid)
		}, [providerName])
	)

	const { state } = refreshModelState[providerName]
	const isRefreshing = state === 'refreshing'

	const { title: providerTitle } = displayInfoOfProviderName(providerName)
	return <SubtleButton
		onClick={() => { refreshModelService.refreshModels(providerName) }}
		text={justFinished ? `${providerTitle} Models are up-to-date!` : `Refresh Models List for ${providerTitle}.`}
		icon={isRefreshing ? <Loader2 className='size-3 animate-spin' /> : (justFinished ? <Check className='stroke-green-500 size-3' /> : <RefreshCw className='size-3' />)}
		disabled={isRefreshing || justFinished}
	/>
}

const RefreshableModels = () => {
	const settingsState = useSettingsState()


	const buttons = refreshableProviderNames.map(providerName => {
		if (!settingsState.settingsOfProvider[providerName]._enabled) return null
		return <div key={providerName} className='pb-4' >
			<RefreshModelButton providerName={providerName} />
		</div>
	})

	return <>
		{buttons}
	</>

}



const AddModelMenu = ({ onSubmit }: { onSubmit: () => void }) => {

	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')

	const settingsState = useSettingsState()

	const providerNameRef = useRef<ProviderName | null>(null)
	const modelNameRef = useRef<string | null>(null)

	const [errorString, setErrorString] = useState('')


	const providerOptions = useMemo(() => providerNames.map(providerName => ({ text: displayInfoOfProviderName(providerName).title, value: providerName })), [providerNames])

	return <>
		<div className='flex items-center gap-4'>
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
			<div className='max-w-40'>
				<button
					className='px-3 py-1 bg-black/10 dark:bg-gray-200/10 rounded-sm overflow-hidden'
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

			{!errorString ? null : <div className='text-red-500 truncate whitespace-nowrap'>
				{errorString}
			</div>}


		</div>

	</>

}

const AddModelMenuFull = () => {
	const [open, setOpen] = useState(false)

	return <div className='hover:bg-black/10 dark:hover:bg-gray-200/10 py-1 px-3 rounded-sm overflow-hidden '>
		{open ?
			<AddModelMenu onSubmit={() => { setOpen(false) }} />
			: <button
				className='px-3 py-1 bg-black/10 dark:bg-gray-200/10 rounded-sm overflow-hidden'
				onClick={() => setOpen(true)}
			>Add Model</button>
		}
	</div>
}


export const ModelDump = () => {

	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')

	const settingsState = useSettingsState()

	// a dump of all the enabled providers' models
	const modelDump: (VoidModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []
	for (let providerName of providerNames) {
		const providerSettings = settingsState.settingsOfProvider[providerName]
		// if (!providerSettings.enabled) continue
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: !!providerSettings._enabled })))
	}

	// sort by hidden
	modelDump.sort((a, b) => {
		return Number(b.providerEnabled) - Number(a.providerEnabled)
	})

	return <div className=''>
		{modelDump.map(m => {
			const { isHidden, isDefault, modelName, providerName, providerEnabled } = m

			const disabled = !providerEnabled

			return <div key={`${modelName}${providerName}`} className='flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-200/10 py-1 px-3 rounded-sm overflow-hidden cursor-default'>
				{/* left part is width:full */}
				<div className={`w-full flex items-center gap-4`}>
					<span>{`${modelName} (${providerName})`}</span>
				</div>
				{/* right part is anything that fits */}
				<div className='w-fit flex items-center gap-4'>
					<span className='opacity-50 whitespace-nowrap'>{isDefault ? '' : '(custom model)'}</span>

					<VoidSwitch
						value={disabled ? false : !isHidden}
						onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName) }}
						disabled={disabled}
						size='sm'
					/>

					<div className={`w-5 flex items-center justify-center`}>
						{isDefault ? null : <button onClick={() => { settingsStateService.deleteModel(providerName, modelName) }}><X className='size-4' /></button>}
					</div>
				</div>
			</div>
		})}
	</div>
}



// providers

const ProviderSetting = ({ providerName, settingName }: { providerName: ProviderName, settingName: SettingName }) => {


	const { title: providerTitle, } = displayInfoOfProviderName(providerName)

	const { title: settingTitle, placeholder, subTextMd } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	let weChangedTextRef = false

	return <ErrorBoundary>
		<div className='my-1'>
			<VoidInputBox
				placeholder={`${providerTitle} ${settingTitle} (${placeholder}).`}
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

						const isEverySettingPresent = Object.keys(defaultProviderSettings[providerName]).every(key => {
							return !!settingsAtProvider[key as keyof typeof settingsAtProvider]
						})

						const shouldEnable = isEverySettingPresent && !settingsAtProvider._enabled // enable if all settings are present and not already enabled
						const shouldDisable = !isEverySettingPresent && settingsAtProvider._enabled

						if (shouldEnable) {
							voidSettingsService.setSettingOfProvider(providerName, '_enabled', true)
						}

						if (shouldDisable) {
							voidSettingsService.setSettingOfProvider(providerName, '_enabled', false)
						}

					}
					syncInstance()
					const disposable = voidSettingsService.onDidChangeState(syncInstance)
					return [disposable]
				}, [voidSettingsService, providerName, settingName])}
				multiline={false}
			/>
			{subTextMd === undefined ? null : <div className='py-1 px-3 opacity-50 text-xs'>
				<ChatMarkdownRender string={subTextMd} />
			</div>}

		</div>
	</ErrorBoundary>
}

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	// const voidSettingsState = useSettingsState()
	// const accessor = useAccessor()
	// const voidSettingsService = accessor.get('IVoidSettingsService')

	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
	const settingNames = customSettingNamesOfProvider(providerName)

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <div className='my-4'>

		<div className='flex items-center w-full gap-4'>
			<h3 className='text-xl truncate'>{providerTitle}</h3>

			{/* enable provider switch */}
			{/* <VoidSwitch
				value={!!enabled}
				onChange={
					useCallback(() => {
						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
					}, [voidSettingsService, providerName])}
				size='sm+'
			/> */}
		</div>

		<div className='px-0'>
			{/* settings besides models (e.g. api key) */}
			{settingNames.map((settingName, i) => {
				return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
			})}
		</div>
	</div >
}


export const VoidProviderSettings = () => {
	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} />
		)}
	</>
}

// export const VoidFeatureFlagSettings = () => {
// 	const accessor = useAccessor()
// 	const voidSettingsService = accessor.get('IVoidSettingsService')

// 	const voidSettingsState = useSettingsState()

// 	return <>
// 		{featureFlagNames.map((flagName) => {
// 			const value = voidSettingsState.featureFlagSettings[flagName]
// 			const { description } = displayInfoOfFeatureFlag(flagName)
// 			return <div key={flagName} className='hover:bg-black/10 hover:dark:bg-gray-200/10 rounded-sm overflow-hidden py-1 px-3 my-1'>
// 				<div className='flex items-center'>
// 					<VoidCheckBox
// 						label=''
// 						value={value}
// 						onClick={() => { voidSettingsService.setFeatureFlag(flagName, !value) }}
// 					/>
// 					<h4 className='text-sm'>{description}</h4>
// 				</div>
// 			</div>
// 		})}
// 	</>
// }
export const VoidFeatureFlagSettings = () => {

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const voidSettingsState = useSettingsState()

	return featureFlagNames.map((flagName) => {

		const enabled = voidSettingsState.featureFlagSettings[flagName]
		const { description } = displayInfoOfFeatureFlag(flagName)

		return <SubtleButton
			onClick={() => { voidSettingsService.setFeatureFlag(flagName, !enabled) }}
			text={description}
			icon={enabled ? <Check className='stroke-green-500 size-3' /> : <X className='stroke-red-500 size-3' />}
			disabled={false}
		/>
	})
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
						<button className={`text-left p-1 px-3 my-0.5 rounded-sm overflow-hidden ${tab === 'models' ? 'bg-black/10 dark:bg-gray-200/10' : ''} hover:bg-black/10 hover:dark:bg-gray-200/10 active:bg-black/10 active:dark:bg-gray-200/10 `}
							onClick={() => { setTab('models') }}
						>Models</button>
						<button className={`text-left p-1 px-3 my-0.5 rounded-sm overflow-hidden ${tab === 'features' ? 'bg-black/10 dark:bg-gray-200/10' : ''} hover:bg-black/10 hover:dark:bg-gray-200/10 active:bg-black/10 active:dark:bg-gray-200/10 `}
							onClick={() => { setTab('features') }}
						>Features</button>
					</div>

					{/* separator */}
					<div className='w-[1px] mx-4' />


					{/* content */}
					<div className='w-full overflow-y-auto'>

						<div className={`${tab !== 'models' ? 'hidden' : ''}`}>
							<h2 className={`text-3xl mb-2`}>Providers</h2>
							<ErrorBoundary>
								<VoidProviderSettings />
							</ErrorBoundary>

							<h2 className={`text-3xl mb-2 mt-4`}>Models</h2>
							<ErrorBoundary>
								<VoidFeatureFlagSettings />
								<RefreshableModels />
								<ModelDump />
								<AddModelMenuFull />
							</ErrorBoundary>
						</div>

						<div className={`${tab !== 'features' ? 'hidden' : ''}`}>
							<h2 className={`text-3xl mb-2`} onClick={() => { setTab('features') }}>Features</h2>
							{/* <VoidFeatureFlagSettings /> */}
						</div>

					</div>
				</div>

			</div>
		</div>

	</div>
}
