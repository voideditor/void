/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import React, { Fragment } from 'react'
import { descOfSettingName, ProviderName, providerNames, voidProviderDefaults } from '../../../../../../../platform/void/common/configTypes.js'
import { VoidInputBox, VoidSelectBox } from './inputs.js'
import { useConfigState, useService } from '../util/services.js'

const SettingsForProvider = ({ providerName }: { providerName: ProviderName }) => {
	const voidConfigState = useConfigState()
	const voidConfigService = useService('configStateService')
	console.log('CONFIG!', voidConfigState)
	console.log('provider:', providerName, voidConfigState[providerName])
	const { models, model, ...others } = voidConfigState[providerName]

	return <>
		<h1>{providerName}</h1>

		{/* other settings (e.g. api key) */}
		{Object.entries(others).map(([settingName, defaultVal], i) => {
			console.log('--- entry:', providerName, settingName, defaultVal)
			const sName = settingName as keyof typeof others

			return <Fragment key={i}>
				<h2>{descOfSettingName(providerName, sName)}</h2>
				<VoidInputBox
					initVal={defaultVal}
					onChangeText={(newVal) => { () => { voidConfigService.setState(providerName, sName, newVal) } }}
					placeholder={settingName}
					multiline={false}
					inputBoxRef={{ current: null }}
				/>
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

		<h2>{'Enabled'}</h2>
		todo

	</>
}


export const SidebarProviderSettings = () => {

	return <>
		{providerNames.map(providerName =>
			<SettingsForProvider key={providerName} providerName={providerName} />
		)}


	</>
}
