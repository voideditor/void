/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef } from 'react';
import { useService } from '../util/services.js';
import { HistoryInputBox, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles, defaultToggleStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { SelectBox, unthemedSelectBoxStyles } from '../../../../../../../base/browser/ui/selectBox/selectBox.js';
import { Checkbox, Toggle } from '../../../../../../../base/browser/ui/toggle/toggle.js';
import { ObjectSettingCheckboxWidget } from '../../../../../preferences/browser/settingsWidgets.js'
import { Widget } from '../../../../../../../base/browser/ui/widget.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';



export const WidgetComponent = <CtorParams extends any[], Instance>({ ctor, propsFn, dispose, onCreateInstance }
	: {
		ctor: { new(...params: CtorParams): Instance },
		propsFn: (container: HTMLDivElement) => CtorParams,
		onCreateInstance: (instance: Instance) => IDisposable[],
		dispose: (instance: Instance) => void,
	}
) => {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const instance = new ctor(...propsFn(containerRef.current!));
		const disposables = onCreateInstance(instance);
		return () => {
			disposables.forEach(d => d.dispose());
			dispose(instance)
		}
	}, [ctor, propsFn, dispose, onCreateInstance, containerRef])

	return <div ref={containerRef} className='w-full' />
}



export const VoidInputBox = ({ onChangeText, onCreateInstance, placeholder, multiline }: {
	onChangeText: (value: string) => void;
	onCreateInstance?: { current: InputBox | null } | ((instance: InputBox) => void | IDisposable[]);
	placeholder: string;
	multiline: boolean;
}) => {


	const contextViewProvider = useService('contextViewService');

	return <WidgetComponent
		ctor={InputBox}
		propsFn={useCallback((container) => [
			container,
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
		] as const, [contextViewProvider, placeholder, multiline])}
		dispose={useCallback((instance: InputBox) => {
			instance.dispose()
			instance.element.remove()
		}, [])}
		onCreateInstance={useCallback((instance: InputBox) => {
			const disposables: IDisposable[] = []
			disposables.push(
				instance.onDidChange((newText) => onChangeText(newText))
			)
			if (typeof onCreateInstance === 'function') {
				const ds = onCreateInstance(instance) ?? []
				disposables.push(...ds)
			}
			if (typeof onCreateInstance === 'object') {
				onCreateInstance.current = instance
			}
			return disposables
		}, [onChangeText, onCreateInstance])
		}
	/>
};




export const VoidSelectBox = <T,>({ onChangeSelection, initVal, selectBoxRef, options }: {
	initVal: T;
	selectBoxRef: React.MutableRefObject<SelectBox | null>;
	options: readonly { text: string, value: T }[];
	onChangeSelection: (value: T) => void;
}) => {
	const contextViewProvider = useService('contextViewService');

	let containerRef = useRef<HTMLDivElement | null>(null);

	return <WidgetComponent
		ctor={SelectBox}
		propsFn={useCallback((container) => {
			containerRef.current = container
			const defaultIndex = options.findIndex(opt => opt.value === initVal);
			return [
				options.map(opt => ({ text: opt.text })),
				defaultIndex,
				contextViewProvider,
				defaultSelectBoxStyles
			] as const;
		}, [containerRef, options, initVal, contextViewProvider])}

		dispose={useCallback((instance: SelectBox) => {
			instance.dispose();
			for (let child of containerRef.current?.childNodes ?? [])
				containerRef.current?.removeChild(child)
		}, [containerRef])}

		onCreateInstance={useCallback((instance: SelectBox) => {
			selectBoxRef.current = instance;
			if (containerRef.current) instance.render(containerRef.current)
			const disposables = [
				instance.onDidSelect(e => {
					console.log('e.selected', JSON.stringify(e));
					onChangeSelection(options[e.index].value);
				})
			];
			return disposables;
		}, [containerRef, selectBoxRef, options, onChangeSelection])}

	/>;
};




// export const VoidCheckBox = ({ onChangeChecked, initVal, label, checkboxRef, }: {
// 	onChangeChecked: (checked: boolean) => void;
// 	initVal: boolean;
// 	checkboxRef: React.MutableRefObject<ObjectSettingCheckboxWidget | null>;
// 	label: string;
// }) => {
// 	const containerRef = useRef<HTMLDivElement>(null);

// 	const themeService = useService('themeService');
// 	const contextViewService = useService('contextViewService');
// 	const hoverService = useService('hoverService');

// 	useEffect(() => {
// 		if (!containerRef.current) return;

// 		// Create and mount the Checkbox using VSCode's implementation

// 		checkboxRef.current = new ObjectSettingCheckboxWidget(
// 			containerRef.current,
// 			themeService,
// 			contextViewService,
// 			hoverService,
// 		);


// 		checkboxRef.current.setValue([{
// 			key: { type: 'string', data: label },
// 			value: { type: 'boolean', data: initVal },
// 			removable: false,
// 			resetable: true,
// 		}])

// 		checkboxRef.current.onDidChangeList((list) => {
// 			onChangeChecked(!!list);
// 		})


// 		// cleanup
// 		return () => {
// 			if (checkboxRef.current) {
// 				checkboxRef.current.dispose();
// 				if (containerRef.current) {
// 					while (containerRef.current.firstChild) {
// 						containerRef.current.removeChild(containerRef.current.firstChild);
// 					}
// 				}
// 				checkboxRef.current = null;
// 			}
// 		};
// 	}, [checkboxRef, label, initVal, onChangeChecked]);

// 	return <div ref={containerRef} className="w-full" />;
// };


