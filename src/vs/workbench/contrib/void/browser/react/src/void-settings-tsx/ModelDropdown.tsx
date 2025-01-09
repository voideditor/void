/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FeatureName, featureNames, ModelSelection, modelSelectionsEqual, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { useSettingsState, useRefreshModelState, useAccessor } from '../util/services.js'
import { _VoidSelectBox, VoidCustomSelectBox } from '../util/inputs.js'
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js'
import { IconWarning } from '../sidebar-tsx/SidebarChat.js'
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js'
import { ModelOption } from '../../../../../../../platform/void/common/voidSettingsService.js'



const optionsEqual = (m1: ModelOption[], m2: ModelOption[]) => {
	if (m1.length !== m2.length) return false
	for (let i = 0; i < m1.length; i++) {
		if (!modelSelectionsEqual(m1[i].selection, m2[i].selection)) return false
	}
	return true
}

const ModelSelectBox = ({ options, featureName }: { options: ModelOption[], featureName: FeatureName }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const selection = voidSettingsService.state.modelSelectionOfFeature[featureName]
	const selectedOption = selection ? voidSettingsService.state._modelOptions.find(v => modelSelectionsEqual(v.selection, selection)) : options[0]

	const onChangeOption = useCallback((newOption: ModelOption) => {
		voidSettingsService.setModelSelectionOfFeature(featureName, newOption.selection)
	}, [voidSettingsService, featureName])

	return <VoidCustomSelectBox
		options={options}
		selectedOption={selectedOption}
		onChangeOption={onChangeOption}
		getOptionName={(option) => option.name}
		getOptionsEqual={(a, b) => optionsEqual([a], [b])}

	/>
}
// const ModelSelectBox = ({ options, featureName }: { options: ModelOption[], featureName: FeatureName }) => {
// 	const accessor = useAccessor()

// 	const voidSettingsService = accessor.get('IVoidSettingsService')

// 	let weChangedText = false

// 	return <VoidSelectBox
// 		className='@@[&_select]:!void-text-xs text-void-fg-3'
// 		options={options}
// 		onChangeSelection={useCallback((newVal: ModelSelection) => {
// 			if (weChangedText) return
// 			voidSettingsService.setModelSelectionOfFeature(featureName, newVal)
// 		}, [voidSettingsService, featureName])}
// 		// we are responsible for setting the initial state here. always sync instance when state changes.
// 		onCreateInstance={useCallback((instance: SelectBox) => {
// 			const syncInstance = () => {
// 				const modelsListRef = voidSettingsService.state._modelOptions // as a ref
// 				const settingsAtProvider = voidSettingsService.state.modelSelectionOfFeature[featureName]
// 				const selectionIdx = settingsAtProvider === null ? -1 : modelsListRef.findIndex(v => modelSelectionsEqual(v.value, settingsAtProvider))
// 				weChangedText = true
// 				instance.select(selectionIdx === -1 ? 0 : selectionIdx)
// 				weChangedText = false
// 			}
// 			syncInstance()
// 			const disposable = voidSettingsService.onDidChangeState(syncInstance)
// 			return [disposable]
// 		}, [voidSettingsService, featureName])}
// 	/>
// }

const MemoizedModelSelectBox = ({ featureName }: { featureName: FeatureName }) => {
	const settingsState = useSettingsState()
	const oldOptionsRef = useRef<ModelOption[]>([])
	const [memoizedOptions, setMemoizedOptions] = useState(oldOptionsRef.current)
	useEffect(() => {
		const oldOptions = oldOptionsRef.current
		const newOptions = settingsState._modelOptions
		if (!optionsEqual(oldOptions, newOptions)) {
			setMemoizedOptions(newOptions)
		}
		oldOptionsRef.current = newOptions
	}, [settingsState._modelOptions])

	return <ModelSelectBox featureName={featureName} options={memoizedOptions} />

}

const DummySelectBox = () => {

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	const openSettings = () => {
		commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID);
	};

	return <div
		className={`
			flex items-center
			flex-nowrap text-ellipsis

			text-void-warning brightness-90 opacity-90

			hover:brightness-75 transition-all duration-200
			cursor-pointer
			text-xs
		`}
		onClick={openSettings}
	>
		<IconWarning
			size={14}
			className='mr-1 brightness-90'
		/>
		<span>Provider required</span>
	</div>
	// return <VoidSelectBox
	// 	options={[{ text: 'Please add a model!', value: null }]}
	// 	onChangeSelection={() => { }}
	// />
}

export const ModelDropdown = ({ featureName }: { featureName: FeatureName }) => {
	const settingsState = useSettingsState()
	return <>
		{settingsState._modelOptions.length === 0 ? <DummySelectBox /> : <MemoizedModelSelectBox featureName={featureName} />}
	</>
}
