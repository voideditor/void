/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidStatefulModelInfo, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, hasDownloadButtonsOnModelsProviderNames } from '../../../../common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidButtonBgDarken, VoidCustomDropdownBox, VoidInputBox2, VoidSimpleInputBox, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { env } from '../../../../../../../base/common/process.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'


const ButtonLeftTextRightOption = ({ text, leftButton }: { text: string, leftButton?: React.ReactNode }) => {

	return <div className='flex items-center text-void-fg-3 px-3 py-0.5 rounded-sm overflow-hidden gap-2'>
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



export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40);

	useEffect(() => {
		const startTime = performance.now();
		const duration = 500; // 500ms animation

		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const newOffset = 40 - (progress * 40);

			setDashOffset(newOffset);

			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};

		const animationId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationId);
	}, []);

	return <div
		className={`flex items-center gap-1.5 w-fit
			${className ? className : `px-2 py-0.5 text-xs text-zinc-900 bg-zinc-100 rounded-sm`}
		`}
	>
		<svg className="size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5 13l4 4L19 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					strokeDasharray: 40,
					strokeDashoffset: dashOffset
				}}
			/>
		</svg>
		{text}
	</div>
}


const AddButton = ({ disabled, text = 'Add', ...props }: { disabled?: boolean, text?: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		disabled={disabled}
		className={`bg-[#0e70c0] px-3 py-1 text-white dark:text-black rounded-sm ${!disabled ? 'hover:bg-[#1177cb] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-opacity-70'}`}
		{...props}
	>{text}</button>

}


// shows a providerName dropdown if no `providerName` is given
export const AddModelInputBox = ({ providerName: permanentProviderName, className, compact }: { providerName?: ProviderName, className?: string, compact?: boolean }) => {

	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')

	const settingsState = useSettingsState()

	const [isOpen, setIsOpen] = useState(false)
	const [showCheckmark, setShowCheckmark] = useState(false)

	// const providerNameRef = useRef<ProviderName | null>(null)
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName>('anthropic')

	const providerName = permanentProviderName ?? userChosenProviderName;

	const [modelName, setModelName] = useState<string>('')
	const [errorString, setErrorString] = useState('')

	const numModels = settingsState.settingsOfProvider[providerName].models.length

	if (showCheckmark) {
		return <AnimatedCheckmarkButton text='Added' className={`bg-[#0e70c0] text-white dark:text-black px-3 py-1 rounded-sm ${className}`} />
	}

	if (!isOpen) {
		return <div
			className={`text-void-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
			onClick={() => setIsOpen(true)}

		>
			<div>
				{numModels > 0 ? `Add a different model?` : `Add a model`}
			</div>
		</div>
	}


	return <>
		<form className={`flex items-center gap-2 ${className}`}>

			{/* X button
			<button onClick={() => { setIsOpen(false) }} className='text-void-fg-4'><X className='size-4' /></button> */}

			{/* provider input */}
			{!permanentProviderName &&
				<VoidCustomDropdownBox
					options={providerNames}
					selectedOption={providerName}
					onChangeOption={(pn) => setUserChosenProviderName(pn)}
					getOptionDisplayName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
					getOptionDropdownName={(pn) => pn ? displayInfoOfProviderName(pn).title : 'Provider Name'}
					getOptionsEqual={(a, b) => a === b}
					// className={`max-w-44 w-full border border-void-border-2 bg-void-bg-1 text-void-fg-3 text-root py-[4px] px-[6px]`}
					className={`max-w-32 mx-2 w-full resize-none bg-void-bg-1 text-void-fg-1 placeholder:text-void-fg-3 border border-void-border-2 focus:border-void-border-1 py-1 px-2 rounded`}
					arrowTouchesText={false}
				/>
			}

			{/* model input */}
			<VoidSimpleInputBox
				value={modelName}
				onChangeValue={setModelName}
				placeholder='Model Name'
				compact={compact}
				className={'max-w-32'}
			/>

			{/* add button */}
			<AddButton
				type='submit'
				disabled={!modelName}
				onClick={(e) => {
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
						// setErrorString(`This model already exists under ${providerName}.`)
						setErrorString(`This model already exists.`)
						return
					}

					settingsStateService.addModel(providerName, modelName)
					setShowCheckmark(true)
					setTimeout(() => {
						setShowCheckmark(false)
						setIsOpen(false)
					}, 1500)
					setErrorString('')
					setModelName('')
				}}
			/>


		</form>

		{!errorString ? null : <div className='text-red-500 truncate whitespace-nowrap mt-1'>
			{errorString}
		</div>}

	</>

}


export const ModelDump = () => {

	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')

	const settingsState = useSettingsState()

	// a dump of all the enabled providers' models
	const modelDump: (VoidStatefulModelInfo & { providerName: ProviderName, providerEnabled: boolean })[] = []
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

			const providerTitle = displayInfoOfProviderName(providerName).title

			const disabled = !providerEnabled
			const value = disabled ? false : !isHidden

			const tooltipName = (
				disabled ? `Add ${providerTitle} to enable`
					: value === true ? 'Enabled'
						: 'Disabled'
			)

			return <div key={`${modelName}${providerName}`}
				className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate
				`}
			>
				{/* left part is width:full */}
				<div className={`flex-grow flex items-center gap-4`}>
					<span className='w-full max-w-32'>{isNewProviderName ? providerTitle : ''}</span>
					<span className='w-fit truncate'>{modelName}</span>
				</div>
				{/* right part is anything that fits */}
				<div className='flex items-center gap-4'
				// data-tooltip-id='void-tooltip'
				// data-tooltip-place='top'
				// data-tooltip-content={disabled ? `${displayInfoOfProviderName(providerName).title} is disabled`
				// 	: (isHidden ? `'${modelName}' won't appear in dropdowns` : ``)
				// }
				>
					<span className='opacity-50 truncate'>{isAutodetected ? '(detected locally)' : isDefault ? '' : '(custom model)'}</span>

					<VoidSwitch
						value={value}
						onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName) }}
						disabled={disabled}
						size='sm'

						data-tooltip-id='void-tooltip'
						data-tooltip-place='right'
						data-tooltip-content={tooltipName}
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
				compact={true}
			/>
			{subTextMd === undefined ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				<ChatMarkdownRender string={subTextMd} chatMessageLocation={undefined} />
			</div>}

		</div>
	</ErrorBoundary>
}

// const OldSettingsForProvider = ({ providerName, showProviderTitle }: { providerName: ProviderName, showProviderTitle: boolean }) => {
// 	const voidSettingsState = useSettingsState()

// 	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

// 	// const accessor = useAccessor()
// 	// const voidSettingsService = accessor.get('IVoidSettingsService')

// 	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
// 	const settingNames = customSettingNamesOfProvider(providerName)

// 	const { title: providerTitle } = displayInfoOfProviderName(providerName)

// 	return <div className='my-4'>

// 		<div className='flex items-center w-full gap-4'>
// 			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

// 			{/* enable provider switch */}
// 			{/* <VoidSwitch
// 				value={!!enabled}
// 				onChange={
// 					useCallback(() => {
// 						const enabledRef = voidSettingsService.state.settingsOfProvider[providerName].enabled
// 						voidSettingsService.setSettingOfProvider(providerName, 'enabled', !enabledRef)
// 					}, [voidSettingsService, providerName])}
// 				size='sm+'
// 			/> */}
// 		</div>

// 		<div className='px-0'>
// 			{/* settings besides models (e.g. api key) */}
// 			{settingNames.map((settingName, i) => {
// 				return <ProviderSetting key={settingName} providerName={providerName} settingName={settingName} />
// 			})}

// 			{needsModel ?
// 				providerName === 'ollama' ?
// 					<WarningBox text={`Please install an Ollama model. We'll auto-detect it.`} />
// 					: <WarningBox text={`Please add a model for ${providerTitle} (Models section).`} />
// 				: null}
// 		</div>
// 	</div >
// }

export const SettingsForProvider = ({ providerName, showProviderTitle, showProviderSuggestions }: { providerName: ProviderName, showProviderTitle: boolean, showProviderSuggestions: boolean }) => {
	const voidSettingsState = useSettingsState()

	const needsModel = isProviderNameDisabled(providerName, voidSettingsState) === 'addModel'

	// const accessor = useAccessor()
	// const voidSettingsService = accessor.get('IVoidSettingsService')

	// const { enabled } = voidSettingsState.settingsOfProvider[providerName]
	const settingNames = customSettingNamesOfProvider(providerName)

	const { title: providerTitle } = displayInfoOfProviderName(providerName)

	return <div>

		<div className='flex items-center w-full gap-4'>
			{showProviderTitle && <h3 className='text-xl truncate'>{providerTitle}</h3>}

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

			{showProviderSuggestions && needsModel ?
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
			<SettingsForProvider key={providerName} providerName={providerName} showProviderTitle={true} showProviderSuggestions={true} />
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


export const ollamaSetupInstructions = <div className='prose-p:my-0 prose-ol:list-decimal prose-p:py-0 prose-ol:my-0 prose-ol:py-0 prose-span:my-0 prose-span:py-0 text-void-fg-3 text-sm list-decimal select-text'>
	<div className=''><ChatMarkdownRender string={`Ollama Setup Instructions`} chatMessageLocation={undefined} /></div>
	<div className=' pl-6'><ChatMarkdownRender string={`1. Download [Ollama](https://ollama.com/download).`} chatMessageLocation={undefined} /></div>
	<div className=' pl-6'><ChatMarkdownRender string={`2. Open your terminal.`} chatMessageLocation={undefined} /></div>
	<div
		className='pl-6 flex items-center w-fit'
		// data-tooltip-id='void-tooltip-ollama-settings'
	>
		<ChatMarkdownRender string={`3. Run \`ollama pull your_model\` to install a model.`} chatMessageLocation={undefined} />
	</div>
	<div className=' pl-6'><ChatMarkdownRender string={`Void automatically detects locally running models and enables them.`} chatMessageLocation={undefined} /></div>
</div>


const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	return <div
		className={`text-void-fg-4 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
		onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		See onboarding screen?
	</div>

}


type TransferEditorType = 'VS Code' | 'Cursor' | 'Windsurf'
// https://github.com/VSCodium/vscodium/blob/master/docs/index.md#migrating-from-visual-studio-code-to-vscodium
// https://code.visualstudio.com/docs/editor/extension-marketplace#_where-are-extensions-installed
type TransferFilesInfo = { from: URI, to: URI }[]
const transferTheseFilesOfOS = (os: 'mac' | 'windows' | 'linux' | null, fromEditor: TransferEditorType = 'VS Code'): TransferFilesInfo => {
	if (os === null)
		throw new Error(`One-click switch is not possible in this environment.`)
	if (os === 'mac') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`$HOME not found`)

		if (fromEditor === 'VS Code') {
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
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.cursor', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, 'Library', 'Application Support', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.windsurf', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
			}]
		}
	}

	if (os === 'linux') {
		const homeDir = env['HOME']
		if (!homeDir) throw new Error(`variable for $HOME location not found`)

		if (fromEditor === 'VS Code') {
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
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Cursor', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Cursor', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.cursor', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Windsurf', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Windsurf', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.config', 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.windsurf', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), homeDir, '.void-editor', 'extensions'),
			}]
		}
	}

	if (os === 'windows') {
		const appdata = env['APPDATA']
		if (!appdata) throw new Error(`variable for %APPDATA% location not found`)
		const userprofile = env['USERPROFILE']
		if (!userprofile) throw new Error(`variable for %USERPROFILE% location not found`)

		if (fromEditor === 'VS Code') {
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
		} else if (fromEditor === 'Cursor') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Cursor', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Cursor', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.cursor', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.void-editor', 'extensions'),
			}]
		} else if (fromEditor === 'Windsurf') {
			return [{
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Windsurf', 'User', 'settings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'settings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Windsurf', 'User', 'keybindings.json'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), appdata, 'Void', 'User', 'keybindings.json'),
			}, {
				from: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.windsurf', 'extensions'),
				to: URI.joinPath(URI.from({ scheme: 'file' }), userprofile, '.void-editor', 'extensions'),
			}]
		}
	}

	throw new Error(`os '${os}' not recognized or editor type '${fromEditor}' not supported for this OS`)
}


export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const fileService = accessor.get('IFileService')

	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: | 'loading' | 'justfinished' }>({ type: 'done' })

	let transferTheseFiles: TransferFilesInfo = [];
	let editorError: string | null = null;

	try {
		transferTheseFiles = transferTheseFilesOfOS(os, fromEditor)
	} catch (e) {
		editorError = e + ''
	}

	if (transferTheseFiles.length === 0)
		return <>
			<WarningBox text={editorError ?? `Transfer from ${fromEditor} not available.`} />
		</>

	const onClick = async () => {
		if (transferState.type !== 'done') return

		setTransferState({ type: 'loading' })

		let errAcc = ''
		for (let { from, to } of transferTheseFiles) {
			console.log('transferring', from, to)
			// Check if the source file exists before attempting to copy
			try {
				const exists = await fileService.exists(from)
				if (exists) {
					// Ensure the destination directory exists
					const toParent = URI.joinPath(to, '..')
					const toParentExists = await fileService.exists(toParent)
					if (!toParentExists) {
						await fileService.createFolder(toParent)
					}
					await fileService.copy(from, to, true)
				} else {
					console.log(`Skipping file that doesn't exist: ${from.toString()}`)
				}
			}
			catch (e) {
				console.error('Error copying file:', e)
				errAcc += `Error copying ${from.toString()}: ${e}\n`
			}
		}

		// Even if some files were missing, consider it a success if no actual errors occurred
		const hadError = !!errAcc
		if (hadError) {
			setTransferState({ type: 'done', error: errAcc })
		}
		else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }); }, 3000)
		}
	}

	return <>
		<VoidButtonBgDarken className={`max-w-48 p-4 ${className}`} disabled={transferState.type !== 'done'} onClick={onClick}>
			{transferState.type === 'done' ? `Transfer from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='text-nowrap flex flex-nowrap'>Transferring<IconLoading /></span>
					: transferState.type === 'justfinished' ? <AnimatedCheckmarkButton text='Settings Transferred' className='bg-none' />
						: null
			}
		</VoidButtonBgDarken>
		{transferState.type === 'done' && transferState.error ? <WarningBox text={transferState.error} /> : null}
	</>
}


// full settings

export const Settings = () => {
	const isDark = useIsDark()
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	return <div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%' }}>
		<div className='overflow-y-auto w-full h-full px-10 py-10 select-none'>

			<div className='max-w-xl mx-auto'>

				<h1 className='text-2xl w-full'>{`Void's Settings`}</h1>

				{/* separator */}
				<div className='w-full h-[1px] my-4' />

				{/* Models section (formerly FeaturesTab) */}
				<ErrorBoundary>
					<h2 className={`text-3xl mb-2`}>Models</h2>
					<ModelDump />
					<AddModelInputBox className='mt-4' compact />
					<RedoOnboardingButton className='mt-2 mb-4' />
					<AutoDetectLocalModelsToggle />
					<RefreshableModels />
				</ErrorBoundary>


				<h2 className={`text-3xl mb-2 mt-12`}>Local Providers</h2>
				<h3 className={`text-void-fg-3 mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3>

				<div className='opacity-80 mb-4'>
					{ollamaSetupInstructions}
				</div>

				<ErrorBoundary>
					<VoidProviderSettings providerNames={localProviderNames} />
				</ErrorBoundary>

				<h2 className={`text-3xl mb-2 mt-12`}>Providers</h2>
				<h3 className={`text-void-fg-3 mb-2`}>{`Void can access models from Anthropic, OpenAI, OpenRouter, and more.`}</h3>
				<ErrorBoundary>
					<VoidProviderSettings providerNames={nonlocalProviderNames} />
				</ErrorBoundary>



				<h2 className={`text-3xl mt-12`}>Feature Options</h2>
				{/* L1 */}

				<div className='flex items-start justify-around my-4 gap-x-8'>
					<ErrorBoundary>
						{/* FIM */}
						<div className='w-full'>
							<h4 className={`text-base`}>{displayInfoOfFeatureName('Autocomplete')}</h4>
							<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>
								<span>
									Experimental.{' '}
								</span>
								<span
									className='hover:brightness-110'
									data-tooltip-id='void-tooltip'
									data-tooltip-content='We recommend using qwen2.5-coder:1.5b with Ollama.'
									data-tooltip-class-name='void-max-w-[20px]'
								>
									Only works with FIM models.*
								</span>
							</div>

							<div className='my-2'>
								{/* Enable Switch */}
								<ErrorBoundary>
									<div className='flex items-center gap-x-2 my-2'>
										<VoidSwitch
											size='xs'
											value={settingsState.globalSettings.enableAutocomplete}
											onChange={(newVal) => voidSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
										/>
										<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.enableAutocomplete ? 'Enabled' : 'Disabled'}</span>
									</div>
								</ErrorBoundary>

								{/* Model Dropdown */}
								<ErrorBoundary>
									<div className={`my-2 ${!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}`}>
										<ModelDropdown featureName={'Autocomplete'} className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1' />
									</div>
								</ErrorBoundary>

							</div>

						</div>
					</ErrorBoundary>

					{/* Apply */}
					<ErrorBoundary>

						<div className='w-full'>
							<h4 className={`text-base`}>{displayInfoOfFeatureName('Apply')}</h4>
							<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>Settings that control the behavior of the Apply button and the Edit tool.</div>

							<div className='my-2'>
								{/* Sync to Chat Switch */}
								<div className='flex items-center gap-x-2 my-2'>
									<VoidSwitch
										size='xs'
										value={settingsState.globalSettings.syncApplyToChat}
										onChange={(newVal) => voidSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
									/>
									<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.syncApplyToChat ? 'Same as Chat model' : 'Different model'}</span>
								</div>

								{/* Model Dropdown */}
								<div className={`my-2 ${settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}`}>
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
					</ErrorBoundary>

				</div>



				{/* L2 */}

				<div className='flex items-start justify-around my-4 gap-x-8'>

					{/* Tools Section */}
					<div className='w-full'>
						<h4 className={`text-base`}>Tools</h4>
						<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>{`Tools are functions that LLMs can call. Some tools require user approval.`}</div>

						<div className='my-2'>
							{/* Auto Accept Switch */}
							<ErrorBoundary>

								<div className='flex items-center gap-x-2 my-2'>
									<VoidSwitch
										size='xs'
										value={settingsState.globalSettings.autoApprove}
										onChange={(newVal) => voidSettingsService.setGlobalSetting('autoApprove', newVal)}
									/>
									<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.autoApprove ? 'Auto-approve' : 'Auto-approve'}</span>
								</div>
							</ErrorBoundary>

							{/* Tool Lint Errors Switch */}
							<ErrorBoundary>

								<div className='flex items-center gap-x-2 my-2'>
									<VoidSwitch
										size='xs'
										value={settingsState.globalSettings.includeToolLintErrors}
										onChange={(newVal) => voidSettingsService.setGlobalSetting('includeToolLintErrors', newVal)}
									/>
									<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.includeToolLintErrors ? 'Fix lint errors' : `Fix lint errors`}</span>
								</div>
							</ErrorBoundary>
						</div>
					</div>



					<div className='w-full'>
						<h4 className={`text-base`}>Editor</h4>
						<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>{`Settings that control the visibility of suggestions and widgets in the code editor.`}</div>

						<div className='my-2'>
							{/* Auto Accept Switch */}
							<ErrorBoundary>
								<div className='flex items-center gap-x-2 my-2'>
									<VoidSwitch
										size='xs'
										value={settingsState.globalSettings.showInlineSuggestions}
										onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
									/>
									<span className='text-void-fg-3 text-xs pointer-events-none'>{settingsState.globalSettings.showInlineSuggestions ? 'Show suggestions on select' : 'Show suggestions on select'}</span>
								</div>
							</ErrorBoundary>
						</div>
					</div>
				</div>


				{/* General section (formerly GeneralTab) */}
				<div className='mt-12'>
					<ErrorBoundary>
						<h2 className={`text-3xl mb-2 mt-12`}>One-Click Switch</h2>
						<h4 className={`text-void-fg-3 mb-4`}>{`Transfer your settings from another editor to Void in one click.`}</h4>

						<div className='flex flex-col gap-4'>
							<OneClickSwitchButton className='w-48' fromEditor="VS Code" />
							<OneClickSwitchButton className='w-48' fromEditor="Cursor" />
							<OneClickSwitchButton className='w-48' fromEditor="Windsurf" />
						</div>
					</ErrorBoundary>
				</div>



				<div className='mt-12'>

					<h2 className={`text-3xl mb-2`}>Built-in Settings</h2>
					<h4 className={`text-void-fg-3 mb-4`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>

					<ErrorBoundary>
						<div className='my-4'>
							<VoidButtonBgDarken className='px-4 py-2' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>
								General Settings
							</VoidButtonBgDarken>
						</div>
						<div className='my-4'>
							<VoidButtonBgDarken className='px-4 py-2' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>
								Keyboard Settings
							</VoidButtonBgDarken>
						</div>
						<div className='my-4'>
							<VoidButtonBgDarken className='px-4 py-2' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>
								Theme Settings
							</VoidButtonBgDarken>
						</div>
						<div className='my-4'>
							<VoidButtonBgDarken className='px-4 py-2' onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>
								Open Logs
							</VoidButtonBgDarken>
						</div>
					</ErrorBoundary>
				</div>


				<div className='mt-12 max-w-[600px]'>
					<h2 className={`text-3xl mb-2`}>AI Instructions</h2>
					<h4 className={`text-void-fg-3 mb-4`}>
							<ChatMarkdownRender inPTag={true} string={`
System instructions to include with all AI requests.
Alternatively, place a \`.voidinstructions\` file in the root of your workspace.
								`} chatMessageLocation={undefined} />
						</h4>
					<ErrorBoundary>
						<AIInstructionsBox />
					</ErrorBoundary>
				</div>
			</div>
		</div>
	</div>
}

