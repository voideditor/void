import React, { useEffect, useState } from 'react';
import { useServices } from '../util/contextForServices.js';
import { IVoidConfigStateService, nonDefaultConfigFields, PartialVoidConfig, VoidConfig, VoidConfigField, VoidConfigInfo, SetFieldFnType, ConfigState } from '../../../browser/registerConfig.js';


const SettingOfFieldAndParam = ({ field, param, configState, configStateService }:
	{ field: VoidConfigField; param: string; configState: NonNullable<ConfigState>; configStateService: IVoidConfigStateService }) => {

	const { partialVoidConfig } = configState


	const { enumArr, defaultVal, description } = configStateService.voidConfigInfo[field][param]
	const val = partialVoidConfig[field]?.[param] ?? defaultVal // current value of this item

	const updateState = (newValue: string) => { configStateService.setField(field, param, newValue) }

	const resetButton = <button
		disabled={val === defaultVal}
		title={val === defaultVal ? 'This is the default value.' : `Revert value to '${defaultVal}'?`}
		className='group btn btn-sm disabled:opacity-75 disabled:cursor-default'
		onClick={() => updateState(defaultVal)}
	>
		<svg
			className='size-5 group-disabled:stroke-current group-disabled:fill-current group-hover:stroke-red-600 group-hover:fill-red-600 duration-200'
			fill='currentColor' strokeWidth='0' viewBox='0 0 16 16' height='200px' width='200px' xmlns='http://www.w3.org/2000/svg'><path fillRule='evenodd' clipRule='evenodd' d='M3.5 2v3.5L4 6h3.5V5H4.979l.941-.941a3.552 3.552 0 1 1 5.023 5.023L5.746 14.28l.72.72 5.198-5.198A4.57 4.57 0 0 0 5.2 3.339l-.7.7V2h-1z'></path>
		</svg>
	</button>

	const inputElement = enumArr === undefined ?
		// string
		(<input
			className='input p-1 w-full'
			type='text'
			value={val}
			onChange={(e) => updateState(e.target.value)}
		/>)
		:
		// enum
		(<select
			className='dropdown p-1 w-full'
			value={val}
			onChange={(e) => updateState(e.target.value)}
		>
			{enumArr.map((option) => (
				<option key={option} value={option}>
					{option}
				</option>
			))}
		</select>)

	return <div>
		<label className='hidden'>{param}</label>
		<span>{description}</span>
		<div className='flex items-center'>
			{inputElement}
			{resetButton}
		</div>
	</div>
}


export const SidebarSettings = () => {
	// track the config state using React state so visual updates happen
	const { configStateService } = useServices()
	const [configState, setConfigState] = useState<ConfigState>(configStateService.state)
	const { voidConfig } = configState
	useEffect(() => { configStateService.onDidChangeState(() => setConfigState(configStateService.state)) }, [configStateService])

	const current_field = voidConfig.default['whichApi'] as VoidConfigField

	return (
		<div className='space-y-4 py-2 overflow-y-auto'>

			{/* choose the field */}
			<div className='outline-vscode-input-bg'>
				<SettingOfFieldAndParam
					configState={configState}
					configStateService={configStateService}
					field='default'
					param='whichApi'
				/>
				<SettingOfFieldAndParam
					configState={configState}
					configStateService={configStateService}
					field='default'
					param='maxTokens'
				/>
			</div>

			<hr />

			{/* render all fields, but hide the ones not visible for fast tab switching */}
			{nonDefaultConfigFields.map(field => {
				return <div
					key={field}
					className={`flex flex-col gap-y-2 ${field !== current_field ? 'hidden' : ''}`}
				>
					{Object.keys(configStateService.voidConfigInfo[field]).map((param) => (
						<SettingOfFieldAndParam
							key={param}
							configState={configState}
							configStateService={configStateService}
							field={field}
							param={param}
						/>
					))}
				</div>
			})}

			{/* Remove this after 10/21/24, this is just to give developers a heads up about the recent change  */}
			<div className='pt-20'>
				{`We recently updated Settings. To copy your old Void settings over, press Ctrl+Shift+P, `}
				{`type 'Open User Settings (JSON)',`}
				{` and look for 'void.'. `}
			</div>
		</div>
	)
}

