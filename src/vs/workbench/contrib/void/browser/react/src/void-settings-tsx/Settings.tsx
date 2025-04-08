/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidModelInfo, globalSettingNames, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, defaultProviderSettings, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName } from '../../../../common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidButton, VoidCheckBox, VoidCustomDropdownBox, VoidInputBox, VoidInputBox2, VoidSimpleInputBox, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, MoveRight } from 'lucide-react'
import { useScrollbarStyles } from '../util/useScrollbarStyles.js'
import { isWindows, isLinux, isMacintosh } from '../../../../../../../base/common/platform.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { env } from '../../../../../../../base/common/process.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconX } from '../sidebar-tsx/SidebarChat.js'

const ButtonLeftTextRightOption = ({ text, leftButton }: { text: string, leftButton?: React.ReactNode }) => {

	return <div className='flex items-center text-void-fg-3 px-3 py-0.5 rounded-sm overflow-hidden gap-2 hover:bg-black/10 dark:hover:bg-gray-300/10'>
		{leftButton ? leftButton : null}
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
	const metricsService = accessor.get('IMetricsService')

	const [justFinished, setJustFinished] = useState<null | 'finished' | 'error'>(null)

	useRefreshModelListener(
		useCallback((providerName2, refreshModelState) => {
			if (providerName2 !== providerName) return
			const { state } = refreshModelState[providerName]
			if (!(state === 'finished' || state === 'error')) return
			// now we know we just entered 'finished' state for this providerName
			setJustFinished(state)
			const tid = setTimeout(() => { setJustFinished(null) }, 2000)
			return () => clearTimeout(tid)
		}, [providerName])
	)

	const { state } = refreshModelState[providerName]

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <ButtonLeftTextRightOption

		leftButton={
			<button
				className='flex items-center'
				disabled={state === 'refreshing' || justFinished !== null}
				onClick={() => {
					refreshModelService.startRefreshingModels(providerName, { enableProviderOnSuccess: false, doNotFire: false })
					metricsService.capture('Click', { providerName, action: 'Refresh Models' })
				}}
			>
				{justFinished === 'finished' ? <Check className='stroke-green-500 size-3' />
					: justFinished === 'error' ? <X className='stroke-red-500 size-3' />
						: state === 'refreshing' ? <Loader2 className='size-3 animate-spin' />
							: <RefreshCw className='size-3' />}
			</button>
		}

		text={justFinished === 'finished' ? `${providerTitle} Models are up-to-date!`
			: justFinished === 'error' ? `${providerTitle} not found!`
				: `Manually refresh ${providerTitle} models.`}
	/>
}

const RefreshableModels = () => {
	const settingsState = useSettingsState()


	const buttons = refreshableProviderNames.map(providerName => {
		if (!settingsState.settingsOfProvider[providerName]._didFillInProviderSettings) return null
		return <RefreshModelButton key={providerName} providerName={providerName} />
	})

	return <>
		{buttons}
	</>

}



const AddModelMenu = ({ onSubmit, onClose }: { onSubmit: () => void, onClose: () => void }) => {

	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')

	const settingsState = useSettingsState()

	// const providerNameRef = useRef<ProviderName | null>(null)
	const [providerName, setProviderName] = useState<ProviderName | null>(null)

	const modelNameRef = useRef<HTMLTextAreaElement | null>(null)

	const [errorString, setErrorString] = useState('')


	return <>
		<div className='flex items-center gap-4'>

			{/* provider */}
			<VoidCustomDropdownBox
				options={providerNames}
				selectedOption={providerName}
				onChangeOption={(pn) => setProviderName(pn)}
				getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
				getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
				getOptionsEqual={(a, b) => a === b}
				className={`max-w-44 w-full border border-void-border-2 bg-void-bg-1 text-void-fg-3 text-root
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
			<div className='max-w-44 w-full border border-void-border-2 bg-void-bg-1 text-void-fg-3 text-root'>
				<VoidInputBox2
					placeholder='Model Name'
					className='mt-[2px] px-[6px] h-full w-full'
					ref={modelNameRef}
					multiline={false}
				/>
			</div>

			{/* button */}
			<VoidButton
				onClick={() => {
					const modelName = modelNameRef.current?.value

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
				}}
			>Add model</VoidButton>

			<button onClick={onClose} className='ml-auto'><X className='size-4' /></button>
		</div>

		{!errorString ? null : <div className='text-red-500 truncate whitespace-nowrap mt-1'>
			{errorString}
		</div>}

	</>

}

const AddModelMenuFull = () => {
	const [open, setOpen] = useState(false)

	return <div className='hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 my-4 px-3 rounded-sm overflow-hidden'>
		{open ?
			<AddModelMenu onSubmit={() => setOpen(false)} onClose={() => setOpen(false)} />
			: <VoidButton onClick={() => setOpen(true)}>Add Model</VoidButton>
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
		modelDump.push(...providerSettings.models.map(model => ({ ...model, providerName, providerEnabled: !!providerSettings._didFillInProviderSettings })))
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
				<div className={`flex-grow flex items-center gap-4`}>
					<span className='w-full max-w-32'>{isNewProviderName ? displayInfoOfProviderName(providerName).title : ''}</span>
					<span className='w-fit truncate'>{modelName}</span>
				</div>
				{/* right part is anything that fits */}
				<div className='flex items-center gap-4'>
					<span className='opacity-50 truncate'>{isAutodetected ? '(detected locally)' : isDefault ? '' : '(custom model)'}</span>

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

	const { title: settingTitle, placeholder, isPasswordField, subTextMd } = displayInfoOfSettingName(providerName, settingName)

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	const settingValue = settingsState.settingsOfProvider[providerName][settingName] as string // this should always be a string in this component
	if (typeof settingValue !== 'string') {
		console.log('Error: Provider setting had a non-string value.')
		return
	}

	return <ErrorBoundary>
		<div className='my-1'>
			<VoidSimpleInputBox
				value={settingValue}
				onChangeValue={useCallback((newVal) => {
					voidSettingsService.setSettingOfProvider(providerName, settingName, newVal)
				}, [voidSettingsService, providerName, settingName])}
				// placeholder={`${providerTitle} ${settingTitle} (${placeholder})`}
				placeholder={`${settingTitle} (${placeholder})`}
				passwordBlur={isPasswordField}
			/>
			{subTextMd === undefined ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				<ChatMarkdownRender string={subTextMd} chatMessageLocation={undefined} />
			</div>}

		</div>
	</ErrorBoundary>
}

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidSettingsState = useSettingsState()

	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

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

			{needsModel ?
				providerName === 'ollama' ?
					<WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} />
					: <WarningBox text={`Please add a model for ${providerTitle} (Models section).`} />
				: null}
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


type TabName = 'models' | 'general'
export const AutoDetectLocalModelsToggle = () => {
	const settingName: GlobalSettingName = 'autoRefreshModels'

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const metricsService = accessor.get('IMetricsService')

	const voidSettingsState = useSettingsState()

	// right now this is just `enabled_autoRefreshModels`
	const enabled = voidSettingsState.globalSettings[settingName]

	return <ButtonLeftTextRightOption
		leftButton={<VoidSwitch
			size='xxs'
			value={enabled}
			onChange={(newVal) => {
				voidSettingsService.setGlobalSetting(settingName, newVal)
				metricsService.capture('Click', { action: 'Autorefresh Toggle', settingName, enabled: newVal })
			}}
		/>}
		text={`Automatically detect local providers and models (${refreshableProviderNames.map(providerName => displayInfoOfProviderName(providerName).title).join(', ')}).`}
	/>


}

export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	return <VoidInputBox2
		className='min-h-[81px] p-3 rounded-sm'
		initValue={voidSettingsState.globalSettings.aiInstructions}
		placeholder={`Do not change my indentation or delete my comments. When writing TS or JS, do not add ;'s. Write new code using Rust if possible. `}
		multiline
		onChangeText={(newText) => {
			voidSettingsService.setGlobalSetting('aiInstructions', newText)
		}}
	/>
}

const FastApplyMethodDropdown = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const options = useMemo(() => [true, false], [])

	const onChangeOption = useCallback((newVal: boolean) => {
		voidSettingsService.setGlobalSetting('enableFastApply', newVal)
	}, [voidSettingsService])

	return <VoidCustomDropdownBox
		className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
		options={options}
		selectedOption={voidSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Output Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>

}


export const FeaturesTab = () => {
	const voidSettingsState = useSettingsState()
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')


	return <>
		<h2 className={`text-3xl mb-2`}>Models</h2>
		<ErrorBoundary>
			<ModelDump />
			<AddModelMenuFull />
			<AutoDetectLocalModelsToggle />
			<RefreshableModels />
		</ErrorBoundary>


		<h2 className={`text-3xl mb-2 mt-12`}>Local Providers</h2>
		{/* <h3 className={`opacity-50 mb-2`}>{`Keep your data private by hosting AI locally on your computer.`}</h3> */}
		{/* <h3 className={`opacity-50 mb-2`}>{`Instructions:`}</h3> */}
		{/* <h3 className={`mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3> */}
		<h3 className={`text-void-fg-3 mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3>
		<div className='pl-4 prose-ol:list-decimal opacity-80'>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`1. Download [Ollama](https://ollama.com/download).`} chatMessageLocation={undefined} /></span>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`2. Open your terminal.`} chatMessageLocation={undefined} /></span>
			<span className={`text-sm mb-2 select-text`}><ChatMarkdownRender string={`3. Run \`ollama run llama3.1:8b\`. This installs Meta's llama3.1 model which is best for chat and inline edits. Requires 5GB of memory.`} chatMessageLocation={undefined} /></span>
			<span className={`text-sm mb-2 select-text`}><ChatMarkdownRender string={`4. Run \`ollama run qwen2.5-coder:1.5b\`. This installs a faster autocomplete model. Requires 1GB of memory.`} chatMessageLocation={undefined} /></span>
			<span className={`text-sm mb-2`}><ChatMarkdownRender string={`Void automatically detects locally running models and enables them.`} chatMessageLocation={undefined} /></span>
			{/* TODO we should create UI for downloading models without user going into terminal */}
		</div>

		<ErrorBoundary>
			<VoidProviderSettings providerNames={localProviderNames} />
		</ErrorBoundary>

		<h2 className={`text-3xl mb-2 mt-12`}>Providers</h2>
		<h3 className={`text-void-fg-3 mb-2`}>{`Void can access models from Anthropic, OpenAI, OpenRouter, and more.`}</h3>
		{/* <h3 className={`opacity-50 mb-2`}>{`Access models like ChatGPT and Claude. We recommend using Anthropic or OpenAI as providers, or Groq as a faster alternative.`}</h3> */}
		<ErrorBoundary>
			<VoidProviderSettings providerNames={nonlocalProviderNames} />
		</ErrorBoundary>



		<h2 className={`text-3xl mt-12`}>Feature Options</h2>
		<ErrorBoundary>
			{/* L1 */}
			<div className='flex items-start justify-around mt-4 my-4 gap-x-8'>
				{/* FIM */}
				<div className='w-full'>
					<h4 className={`text-base`}>{displayInfoOfFeatureName('Autocomplete')}</h4>
					<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>Experimental. Only works with models that support FIM.</div>

					<div className='my-2'>
						{/* Enable Switch */}
						<div className='flex items-center gap-x-2 my-2'>
							<VoidSwitch
								size='xs'
								value={voidSettingsState.globalSettings.enableAutocomplete}
								onChange={(newVal) => voidSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
							/>
							<span className='text-void-fg-3 text-xs pointer-events-none'>{voidSettingsState.globalSettings.enableAutocomplete ? 'Enabled' : 'Disabled'}</span>
						</div>
						{/* Model Dropdown */}
						<div className={`my-2 ${!voidSettingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}`}>
							<ModelDropdown featureName={'Autocomplete'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
						</div>
					</div>

				</div>

				{/* Apply */}
				<div className='w-full'>
					<h4 className={`text-base`}>{displayInfoOfFeatureName('Apply')}</h4>
					<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>Settings that control the behavior of the Apply button and the Edit tool.</div>

					<div className='my-2'>
						{/* Sync to Chat Switch */}
						<div className='flex items-center gap-x-2 my-2'>
							<VoidSwitch
								size='xs'
								value={voidSettingsState.globalSettings.syncApplyToChat}
								onChange={(newVal) => voidSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
							/>
							<span className='text-void-fg-3 text-xs pointer-events-none'>{voidSettingsState.globalSettings.syncApplyToChat ? 'Same as Chat model' : 'Different model'}</span>
						</div>

						{/* Model Dropdown */}
						<div className={`my-2 ${voidSettingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}`}>
							<ModelDropdown featureName={'Apply'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
						</div>
					</div>


					<div className='my-2'>
						{/* Fast Apply Method Dropdown */}
						<div className='flex items-center gap-x-2 my-2'>
							<FastApplyMethodDropdown />
						</div>
					</div>

				</div>

			</div>

			{/* L2 */}
			<div className='flex items-start justify-around my-4 gap-x-8'>

				{/* Tools Section */}
				<div className='w-full'>
					<h4 className={`text-base`}>Tools</h4>
					<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>{`Tools are functions that LLMs can call. Some tools require user approval.`}</div>

					<div className='my-2'>
						{/* Auto Accept Switch */}
						<div className='flex items-center gap-x-2 my-2'>
							<VoidSwitch
								size='xs'
								value={voidSettingsState.globalSettings.autoApprove}
								onChange={(newVal) => voidSettingsService.setGlobalSetting('autoApprove', newVal)}
							/>
							<span className='text-void-fg-3 text-xs pointer-events-none'>{voidSettingsState.globalSettings.autoApprove ? 'Auto-approve' : 'Auto-approve'}</span>
						</div>
					</div>
				</div>

				<div className='w-full'>
				</div>

			</div>


			<div className='py-8' />

		</ErrorBoundary>

	</>
}



// https://github.com/VSCodium/vscodium/blob/master/docs/index.md#migrating-from-visual-studio-code-to-vscodium
// https://code.visualstudio.com/docs/editor/extension-marketplace#_where-are-extensions-installed
type TransferFilesInfo = { from: URI, to: URI }[]
const transferTheseFilesOfOS = (os: 'mac' | 'windows' | 'linux' | null): TransferFilesInfo => {
	if (os === null)
		throw new Error(`One-click switch is not possible in this environment.`)
	if (os === 'mac') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`$HOME not found`)
		return [{
			from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'settings.json'),
		}, {
			from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Code', 'User', 'keybindings.json'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'keybindings.json'),
		}, {
			from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.vscode', 'extensions'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
		}]
	}

	if (os === 'linux') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`variable for $HOME location not found`)
		return [{
			from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'settings.json'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'settings.json'),
		}, {
			from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Code', 'User', 'keybindings.json'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'keybindings.json'),
		}, {
			from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.vscode', 'extensions'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
		}]
	}

	if (os === 'windows') {
		const appdata = env['APPDATA']
		if (!appdata) throw new Error(`variable for %APPDATA% location not found`)
		const userprofile = env['USERPROFILE']
		if (!userprofile) throw new Error(`variable for %USERPROFILE% location not found`)

		return [{
			from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'settings.json'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'settings.json'),
		}, {
			from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Code', 'User', 'keybindings.json'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'keybindings.json'),
		}, {
			from: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.vscode', 'extensions'),
			to: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.void-editor', 'extensions'),
		}]
	}

	throw new Error(`os '${os}' not recognized`)
}


let transferTheseFiles: TransferFilesInfo = []
let transferError: string | null = null

try { transferTheseFiles = transferTheseFilesOfOS(os) }
catch (e) { transferError = e + '' }

const OneClickSwitchButton = () => {
	const accessor = useAccessor()
	const fileService = accessor.get('IFileService')

	const [state, setState] = useState<{ type: 'done', error?: string } | { type: | 'loading' | 'justfinished' }>({ type: 'done' })

	if (transferTheseFiles.length === 0)
		return <>
			<WarningBox text={transferError ?? `One-click switch not available.`} />
		</>



	const onClick = async () => {

		if (state.type !== 'done') return

		setState({ type: 'loading' })

		let errAcc = ''
		for (let { from, to } of transferTheseFiles) {
			console.log('transferring', from, to)
			// not sure if this can fail, just wrapping it with try/catch for now
			try { await fileService.copy(from, to, true) }
			catch (e) { errAcc += e + '\n' }
		}
		const hadError = !!errAcc
		if (hadError) {
			setState({ type: 'done', error: errAcc })
		}
		else {
			setState({ type: 'justfinished' })
			setTimeout(() => { setState({ type: 'done' }); }, 3000)
		}
	}

	return <>
		<VoidButton disabled={state.type !== 'done'} onClick={onClick}>
			{state.type === 'done' ? 'Transfer my Settings'
				: state.type === 'loading' ? 'Transferring...'
					: state.type === 'justfinished' ? 'Success!'
						: null
			}
		</VoidButton>
		{state.type === 'done' && state.error ? <WarningBox text={state.error} /> : null}
	</>
}


const GeneralTab = () => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')

	return <>


		<div className=''>
			<h2 className={`text-3xl mb-2`}>One-Click Switch</h2>
			<h4 className={`text-void-fg-3 mb-2`}>{`Transfer your settings from VS Code to Void in one click.`}</h4>
			<OneClickSwitchButton />
		</div>



		<div className='mt-12'>
			<h2 className={`text-3xl mb-2`}>Built-in Settings</h2>
			<h4 className={`text-void-fg-3 mb-2`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>

			<div className='my-4'>
				<VoidButton onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>
					General Settings
				</VoidButton>
			</div>
			<div className='my-4'>
				<VoidButton onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>
					Keyboard Settings
				</VoidButton>
			</div>
			<div className='my-4'>
				<VoidButton onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>
					Theme Settings
				</VoidButton>
			</div>
			<div className='my-4'>
				<VoidButton onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>
					Open Logs
				</VoidButton>
			</div>
		</div>


		<div className='mt-12'>
			<h2 className={`text-3xl mb-2`}>AI Instructions</h2>
			<h4 className={`text-void-fg-3 mb-2`}>{`Instructions to include on all AI requests.`}</h4>
			<AIInstructionsBox />
		</div>


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

				<h1 className='text-2xl w-full'>{`Void's Settings`}</h1>

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
					<div className='w-full min-w-[550px]'>

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
