/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import React, { Fragment } from 'react'
import { displayInfoOfSettingName, ProviderName, providerNames } from '../../../../../../../platform/void/common/configTypes.js'
import { VoidCheckBox, VoidInputBox, VoidSelectBox } from './inputs.js'
import { useConfigState, useService } from '../util/services.js'

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidConfigState = useConfigState()
	const voidConfigService = useService('configStateService')
	const { models, model, ...others } = voidConfigState[providerName]

	return <>
		<h1>{providerName}</h1>

		{/* other settings (e.g. api key) */}
		{Object.entries(others).map(([settingName, defaultVal], i) => {
			const sName = settingName as keyof typeof others

			const { title, type, placeholder } = displayInfoOfSettingName(providerName, sName)

			return <Fragment key={i}>
				<h2>{title}</h2>
				{
					type === 'boolean' ?
						<VoidCheckBox
							initVal={defaultVal === 'true'}
							onChangeChecked={(newVal) => { voidConfigService.setState(providerName, sName, newVal ? 'true' : 'false') }}
							label={settingName}
							checkboxRef={{ current: null }}
						/>
						:
						<VoidInputBox
							initVal={defaultVal}
							placeholder={placeholder}
							onChangeText={(newVal) => { () => { voidConfigService.setState(providerName, sName, newVal) } }}
							multiline={false}
							inputBoxRef={{ current: null }}
						/>}
			</Fragment>
		})}

		<h2>{'Models'}</h2>
		{models === null ?
			<p>{'No models available.'}</p>
			: <VoidSelectBox
				initVal={models[0]}
				options={models}
				onChangeSelection={(newVal) => { () => { } }}
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
