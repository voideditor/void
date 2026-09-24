/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { FeatureName, isFeatureNameDisabled, modelSelectionsEqual, } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { useSettingsState, useAccessor } from '../util/services.js'
import { _VoidSelectBox, VoidCustomDropdownBox } from '../util/inputs.js'
import { VOID_OPEN_SETTINGS_ACTION_ID, } from '../../../voidSettingsPane.js'
import { modelFilterOfFeatureName, ModelOption } from '../../../../../../../platform/void/common/voidSettingsService.js'
import { WarningBox } from './WarningBox.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'

// Helper to get basename for command display
const getBasename = (pathStr: string) => {
	if (!pathStr) return '';
	return pathStr.split(/[/\\]/).pop() || pathStr;
};

const optionsEqual = (m1: ModelOption[], m2: ModelOption[]) => {
	if (m1.length !== m2.length) return false
	for (let i = 0; i < m1.length; i++) {
		if (!modelSelectionsEqual(m1[i].selection, m2[i].selection)) return false
	}
	return true
}

const ModelSelectBox = ({ options, featureName, className }: { options: ModelOption[], featureName: FeatureName, className: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const selection = voidSettingsService.state.modelSelectionOfFeature[featureName]
	const selectedOption = selection
		? voidSettingsService.state._modelOptions.find((v: ModelOption) => modelSelectionsEqual(v.selection, selection))!
		: options[0]

	const onChangeOption = useCallback((newOption: ModelOption) => {
		voidSettingsService.setModelSelectionOfFeature(featureName, newOption.selection)
	}, [voidSettingsService, featureName])

	const asDisplay = (option: ModelOption) => {
		const { providerName } = option.selection;


		const modelLabel = option.name;


		const detail = providerName;

		return { name: modelLabel, detail };
	};

	return (
		<VoidCustomDropdownBox
			options={options}
			selectedOption={selectedOption}
			onChangeOption={onChangeOption}
			getOptionDisplayName={(option) => asDisplay(option).name}
			getOptionDropdownName={(option) => asDisplay(option).name}
			getOptionDropdownDetail={(option) => asDisplay(option).detail}
			getOptionsEqual={(a, b) => optionsEqual([a], [b])}
			className={className}
			matchInputWidth={false}
			enableSearch={true}
			getOptionSearchText={(option) => {
				const { providerName, modelName } = option.selection;
				const display = asDisplay(option).name;
				return `${display} ${providerName} ${modelName}`;
			}}
			searchPlaceholder="Search model..."
		/>
	)
}

const MemoizedModelDropdown = ({ featureName, className }: { featureName: FeatureName, className: string }) => {
	const settingsState = useSettingsState()
	const oldOptionsRef = useRef<ModelOption[]>([])
	const [memoizedOptions, setMemoizedOptions] = useState(oldOptionsRef.current)

	const { filter, emptyMessage } = modelFilterOfFeatureName[featureName]

	useEffect(() => {
		const oldOptions = oldOptionsRef.current
		const newOptions = settingsState._modelOptions.filter((o) => filter(o.selection, { chatMode: settingsState.globalSettings.chatMode, overridesOfModel: settingsState.overridesOfModel }))

		if (!optionsEqual(oldOptions, newOptions)) {
			setMemoizedOptions(newOptions)
		}
		oldOptionsRef.current = newOptions
	}, [settingsState._modelOptions, filter])

	if (memoizedOptions.length === 0) { // Pretty sure this will never be reached unless filter is enabled
		return <WarningBox text={emptyMessage?.message || 'No models available'} />
	}

	return <ModelSelectBox featureName={featureName} options={memoizedOptions} className={className} />
}

export const ModelDropdown = ({ featureName, className }: { featureName: FeatureName, className: string }) => {
	const settingsState = useSettingsState()

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	const openSettings = () => { commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID); };

	const { emptyMessage } = modelFilterOfFeatureName[featureName]

	const isDisabled = isFeatureNameDisabled(featureName, settingsState)

	const isAcpRelevantFeature = (featureName === 'Chat' || featureName === 'Ctrl+K')
	const usingAcp = isAcpRelevantFeature && settingsState.globalSettings.useAcp
	const usingBuiltinAcp = usingAcp && settingsState.globalSettings.acpMode === 'builtin'

	// If using ACP, show agent info instead of model dropdown (for Chat/Ctrl+K)
	// BUT ONLY if NOT using 'builtin' mode (builtin mode proxies to models, so we still need the dropdown)
	if (usingAcp && !usingBuiltinAcp) {
		const isProcess = settingsState.globalSettings.acpMode === 'process';
		const cmd = settingsState.globalSettings.acpProcessCommand;
		const agentName = isProcess
			? (cmd ? getBasename(cmd) : 'Local Agent')
			: 'Remote Agent';

		return (
			<div
				className={`
					flex items-center gap-2 px-2 py-0.5 rounded
					text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-2
					select-none cursor-pointer hover:brightness-95
					${className}
				`}
				onClick={openSettings}
				title="Click to configure Agent"
			>
				<div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
				<span className="truncate max-w-[120px]">{agentName}</span>
			</div>
		);
	}

	const mainContent = isDisabled
		? (
			<WarningBox
				onClick={openSettings}
				text={
					emptyMessage && emptyMessage.priority === 'always' ? emptyMessage.message :
						isDisabled === 'addModel' ? 'Add a model'
							: (isDisabled === 'addProvider' || isDisabled === 'notFilledIn' || isDisabled === 'providerNotAutoDetected') ? 'Provider required'
								: 'Provider required'
				}
			/>
		)
		: (
			<ErrorBoundary>
				<MemoizedModelDropdown featureName={featureName} className={className} />
			</ErrorBoundary>
		)

	// Built-in Void Agent (ACP builtin): keep the model dropdown, but visually mark that we are routed via the agent.
	if (usingBuiltinAcp) {
		return (
			<div className="flex items-center gap-2 min-w-0">
				<div
					className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0"
					title="Using Built-in Void Agent"
				/>
				<div className="min-w-0 flex-1">
					{mainContent}
				</div>
			</div>
		)
	}

	return mainContent
}
