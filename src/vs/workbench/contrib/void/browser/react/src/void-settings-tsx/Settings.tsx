/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { ProviderName, SettingName, displayInfoOfSettingName, providerNames, VoidStatefulModelInfo, customSettingNamesOfProvider, RefreshableProviderName, refreshableProviderNames, displayInfoOfProviderName, nonlocalProviderNames, localProviderNames, GlobalSettingName, featureNames, displayInfoOfFeatureName, isProviderNameDisabled, FeatureName, hasDownloadButtonsOnModelsProviderNames, subTextMdOfProviderName } from '../../../../common/voidSettingsTypes.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidButtonBgDarken, VoidCustomDropdownBox, VoidInputBox2, VoidSimpleInputBox, VoidSwitch } from '../util/inputs.js'
import { useAccessor, useIsDark, useRefreshModelListener, useRefreshModelState, useSettingsState } from '../util/services.js'
import { X, RefreshCw, Loader2, Check, Asterisk, Settings as SettingsIcon } from 'lucide-react'
import { URI } from '../../../../../../../base/common/uri.js'
import { env } from '../../../../../../../base/common/process.js'
import { ModelDropdown } from './ModelDropdown.js'
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js'
import { WarningBox } from './WarningBox.js'
import { os } from '../../../../common/helpers/systemInfo.js'
import { IconLoading } from '../sidebar-tsx/SidebarChat.js'
import { ToolApprovalType, toolApprovalTypes } from '../../../../common/toolsServiceTypes.js'
import Severity from '../../../../../../../base/common/severity.js'

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
		className={`bg-[#0e70c0] px-3 py-1 text-white rounded-sm ${!disabled ? 'hover:bg-[#1177cb] cursor-pointer' : 'opacity-50 cursor-not-allowed bg-opacity-70'}`}
		{...props}
	>{text}</button>

}

// ConfirmButton prompts for a second click to confirm an action, cancels if clicking outside
const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!confirm) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [confirm]);
	return (
		<div ref={ref} className={`inline-block`}>
			<VoidButtonBgDarken className={className} onClick={() => {
				if (!confirm) {
					setConfirm(true);
				} else {
					onConfirm();
					setConfirm(false);
				}
			}}>
				{confirm ? `Confirm Reset` : children}
			</VoidButtonBgDarken>
		</div>
	);
};


// shows a providerName dropdown if no `providerName` is given
export const AddModelInputBox = ({ providerName: permanentProviderName, className, compact }: { providerName?: ProviderName, className?: string, compact?: boolean }) => {

	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')

	const settingsState = useSettingsState()

	const [isOpen, setIsOpen] = useState(false)
	const [showCheckmark, setShowCheckmark] = useState(false)

	// const providerNameRef = useRef<ProviderName | null>(null)
	const [userChosenProviderName, setUserChosenProviderName] = useState<ProviderName | null>(null)

	const providerName = permanentProviderName ?? userChosenProviderName;

	const [modelName, setModelName] = useState<string>('')
	const [errorString, setErrorString] = useState('')

	const numModels = providerName === null ? 0 : settingsState.settingsOfProvider[providerName].models.length

	if (showCheckmark) {
		return <AnimatedCheckmarkButton text='Added' className={`bg-[#0e70c0] text-white px-3 py-1 rounded-sm ${className}`} />
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
			<ErrorBoundary>
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
			</ErrorBoundary>


			{/* model input */}
			<ErrorBoundary>
				<VoidSimpleInputBox
					value={modelName}
					onChangeValue={setModelName}
					placeholder='Model Name'
					compact={compact}
					className={'max-w-32'}
				/>
			</ErrorBoundary>

			{/* add button */}
			<ErrorBoundary>
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
			</ErrorBoundary>


		</form>

		{!errorString ? null : <div className='text-red-500 truncate whitespace-nowrap mt-1'>
			{errorString}
		</div>}

	</>

}


// Import the getModelCapabilities function to access default values
import { getModelCapabilities, ModelOverrideOptions } from '../../../../common/modelCapabilities.js';

// Modal dialog to show model settings
const ModelSettingsDialog = ({
	isOpen,
	onClose,
	modelInfo
}: {
	isOpen: boolean,
	onClose: () => void,
	modelInfo: { modelName: string, providerName: ProviderName, type: string } | null
}) => {
	if (!isOpen || !modelInfo) return null;

	const { modelName, providerName } = modelInfo;
	const accessor = useAccessor();
	const settingsStateService = accessor.get('IVoidSettingsService');
	const settingsState = useSettingsState();

	// Get current model capabilities and override settings
	const modelCapabilities = getModelCapabilities(providerName, modelName, settingsState.overridesOfModel);
	const defaultModelCapabilities = getModelCapabilities(providerName, modelName, undefined)

	// Initialize form state for all potential override options
	const [formValues, setFormValues] = useState<{
		contextWindow: string;
		reservedOutputTokenSpace: string;
		specialToolFormat: 'openai-style' | 'gemini-style' | 'anthropic-style' | undefined | '';
		supportsSystemMessage: 'system-role' | 'developer-role' | 'separated' | false | '';
		supportsFIM: boolean | null;
		reasoningCapabilities: boolean | null;
		canTurnOffReasoning: boolean;
		reasoningReservedOutputTokenSpace: string;
		openSourceThinkTags: [string, string] | null;
	}>({
		// start form as default values
		contextWindow: '',
		reservedOutputTokenSpace: '',
		specialToolFormat: '',
		supportsSystemMessage: '',
		supportsFIM: null,
		reasoningCapabilities: null,
		canTurnOffReasoning: false,
		reasoningReservedOutputTokenSpace: '',
		openSourceThinkTags: null,
	});

	// When dialog opens or model changes, reset form values
	useEffect(() => {
		if (isOpen && modelInfo) {
			// Get current overrides
			const overrides = settingsState.overridesOfModel?.[providerName]?.[modelName] || {};

			// Extract reasoning capabilities if available (use any to avoid TS union narrowing issues)
			const reasoningCapabilities: any = typeof overrides.reasoningCapabilities === 'object' ?
				overrides.reasoningCapabilities : overrides.reasoningCapabilities ? { supportsReasoning: true, canIOReasoning: true } : false;

			// Extract the think tags if they exist
			let thinkTags: [string, string] | null = null;
			if (typeof reasoningCapabilities === 'object' && reasoningCapabilities.openSourceThinkTags) {
				thinkTags = reasoningCapabilities.openSourceThinkTags as [string, string];
			}

			// Only set values that are explicitly overridden, otherwise leave them empty
			// to indicate default values should be used
			setFormValues({
				contextWindow: overrides.contextWindow !== undefined ? String(overrides.contextWindow) : '',
				reservedOutputTokenSpace: overrides.reservedOutputTokenSpace !== undefined ? String(overrides.reservedOutputTokenSpace) : '',
				specialToolFormat: overrides.specialToolFormat !== undefined ? overrides.specialToolFormat : '',
				supportsSystemMessage: overrides.supportsSystemMessage !== undefined ? overrides.supportsSystemMessage : '',
				supportsFIM: overrides.supportsFIM !== undefined ? overrides.supportsFIM : null,
				reasoningCapabilities: overrides.reasoningCapabilities !== undefined ?
					!!overrides.reasoningCapabilities : null,
				canTurnOffReasoning: typeof reasoningCapabilities === 'object' ? !!reasoningCapabilities.canTurnOffReasoning : false,
				reasoningReservedOutputTokenSpace: typeof reasoningCapabilities === 'object' && reasoningCapabilities.reasoningReservedOutputTokenSpace ?
					String(reasoningCapabilities.reasoningReservedOutputTokenSpace) : '',
				openSourceThinkTags: thinkTags,
			});
		}
	}, [isOpen, modelInfo, settingsState.overridesOfModel, providerName, modelName]);

	// Update a single field in the form
	const updateField = (field: keyof typeof formValues, value: any) => {
		setFormValues(prev => ({
			...prev,
			[field]: value
		}));
	};

	// Handle saving settings
	const handleSave = async () => {
		// Get current overrides to see what needs to be updated/removed
		const currentOverrides = settingsState.overridesOfModel?.[providerName]?.[modelName] || {};
		const newSettings: ModelOverrideOptions = {};

		// Handle numeric fields - empty strings should remove the override
		if (formValues.contextWindow.trim() === '') {
			newSettings.contextWindow = defaultModelCapabilities.contextWindow;
		} else if (formValues.contextWindow) {
			const tokens = parseInt(formValues.contextWindow);
			if (!isNaN(tokens)) newSettings.contextWindow = tokens;
		}

		if (formValues.reservedOutputTokenSpace.trim() === '') {
			newSettings.reservedOutputTokenSpace = defaultModelCapabilities.reservedOutputTokenSpace;
		} else if (formValues.reservedOutputTokenSpace) {
			const tokens = parseInt(formValues.reservedOutputTokenSpace);
			if (!isNaN(tokens)) newSettings.reservedOutputTokenSpace = tokens;
		}

		// Handle dropdown fields
		if (formValues.specialToolFormat === '') {
			newSettings.specialToolFormat = defaultModelCapabilities.specialToolFormat
		} else {
			newSettings.specialToolFormat = formValues.specialToolFormat
		}

		if (formValues.supportsSystemMessage === '') {
			newSettings.supportsSystemMessage = defaultModelCapabilities.supportsSystemMessage;
		} else {
			newSettings.supportsSystemMessage = formValues.supportsSystemMessage as any;
		}

		if (formValues.supportsFIM === null) {
			newSettings.supportsFIM = defaultModelCapabilities.supportsFIM
		} else {
			newSettings.supportsFIM = formValues.supportsFIM;
		}

		if (formValues.reasoningCapabilities === null) {
			newSettings.reasoningCapabilities = defaultModelCapabilities.reasoningCapabilities;
		} else if (formValues.reasoningCapabilities) {
			const reasoningSettings: any = {
				supportsReasoning: true,
				canIOReasoning: true,
				canTurnOffReasoning: formValues.canTurnOffReasoning
			};

			// Only add these if they have values
			if (formValues.reasoningReservedOutputTokenSpace) {
				reasoningSettings.reasoningReservedOutputTokenSpace = parseInt(formValues.reasoningReservedOutputTokenSpace);
			}

			if (formValues.openSourceThinkTags) {
				reasoningSettings.openSourceThinkTags = formValues.openSourceThinkTags;
			}

			newSettings.reasoningCapabilities = reasoningSettings;
		} else {
			newSettings.reasoningCapabilities = false;
		}

		await settingsStateService.setOverridesOfModel(providerName, modelName, newSettings);
		onClose();
	};



	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
			<div className="bg-void-bg-1 rounded-md p-4 max-w-md w-full shadow-xl overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
				<div className="flex justify-between items-center mb-4">
					<h3 className="text-lg font-medium">Change Defaults for {modelName} ({displayInfoOfProviderName(providerName).title})</h3>
					<button onClick={onClose} className="text-void-fg-3 hover:text-void-fg-1">
						<X className="size-5" />
					</button>
				</div>

				<div className="mb-4">
					{/* Model-specific settings */}
					<div className="border border-void-border-2 rounded-sm p-3">

						{/* Context window */}
						<div className="flex items-center justify-between py-1">
							<span className="text-void-fg-2">Context window (tokens)</span>
							<div className="flex items-center gap-2">
								<VoidSwitch
									size="xxs"
									value={formValues.contextWindow !== ''}
									onChange={(enabled) => {
										updateField('contextWindow', enabled ? String(defaultModelCapabilities.contextWindow) : '');
									}}
								/>
								{formValues.contextWindow === '' ? (
									<span className="text-void-fg-3 text-xs w-24 text-right">Default ({defaultModelCapabilities.contextWindow})</span>
								) : (
									<VoidSimpleInputBox
										value={formValues.contextWindow}
										onChangeValue={(value) => updateField('contextWindow', value)}
										placeholder={String(defaultModelCapabilities.contextWindow)}
										compact={true}
										className="max-w-24"
									/>
								)}
							</div>
						</div>

						{/* Maximum output tokens */}
						<div className="flex items-center justify-between py-1">
							<span className="text-void-fg-2">Maximum output tokens</span>
							<div className="flex items-center gap-2">
								<VoidSwitch
									size="xxs"
									value={formValues.reservedOutputTokenSpace !== ''}
									onChange={(enabled) => {
										updateField('reservedOutputTokenSpace', enabled ? String(defaultModelCapabilities.reservedOutputTokenSpace) : '');
									}}
								/>
								{formValues.reservedOutputTokenSpace === '' ? (
									<span className="text-void-fg-3 text-xs w-24 text-right">Default ({defaultModelCapabilities.reservedOutputTokenSpace})</span>
								) : (
									<VoidSimpleInputBox
										value={formValues.reservedOutputTokenSpace}
										onChangeValue={(value) => updateField('reservedOutputTokenSpace', value)}
										placeholder={String(defaultModelCapabilities.reservedOutputTokenSpace)}
										compact={true}
										className="max-w-24"
									/>
								)}
							</div>
						</div>

						{/* Supports Tools */}
						<div className="flex items-center justify-between py-1">
							<span className="text-void-fg-2">Supports tools</span>
							<VoidCustomDropdownBox
								options={['', 'openai-style']}
								selectedOption={formValues.specialToolFormat}
								onChangeOption={(value) => updateField('specialToolFormat', value)}
								getOptionDisplayName={(opt) => {
									if (opt === '') return `Default (${defaultModelCapabilities.specialToolFormat || 'No'})`;
									return opt;
								}}
								getOptionDropdownName={(opt) => {
									if (opt === '') return `Default`;
									return opt;
								}}
								getOptionsEqual={(a, b) => a === b}
								className="max-w-32 text-xs"
							/>
						</div>

						{/* Supports System Message */}
						<div className="flex items-center justify-between py-1">
							<span className="text-void-fg-2">Supports system message</span>
							<VoidCustomDropdownBox
								options={['', 'system-role', 'developer-role', false]}
								selectedOption={formValues.supportsSystemMessage}
								onChangeOption={(value) => updateField('supportsSystemMessage', value)}
								getOptionDisplayName={(opt) => {
									if (opt === '') return `Default (${defaultModelCapabilities.supportsSystemMessage || 'No'})`;
									if (opt === false) return 'No'
									if (opt === true) return 'Yes' // should never happen
									return opt;
								}}
								getOptionDropdownName={(opt) => {
									if (opt === '') return `Default`;
									if (opt === false) return 'No'
									if (opt === true) return 'Yes' // should never happen
									return opt;
								}}
								getOptionsEqual={(a, b) => a === b}
								className="max-w-32 text-xs"
							/>
						</div>

						{/* Supports FIM */}
						<div className="flex items-center justify-between py-1">
							<span className="text-void-fg-2">Supports fill-in-the-middle (autocomplete)</span>
							<VoidCustomDropdownBox
								options={[null, true, false]}
								selectedOption={formValues.supportsFIM}
								onChangeOption={(value) => updateField('supportsFIM', value)}
								getOptionDisplayName={(opt) => {
									if (opt === null) return `Default (${defaultModelCapabilities.supportsFIM ? 'Yes' : 'No'})`;
									return opt ? 'Yes' : 'No';
								}}
								getOptionDropdownName={(opt) => {
									if (opt === null) return 'Default';
									return opt ? 'Yes' : 'No';
								}}
								getOptionsEqual={(a, b) => a === b}
								className="max-w-32 text-xs"
							/>
						</div>

						{/* Supports Reasoning */}
						<div className="flex items-center justify-between py-1">
							<span className="text-void-fg-2">Supports reasoning</span>
							<VoidCustomDropdownBox
								options={[null, true, false]}
								selectedOption={formValues.reasoningCapabilities}
								onChangeOption={(value) => updateField('reasoningCapabilities', value)}
								getOptionDisplayName={(opt) => {
									if (opt === null) return `Default (${defaultModelCapabilities.reasoningCapabilities ? 'Yes' : 'No'})`;
									return opt ? 'Yes' : 'No';
								}}
								getOptionDropdownName={(opt) => {
									if (opt === null) return 'Default';
									return opt ? 'Yes' : 'No';
								}}
								getOptionsEqual={(a, b) => a === b}
								className="max-w-32 text-xs"
							/>
						</div>

						{/* Additional reasoning options - only show when reasoning is enabled */}
						{formValues.reasoningCapabilities && (
							<>
								{/* Can Turn Off Reasoning */}
								<div className="flex items-center justify-between py-1 pl-6">
									<span className="text-void-fg-2">Allow turning off reasoning</span>
									<VoidCustomDropdownBox
										options={[true, false]}
										selectedOption={formValues.canTurnOffReasoning}
										onChangeOption={(value) => updateField('canTurnOffReasoning', value)}
										getOptionDisplayName={(opt) => opt ? 'Yes' : 'No'}
										getOptionDropdownName={(opt) => opt ? 'Yes' : 'No'}
										getOptionsEqual={(a, b) => a === b}
										className="max-w-32 text-xs"
									/>
								</div>

								{/* Reasoning Max Output Tokens - only shown if canTurnOffReasoning is true */}
								{formValues.canTurnOffReasoning && (
									<div className="flex items-center justify-between py-1 pl-6">
										<span className="text-void-fg-2">Max output tokens when reasoning</span>
										<div className="flex items-center gap-2">
											<VoidSwitch
												size="xxs"
												value={formValues.reasoningReservedOutputTokenSpace !== ''}
												onChange={(enabled) => {
													// Use a reasonable default value when enabling
													const defaultValue = defaultModelCapabilities.reservedOutputTokenSpace || 500;
													updateField('reasoningReservedOutputTokenSpace', enabled ? String(defaultValue) : '');
												}}
											/>
											{formValues.reasoningReservedOutputTokenSpace === '' ? (
												<span className="text-void-fg-3 text-xs w-24 text-right">Default</span>
											) : (
												<VoidSimpleInputBox
													value={formValues.reasoningReservedOutputTokenSpace}
													onChangeValue={(value) => updateField('reasoningReservedOutputTokenSpace', value)}
													placeholder="Default"
													compact={true}
													className="max-w-24"
												/>
											)}
										</div>
									</div>
								)}

								{/* Open Source Think Tags Toggle + Input Fields */}
								<div className="flex items-center justify-between py-1 pl-6">
									<span className="text-void-fg-2">Open source think tags</span>
									<div className="flex items-center gap-2">
										<VoidSwitch
											size="xxs"
											value={formValues.openSourceThinkTags !== null}
											onChange={(enabled) => {
												if (enabled) {
													// Enable with default values
													updateField('openSourceThinkTags', ['<think>', '</think>']);
												} else {
													// Disable
													updateField('openSourceThinkTags', null);
												}
											}}
										/>

										{formValues.openSourceThinkTags !== null && (
											<div className="flex gap-1 items-center">
												<VoidSimpleInputBox
													value={formValues.openSourceThinkTags ? formValues.openSourceThinkTags[0] : ''}
													onChangeValue={(value) => {
														const currentTags = formValues.openSourceThinkTags || ['', ''];
														updateField('openSourceThinkTags', [value, currentTags[1]]);
													}}
													placeholder="<think>"
													compact={true}
													className="max-w-16"
												/>
												<span className="text-void-fg-3">...</span>
												<VoidSimpleInputBox
													value={formValues.openSourceThinkTags ? formValues.openSourceThinkTags[1] : ''}
													onChangeValue={(value) => {
														const currentTags = formValues.openSourceThinkTags || ['', ''];
														updateField('openSourceThinkTags', [currentTags[0], value]);
													}}
													placeholder="</think>"
													compact={true}
													className="max-w-16"
												/>
											</div>
										)}
									</div>
								</div>
							</>
						)}
					</div>
				</div>

				<div className="flex justify-end gap-2">
					<VoidButtonBgDarken onClick={onClose} className="px-3 py-1">
						Cancel
					</VoidButtonBgDarken>
					<VoidButtonBgDarken onClick={handleSave} className="px-3 py-1 bg-[#0e70c0] text-white">
						Save
					</VoidButtonBgDarken>
				</div>
			</div>
		</div>
	);
};

export const ModelDump = () => {
	const accessor = useAccessor()
	const settingsStateService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	// State to track which model's settings dialog is open
	const [openSettingsModel, setOpenSettingsModel] = useState<{
		modelName: string,
		providerName: ProviderName,
		type: string
	} | null>(null);

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
			const { isHidden, type, modelName, providerName, providerEnabled } = m

			const isNewProviderName = (i > 0 ? modelDump[i - 1] : undefined)?.providerName !== providerName

			const providerTitle = displayInfoOfProviderName(providerName).title

			const disabled = !providerEnabled
			const value = disabled ? false : !isHidden

			const tooltipName = (
				disabled ? `Add ${providerTitle} to enable`
					: value === true ? 'Show in Dropdown'
						: 'Hide from Dropdown'
			)


			const detailAboutModel = type === 'autodetected' ?
				<Asterisk size={14} className="inline-block align-text-top brightness-115 stroke-[2] text-[#0e70c0]" data-tooltip-id='void-tooltip' data-tooltip-place='right' data-tooltip-content='Detected locally' />
				: type === 'custom' ?
					<Asterisk size={14} className="inline-block align-text-top brightness-115 stroke-[2] text-[#0e70c0]" data-tooltip-id='void-tooltip' data-tooltip-place='right' data-tooltip-content='Custom model' />
					: undefined



			return <div key={`${modelName}${providerName}`}
				className={`flex items-center justify-between gap-4 hover:bg-black/10 dark:hover:bg-gray-300/10 py-1 px-3 rounded-sm overflow-hidden cursor-default truncate group
				`}
			>
				{/* left part is width:full */}
				<div className={`flex flex-grow items-center gap-4`}>
					<span className='w-full max-w-32'>{isNewProviderName ? providerTitle : ''}</span>
					<span className='w-fit truncate'>{modelName}</span>
				</div>

				{/* right part is anything that fits */}
				<div className="flex items-center gap-4 w-fit">

					{/* Advanced Settings button - only for custom or locally detected models */}
					<div className="w-5 flex items-center justify-center">
						<button
							onClick={() => { setOpenSettingsModel({ modelName, providerName, type }) }}
							data-tooltip-id='void-tooltip'
							data-tooltip-place='right'
							data-tooltip-content='Advanced Settings'
							className="opacity-0 group-hover:opacity-100 transition-opacity"
						>
							<SettingsIcon size={14} className="text-void-fg-3" />
						</button>
					</div>

					{/* Blue star */}
					{detailAboutModel}


					{/* Switch */}
					<VoidSwitch
						value={value}
						onChange={() => { settingsStateService.toggleModelHidden(providerName, modelName); }}
						disabled={disabled}
						size='sm'

						data-tooltip-id='void-tooltip'
						data-tooltip-place='right'
						data-tooltip-content={tooltipName}
					/>

					{/* X button */}
					<div className={`w-5 flex items-center justify-center`}>
						{type === 'default' || type === 'autodetected' ? null : <button onClick={() => { settingsStateService.deleteModel(providerName, modelName); }}><X className="size-4" /></button>}
					</div>
				</div>
			</div>
		})}

		{/* Model Settings Dialog */}
		<ModelSettingsDialog
			isOpen={openSettingsModel !== null}
			onClose={() => setOpenSettingsModel(null)}
			modelInfo={openSettingsModel}
		/>
	</div>
}



// providers

const ProviderSetting = ({ providerName, settingName, subTextMd }: { providerName: ProviderName, settingName: SettingName, subTextMd: React.ReactNode }) => {

	const { title: settingTitle, placeholder, isPasswordField } = displayInfoOfSettingName(providerName, settingName)

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
			{!subTextMd ? null : <div className='py-1 px-3 opacity-50 text-sm'>
				{subTextMd}
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

				return <ProviderSetting
					key={settingName}
					providerName={providerName}
					settingName={settingName}
					subTextMd={i !== settingNames.length - 1 ? null
						: <ChatMarkdownRender string={subTextMdOfProviderName(providerName)} chatMessageLocation={undefined} />}
				/>
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


export const OllamaSetupInstructions = () => {
	return <div className='prose-p:my-0 prose-ol:list-decimal prose-p:py-0 prose-ol:my-0 prose-ol:py-0 prose-span:my-0 prose-span:py-0 text-void-fg-3 text-sm list-decimal select-text'>
		<div className=''><ChatMarkdownRender string={`Ollama Setup Instructions`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`1. Download [Ollama](https://ollama.com/download).`} chatMessageLocation={undefined} /></div>
		<div className=' pl-6'><ChatMarkdownRender string={`2. Open your terminal.`} chatMessageLocation={undefined} /></div>
		<div
			className='pl-6 flex items-center w-fit'
			data-tooltip-id='void-tooltip-ollama-settings'
		>
			<ChatMarkdownRender string={`3. Run \`ollama pull your_model\` to install a model.`} chatMessageLocation={undefined} />
		</div>
		<div className=' pl-6'><ChatMarkdownRender string={`Void automatically detects locally running models and enables them.`} chatMessageLocation={undefined} /></div>
	</div>
}


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




export const ToolApprovalTypeSwitch = ({ approvalType, size, desc }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		voidSettingsService.setGlobalSetting('autoApprove', {
			...voidSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [voidSettingsService, metricsService])

	return <>
		<VoidSwitch
			size={size}
			value={voidSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className="text-void-fg-3 text-xs">{desc}</span>
	</>
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
		// Define extensions to skip when transferring
		const extensionBlacklist = [
			// ignore extensions
			'ms-vscode-remote.remote-ssh',
			'ms-vscode-remote.remote-wsl',
			// ignore other AI copilots that could conflict with Void keybindings
			'sourcegraph.cody-ai',
			'continue.continue',
			'codeium.codeium',
			'saoudrizwan.claude-dev', // cline
			'rooveterinaryinc.roo-cline', // roo
		];
		for (const { from, to } of transferTheseFiles) {
			console.log('Transferring...', from)
			try {
				// find a blacklisted item
				const isBlacklisted = extensionBlacklist.find(blacklistItem => {
					return from.fsPath?.includes(blacklistItem)
				})
				if (isBlacklisted) {
					console.log(`Skipping conflicting item (${isBlacklisted})`)
					continue
				}

			} catch { }

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
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			// Export chat threads
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'void-chats.json'
		}
		else if (t === 'Settings') {
			// Export user settings
			dataStr = JSON.stringify(voidSettingsService.state, null, 2)
			downloadName = 'void-settings.json'
		}
		else {
			dataStr = ''
			downloadName = ''
		}

		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}


	// Add file input refs
	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)

	const [s, ss] = useState(0)

	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>,) => {
		const files = e.target.files
		if (!files) return;
		const file = files[0]
		if (!file) return

		const reader = new FileReader();
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string);

				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				}
				else if (t === 'Settings') {
					voidSettingsService.dangerousSetState(json as any)
				}

				notificationService.info(`${t} imported successfully!`)
			} catch (err) {
				notificationService.notify({ message: `Failed to import ${t}`, source: err + '', severity: Severity.Error, })
			}
		};
		reader.readAsText(file);
		e.target.value = '';

		ss(s => s + 1)
	}


	return <div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%' }}>
		<div className='overflow-y-auto w-full h-full px-10 py-10 select-none'>

			<div className='max-w-xl mx-auto'>

				<h1 className='text-2xl w-full'>{`Void's Settings`}</h1>

				{/* separator */}
				<div className='w-full h-[1px] my-4' />

				{/* Models section (formerly FeaturesTab) */}

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
					<OllamaSetupInstructions />
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

				<div className='flex flex-col gap-y-8 my-4'>
					<ErrorBoundary>
						{/* FIM */}
						<div>
							<h4 className={`text-base`}>{displayInfoOfFeatureName('Autocomplete')}</h4>
							<div className='text-sm italic text-void-fg-3 mt-1'>
								<span>
									Experimental.{' '}
								</span>
								<span
									className='hover:brightness-110'
									data-tooltip-id='void-tooltip'
									data-tooltip-content='We recommend using the largest qwen2.5-coder model you can with Ollama (try qwen2.5-coder:3b).'
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
							<div className='text-sm italic text-void-fg-3 mt-1'>Settings that control the behavior of the Apply button.</div>

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





					{/* Tools Section */}
					<div>
						<h4 className={`text-base`}>Tools</h4>
						<div className='text-sm italic text-void-fg-3 mt-1'>{`Tools are functions that LLMs can call. Some tools require user approval.`}</div>

						<div className='my-2'>
							{/* Auto Accept Switch */}
							<ErrorBoundary>
								{[...toolApprovalTypes].map((approvalType) => {
									return <div key={approvalType} className="flex items-center gap-x-2 my-2">
										<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
									</div>
								})}

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
						<div className='text-sm italic text-void-fg-3 mt-1'>{`Settings that control the visibility of Void suggestions in the code editor.`}</div>

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
						<h2 className='text-3xl mb-2 mt-12'>One-Click Switch</h2>
						<h4 className='text-void-fg-3 mb-4'>{`Transfer your editor settings into Void.`}</h4>

						<div className='flex flex-col gap-2'>
							<OneClickSwitchButton className='w-48' fromEditor="VS Code" />
							<OneClickSwitchButton className='w-48' fromEditor="Cursor" />
							<OneClickSwitchButton className='w-48' fromEditor="Windsurf" />
						</div>
					</ErrorBoundary>
				</div>

				{/* Import/Export section, as its own block right after One-Click Switch */}
				<div className='mt-12'>
					<h2 className='text-3xl mb-2'>Import/Export</h2>
					<h4 className='text-void-fg-3 mb-4'>{`Transfer Void's settings and chats in and out of Void.`}</h4>
					<div className='flex flex-col gap-8'>
						{/* Settings Subcategory */}
						<div className='flex flex-col gap-2 max-w-48 w-full'>
							<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
							<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputSettingsRef.current?.click() }}>
								Import Settings
							</VoidButtonBgDarken>
							<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Settings')}>
								Export Settings
							</VoidButtonBgDarken>
							<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { voidSettingsService.resetState(); }}>
								Reset Settings
							</ConfirmButton>
						</div>
						{/* Chats Subcategory */}
						<div className='flex flex-col gap-2 w-full max-w-48'>
							<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
							<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputChatsRef.current?.click() }}>
								Import Chats
							</VoidButtonBgDarken>
							<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Chats')}>
								Export Chats
							</VoidButtonBgDarken>
							<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { chatThreadsService.resetState(); }}>
								Reset Chats
							</ConfirmButton>
						</div>
					</div>
				</div>



				<div className='mt-12'>

					<h2 className={`text-3xl mb-2`}>Built-in Settings</h2>
					<h4 className={`text-void-fg-3 mb-4`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>

					<ErrorBoundary>
						<div className='flex flex-col gap-2 justify-center max-w-48 w-full'>
							<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>
								General Settings
							</VoidButtonBgDarken>
							<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>
								Keyboard Settings
							</VoidButtonBgDarken>
							<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>
								Theme Settings
							</VoidButtonBgDarken>
							<VoidButtonBgDarken className='px-4 py-1' onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>
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
Alternatively, place a \`.voidrules\` file in the root of your workspace.
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

