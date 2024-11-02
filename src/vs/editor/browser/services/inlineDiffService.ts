// This file was added by the Void team

// src/vs/editor/browser/services/inlineDiffService.ts
import { Disposable } from '../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IModelDecorationOptions, IModelDeltaDecoration } from '../../common/model.js';
import { ICodeEditor, IViewZone } from '../editorBrowser.js';
import { IRange } from '../../common/core/range.js';


export interface IInlineDiffService {
	readonly _serviceBrand: undefined;

	addDiff(editor: ICodeEditor, originalText: string, modifiedRange: IRange): void;
	removeDiffs(editor: ICodeEditor): void;
}

export const IInlineDiffService = createDecorator<IInlineDiffService>('inlineDiffService');

class InlineDiffService extends Disposable implements IInlineDiffService {
	private readonly _diffDecorations = new Map<ICodeEditor, string[]>();
	private readonly _diffZones = new Map<ICodeEditor, string[]>();
	_serviceBrand: undefined;

	private static readonly ADDED_DECORATION: IModelDecorationOptions = {
		className: 'inline-diff-added',
		description: 'inline-diff-added',
		isWholeLine: false,
		minimap: {
			color: { id: 'minimapGutter.addedBackground' },
			position: 2
		},
		overviewRuler: {
			color: { id: 'editorOverviewRuler.addedForeground' },
			position: 7
		}
	};

	constructor(

	) {
		super();
	}

	public addDiff: IInlineDiffService['addDiff'] = (editor, originalText, modifiedRange) => {

		// Clear existing diffs
		this.removeDiffs(editor);

		// Add decoration for modified text
		const decorations: IModelDeltaDecoration[] = [{
			range: modifiedRange,
			options: InlineDiffService.ADDED_DECORATION
		}];

		const newDecorations = editor.deltaDecorations([], decorations);
		this._diffDecorations.set(editor, newDecorations);

		// Add view zone for original text
		editor.changeViewZones(accessor => {
			const domNode = document.createElement('div');
			domNode.className = 'inline-diff-deleted monaco-editor';

			// Create inner container for proper padding
			const innerContainer = document.createElement('div');
			innerContainer.className = 'view-line';
			innerContainer.textContent = originalText;
			domNode.appendChild(innerContainer);

			const viewZone: IViewZone = {
				afterLineNumber: modifiedRange.startLineNumber - 1,
				heightInLines: originalText.split('\n').length,
				domNode: domNode,
				suppressMouseDown: true,
				marginDomNode: this.createGutterElement(editor)
			};

			const zoneId = accessor.addZone(viewZone);
			this._diffZones.set(editor, [zoneId]);
		});
	}

	private createGutterElement(editor: ICodeEditor): HTMLElement {
		const gutterDiv = document.createElement('div');
		gutterDiv.className = 'inline-diff-gutter';
		gutterDiv.innerHTML = '<div class="inline-diff-deleted-gutter">-</div>';
		return gutterDiv;
	}

	public removeDiffs(editor: ICodeEditor): void {
		// Clear decorations
		const decorationIds = this._diffDecorations.get(editor) || [];
		editor.deltaDecorations(decorationIds, []);
		this._diffDecorations.delete(editor);

		// Clear view zones
		editor.changeViewZones(accessor => {
			const zoneIds = this._diffZones.get(editor) || [];
			zoneIds.forEach(id => accessor.removeZone(id));
		});
		this._diffZones.delete(editor);
	}

	override dispose(): void {
		super.dispose();
		this._diffDecorations.clear();
		this._diffZones.clear();
	}
}

// Register the service
registerSingleton(IInlineDiffService, InlineDiffService, InstantiationType.Eager);


