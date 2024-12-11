/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { displayInfoOfSettingName, ProviderName, providerNames } from '../../../../../../../platform/void/common/voidConfigTypes.js'
import { VoidCheckBox, VoidInputBox, VoidSelectBox } from './inputs.js'
import { useConfigState, useService } from '../util/services.js'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import ErrorBoundary from './ErrorBoundary.js'


const Setting = ({ providerName, settingName }: { providerName: ProviderName, settingName: any }) => {

	const { title, type, placeholder } = displayInfoOfSettingName(providerName, settingName)
	const voidConfigService = useService('configStateService')

	const instanceRef = useRef<InputBox | null>(null)

	useEffect(() => {
		// this is really just to sync the state on initial mount, when init value hasn't been set yet
		const syncState = () => {
			if (!instanceRef.current) return

			const settingsAtProvider = voidConfigService.state.settingsOfProvider[providerName];

			// @ts-ignore
			const stateVal = settingsAtProvider[settingName]

			if (instanceRef.current.value !== stateVal)
				instanceRef.current.value = stateVal
		}
		syncState()
		const disposable = voidConfigService.onDidChangeState(syncState)
		return () => disposable.dispose()
	}, [instanceRef, voidConfigService])

	return <><ErrorBoundary>
		<h2>{title}</h2>
		{<VoidInputBox
			placeholder={placeholder}
			onChangeText={useCallback((newVal) => {
				voidConfigService.setSettingOfProvider(providerName, settingName, newVal)
			}, [voidConfigService, providerName, settingName])
			}
			onCreateInstance={instanceRef}
			multiline={false}
		/>}
	</ErrorBoundary></>

}

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidConfigState = useConfigState()
	const { models, ...others } = voidConfigState[providerName]
	return <>
		<h1>{providerName}</h1>
		{/* settings besides models (e.g. api key) */}
		{Object.keys(others).map((settingName, i) => {
			return <Setting key={settingName} providerName={providerName} settingName={settingName} />
		})}
	</>
}


export const SidebarProviderSettings = () => {

	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} />
		)}


	</>
}
