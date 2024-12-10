/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import React, { Fragment, useCallback, useRef } from 'react'
import { displayInfoOfSettingName, ProviderName, providerNames, ProviderSettingName, VoidProviderState } from '../../../../../../../platform/void/common/configTypes.js'
import { VoidCheckBox, VoidInputBox, VoidSelectBox } from './inputs.js'
import { useConfigState, useService } from '../util/services.js'


const Setting = ({ val, providerName, settingName }: { val: string, providerName: ProviderName, settingName: any }) => {

	const { title, type, placeholder } = displayInfoOfSettingName(providerName, settingName)
	const voidConfigService = useService('configStateService')

	const initValRef = useRef(val)

	return <>
		<h2>{title}</h2>
		{<VoidInputBox
			initVal={initValRef.current}
			placeholder={placeholder}
			onChangeText={useCallback((newVal) => {
				voidConfigService.setState(providerName, settingName, newVal)
			}, [voidConfigService, providerName, settingName])
			}
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
		{Object.entries(others).map(([settingName, val], i) => {
			return <Setting key={settingName} val={val} providerName={providerName} settingName={settingName} />
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
