/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { displayInfoOfSettingName, ProviderName, providerNames, ProviderSettingName, VoidProviderState } from '../../../../../../../platform/void/common/configTypes.js'
import { VoidCheckBox, VoidInputBox, VoidSelectBox } from './inputs.js'
import { useConfigState, useService } from '../util/services.js'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'


const Setting = ({ providerName, settingName }: { providerName: ProviderName, settingName: any }) => {

	const { title, type, placeholder } = displayInfoOfSettingName(providerName, settingName)
	const voidConfigService = useService('configStateService')

	const instanceRef = useRef<InputBox | null>(null)

	useEffect(() => {
		// this is really just to sync the state on initial mount, when init value hasn't been set yet
		const syncState = () => {
			if (!instanceRef.current) return
			// @ts-ignore
			const stateVal = voidConfigService.state[providerName][settingName]
			if (instanceRef.current.value !== stateVal)
				instanceRef.current.value = stateVal
		}
		syncState()
		const disposable = voidConfigService.onDidChangeState(syncState)
		return () => disposable.dispose()
	}, [instanceRef, voidConfigService])

	return <>
		<h2>{title}</h2>
		{<VoidInputBox
			placeholder={placeholder}
			onChangeText={useCallback((newVal) => {
				voidConfigService.setState(providerName, settingName, newVal)
			}, [voidConfigService, providerName, settingName])
			}
			onCreateInstance={instanceRef}
			multiline={false}
		/>}
	</>

}

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidConfigState = useConfigState()
	const { models, model, ...others } = voidConfigState[providerName]
	const voidConfigService = useService('configStateService')

	return <>
		<h1>{providerName}</h1>

		{/* other settings (e.g. api key) */}
		{Object.keys(others).map((settingName, i) => {
			return <Setting key={settingName} providerName={providerName} settingName={settingName} />
		})}

		<h2>{'Models'}</h2>
		{models === null ?
			<p>{'No models available.'}</p>
			: <VoidSelectBox
				initVal={models[0]}
				options={models}
				onChangeSelection={(newVal) => { voidConfigService.setState(providerName, 'model', newVal) }}
				selectBoxRef={{ current: null }}
			/>}

	</>
}


export const SidebarProviderSettings = () => {

	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} />
		)}


	</>
}
