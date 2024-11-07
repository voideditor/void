import React, { useState } from 'react';
import { useOnVSCodeMessage } from '../common/getVscodeApi';
import { useVoidProps } from '../common/contextForProps';


type props = {
	text: string
}

export const DiffLine = () => {

	const props = useVoidProps<props>()

	console.log('props!', props)

	if (!props) {
		return null
	}

	// eslint-disable-next-line react/prop-types
	const text = props.text

	return <>
		<div>
			{text}
		</div>
	</>
};

