/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IInputBoxStyles, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js';
import { SelectBox } from '../../../../../../../base/browser/ui/selectBox/selectBox.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { Checkbox } from '../../../../../../../base/browser/ui/toggle/toggle.js';

import { CodeEditorWidget } from '../../../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js'
import { useAccessor } from './services.js';
import { ScrollableElement } from '../../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ModelOption } from '../../../../../../../platform/void/common/voidSettingsService.js';
import { createPortal } from 'react-dom';


// type guard
const isConstructor = (f: any)
	: f is { new(...params: any[]): any } => {
	return !!f.prototype && f.prototype.constructor === f;
}

export const WidgetComponent = <CtorParams extends any[], Instance>({ ctor, propsFn, dispose, onCreateInstance, children, className }
	: {
		ctor: { new(...params: CtorParams): Instance } | ((container: HTMLDivElement) => Instance),
		propsFn: (container: HTMLDivElement) => CtorParams, // unused if fn
		onCreateInstance: (instance: Instance) => IDisposable[],
		dispose: (instance: Instance) => void,
		children?: React.ReactNode,
		className?: string
	}
) => {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const instance = isConstructor(ctor) ? new ctor(...propsFn(containerRef.current!)) : ctor(containerRef.current!)
		const disposables = onCreateInstance(instance);
		return () => {
			disposables.forEach(d => d.dispose());
			dispose(instance)
		}
	}, [ctor, propsFn, dispose, onCreateInstance, containerRef])

	return <div ref={containerRef} className={className === undefined ? `w-full` : className}>{children}</div>
}



export const VoidInputBox = ({ onChangeText, onCreateInstance, inputBoxRef, placeholder, multiline, styles }: {
	onChangeText: (value: string) => void;
	styles?: Partial<IInputBoxStyles>,
	onCreateInstance?: (instance: InputBox) => void | IDisposable[];
	inputBoxRef?: { current: InputBox | null };
	placeholder: string;
	multiline: boolean;
}) => {

	const accessor = useAccessor()

	const contextViewProvider = accessor.get('IContextViewService')
	return <WidgetComponent
		ctor={InputBox}
		className='
			bg-void-bg-1
			@@[&_::placeholder]:!void-text-void-fg-3
		'
		propsFn={useCallback((container) => [
			container,
			contextViewProvider,
			{
				inputBoxStyles: {
					...defaultInputBoxStyles,
					inputForeground: "var(--vscode-foreground)",
					// inputBackground: 'transparent',
					// inputBorder: 'none',
					...styles,
				},
				placeholder,
				tooltip: '',
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
			if (onCreateInstance) {
				const ds = onCreateInstance(instance) ?? []
				disposables.push(...ds)
			}
			if (inputBoxRef)
				inputBoxRef.current = instance;

			return disposables
		}, [onChangeText, onCreateInstance, inputBoxRef])
		}
	/>
};




export const VoidSwitch = ({
	value,
	onChange,
	size = 'md',
	label,
	disabled = false,
}: {
	value: boolean;
	onChange: (value: boolean) => void;
	label?: string;
	disabled?: boolean;
	size?: 'xs' | 'sm' | 'sm+' | 'md';
}) => {
	return (
		<label className="inline-flex items-center cursor-pointer">
			<div
				onClick={() => !disabled && onChange(!value)}
				className={`
			relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out
			${value ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'}
			${disabled ? 'opacity-25' : ''}
			${size === 'xs' ? 'h-4 w-7' : ''}
			${size === 'sm' ? 'h-5 w-9' : ''}
			${size === 'sm+' ? 'h-5 w-10' : ''}
			${size === 'md' ? 'h-6 w-11' : ''}
		  `}
			>
				<span
					className={`
			  inline-block transform rounded-full bg-white dark:bg-gray-900 shadow transition-transform duration-200 ease-in-out
			  ${size === 'xs' ? 'h-2.5 w-2.5' : ''}
			  ${size === 'sm' ? 'h-3 w-3' : ''}
			  ${size === 'sm+' ? 'h-3.5 w-3.5' : ''}
			  ${size === 'md' ? 'h-4 w-4' : ''}
			  ${size === 'xs' ? (value ? 'translate-x-3.5' : 'translate-x-0.5') : ''}
			  ${size === 'sm' ? (value ? 'translate-x-5' : 'translate-x-1') : ''}
			  ${size === 'sm+' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			  ${size === 'md' ? (value ? 'translate-x-6' : 'translate-x-1') : ''}
			`}
				/>
			</div>
			{label && (
				<span className={`
			ml-3 font-medium text-gray-900 dark:text-gray-100
			${size === 'xs' ? 'text-xs' : 'text-sm'}
		  `}>
					{label}
				</span>
			)}
		</label>
	);
};





export const VoidCheckBox = ({ label, value, onClick, className }: { label: string, value: boolean, onClick: (checked: boolean) => void, className?: string }) => {
	const divRef = useRef<HTMLDivElement | null>(null)
	const instanceRef = useRef<Checkbox | null>(null)

	useEffect(() => {
		if (!instanceRef.current) return
		instanceRef.current.checked = value
	}, [value])


	return <WidgetComponent
		className={className ?? ''}
		ctor={Checkbox}
		propsFn={useCallback((container: HTMLDivElement) => {
			divRef.current = container
			return [label, value, defaultCheckboxStyles] as const
		}, [label, value])}
		onCreateInstance={useCallback((instance: Checkbox) => {
			instanceRef.current = instance;
			divRef.current?.append(instance.domNode)
			const d = instance.onChange(() => onClick(instance.checked))
			return [d]
		}, [onClick])}
		dispose={useCallback((instance: Checkbox) => {
			instance.dispose()
			instance.domNode.remove()
		}, [])}

	/>

}


export const VoidCustomSelectBox = <T extends any>({
	options,
	selectedOption,
	onChangeOption,
	getOptionName,
	getOptionsEqual,
	className,
	arrowTouchesText = true,
}: {
	options: T[];
	selectedOption?: T;
	onChangeOption: (newValue: T) => void;
	getOptionName: (option: T) => string;
	getOptionsEqual: (a: T, b: T) => boolean;
	className?: string;
	arrowTouchesText?: boolean;
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	const containerRef = useRef<HTMLDivElement | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);

	if (!selectedOption) {
		selectedOption = options[0];
	}

	const updatePosition = () => {
		if (!buttonRef.current) return;
		const rect = buttonRef.current.getBoundingClientRect();
		const viewportHeight = window.innerHeight;
		const spaceBelow = viewportHeight - rect.bottom;
		const spaceNeeded = options.length * 28; // Approximate height per option
		const showAbove = spaceBelow < spaceNeeded && rect.top > spaceBelow;

		setPosition({
			top: showAbove ? rect.top - 4 - spaceNeeded : rect.bottom + 4,
			left: rect.left,
		});
	};

	useEffect(() => {
		if (isOpen) {
			updatePosition();
			window.addEventListener('scroll', updatePosition, true);
			window.addEventListener('resize', updatePosition);

			return () => {
				window.removeEventListener('scroll', updatePosition, true);
				window.removeEventListener('resize', updatePosition);
			};
		}
	}, [isOpen]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => document.removeEventListener('mousedown', handleClickOutside);
		}
	}, [isOpen]);

	return (
		<div
			ref={containerRef}
			className={`inline-block ${className}`}
		>
			{/* Select Button */}
			<button
				ref={buttonRef}
				className="flex items-center h-4 bg-transparent whitespace-nowrap hover:brightness-110 w-full"
				onClick={() => {
					setIsOpen(!isOpen);
					if (!isOpen) {
						setTimeout(updatePosition, 0);
					}
				}}
			>
				<span className={`max-w-[120px] truncate ${arrowTouchesText ? 'mr-1' : ''}`}>
					{getOptionName(selectedOption)}
				</span>
				<svg
					className={`size-3 flex-shrink-0 ${arrowTouchesText ? '' : 'ml-auto'}`}
					viewBox="0 0 12 12"
					fill="none"
				>
					<path
						d="M2.5 4.5L6 8L9.5 4.5"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>

			{/* Dropdown Menu */}
			{isOpen && (
				<div
					className="fixed z-10 bg-void-bg-1 border-void-border-1 border overflow-hidden rounded shadow-lg w-fit"
					style={{
						top: position.top,
						left: position.left,
						minWidth: buttonRef.current?.offsetWidth,
					}}
				>
					{options.map((option) => {
						const thisOptionIsSelected = getOptionsEqual(option, selectedOption);
						const optionName = getOptionName(option);

						return (
							<div
								key={optionName}
								className={`flex items-center px-2 py-1 cursor-pointer whitespace-nowrap
									transition-all duration-100
									bg-void-bg-1
									${thisOptionIsSelected ? 'bg-void-bg-3' : 'hover:bg-void-bg-3'}
								`}
								onClick={() => {
									onChangeOption(option);
									setIsOpen(false);
								}}
							>
								<div className="w-4 flex justify-center flex-shrink-0">
									{thisOptionIsSelected && (
										<svg className="size-3" viewBox="0 0 12 12" fill="none">
											<path
												d="M10 3L4.5 8.5L2 6"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
								</div>
								<span>{optionName}</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};



export const _VoidSelectBox = <T,>({ onChangeSelection, onCreateInstance, selectBoxRef, options, className }: {
	onChangeSelection: (value: T) => void;
	onCreateInstance?: ((instance: SelectBox) => void | IDisposable[]);
	selectBoxRef?: React.MutableRefObject<SelectBox | null>;
	options: readonly { text: string, value: T }[];
	className?: string;
}) => {
	const accessor = useAccessor()
	const contextViewProvider = accessor.get('IContextViewService')

	let containerRef = useRef<HTMLDivElement | null>(null);

	return <WidgetComponent
		className={`
			@@select-child-restyle
			@@[&_select]:!void-text-void-fg-3
			@@[&_select]:!void-text-xs
			!text-void-fg-3
			${className ?? ''}
		`}
		ctor={SelectBox}
		propsFn={useCallback((container) => {
			containerRef.current = container
			const defaultIndex = 0;
			return [
				options.map(opt => ({ text: opt.text })),
				defaultIndex,
				contextViewProvider,
				defaultSelectBoxStyles,
			] as const;
		}, [containerRef, options, contextViewProvider])}

		dispose={useCallback((instance: SelectBox) => {
			instance.dispose();
			for (let child of containerRef.current?.childNodes ?? [])
				containerRef.current?.removeChild(child)
		}, [containerRef])}

		onCreateInstance={useCallback((instance: SelectBox) => {
			const disposables: IDisposable[] = []

			if (containerRef.current)
				instance.render(containerRef.current)

			disposables.push(
				instance.onDidSelect(e => { onChangeSelection(options[e.index].value); })
			)

			if (onCreateInstance) {
				const ds = onCreateInstance(instance) ?? []
				disposables.push(...ds)
			}
			if (selectBoxRef)
				selectBoxRef.current = instance;

			return disposables;
		}, [containerRef, onChangeSelection, options, onCreateInstance, selectBoxRef])}

	/>;
};

// makes it so that code in the sidebar isnt too tabbed out
const normalizeIndentation = (code: string): string => {
	const lines = code.split('\n')

	let minLeadingSpaces = Infinity

	// find the minimum number of leading spaces
	for (const line of lines) {
		if (line.trim() === '') continue;
		let leadingSpaces = 0;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === '\t' || char === ' ') {
				leadingSpaces += 1;
			} else { break; }
		}
		minLeadingSpaces = Math.min(minLeadingSpaces, leadingSpaces)
	}

	// remove the leading spaces
	return lines.map(line => {
		if (line.trim() === '') return line;

		let spacesToRemove = minLeadingSpaces;
		let i = 0;
		while (spacesToRemove > 0 && i < line.length) {
			const char = line[i];
			if (char === '\t' || char === ' ') {
				spacesToRemove -= 1;
				i++;
			} else { break; }
		}

		return line.slice(i);

	}).join('\n')

}

export type VoidCodeEditorProps = { initValue: string, language?: string, maxHeight?: number, showScrollbars?: boolean }
export const VoidCodeEditor = ({ initValue, language, maxHeight, showScrollbars }: VoidCodeEditorProps) => {

	// default settings
	const MAX_HEIGHT = maxHeight ?? Infinity;
	const SHOW_SCROLLBARS = showScrollbars ?? false;

	const divRef = useRef<HTMLDivElement | null>(null)

	const accessor = useAccessor()
	const instantiationService = accessor.get('IInstantiationService')
	const modelService = accessor.get('IModelService')
	const languageDetectionService = accessor.get('ILanguageDetectionService')

	initValue = normalizeIndentation(initValue)

	return <div ref={divRef} className='relative z-0 px-2 py-1 bg-void-bg-3'>
		<WidgetComponent
			className='@@bg-editor-style-override' // text-sm
			ctor={useCallback((container) => {
				return instantiationService.createInstance(
					CodeEditorWidget,
					container,
					{
						automaticLayout: true,
						wordWrap: 'off',

						scrollbar: {
							alwaysConsumeMouseWheel: false,
							...SHOW_SCROLLBARS ? {
								vertical: 'auto',
								verticalScrollbarSize: 8,
								horizontal: 'auto',
								horizontalScrollbarSize: 8,
							} : {
								vertical: 'hidden',
								verticalScrollbarSize: 0,
								horizontal: 'auto',
								horizontalScrollbarSize: 8,
								ignoreHorizontalScrollbarInContentHeight: true,

							},
						},
						scrollBeyondLastLine: false,

						lineNumbers: 'off',

						readOnly: true,
						domReadOnly: true,
						readOnlyMessage: { value: '' },

						minimap: {
							enabled: false,
							// maxColumn: 0,
						},

						selectionHighlight: false, // highlights whole words
						renderLineHighlight: 'none',

						folding: false,
						lineDecorationsWidth: 0,
						overviewRulerLanes: 0,
						hideCursorInOverviewRuler: true,
						overviewRulerBorder: false,
						glyphMargin: false,

						stickyScroll: {
							enabled: false,
						},
					},
					{
						isSimpleWidget: true,
					})
			}, [instantiationService])
			}

			onCreateInstance={useCallback((editor: CodeEditorWidget) => {
				const model = modelService.createModel(
					initValue,
					language ? {
						languageId: language,
						onDidChange: () => ({
							dispose: () => { }
						})
					} : null
				);
				editor.setModel(model);

				const container = editor.getDomNode()
				const parentNode = container?.parentElement
				const resize = () => {
					if (parentNode) {
						const height = Math.min(editor.getScrollHeight() + 1, MAX_HEIGHT);
						parentNode.style.height = `${height}px`;
						editor.layout();
					}
				}

				resize()
				const disposable = editor.onDidContentSizeChange(() => { resize() });

				return [disposable]
			}, [modelService, initValue, language])}

			dispose={useCallback((editor: CodeEditorWidget) => {
				editor.dispose();
			}, [modelService, languageDetectionService])}

			propsFn={useCallback(() => { return [] }, [])}
		/>
	</div>

}


export const VoidButton = ({ children, disabled, onClick }: { children: React.ReactNode; disabled?:boolean; onClick: () => void }) => {
	return <button disabled={disabled}
		className='px-3 py-1 bg-black/10 dark:bg-gray-200/10 rounded-sm overflow-hidden'
		onClick={onClick}
	>{children}</button>
}

// export const VoidScrollableElt = ({ options, children }: { options: ScrollableElementCreationOptions, children: React.ReactNode }) => {
// 	const instanceRef = useRef<DomScrollableElement | null>(null);
// 	const [childrenPortal, setChildrenPortal] = useState<React.ReactNode | null>(null)

// 	return <>
// 		<WidgetComponent
// 			ctor={DomScrollableElement}
// 			propsFn={useCallback((container) => {
// 				return [container, options] as const;
// 			}, [options])}
// 			onCreateInstance={useCallback((instance: DomScrollableElement) => {
// 				instanceRef.current = instance;
// 				setChildrenPortal(createPortal(children, instance.getDomNode()))
// 				return []
// 			}, [setChildrenPortal, children])}
// 			dispose={useCallback((instance: DomScrollableElement) => {
// 				console.log('calling dispose!!!!')
// 				// instance.dispose();
// 				// instance.getDomNode().remove()
// 			}, [])}
// 		>{children}</WidgetComponent>

// 		{childrenPortal}

// 	</>
// }

// export const VoidSelectBox = <T,>({ onChangeSelection, initVal, selectBoxRef, options }: {
// 	initVal: T;
// 	selectBoxRef: React.MutableRefObject<SelectBox | null>;
// 	options: readonly { text: string, value: T }[];
// 	onChangeSelection: (value: T) => void;
// }) => {


// 	return <WidgetComponent
// 		ctor={DropdownMenu}
// 		propsFn={useCallback((container) => {
// 			return [
// 				container, {
// 					contextMenuProvider,
// 					actions: options.map(({ text, value }, i) => ({
// 						id: i + '',
// 						label: text,
// 						tooltip: text,
// 						class: undefined,
// 						enabled: true,
// 						run: () => {
// 							onChangeSelection(value);
// 						},
// 					}))

// 				}] as const;
// 		}, [options, initVal, contextViewProvider])}

// 		dispose={useCallback((instance: DropdownMenu) => {
// 			instance.dispose();
// 			// instance.element.remove()
// 		}, [])}

// 		onCreateInstance={useCallback((instance: DropdownMenu) => {
// 			return []
// 		}, [])}

// 	/>;
// };




// export const VoidCheckBox = ({ onChangeChecked, initVal, label, checkboxRef, }: {
// 	onChangeChecked: (checked: boolean) => void;
// 	initVal: boolean;
// 	checkboxRef: React.MutableRefObject<ObjectSettingCheckboxWidget | null>;
// 	label: string;
// }) => {
// 	const containerRef = useRef<HTMLDivElement>(null);


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


