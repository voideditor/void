/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ['./src2/**/*.{jsx,tsx}'], // uses these files to decide how to transform the css file
	theme: {
		extend: {
			colors: {
				vscode: {
					// see https://code.visualstudio.com/api/references/theme-color

					// base colors
					"fg": "var(--vscode-foreground)",
					"focus-border": "var(--vscode-focusBorder)",
					"disabled-fg": "var(--vscode-disabledForeground)",
					"widget-border": "var(--vscode-widget-border)",
					"widget-shadow": "var(--vscode-widget-shadow)",
					"selection-bg": "var(--vscode-selection-background)",
					"description-fg": "var(--vscode-descriptionForeground)",
					"error-fg": "var(--vscode-errorForeground)",
					"icon-fg": "var(--vscode-icon-foreground)",
					"sash-hover-border": "var(--vscode-sash-hoverBorder)",

					// text colors
					"text-blockquote-bg": "var(--vscode-textBlockQuote-background)",
					"text-blockquote-border": "var(--vscode-textBlockQuote-border)",
					"text-codeblock-bg": "var(--vscode-textCodeBlock-background)",
					"text-link-active-fg": "var(--vscode-textLink-activeForeground)",
					"text-link-fg": "var(--vscode-textLink-foreground)",
					"text-preformat-fg": "var(--vscode-textPreformat-foreground)",
					"text-preformat-bg": "var(--vscode-textPreformat-background)",
					"text-separator-fg": "var(--vscode-textSeparator-foreground)",

					// input colors
					"input-bg": "var(--vscode-input-background)",
					"input-border": "var(--vscode-input-border)",
					"input-fg": "var(--vscode-input-foreground)",
					"input-placeholder-fg": "input-var(--vscode-placeholderForeground)",
					"input-active-bg": "inputOption-var(--vscode-activeBackground)",
					"input-option-active-border": "inputOption-var(--vscode-activeBorder)",
					"input-option-active-fg": "inputOption-var(--vscode-activeForeground)",
					"input-option-hover-bg": "inputOption-var(--vscode-hoverBackground)",
					"input-validation-error-bg": "inputValidation-var(--vscode-errorBackground)",
					"input-validation-error-fg": "inputValidation-var(--vscode-errorForeground)",
					"input-validation-error-border": "inputValidation-var(--vscode-errorBorder)",
					"input-validation-info-bg": "inputValidation-var(--vscode-infoBackground)",
					"input-validation-info-fg": "inputValidation-var(--vscode-infoForeground)",
					"input-validation-info-border": "inputValidation-var(--vscode-infoBorder)",
					"input-validation-warning-bg": "inputValidation-var(--vscode-warningBackground)",
					"input-validation-warning-fg": "inputValidation-var(--vscode-warningForeground)",
					"input-validation-warning-border": "inputValidation-var(--vscode-warningBorder)",

					// badge colors
					"badge-fg": "var(--vscode-badge-foreground)",
					"badge-bg": "var(--vscode-badge-background)",

					// button colors
					"button-bg": "var(--vscode-button-background)",
					"button-fg": "var(--vscode-button-foreground)",
					"button-border": "var(--vscode-button-border)",
					"button-separator": "var(--vscode-button-separator)",
					"button-hover-bg": "var(--vscode-button-hoverBackground)",
					"button-secondary-fg": "var(--vscode-button-secondaryForeground)",
					"button-secondary-bg": "var(--vscode-button-secondaryBackground)",
					"button-secondary-hover-bg": "var(--vscode-button-secondaryHoverBackground)",

					// checkbox colors
					"checkbox-bg": "var(--vscode-checkbox-background)",
					"checkbox-fg": "var(--vscode-checkbox-foreground)",
					"checkbox-border": "var(--vscode-checkbox-border)",
					"checkbox-select-bg": "var(--vscode-checkbox-selectBackground)",


					// sidebar colors
					"sidebar-bg": "var(--vscode-sideBar-background)",
					"sidebar-fg": "var(--vscode-sideBar-foreground)",
					"sidebar-border": "var(--vscode-sideBar-border)",
					"sidebar-drop-backdrop": "var(--vscode-sideBar-dropBackground)",
					"sidebar-title-fg": "var(--vscode-sideBarTitle-foreground)",
					"sidebar-header-bg": "var(--vscode-sideBarSectionHeader-background)",
					"sidebar-header-fg": "var(--vscode-sideBarSectionHeader-foreground)",
					"sidebar-header-border": "var(--vscode-sideBarSectionHeader-border)",
					"sidebar-activitybartop-border": "var(--vscode-sideBarActivityBarTop-border)",
					"sidebar-title-bg": "var(--vscode-sideBarTitle-background)",
					"sidebar-title-border": "var(--vscode-sideBarTitle-border)",
					"sidebar-stickyscroll-bg": "var(--vscode-sideBarStickyScroll-background)",
					"sidebar-stickyscroll-border": "var(--vscode-sideBarStickyScroll-border)",
					"sidebar-stickyscroll-shadow": "var(--vscode-sideBarStickyScroll-shadow)",


					// other colors (these are partially complete)

					// editor colors
					"editor-bg": "var(--vscode-editor-background)",
					"editor-fg": "var(--vscode-editor-foreground)",

					// editorWidget colors
					"editor-widget-fg": "var(--vscode-editorWidget-foreground)",
					"editor-widget-bg": "var(--vscode-editorWidget-background)",
					"editor-widget-border": "var(--vscode-editorWidget-border)",


				},
			},
		},
	},
	plugins: [],
	prefix: 'void-'
}

