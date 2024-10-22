import React, { useState } from 'react';
import { useOnVSCodeMessage } from './getVscodeApi';


export const CtrlK = () => {

	const [x, sx] = useState('abc')

	useOnVSCodeMessage('ctrl+k', () => {
		console.log('Ctrl+K pressed')
		sx('Pressed ctrl+k')
	})

	return <>
		<div>
			{x}
		</div>
	</>
};

