/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { ICursorSelectionChangedEvent } from '../../../../editor/common/cursorEvents.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import * as dom from '../../../../base/browser/dom.js';
import { mountVoidSelectionHelper } from './react/out/void-editor-widgets-tsx/index.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { getLengthOfTextPx } from './editCodeService.js';


const minDistanceFromRightPx = 400;
const minLeftPx = 60;


export type VoidSelectionHelperProps = {
	rerenderKey: number // alternates between 0 and 1
}


export class SelectionHelperContribution extends Disposable implements IEditorContribution, IOverlayWidget {
	public static readonly ID = 'editor.contrib.voidSelectionHelper';
	// react
	private _rootHTML: HTMLElement;
	private _rerender: (props?: any) => void = () => { };
	private _rerenderKey: number = 0;
	private _reactComponentDisposable: IDisposable | null = null;

	// internal
	private _isVisible = false;
	private _showScheduler: RunOnceScheduler;
	private _lastSelection: Selection | null = null;

	constructor(
		private readonly _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService
	) {
		super();

		// Create the container element for React component
		const { root, content } = dom.h('div@root', [
			dom.h('div@content', [])
		]);

		// Set styles for container
		root.style.position = 'absolute';
		root.style.display = 'none'; // Start hidden
		root.style.pointerEvents = 'none';
		root.style.marginLeft = '16px';

		// Initialize React component
		this._instantiationService.invokeFunction(accessor => {
			if (this._reactComponentDisposable) {
				this._reactComponentDisposable.dispose();
			}
			const res = mountVoidSelectionHelper(content, accessor);
			if (!res) return;

			this._reactComponentDisposable = res;
			this._rerender = res.rerender;

			this._register(this._reactComponentDisposable);


		});

		this._rootHTML = root;

		// Register as overlay widget
		this._editor.addOverlayWidget(this);

		// Use scheduler to debounce showing widget
		this._showScheduler = new RunOnceScheduler(() => {
			if (this._lastSelection) {
				this._showHelperForSelection(this._lastSelection);
			}
		}, 50);

		// Register event listeners
		this._register(this._editor.onDidChangeCursorSelection(e => this._onSelectionChange(e)));

		// Add a flag to track if mouse is over the widget
		let isMouseOverWidget = false;
		this._rootHTML.addEventListener('mouseenter', () => {
			isMouseOverWidget = true;
		});
		this._rootHTML.addEventListener('mouseleave', () => {
			isMouseOverWidget = false;
		});

		// Only hide helper when text editor loses focus and mouse is not over the widget
		this._register(this._editor.onDidBlurEditorText(() => {
			if (!isMouseOverWidget) {
				this._hideHelper();
			}
		}));

		this._register(this._editor.onDidScrollChange(() => this._updatePositionIfVisible()));
		this._register(this._editor.onDidLayoutChange(() => this._updatePositionIfVisible()));
	}

	// IOverlayWidget implementation
	public getId(): string {
		return SelectionHelperContribution.ID;
	}

	public getDomNode(): HTMLElement {
		return this._rootHTML;
	}

	public getPosition(): IOverlayWidgetPosition | null {
		return null; // We position manually
	}

	private _onSelectionChange(e: ICursorSelectionChangedEvent): void {
		if (!this._editor.hasModel()) {
			return;
		}

		if (this._editor.getModel().uri.scheme !== 'file') {
			return;
		}

		const selection = this._editor.getSelection();

		if (!selection || selection.isEmpty()) {
			this._hideHelper();
			return;
		}

		// Get selection text to check if it's worth showing the helper
		const text = this._editor.getModel()!.getValueInRange(selection);
		if (text.length < 3) {
			this._hideHelper();
			return;
		}

		// Store selection
		this._lastSelection = new Selection(
			selection.startLineNumber,
			selection.startColumn,
			selection.endLineNumber,
			selection.endColumn
		);

		this._showScheduler.schedule();
	}

	// Update the _showHelperForSelection method to work with the React component
	private _showHelperForSelection(selection: Selection): void {
		if (!this._editor.hasModel()) {
			return;
		}

		const model = this._editor.getModel()!;

		// get the longest length of the nearest neighbors of the target
		const { tabSize: numSpacesInTab } = model.getFormattingOptions();
		const spaceWidth = this._editor.getOption(EditorOption.fontInfo).spaceWidth;
		const tabWidth = numSpacesInTab * spaceWidth;
		const numLinesModel = model.getLineCount()

		// Calculate right edge of visible editor area
		const editorWidthPx = this._editor.getLayoutInfo().width;
		const maxLeftPx = editorWidthPx - minDistanceFromRightPx

		// returns the position where the box should go on the targetLine
		const getBoxPosition = (targetLine: number): { top: number, left: number } => {

			const targetPosition = this._editor.getScrolledVisiblePosition({ lineNumber: targetLine, column: 1 }) ?? { left: 0, top: 0 };

			const { top: targetTop, left: targetLeft } = targetPosition

			let targetWidth = 0;
			for (let i = targetLine; i <= targetLine + 1; i++) {

				// if not in range, continue
				if (!(i >= 1) || !(i <= numLinesModel)) continue;

				const content = model.getLineContent(i);
				const currWidth = getLengthOfTextPx({
					tabWidth,
					spaceWidth,
					content
				})

				targetWidth = Math.max(targetWidth, currWidth);
			}

			return {
				top: targetTop,
				left: targetLeft + targetWidth,
			};

		}


		// Calculate the middle line of the selection
		const startLine = selection.startLineNumber;
		const endLine = selection.endLineNumber;
		// const middleLine = Math.floor(startLine + (endLine - startLine) / 2);
		const targetLine = endLine - startLine + 1 <= 2 ? startLine : startLine + 2;

		let boxPos = getBoxPosition(targetLine);

		// if the position of the box is too far to the right, keep searching for a good position
		const lineDeltasToTry = [-1, -2, -3, 1, 2, 3];

		if (boxPos.left > maxLeftPx) {
			for (const lineDelta of lineDeltasToTry) {

				boxPos = getBoxPosition(targetLine + lineDelta);
				if (boxPos.left <= maxLeftPx) {
					break;
				}
			}
		}
		if (boxPos.left > maxLeftPx) { // if still not found, make it 2 lines before
			boxPos = getBoxPosition(targetLine - 2)
		}


		// Position the helper element at the end of the middle line but ensure it's visible
		const xPosition = Math.max(Math.min(boxPos.left, maxLeftPx), minLeftPx);
		const yPosition = boxPos.top;

		// Update the React component position
		this._rootHTML.style.left = `${xPosition}px`;
		this._rootHTML.style.top = `${yPosition}px`;
		this._rootHTML.style.display = 'flex'; // Show the container

		this._isVisible = true;

		// rerender
		const enabled = this._voidSettingsService.state.globalSettings.showInlineSuggestions
			&& this._editor.hasTextFocus() // needed since VS Code counts unfocused selections as selections, which causes this to rerender when it shouldnt (bad ux)

		if (enabled) {
			this._rerender({ rerenderKey: this._rerenderKey } satisfies VoidSelectionHelperProps)
			this._rerenderKey = (this._rerenderKey + 1) % 2;
			// this._reactComponentRerender();
		}

	}

	private _hideHelper(): void {
		this._rootHTML.style.display = 'none';
		this._isVisible = false;
		this._lastSelection = null;
	}

	private _updatePositionIfVisible(): void {
		if (!this._isVisible || !this._lastSelection || !this._editor.hasModel()) {
			return;
		}

		this._showHelperForSelection(this._lastSelection);
	}

	override dispose(): void {
		this._hideHelper();
		if (this._reactComponentDisposable) {
			this._reactComponentDisposable.dispose();
		}
		this._editor.removeOverlayWidget(this);
		this._showScheduler.dispose();
		super.dispose();
	}
}

// Register the contribution
registerEditorContribution(SelectionHelperContribution.ID, SelectionHelperContribution, EditorContributionInstantiation.Eager);
