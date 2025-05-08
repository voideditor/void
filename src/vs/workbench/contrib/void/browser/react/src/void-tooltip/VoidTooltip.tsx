/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css'
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import { useIsDark } from '../util/services.js';

/**
 * Creates a configured global tooltip component with consistent styling
 * To use:
 * 1. Mount a Tooltip with some id eg id='void-tooltip'
 * 2. Add data-tooltip-id="void-tooltip" and data-tooltip-content="Your tooltip text" to any element
 */
export const VoidTooltip = () => {


	const isDark = useIsDark()

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
				#void-tooltip, #void-tooltip-orange, #void-tooltip-green, #void-tooltip-ollama-settings, #void-tooltip-provider-info {
					font-size: 12px;
					padding: 0px 8px;
					border-radius: 6px;
					z-index: 999999;
				}

				#void-tooltip {
					background-color: var(--vscode-editor-background);
					color: var(--vscode-input-foreground);
				}

				#void-tooltip-orange {
					background-color: #F6762A;
					color: white;
				}

				#void-tooltip-green {
					background-color: #228B22;
					color: white;
				}

				#void-tooltip-ollama-settings, #void-tooltip-provider-info {
					background-color: var(--vscode-editor-background);
					color: var(--vscode-input-foreground);
				}

				.react-tooltip-arrow {
					z-index: -1 !important; /* Keep arrow behind content (somehow this isnt done automatically) */
				}
				`}
			</style>


			<Tooltip
				id="void-tooltip"
				// border='1px solid var(--vscode-editorGroup-border)'
				border='1px solid rgba(100,100,100,.2)'
				opacity={1}
				delayShow={50}
			/>
			<Tooltip
				id="void-tooltip-orange"
				border='1px solid rgba(200,200,200,.3)'
				opacity={1}
				delayShow={50}
			/>
			<Tooltip
				id="void-tooltip-green"
				border='1px solid rgba(200,200,200,.3)'
				opacity={1}
				delayShow={50}
			/>
			<Tooltip
				id="void-tooltip-ollama-settings"
				border='1px solid rgba(100,100,100,.2)'
				opacity={1}
				openEvents={{ mouseover: true, click: true, focus: true }}
				place='right'
				style={{ pointerEvents: 'all', userSelect: 'text', fontSize: 11 }}
			>
				<div style={{ padding: '8px 10px' }}>
					<div style={{ opacity: 0.8, textAlign: 'center', fontWeight: 'bold', marginBottom: 8 }}>
						Good starter models
					</div>
					<div style={{ marginBottom: 4 }}>
						<span style={{ opacity: 0.8 }}>For chat:{` `}</span>
						<span style={{ opacity: 0.8, fontWeight: 'bold' }}>gemma3</span>
					</div>
					<div style={{ marginBottom: 4 }}>
						<span style={{ opacity: 0.8 }}>For autocomplete:{` `}</span>
						<span style={{ opacity: 0.8, fontWeight: 'bold' }}>qwen2.5-coder</span>
					</div>
					<div style={{ marginBottom: 0 }}>
						<span style={{ opacity: 0.8 }}>Use the largest version of these you can!</span>
					</div>
				</div>
			</Tooltip>

			<Tooltip
				id="void-tooltip-provider-info"
				border='1px solid rgba(100,100,100,.2)'
				opacity={1}
				delayShow={50}
				style={{ pointerEvents: 'all', userSelect: 'text', fontSize: 11, maxWidth: '280px', paddingTop:'8px', paddingBottom:'8px' }}
			/>
		</>
	);
};
