/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: 'selector', // '{prefix-}dark' className is used to identify `dark:`
	content: ['./src2/**/*.{jsx,tsx}'], // uses these files to decide how to transform the css file
	theme: {
		extend: {
			fontSize: {
				xs: '10px',
				sm: '11px',
				root: '13px',
				lg: '14px',
				xl: '16px',
				'2xl': '18px',
				'3xl': '20px',
				'4xl': '24px',
				'5xl': '30px',
				'6xl': '36px',
				'7xl': '48px',
				'8xl': '64px',
				'9xl': '72px',
			},
			// common colors to use, ordered light to dark

			colors: {
				"void-bg-1": "var(--vscode-input-background)",
				"void-bg-1-alt": "var(--vscode-badge-background)",
				"void-bg-2": "var(--vscode-sideBar-background)",
				"void-bg-2-alt": "color-mix(in srgb, var(--vscode-sideBar-background) 30%, var(--vscode-editor-background) 70%)",
				"void-bg-3": "var(--vscode-editor-background)",


				"void-fg-1": "var(--vscode-editor-foreground)",
				"void-fg-2": "var(--vscode-input-foreground)",
				"void-fg-3": "var(--vscode-input-placeholderForeground)",
				// "void-fg-4": "var(--vscode-tab-inactiveForeground)",
				"void-fg-4": "var(--vscode-list-deemphasizedForeground)",


				"void-warning": "var(--vscode-charts-yellow)",

				"void-border-1": "var(--vscode-commandCenter-activeBorder)",
				"void-border-2": "var(--vscode-commandCenter-border)",
				"void-border-3": "var(--vscode-commandCenter-inactiveBorder)",
				"void-border-3": "var(--vscode-settings-sashBorder)",


				vscode: {
					// see: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content

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
					"input-placeholder-fg": "var(--vscode-input-placeholderForeground)",
					"input-active-bg": "var(--vscode-input-activeBackground)",
					"input-option-active-border": "var(--vscode-inputOption-activeBorder)",
					"input-option-active-fg": "var(--vscode-inputOption-activeForeground)",
					"input-option-hover-bg": "var(--vscode-inputOption-hoverBackground)",
					"input-validation-error-bg": "var(--vscode-inputValidation-errorBackground)",
					"input-validation-error-fg": "var(--vscode-inputValidation-errorForeground)",
					"input-validation-error-border": "var(--vscode-inputValidation-errorBorder)",
					"input-validation-info-bg": "var(--vscode-inputValidation-infoBackground)",
					"input-validation-info-fg": "var(--vscode-inputValidation-infoForeground)",
					"input-validation-info-border": "var(--vscode-inputValidation-infoBorder)",
					"input-validation-warning-bg": "var(--vscode-inputValidation-warningBackground)",
					"input-validation-warning-fg": "var(--vscode-inputValidation-warningForeground)",
					"input-validation-warning-border": "var(--vscode-inputValidation-warningBorder)",

					// command center colors (the top bar)
					"commandcenter-fg": "var(--vscode-commandCenter-foreground)",
					"commandcenter-active-fg": "var(--vscode-commandCenter-activeForeground)",
					"commandcenter-bg": "var(--vscode-commandCenter-background)",
					"commandcenter-active-bg": "var(--vscode-commandCenter-activeBackground)",
					"commandcenter-border": "var(--vscode-commandCenter-border)",
					"commandcenter-inactive-fg": "var(--vscode-commandCenter-inactiveForeground)",
					"commandcenter-inactive-border": "var(--vscode-commandCenter-inactiveBorder)",
					"commandcenter-active-border": "var(--vscode-commandCenter-activeBorder)",
					"commandcenter-debugging-bg": "var(--vscode-commandCenter-debuggingBackground)",

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
					"sidebar-drop-bg": "var(--vscode-sideBar-dropBackground)",
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

					// text formatting
					"text-preformat-bg": "var(--vscode-textPreformat-background)",
					"text-preformat-fg": "var(--vscode-textPreformat-foreground)",

					// editor colors
					"editor-bg": "var(--vscode-editor-background)",
					"editor-fg": "var(--vscode-editor-foreground)",



					// other
					"editorwidget-bg": "var(--vscode-editorWidget-background)",
					"toolbar-hover-bg": "var(--vscode-toolbar-hoverBackground)",
					"toolbar-foreground": "var(--vscode-editorActionList-foreground)",

					"editorwidget-fg": "var(--vscode-editorWidget-foreground)",
					"editorwidget-border": "var(--vscode-editorWidget-border)",

					"charts-orange": "var(--vscode-charts-orange)",
					"charts-yellow": "var(--vscode-charts-yellow)",
				},
			},
		},
	},
	plugins: [],
	prefix: 'void-'
}

