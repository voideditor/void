import React, { useState } from "react";
import { useVoidConfig, VoidConfigField } from "./contextForConfig";


const SettingOfFieldAndParam = ({ field, param }: { field: VoidConfigField, param: string }) => {
	const { voidConfig, partialVoidConfig, voidConfigInfo, setConfigParam } = useVoidConfig()
	const { enumArr, defaultVal, description } = voidConfigInfo[field][param]
	const val = partialVoidConfig[field]?.[param] ?? defaultVal // current value of this item

	const updateState = (newValue: string) => { setConfigParam(field, param, newValue) }

	const resetButton = <button className='btn btn-sm' onClick={() => updateState(defaultVal)}>
		<svg
			className='size-5'
			stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 16 16" height="200px" width="200px" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" clipRule="evenodd" d="M3.5 2v3.5L4 6h3.5V5H4.979l.941-.941a3.552 3.552 0 1 1 5.023 5.023L5.746 14.28l.72.72 5.198-5.198A4.57 4.57 0 0 0 5.2 3.339l-.7.7V2h-1z"></path>
		</svg>
	</button>

	const inputElement = enumArr === undefined ?
		// string
		(<input
			className='input p-1 w-full'
			type="text"
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

	const { voidConfig, voidConfigInfo } = useVoidConfig()

	return (
		<div className="space-y-8 py-2 overflow-y-auto">
			{Object.keys(voidConfig.default).map((setting) => (
				<section key={setting} className="space-y-2">
					{/* choose the field */}
					<div className="outline-vscode-input-bg">
						<SettingOfFieldAndParam field="default" param={setting} />
					</div>

					<hr />

					{/* render all fields */}
					{voidConfigInfo[voidConfig.default[setting]] &&
						Object.keys(voidConfigInfo[voidConfig.default[setting]])?.map(
							(param) => (
								<div key={param} className="flex flex-col gap-y-2">
									<SettingOfFieldAndParam
										field={voidConfig.default[setting]}
										param={param}
									/>
								</div>
							)
						)}
				</section>
			))}

			{/* Remove this after 10/21/24, this is just to give developers a heads up about the recent change  */}
			<div className="pt-20">
				{`We recently updated Settings. To copy your old Void settings over, press Ctrl+Shift+P, `}
				{`type 'Open User Settings (JSON)',`}
				{` and look for 'void.'. `}
			</div>
		</div>
	);
}

