import React, { useState } from 'react';
import { useOnVSCodeMessage } from '../common/getVscodeApi';
import { useVoidProps } from '../common/contextForProps';


type props = {
	text: string
}

export const DiffLine = () => {

	const props = useVoidProps<props>()

	// eslint-disable-next-line react/prop-types
	let text = props?.text ?? ''

	return <>
		<div className="view-line relative pointer-events-none">
			<div className={`absolute w-[100%] h-[100%] bg-[rgba(255,0,51,0.2)] z-10`}></div>
			<span>
				<span className='whitespace-pre text-[14px]'>
					{text}
				</span>
			</span>
		</div>
	</>
};

