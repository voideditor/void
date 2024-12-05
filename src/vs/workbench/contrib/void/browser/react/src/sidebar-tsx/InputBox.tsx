import React, { useEffect, useRef } from 'react';
import { useService } from '../util/services.js';
import { HistoryInputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultInputBoxStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';

export const InputBox = ({ onChangeText, placeholder, historyInputBoxRef, }: {
	onChangeText: (value: string) => void;
	placeholder: string;
	historyInputBoxRef: React.MutableRefObject<HistoryInputBox | null>; // update this whenever historyInputBoxRef.current changes
}) => {
	const contextViewProvider = useService('contextViewService');

	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		// create and mount the HistoryInputBox
		historyInputBoxRef.current = new HistoryInputBox(
			containerRef.current,
			contextViewProvider,
			{
				inputBoxStyles: {
					...defaultInputBoxStyles,
					inputBackground: 'transparent',
				},
				placeholder,
				history: [],
				flexibleHeight: true,
				flexibleMaxHeight: 500,
				flexibleWidth: false,
			}
		);


		historyInputBoxRef.current.onDidChange((newStr) => {
			onChangeText(newStr)
		})

		// historyInputBoxRef.current.onDidHeightChange((newHeight) => {
		// 	console.log('CHANGE height', newHeight);
		// })

		// cleanup
		return () => {
			if (historyInputBoxRef.current) {
				historyInputBoxRef.current.dispose();
				if (containerRef.current) {
					while (containerRef.current.firstChild) {
						containerRef.current.removeChild(containerRef.current.firstChild);
					}
				}
				historyInputBoxRef.current = null;
			}
		};
	}, [onChangeText, placeholder, contextViewProvider]); // Empty dependency array since we only want to mount/unmount once

	return <div ref={containerRef} className="w-full" />;
};
