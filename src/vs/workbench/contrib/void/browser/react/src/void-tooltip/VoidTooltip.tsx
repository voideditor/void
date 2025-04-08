/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';

/**
 * Creates a configured global tooltip component with consistent styling
 * To use:
 * 1. Mount a Tooltip with some id eg id='void-tooltip'
 * 2. Add data-tooltip-id="void-tooltip" and data-tooltip-content="Your tooltip text" to any element
 */
export const VoidTooltip = () => {
	return (

		// use native colors so we don't have to worry about @@void-scope styles
		// --void-bg-1: var(--vscode-input-background);
		// --void-bg-1-alt: var(--vscode-badge-background);
		// --void-bg-2: var(--vscode-sideBar-background);
		// --void-bg-2-alt: color-mix(in srgb, var(--vscode-sideBar-background) 30%, var(--vscode-editor-background) 70%);
		// --void-bg-3: var(--vscode-editor-background);

		// --void-fg-0: color-mix(in srgb, var(--vscode-tab-activeForeground) 90%, black 10%);
		// --void-fg-1: var(--vscode-editor-foreground);
		// --void-fg-2: var(--vscode-input-foreground);
		// --void-fg-3: var(--vscode-input-placeholderForeground);
		// /* --void-fg-4: var(--vscode-tab-inactiveForeground); */
		// --void-fg-4: var(--vscode-list-deemphasizedForeground);

		// --void-warning: var(--vscode-charts-yellow);

		// --void-border-1: var(--vscode-commandCenter-activeBorder);
		// --void-border-2: var(--vscode-commandCenter-border);
		// --void-border-3: var(--vscode-commandCenter-inactiveBorder);
		// --void-border-4: var(--vscode-editorGroup-border);

		<>
			<style>
				{`
				#void-tooltip {
					background-color: var(--vscode-editor-background);
					color: var(--vscode-input-foreground);

					box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
					font-size: 10px;
					padding: 0px 8px;
					border-radius: 6px;
					z-index: 9999;
				}
				`}
			</style>


			<Tooltip
				id="void-tooltip"
				border='1px solid var(--vscode-commandCenter-border)'
				opacity={1}
				delayShow={50}
			/>
		</>
	);
};
