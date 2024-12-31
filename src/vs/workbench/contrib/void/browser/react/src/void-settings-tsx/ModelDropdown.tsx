/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { FeatureName, featureNames, ModelSelection, modelSelectionsEqual, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { useSettingsState, useRefreshModelState, useAccessor } from '../util/services.js'
import { VoidSelectBox } from '../util/inputs.js'
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js'
import { IconWarning } from '../sidebar-tsx/SidebarChat.js'
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js'

const ModelSelectBox = ({ featureName }: { featureName: FeatureName }) => {
	const accessor = useAccessor()

	const voidSettingsService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	let weChangedText = false

	return <VoidSelectBox
		options={settingsState._modelOptions}
		onChangeSelection={useCallback((newVal: ModelSelection) => {
			if (weChangedText) return
			voidSettingsService.setModelSelectionOfFeature(featureName, newVal)
		}, [voidSettingsService, featureName])}
		// we are responsible for setting the initial state here. always sync instance when state changes.
		onCreateInstance={useCallback((instance: SelectBox) => {
			const syncInstance = () => {
				const modelsListRef = voidSettingsService.state._modelOptions // as a ref
				const settingsAtProvider = voidSettingsService.state.modelSelectionOfFeature[featureName]
				const selectionIdx = settingsAtProvider === null ? -1 : modelsListRef.findIndex(v => modelSelectionsEqual(v.value, settingsAtProvider))
				weChangedText = true
				instance.select(selectionIdx === -1 ? 0 : selectionIdx)
				weChangedText = false
			}
			syncInstance()
			const disposable = voidSettingsService.onDidChangeState(syncInstance)
			return [disposable]
		}, [voidSettingsService, featureName])}
	/>
}

const DummySelectBox = () => {

	const accessor = useAccessor()
	const comandService = accessor.get('ICommandService')

	const openSettings = () => {
		comandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID);
	};

	return <div
		className={`
			flex items-center
			flex-nowrap text-ellipsis
			text-vscode-charts-yellow
			hover:brightness-90 transition-all duration-200
			cursor-pointer
		`}
		onClick={openSettings}
	>
		<IconWarning
			size={20}
			className='mr-1 brightness-90'
		/>
		<span>Model required</span>
	</div>
	// return <VoidSelectBox
	// 	options={[{ text: 'Please add a model!', value: null }]}
	// 	onChangeSelection={() => { }}
	// />
}

export const ModelDropdown = ({ featureName }: { featureName: FeatureName }) => {
	const settingsState = useSettingsState()
	return <>
		{settingsState._modelOptions.length === 0 ? <DummySelectBox /> : <ModelSelectBox featureName={featureName} />}
	</>
}
