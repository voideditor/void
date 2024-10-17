import React, { useState } from "react";
import { configFields, useVoidConfig, VoidConfigField } from "./contextForConfig";


const SettingOfFieldAndParam = ({ field, param }: { field: VoidConfigField, param: string }) => {
	const { voidConfig, partialVoidConfig, voidConfigInfo, setConfigParam } = useVoidConfig()

	const [val, setVal] = useState<string | undefined>(partialVoidConfig[field]?.[param])

	const { enumArr } = voidConfigInfo[field][param]

	const updateState = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setVal(e.target.value); };
	const commitConfigParam = () => { if (val) setConfigParam(field, param, val); };


	// string
	if (enumArr === undefined) {
		return (
			<div>
				<label>{param}</label>
				<input
					type="text"
					value={val}
					onChange={updateState}
					onBlur={commitConfigParam}
				/>
			</div>
		)
	}
	// enum
	else {
		return (
			<div>
				<label>{param}</label>
				<select
					value={val}
					onChange={updateState}
					onBlur={commitConfigParam}
				>
					{enumArr.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			</div>
		)
	}
}

export const SidebarSettings = () => {

	const { voidConfig, voidConfigInfo } = useVoidConfig()

	const current_field = voidConfig.default['whichApi'] as VoidConfigField
	const params = Object.keys(voidConfigInfo[current_field])

	return (
		<div>
			{params.map((param) => (
				<SettingOfFieldAndParam
					key={param}
					field={current_field}
					param={param}
				/>
			))}
		</div>
	)
}

