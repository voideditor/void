import React, { useEffect, useRef } from 'react';
import { useService } from '../util/services.js';
import { HistoryInputBox, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultCheckboxStyles, defaultInputBoxStyles, defaultToggleStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { SelectBox, unthemedSelectBoxStyles } from '../../../../../../../base/browser/ui/selectBox/selectBox.js';
import { Checkbox, Toggle } from '../../../../../../../base/browser/ui/toggle/toggle.js';

// settingitem

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
	}, [inputBoxRef, contextViewProvider, placeholder, multiline, initVal, onChangeText]);

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





export const VoidCheckBox = ({ onChangeChecked, initVal, label, checkboxRef, }: {
	onChangeChecked: (checked: boolean) => void;
	initVal: boolean;
	checkboxRef: React.MutableRefObject<Toggle | null>;
	label: string;
}) => {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		// Create and mount the Checkbox using VSCode's implementation
		checkboxRef.current = new Toggle({
			title: label,
			isChecked: initVal,
			...defaultToggleStyles
		});

		containerRef.current.appendChild(checkboxRef.current.domNode);

		checkboxRef.current.onChange(checked => {
			console.log('CHANGE checked state on checkbox', checked);
			onChangeChecked(checked);
		});

		// cleanup
		return () => {
			if (checkboxRef.current) {
				checkboxRef.current.dispose();
				if (containerRef.current) {
					while (containerRef.current.firstChild) {
						containerRef.current.removeChild(containerRef.current.firstChild);
					}
				}
				checkboxRef.current = null;
			}
		};
	}, [checkboxRef, label, initVal, onChangeChecked]);

	return <div ref={containerRef} className="w-full" />;
};
