/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidModelInfo, featureFlagNames, displayInfoOfFeatureFlag, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, defaultProviderSettings, nonlocalProviderNames, localProviderNames } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidCheckBox, VoidInputBox, _VoidSelectBox, VoidSwitch, VoidCustomSelectBox } from '../util/inputs.js'
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, MoveRight } from 'lucide-react'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { useScrollbarStyles } from '../util/useScrollbarStyles.js'

const SubtleButton = ({ onClick, text, icon, disabled }: { onClick: () => void, text: string, icon: React.ReactNode, disabled: boolean }) => {

	return <div className='flex items-center text-void-fg-3 mb-1 px-3 rounded-sm overflow-hidden gap-2 hover:bg-black/10 dark:hover:bg-gray-300/10'>
		<button className='flex items-center' disabled={disabled} onClick={onClick}>
			{icon}
		</button>
		<span>
			{text}
		</span>
	</div>
}

// models
const RefreshModelButton = ({ providerName }: { providerName: RefreshableProviderName }) => {

	const refreshModelState = useRefreshModelState()

	const accessor = useAccessor()
	const refreshModelService = accessor.get('IRefreshModelService')

	const [justFinished, setJustFinished] = useState(false)

	useRefreshModelListener(
		useCallback((providerName2, refreshModelState) => {
			if (providerName2 !== providerName) return
			const { state } = refreshModelState[providerName]
			if (state !== 'finished') return
			// now we know we just entered 'finished' state for this providerName
			setJustFinished(true)
			const tid = setTimeout(() => { setJustFinished(false) }, 2000)
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

	// const providerNameRef = useRef<ProviderName | null>(null)
	const [providerName, setProviderName] = useState<ProviderName | null>(null)

	const modelNameRef = useRef<string | null>(null)

	const [errorString, setErrorString] = useState('')


	return <>
		<div className='flex items-center gap-4'>

			{/* provider */}
			<VoidCustomSelectBox
				options={providerNames}
				selectedOption={providerName}
				onChangeOption={(pn) => setProviderName(pn)}
				getOptionName={(pn) => pn ? displayInfoOfProviderName(pn).title : '(null)'}
				getOptionsEqual={(a, b) => a === b}
				className={`max-w-40 w-full border border-void-border-2 bg-void-bg-1 text-void-fg-3 text-root
					py-[4px] px-[6px]
				`}
				arrowTouchesText={false}
			/>
			{/* <_VoidSelectBox
					onCreateInstance={useCallback(() => { providerNameRef.current = providerOptions[0].value }, [providerOptions])} // initialize state
					onChangeSelection={useCallback((providerName: ProviderName) => { providerNameRef.current = providerName }, [])}
					options={providerOptions}
				/> */}

			{/* model */}
			<div className='max-w-40 w-full border border-void-border-2 bg-void-bg-1 text-void-fg-3 text-root'>
				<VoidInputBox
					placeholder='Model Name'
					onChangeText={useCallback((modelName) => { modelNameRef.current = modelName }, [])}
					multiline={false}
				/>
			</div>

			{/* button */}
			<div className='max-w-40'>
				<button
					className='px-3 py-1 bg-black/10 dark:bg-gray-200/10 rounded-sm overflow-hidden'
					onClick={() => {
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

	return <div className='hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 my-4 pb-1 px-3 rounded-sm overflow-hidden '>
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
		{modelDump.map((m, i) => {
			const { isHidden, isDefault, isAutodetected, modelName, providerName, providerEnabled } = m

			const isNewProviderName = (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName

			const disabled = !providerEnabled

			return <div key={`${modelName}${providerName}`}
				className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate
				`}
			>
				{/* left part is width:full */}
				<div className={`w-full flex items-center gap-4`}>
					<span className='min-w-20'>{isNewProviderName ? displayInfoOfProviderName(providerName).title : ''}</span>
					<span>{modelName}</span>
					{/* <span>{`${modelName} (${providerName})`}</span> */}
				</div>
				{/* right part is anything that fits */}
				<div className='w-fit flex items-center gap-4'>
					<span className='opacity-50'>{isAutodetected ? '(detected locally)' : isDefault ? '' : '(custom model)'}</span>

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


	// const { title: providerTitle, } = displayInfoOfProviderName(providerName)

	const { title: settingTitle, placeholder, subTextMd } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	let weChangedTextRef = false

	return <ErrorBoundary>
		<div className='my-1'>
			<VoidInputBox
				// placeholder={`${providerTitle} ${settingTitle} (${placeholder})`}
				placeholder={`${settingTitle} (${placeholder})`}
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
			{subTextMd === undefined ? null : <div className='py-1 px-3 opacity-50 text-sm'>
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


export const VoidProviderSettings = ({ providerNames }: { providerNames: ProviderName[] }) => {
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
type TabName = 'models' | 'general'
export const VoidFeatureFlagSettings = () => {

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const voidSettingsState = useSettingsState()

	return featureFlagNames.map((flagName) => {

		// right now this is just `enabled_autoRefreshModels`
		const enabled = voidSettingsState.featureFlagSettings[flagName]
		const { description } = displayInfoOfFeatureFlag(flagName)

		return <SubtleButton key={flagName}
			onClick={() => { voidSettingsService.setFeatureFlag(flagName, !enabled) }}
			text={description}
			icon={enabled ? <Check className='stroke-green-500 size-3' /> : <X className='stroke-red-500 size-3' />}
			disabled={false}
		/>
	})
}


export const FeaturesTab = () => {
	return <>
		<h2 className={`text-3xl mb-2`}>Local Providers</h2>
		{/* <h3 className={`opacity-50 mb-2`}>{`Keep your data private by hosting AI locally on your computer.`}</h3> */}
		{/* <h3 className={`opacity-50 mb-2`}>{`Instructions:`}</h3> */}
		{/* <h3 className={`mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3> */}
		<h3 className={`text-void-fg-3 mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3>
		<div className='pl-4 select-text opacity-50'>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`1. Download [Ollama](https://ollama.com/download).`} /></span>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`2. Open your terminal.`} /></span>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`3. Run \`ollama run llama3.1\`. This installs Meta's llama3.1 model which is best for chat and inline edits. Requires 5GB of memory.`} /></span>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`4. Run \`ollama run qwen2.5-coder:1.5b\`. This installs a faster autocomplete model. Requires 1GB of memory.`} /></span>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`Void automatically detects locally running models and enables them.`} /></span>
			{/* TODO we should create UI for downloading models without user going into terminal */}
		</div>

		<ErrorBoundary>
			<VoidProviderSettings providerNames={localProviderNames} />
		</ErrorBoundary>

		<h2 className={`text-3xl mb-2 mt-16`}>Providers</h2>
		<h3 className={`text-void-fg-3 mb-2`}>{`Void can access models from Anthropic, OpenAI, OpenRouter, and more.`}</h3>
		{/* <h3 className={`opacity-50 mb-2`}>{`Access models like ChatGPT and Claude. We recommend using Anthropic or OpenAI as providers, or Groq as a faster alternative.`}</h3> */}
		<ErrorBoundary>
			<VoidProviderSettings providerNames={nonlocalProviderNames} />
		</ErrorBoundary>

		<h2 className={`text-3xl mb-2 mt-16`}>Models</h2>
		<ErrorBoundary>
			<VoidFeatureFlagSettings />
			<RefreshableModels />
			<ModelDump />
			<AddModelMenuFull />
		</ErrorBoundary>
	</>
}






const OneClickSwitch = () => {

}


const GeneralTab = () => {
	return <>
		{/* <VoidFeatureFlagSettings /> */}

		{/* keyboard shortcuts */}

		<h2 className={`text-3xl mb-2`}>General Settings</h2>
		<h3 className={`text-void-fg-3 mb-2`}>{`VS Code's built-in settings.`}</h3>

		<h2 className={`text-3xl mb-2`}>Keyboard Settings</h2>
		<h3 className={`text-void-fg-3 mb-2`}>{`Void can access models from Anthropic, OpenAI, OpenRouter, and more.`}</h3>


		<h2 className={`text-3xl mb-2`}>One-click Switch</h2>

		Transfer your VS Code settings to Void.

		<h2 className={`text-3xl mb-2`}>Theme</h2>


		<h2 className={`text-3xl mb-2`}>Rules for AI</h2>
		{/* placeholder: "Do not add ;'s. Do not change or delete spacing, formatting, or comments. Respond to queries in French when applicable. " */}

	</>
}

// full settings

export const Settings = () => {
	const isDark = useIsDark()

	const [tab, setTab] = useState<TabName>('models')

	const containerRef = useRef<HTMLDivElement | null>(null)
	useScrollbarStyles(containerRef)

	return <div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%' }}>
		<div ref={containerRef} className='overflow-y-auto w-full h-full px-10 py-10 select-none'>

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
						<button className={`text-left p-1 px-3 my-0.5 rounded-sm overflow-hidden ${tab === 'general' ? 'bg-black/10 dark:bg-gray-200/10' : ''} hover:bg-black/10 hover:dark:bg-gray-200/10 active:bg-black/10 active:dark:bg-gray-200/10 `}
							onClick={() => { setTab('general') }}
						>General</button>
					</div>

					{/* separator */}
					<div className='w-[1px] mx-4' />


					{/* content */}
					<div className='w-full overflow-y-auto'>

						<div className={`${tab !== 'models' ? 'hidden' : ''}`}>
							<FeaturesTab />
						</div>

						<div className={`${tab !== 'general' ? 'hidden' : ''}`}>
							<GeneralTab />
						</div>

					</div>
				</div>

			</div>
		</div>

	</div>
}
