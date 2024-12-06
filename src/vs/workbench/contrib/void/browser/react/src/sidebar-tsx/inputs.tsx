import React, { useEffect, useRef } from 'react';
import { useService } from '../util/services.js';
import { HistoryInputBox, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultInputBoxStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { SelectBox, unthemedSelectBoxStyles } from '../../../../../../../base/browser/ui/selectBox/selectBox.js';

export const VoidInputBox = ({ onChangeText, initVal, placeholder, inputBoxRef, multiline }: {
	onChangeText: (value: string) => void;
	placeholder: string;
	inputBoxRef: React.MutableRefObject<InputBox | null>;
	multiline: boolean;
	initVal: string;
}) => {
	const contextViewProvider = useService('contextViewService');

	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		// create and mount the HistoryInputBox
		inputBoxRef.current = new InputBox(
			containerRef.current,
			contextViewProvider,
			{
				inputBoxStyles: {
					...defaultInputBoxStyles,
					inputBackground: 'transparent',
				},
				placeholder,
				flexibleHeight: multiline,
				flexibleMaxHeight: 500,
				flexibleWidth: false,

			}
		);
		inputBoxRef.current.value = initVal;


		inputBoxRef.current.onDidChange((newStr) => {
			console.log('CHANGE TEXT on inputbox', newStr)
			onChangeText(newStr)
		})

		// cleanup
		return () => {
			if (inputBoxRef.current) {
				inputBoxRef.current.dispose();
				if (containerRef.current) {
					while (containerRef.current.firstChild) {
						containerRef.current.removeChild(containerRef.current.firstChild);
					}
				}
				inputBoxRef.current = null;
			}
		};
	}, [inputBoxRef, contextViewProvider, placeholder, multiline, initVal, onChangeText]); // Empty dependency array since we only want to mount/unmount once

	return <div ref={containerRef} className="w-full" />;
};



export const VoidSelectBox = ({ onChangeSelection, initVal, selectBoxRef, options }: {
	onChangeSelection: (value: string) => void;
	initVal: string;
	selectBoxRef: React.MutableRefObject<SelectBox | null>;
	options: readonly string[];

}) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const contextViewProvider = useService('contextViewService');

	useEffect(() => {
		if (!containerRef.current) return;

		const defaultIndex = options.indexOf(initVal);

		selectBoxRef.current = new SelectBox(
			options.map(opt => ({ text: opt })),
			defaultIndex,
			contextViewProvider,
			unthemedSelectBoxStyles
		);

		selectBoxRef.current.render(containerRef.current);

		selectBoxRef.current.onDidSelect(e => { onChangeSelection(e.selected); });

		// cleanup
		return () => {
			if (selectBoxRef.current) {
				selectBoxRef.current.dispose();
				if (containerRef.current) {
					while (containerRef.current.firstChild) {
						containerRef.current.removeChild(containerRef.current.firstChild);
					}
				}
			}
		};
	}, [options, initVal, onChangeSelection, contextViewProvider, selectBoxRef]);

	return <div ref={containerRef} className="w-full" />;
};
