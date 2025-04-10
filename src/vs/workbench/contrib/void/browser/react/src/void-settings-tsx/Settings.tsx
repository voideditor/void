/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidStatefulModelInfo, globalSettingNames, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, hasDownloadButtonsOnModelsProviderNames } from '../../../../common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidButtonBgDarken, VoidCheckBox, VoidCustomDropdownBox, VoidInputBox, VoidInputBox2, VoidSimpleInputBox, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, MoveRight, PlusCircle, MinusCircle, Download, Trash, StopCircle, Square, ExternalLink } from 'lucide-react'
import { isWindows, isLinux, isMacintosh } from '../../../../../../../base/common/platform.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { env } from '../../../../../../../base/common/process.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconLoading, IconX } from '../sidebar-tsx/SidebarChat.js'
import { getModelCapabilities, getProviderCapabilities, ollamaRecommendedModels, VoidStaticModelInfo } from '../../../../common/modelCapabilities.js'


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



const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
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
			${className ? className : `px-2 py-0.5 text-xs text-white bg-[#0e70c0] rounded-sm`}
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
		className={`bg-[#0e70c0] px-3 py-1 text-white rounded-sm ${!disabled ? 'hover:bg-[#1177cb] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-opacity-70'}`}
		{...props}
	>{text}</button>

}


// shows a providerName dropdown if no `providerName` is given
const AddModelInputBox = ({ providerName: permanentProviderName, className, compact }: { providerName?: ProviderName, className?: string, compact?: boolean }) => {

	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')

	const settingsState = useSettingsState()

	const [isOpen, setIsOpen] = useState(false)

	// const providerNameRef = useRef<ProviderName | null>(null)
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName>('anthropic')

	const providerName = permanentProviderName ?? userChosenProviderName;

	const [modelName, setModelName] = useState<string>('')
	const [errorString, setErrorString] = useState('')

	const numModels = settingsState.settingsOfProvider[providerName].models.length

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
					setIsOpen(false)
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

const SettingsForProvider = ({ providerName, showProviderTitle, showProviderSuggestions }: { providerName: ProviderName, showProviderTitle: boolean, showProviderSuggestions: boolean }) => {
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


export const FeaturesTab = () => {
	const voidSettingsState = useSettingsState()
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')


	return <>
		<h2 className={`text-3xl mb-2`}>Models</h2>
		<ErrorBoundary>
			<ModelDump />
			<AddModelInputBox className='my-4' compact />
			<AutoDetectLocalModelsToggle />
			<RefreshableModels />
		</ErrorBoundary>


		<h2 className={`text-3xl mb-2 mt-12`}>Local Providers</h2>
		{/* <h3 className={`opacity-50 mb-2`}>{`Keep your data private by hosting AI locally on your computer.`}</h3> */}
		{/* <h3 className={`opacity-50 mb-2`}>{`Instructions:`}</h3> */}
		{/* <h3 className={`mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3> */}
		<h3 className={`text-void-fg-3 mb-2`}>{`Void can access any model that you host locally. We automatically detect your local models by default.`}</h3>

		<div className='opacity-80 mb-4'>
			{ollamaSetupInstructions}
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
					<h4 className={`text-base`}>Editor</h4>
					<div className='text-sm italic text-void-fg-3 mt-1 mb-4'>{`Settings that control the visibility of suggestions and widgets in the code editor.`}</div>

					<div className='my-2'>
						{/* Auto Accept Switch */}
						<div className='flex items-center gap-x-2 my-2'>
							<VoidSwitch
								size='xs'
								value={voidSettingsState.globalSettings.showInlineSuggestions}
								onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
							/>
							<span className='text-void-fg-3 text-xs pointer-events-none'>{voidSettingsState.globalSettings.showInlineSuggestions ? 'Show suggestions on select' : 'Show suggestions on select'}</span>
						</div>
					</div>
				</div>


			</div>


			<div className='py-8' />

		</ErrorBoundary>

	</>
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


const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
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


const GeneralTab = () => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')

	return <>
		<div className=''>
			<h2 className={`text-3xl mb-2`}>One-Click Switch</h2>
			<h4 className={`text-void-fg-3 mb-2`}>{`Transfer your settings from another editor to Void in one click.`}</h4>

			<div className='flex flex-col gap-4'>
				<OneClickSwitchButton className='w-48' fromEditor="VS Code" />
				<OneClickSwitchButton className='w-48' fromEditor="Cursor" />
				<OneClickSwitchButton className='w-48' fromEditor="Windsurf" />
			</div>
		</div>



		<div className='mt-12'>
			<h2 className={`text-3xl mb-2`}>Built-in Settings</h2>
			<h4 className={`text-void-fg-3 mb-2`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>

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
		</div>


		<div className='mt-12 max-w-[600px]'>
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


	const deleteme = false
	if (deleteme) {
		return <div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%' }}>
			<VoidOnboarding />
		</div>
	}

	return <div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%' }}>
		<div className='overflow-y-auto w-full h-full px-10 py-10 select-none'>

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


const FADE_DURATION_MS = 2000


const FadeIn = ({ children, className, delayMs = 0, ...props }: { children: React.ReactNode, delayMs?: number, className?: string } & React.HTMLAttributes<HTMLDivElement>) => {
	const [opacity, setOpacity] = useState(0)

	useEffect(() => {

		const timeout = setTimeout(() => {
			setOpacity(1)
		}, delayMs)

		return () => clearTimeout(timeout)
	}, [setOpacity, delayMs])


	return (
		<div className={className} style={{ opacity, transition: `opacity ${FADE_DURATION_MS}ms ease-in-out` }} {...props}>
			{children}
		</div>
	)
}

// Onboarding
// 	OnboardingPage
// 		title:
// 			div
// 				"Welcome to Void"
// 			image
// 		content:<></>
// 		title
// 		content
// 		prev/next

// 	OnboardingPage
// 		title:
// 			div
// 				"How would you like to use Void?"
// 		content:
// 			ModelQuestionContent
// 				|
// 					div
// 						"I want to:"
// 					div
// 						"Use the smartest models"
// 						"Keep my data fully private"
// 						"Save money"
// 						"I don't know"
// 				| div
// 					| div
// 						"We recommend using "
// 						"Set API"
// 					| div
// 						""
// 					| div
//
// 		title
// 		content
// 		prev/next
//
// 	OnboardingPage
// 		title
// 		content
// 		prev/next


const NextButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded bg-void-accent hover:bg-void-accent/90 text-white"
			{...props}
		>
			Next
		</button>
	)
}

const SkipButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded bg-void-bg-2 hover:bg-void-bg-3 text-void-fg-2"
			{...props}
		>
			Skip
		</button>
	)
}

const PreviousButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded bg-void-bg-2 hover:bg-void-bg-3"
			{...props}
		>
			Previous
		</button>
	)
}


const ollamaSetupInstructions = <div className='prose-p:my-0 prose-p:py-0 prose-ol:my-0 prose-ol:py-0 prose-span:my-0 prose-span:py-0 text-void-fg-3 text-sm font-light list-decimal select-text opacity-80'>
	<div className=''><ChatMarkdownRender string={`Ollama Setup Instructions`} chatMessageLocation={undefined} /></div>
	<div className=' pl-6'><ChatMarkdownRender string={`1. Download [Ollama](https://ollama.com/download).`} chatMessageLocation={undefined} /></div>
	<div className=' pl-6'><ChatMarkdownRender string={`2. Open your terminal.`} chatMessageLocation={undefined} /></div>
	<div className=' pl-6'><ChatMarkdownRender string={`3. Run \`ollama pull your_model\` to install a model.`} chatMessageLocation={undefined} /></div>
	<div className=' pl-6'><ChatMarkdownRender string={`Void automatically detects locally running models and enables them.`} chatMessageLocation={undefined} /></div>
</div>

const OllamaDownloadOrRemoveModelButton = ({ modelName, isModelInstalled, sizeGb }: { modelName: string, isModelInstalled: boolean, sizeGb: number | false | 'not-known' }) => {


	// for now just link to the ollama download page
	return <a
		href={`https://ollama.com/library/${modelName}`}
		target="_blank"
		rel="noopener noreferrer"
		className="flex items-center text-void-fg-2 hover:text-void-fg-1"
	>
		<ExternalLink className="w-3.5 h-3.5" />
	</a>

	// if (isModelInstalled) {
	// 	return <div className="flex items-center">

	// 		<span className="flex items-center">Uninstall</span>

	// 		<IconShell1
	// 			className="ml-1"
	// 			Icon={Trash}
	// 			onClick={() => {

	// 				setIsModelInstalling(false);
	// 			}}
	// 		/>

	// 	</div>
	// }



	// else if (isModelInstalling) {
	// 	return <div className="flex items-center">

	// 		<span className="flex items-center">{`Download? ${typeof sizeGb === 'number' ? `(${sizeGb} Gb)` : ''}`}</span>

	// 		<IconShell1
	// 			className="ml-1"
	// 			Icon={Square}
	// 			onClick={() => {
	// 				// abort()

	// 				// TODO!!!!!!!!!!! don't do this
	// 				setIsModelInstalling(false);
	// 			}}
	// 		/>

	// 	</div>
	// }


	// else if (!isModelInstalled) {

	// 	return <div className="flex items-center">

	// 		<span className="flex items-center">Download ({sizeGb} Gb)</span>

	// 		<IconShell1
	// 			className="ml-1"
	// 			Icon={Download}
	// 			onClick={() => {
	// 				// this is a check for whether the model was installed:

	// 				if (isModelInstalling) return


	// 				// TODO!!!!!! don't do this


	// 				// install(modelname), callback = setIsModelInstalling(false);

	// 				setIsModelInstalling(true);
	// 			}}
	// 		/>

	// 	</div>

	// }

	// return <></>


}


const YesNoText = ({ val }: { val: boolean | null }) => {

	return <div
		className={
			val === true ? "text text-green-500"
				: val === false ? 'text-red-500'
					: "text text-yellow-500"
		}
	>
		{
			val === true ? "Yes"
				: val === false ? 'No'
					: "Yes*"
		}
	</div>

}



const abbreviateNumber = (num: number): string => {
	if (num >= 1000000) {
		// For millions
		return Math.floor(num / 1000000) + 'M';
	} else if (num >= 1000) {
		// For thousands
		return Math.floor(num / 1000) + 'K';
	} else {
		// For numbers less than 1000
		return num.toString();
	}
}

const TableOfModelsForProvider = ({ providerName }: { providerName: ProviderName }) => {

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	const isDetectableLocally = (refreshableProviderNames as ProviderName[]).includes(providerName)
	// const providerCapabilities = getProviderCapabilities(providerName)


	// info used to show the table
	const infoOfModelName: Record<string, { showAsDefault: boolean, isDownloaded: boolean }> = {}

	voidSettingsState.settingsOfProvider[providerName].models.forEach(m => {
		infoOfModelName[m.modelName] = {
			showAsDefault: m.isDefault,
			isDownloaded: true
		}
	})

	// special case  columns for ollama; show recommended models as default
	if (providerName === 'ollama') {
		for (const modelName of ollamaRecommendedModels) {
			if (modelName in infoOfModelName) continue
			infoOfModelName[modelName] = {
				...infoOfModelName[modelName],
				showAsDefault: true,
			}
		}
	}

	return <table className="table-fixed border-collapse mb-6 bg-void-bg-2 text-sm mx-auto select-text">
		<thead>
			<tr className="border-b border-void-border-1 text-nowrap text-ellipsis">
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[200px]">Models Offered</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Cost/M</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Context</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Chat</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Agent</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Autotab</th>
				{/* <th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Reasoning</th> */}
				{isDetectableLocally && <th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Detected</th>}
				{providerName === 'ollama' && <th className="text-left py-2 px-3 font-normal text-void-fg-3">Download</th>}
			</tr>
		</thead>
		<tbody>
			{Object.keys(infoOfModelName).map(modelName => {
				const { showAsDefault, isDownloaded } = infoOfModelName[modelName]

				const {
					downloadable,
					cost,
					supportsTools,
					supportsFIM,
					reasoningCapabilities,
					contextWindow,

					isUnrecognizedModel,
					maxOutputTokens,
					supportsSystemMessage,
				} = getModelCapabilities(providerName, modelName)


				const removeModelButton = <button
					className="absolute -left-1 top-1/2 transform -translate-y-1/2 -translate-x-full text-void-fg-3 hover:text-void-fg-1 text-xs"
					onClick={() => voidSettingsService.deleteModel(providerName, modelName)}
				>
					<X className="w-3.5 h-3.5" />
				</button>



				return (
					<tr key={modelName} className="border-b border-void-border-1 hover:bg-void-bg-3/50">
						<td className="py-2 px-3 relative">
							{!showAsDefault && removeModelButton}
							{modelName}
						</td>
						<td className="py-2 px-3">${cost.output ?? ''}</td>
						<td className="py-2 px-3">{contextWindow ? abbreviateNumber(contextWindow) : ''}</td>
						<td className="py-2 px-3"><YesNoText val={true} /></td>
						<td className="py-2 px-3"><YesNoText val={!!supportsTools || null} /></td>
						<td className="py-2 px-3"><YesNoText val={!!supportsFIM} /></td>
						{/* <td className="py-2 px-3"><YesNoText val={!!reasoningCapabilities} /></td> */}
						{isDetectableLocally && <td className="py-2 px-3">{!!isDownloaded ? <Check className="w-4 h-4" /> : <></>}</td>}
						{providerName === 'ollama' && <th className="py-2 px-3">
							<OllamaDownloadOrRemoveModelButton modelName={modelName} isModelInstalled={infoOfModelName[modelName].isDownloaded} sizeGb={downloadable && downloadable.sizeGb} />
						</th>}

					</tr>
				)
			})}
			<tr className="hover:bg-void-bg-3/50">
				<td className="py-2 px-3 text-void-accent">
					<AddModelInputBox
						key={providerName}
						providerName={providerName}
						compact={true} />
				</td>
				<td colSpan={4}></td>
			</tr>
		</tbody>
	</table>
}




type WantToUseOption = 'smart' | 'private' | 'cheap' | 'all'

const VoidOnboarding = () => {

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const voidSettingsState = useSettingsState()
	const isOnboardingComplete = false // voidSettingsService._isOnboardingComplete

	if (isOnboardingComplete) {
		return null
	}

	const [pageIndex, setPageIndex] = useState(0)


	const skipButton = <SkipButton onClick={() => { setPageIndex(pageIndex + 1) }} />


	// page 1 state
	const [wantToUseOption, setWantToUseOption] = useState<WantToUseOption>('smart')

	// page 2 state
	const [selectedProviderName, setSelectedProviderName] = useState<ProviderName | null>(null)

	const providerNamesOfWantToUseOption: { [wantToUseOption in WantToUseOption]: ProviderName[] } = {
		smart: ['anthropic', 'openAI', 'gemini', 'openRouter'],
		private: ['ollama', 'vLLM', 'openAICompatible'],
		cheap: ['gemini', 'deepseek', 'openRouter', 'ollama', 'vLLM'],
		all: providerNames,
		// TODO allow user to redo onboarding
	}


	const didFillInProviderSettings = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName]._didFillInProviderSettings
	const isApiKeyLongEnoughIfApiKeyExists = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName].apiKey ? voidSettingsState.settingsOfProvider[selectedProviderName].apiKey.length > 15 : true
	const isAtLeastOneModel = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName].models.length >= 1

	const didFillInSelectedProviderSettings = !!(didFillInProviderSettings && isApiKeyLongEnoughIfApiKeyExists && isAtLeastOneModel)

	const prevAndNextButtons = <div className="self-end flex items-center gap-1 pb-8">
		<PreviousButton
			onClick={() => { setPageIndex(pageIndex - 1) }}
		/>
		<NextButton
			onClick={() => { setPageIndex(pageIndex + 1) }}
			disabled={pageIndex === 2 && !didFillInSelectedProviderSettings}
		/>
	</div>


	// cannot be md
	const basicDescOfWantToUseOption: { [wantToUseOption in WantToUseOption]: string } = {
		smart: "Models with the best performance on benchmarks.",
		private: "Fully private and hosted on your computer/network.",
		cheap: "Free and affordable options.",
		all: "",
	}

	// can be md
	const detailedDescOfWantToUseOption: { [wantToUseOption in WantToUseOption]: string } = {
		smart: "Most intelligent and best for agent mode.",
		private: "Private-hosted so your data never leaves your computer or network. [Email us](mailto:founders@voideditor.com) for help setting up at your company.",
		cheap: "Great deals like Gemini 2.5 Pro or self-host a model for free.",
		all: "",
	}

	// set the selected provider name appropriately
	useEffect(() => {
		if (wantToUseOption && providerNamesOfWantToUseOption[wantToUseOption].length > 0) {
			setSelectedProviderName(providerNamesOfWantToUseOption[wantToUseOption][0]);
		} else {
			setSelectedProviderName(null);
		}
	}, [wantToUseOption]);

	// set wantToUseOption to smart when page changes
	useEffect(() => {
		setWantToUseOption(wantToUseOption);
	}, [pageIndex]);


	// TODO add a description next to the skip button saying (you can always restart the onboarding in Settings)
	const contentOfIdx: { [pageIndex: number]: React.ReactNode } = {
		0: <div className="max-w-[600px] w-full h-full text-left mx-auto flex flex-col items-center justify-between">
			<FadeIn >
				<div className="text-5xl font-light mb-6 mt-12 text-center">Welcome to Void</div>


				{/* <div className="w-8 h-8 mb-2">
					<VoidImage className='h-full w-full' />
				</div> */}
			</FadeIn>

			<FadeIn delayMs={1000} className="text-center pb-8" onClick={() => { setPageIndex(pageIndex + 1) }}>
				Get Started
			</FadeIn>
		</div>,
		1: <div className="max-w-full w-full h-full text-left mx-auto flex flex-col items-center justify-between">

			<FadeIn>

				<div className="text-3xl font-medium mb-6 mt-8 text-center">AI Preferences</div>

				<div className="flex flex-col items-center w-full mx-auto">

					<div className="text-base text-void-fg-2 mb-8 text-center">What are you looking for in an AI model?</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full md:max-w-[75%] max-w-[90%]">
						<div
							onClick={() => { setWantToUseOption('smart'); setPageIndex(pageIndex + 1); }}
							className="flex flex-col items-center justify-center p-6 rounded-md transition-all duration-300 cursor-pointer md:aspect-[8/7] border-void-border-1 border bg-gradient-to-br from-[#0e70c0]/15 via-[#0e70c0]/5 to-transparent hover:from-[#0e70c0]/25 hover:via-[#0e70c0]/10 hover:to-[#0e70c0]/5 dark:from-[#0e70c0]/20 dark:via-[#0e70c0]/10 dark:to-[#0e70c0]/5 dark:hover:from-[#0e70c0]/30 dark:hover:via-[#0e70c0]/15 dark:hover:to-[#0e70c0]/5"
						>
							<span className="text-5xl mb-4">🧠</span>
							<h3 className="text-xl font-medium mb-3">Intelligence</h3>
							<p className="text-center text-sm text-void-fg-2">{basicDescOfWantToUseOption['smart']}</p>
						</div>

						<div
							onClick={() => { setWantToUseOption('private'); setPageIndex(pageIndex + 1); }}
							className="flex flex-col items-center justify-center p-6 rounded-md transition-all duration-300 cursor-pointer md:aspect-[8/7] border-void-border-1 border bg-gradient-to-br from-[#0e70c0]/15 via-[#0e70c0]/5 to-transparent hover:from-[#0e70c0]/25 hover:via-[#0e70c0]/10 hover:to-[#0e70c0]/5 dark:from-[#0e70c0]/20 dark:via-[#0e70c0]/10 dark:to-[#0e70c0]/5 dark:hover:from-[#0e70c0]/30 dark:hover:via-[#0e70c0]/15 dark:hover:to-[#0e70c0]/5"
						>
							<span className="text-5xl mb-4">🔒</span>
							<h3 className="text-xl font-medium mb-3">Privacy</h3>
							<p className="text-center text-sm text-void-fg-2">{basicDescOfWantToUseOption['private']}</p>
						</div>

						<div
							onClick={() => { setWantToUseOption('cheap'); setPageIndex(pageIndex + 1); }}
							className="flex flex-col items-center justify-center p-6 rounded-md transition-all duration-300 cursor-pointer md:aspect-[8/7] border-void-border-1 border bg-gradient-to-br from-[#0e70c0]/15 via-[#0e70c0]/5 to-transparent hover:from-[#0e70c0]/25 hover:via-[#0e70c0]/10 hover:to-[#0e70c0]/5 dark:from-[#0e70c0]/20 dark:via-[#0e70c0]/10 dark:to-[#0e70c0]/5 dark:hover:from-[#0e70c0]/30 dark:hover:via-[#0e70c0]/15 dark:hover:to-[#0e70c0]/5"
						>
							<span className="text-5xl mb-4">💵</span>
							<h3 className="text-xl font-medium mb-3">Low-Cost</h3>
							<p className="text-center text-sm text-void-fg-2">{basicDescOfWantToUseOption['cheap']}</p>
						</div>
					</div>
				</div>

			</FadeIn>

			<div className="max-w-[600px] w-full flex flex-col items-center justify-between">
				{prevAndNextButtons}
			</div>

		</div>,
		2: <div className="max-w-[600px] w-full h-full text-left mx-auto flex flex-col items-center justify-between">
			<FadeIn className="flex flex-col gap-2 w-full">

				<div className="text-5xl font-light mb-6 mt-12 text-center">Choose a Provider</div>

				<div className="mx-auto flex items-center overflow-hidden bg-zinc-700/5 dark:bg-zinc-300/5 rounded-md">
					<button
						onClick={() => {
							setWantToUseOption('smart');
						}}
						className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'smart'
								? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
								: 'text-void-fg-3 hover:text-void-fg-2'
							}
							`}
					>
						Intelligent
					</button>
					<button
						onClick={() => {
							setWantToUseOption('private');
						}}
						className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'private'
								? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
								: 'text-void-fg-3 hover:text-void-fg-2'
							}
							`}
					>
						Private
					</button>
					<button
						onClick={() => {
							setWantToUseOption('cheap');
						}}
						className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'cheap'
								? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
								: 'text-void-fg-3 hover:text-void-fg-2'
							}
							`}
					>
						Low-Cost
					</button>
					<button
						onClick={() => {
							setWantToUseOption('all')
						}}
						className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'all'
								? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
								: 'text-void-fg-3 hover:text-void-fg-2'
							}
							`}
					>
						All
					</button>
				</div>

				{/* Provider Buttons */}
				<div
					key={wantToUseOption}
					className="flex flex-wrap items-center mt-4 min-h-[37px] w-full"
				>

					{(wantToUseOption === 'all' ? providerNames : providerNamesOfWantToUseOption[wantToUseOption]).map((providerName) => {
						const isSelected = selectedProviderName === providerName

						return (
							<button
								key={providerName}
								onClick={() => setSelectedProviderName(providerName)}
								className={`py-[2px] px-2 mx-0.5 my-0.5 text-xs font-medium cursor-pointer relative rounded-full transition-colors duration-150 border
									${isSelected ? 'bg-[#0e70c0] text-white shadow-sm border-[#0e70c0]/80' : 'bg-[#0e70c0]/10 text-void-fg-3 hover:bg-[#0e70c0]/30 border-[#0e70c0]/20'}
								`}
							>
								{displayInfoOfProviderName(providerName).title}
							</button>
						)
					})}

				</div>

				{/* Description */}
				<div className="text-left text-sm text-void-fg-3 px-2 py-1">

					<div className='pl-4 select-text'>
						<ChatMarkdownRender string={detailedDescOfWantToUseOption[wantToUseOption]} chatMessageLocation={undefined} />
					</div>

				</div>


				{/* ModelsTable and ProviderFields */}
				{selectedProviderName && <div className='mt-4'>


					{/* Models Table */}
					<TableOfModelsForProvider providerName={selectedProviderName} />


					{/* Add provider section - simplified styling */}
					<div className='mb-5 mt-8'>
						<div className='text-base font-semibold'>
							Add {displayInfoOfProviderName(selectedProviderName).title}


							{selectedProviderName === 'ollama' ? ollamaSetupInstructions : ''}

						</div>

						{selectedProviderName &&
							<SettingsForProvider providerName={selectedProviderName} showProviderTitle={false} showProviderSuggestions={false} />
						}

						{/* Button and status indicators */}
						{!didFillInProviderSettings ? <p className="text-xs text-void-fg-3 mt-2">Please fill in all fields to continue</p>
							: !isAtLeastOneModel ? <p className="text-xs text-void-fg-3 mt-2">Please add a model to continue</p>
								: !isApiKeyLongEnoughIfApiKeyExists ? <p className="text-xs text-void-fg-3 mt-2">Please enter a valid API key</p>
									: <div className="mt-2"><AnimatedCheckmarkButton text='Added' /></div>}
					</div>


				</div>}

			</FadeIn>

			{prevAndNextButtons}
		</div>,
		// 2.5: <div className="max-w-[600px] w-full h-full text-left mx-auto flex flex-col items-center justify-between">
		// 	<FadeIn>
		// 		<div className="text-5xl font-light mb-6 mt-12 text-center">Autocomplete</div>

		// 		<div className="text-center flex flex-col gap-4 w-full max-w-md mx-auto">
		// 			<h4 className="text-void-fg-3 mb-2">Void offers free autocomplete with locally hosted models</h4>
		// 			<h4 className="text-void-fg-3 mb-2">[have buttons for Ollama install Qwen2.5coder3b and memory requirements] </h4>

		// 		</div>
		// 	</FadeIn>

		// 	{prevAndNextButtons}
		// </div>,
		3: <div className="max-w-[600px] w-full h-full text-left mx-auto flex flex-col items-center justify-between">
			<FadeIn>
				<div className="text-5xl font-light mb-6 mt-12">Settings and Themes</div>

				<div className="text-center flex flex-col gap-4 w-full max-w-md mx-auto">
					<h4 className="text-void-fg-3 mb-2">Transfer your settings from an existing editor?</h4>
					<OneClickSwitchButton fromEditor="VS Code" />
					<OneClickSwitchButton fromEditor="Cursor" />
					<OneClickSwitchButton fromEditor="Windsurf" />
				</div>

			</FadeIn>

			{prevAndNextButtons}
		</div>,
		4: <div className="max-w-[600px] w-full h-full text-left mx-auto flex flex-col items-center justify-between">
			<FadeIn className="text-5xl font-light mb-6 mt-12">
				Jump in
			</FadeIn>

			<FadeIn className="text-center">
				Enter the Void
			</FadeIn>

			{prevAndNextButtons}
		</div>,
	}


	return <div key={pageIndex} className="w-full h-full text-left mx-auto overflow-y-auto flex flex-col items-center justify-between">
		{contentOfIdx[pageIndex]}
	</div>
}
