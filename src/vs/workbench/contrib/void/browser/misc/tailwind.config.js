/** @type {import('tailwindcss').Config} */

// inject user's vscode theme colors: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content
module.exports = {
	content: ["./src/webviews/**/*.{html,js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				vscode: {
					"sidebar-bg": "var(--vscode-sideBar-background)",
					"editor-bg": "var(--vscode-editor-background)",
					"editor-fg": "var(--vscode-editor-foreground)",
					"input-bg": "var(--vscode-input-background)",
					"input-fg": "var(--vscode-input-foreground)",
					"input-border": "var(--vscode-input-border)",
					"button-fg": "var(--vscode-button-foreground)",
					"button-bg": "var(--vscode-button-background)",
					"button-hoverBg": "var(--vscode-button-hoverBackground)",
					"button-secondary-fg": "var(--vscode-button-secondaryForeground)",
					"button-secondary-bg": "var(--vscode-button-secondaryBackground)",
					"button-secondary-hoverBg": "var(--vscode-button-secondaryHoverBackground)",
					"dropdown-bg": "var(--vscode-settings-dropdownBackground)",
					"dropdown-foreground": "var(--vscode-settings-dropdownForeground)",
					"dropdown-border": "var(--vscode-settings-dropdownBorder)",
					"focus-border": "var(--vscode-focusBorder)",
				},
			},
		},
	},
	plugins: [],
};
