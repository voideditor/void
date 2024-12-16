/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { titleOfProviderName, displayInfoOfSettingName, ProviderName, providerNames, featureNames, SettingsOfProvider, SettingName, defaultSettingsOfProvider } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { VoidInputBox } from '../sidebar-tsx/inputs.js'
import { useSettingsState, useService } from '../util/services.js'
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'


const Setting = ({ providerName, settingName }: { providerName: ProviderName, settingName: SettingName }) => {

	const { title, type, placeholder } = displayInfoOfSettingName(providerName, settingName)
	const voidSettingsService = useService('settingsStateService')


	let weChangedTextRef = false

	return <><ErrorBoundary>
		<label>{title}</label>
		<VoidInputBox
			placeholder={placeholder}
			onChangeText={useCallback((newVal) => {
				if (weChangedTextRef) return
				voidSettingsService.setSettingOfProvider(providerName, settingName, newVal)
			}, [voidSettingsService, providerName, settingName])}

			// we are responsible for setting the initial value. always sync the instance whenever there's a change to state.
			onCreateInstance={useCallback((instance: InputBox) => {
				const syncInstance = () => {
					const settingsAtProvider = voidSettingsService.state.settingsOfProvider[providerName];
					const stateVal = settingsAtProvider[settingName as keyof typeof settingsAtProvider]
					// console.log('SYNCING TO', providerName, settingName, stateVal)
					weChangedTextRef = true
					instance.value = stateVal as string
					weChangedTextRef = false
				}
				syncInstance()
				const disposable = voidSettingsService.onDidChangeState(syncInstance)
				return [disposable]
			}, [voidSettingsService, providerName, settingName])}
			multiline={false}
		/>
	</ErrorBoundary></>

}


const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidSettingsState = useSettingsState()
	const { models, ...others } = voidSettingsState.settingsOfProvider[providerName]

	return <>
		<h1 className='text-xl'>{titleOfProviderName(providerName)}</h1>
		{/* settings besides models (e.g. api key) */}
		{Object.keys(others).map((sName, i) => {
			const settingName = sName as keyof typeof others
			return <Setting key={settingName} providerName={providerName} settingName={settingName} />
		})}
	</>
}


export const VoidProviderSettings = () => {

	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} />
		)}
	</>
}
