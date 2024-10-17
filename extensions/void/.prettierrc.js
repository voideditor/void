module.exports = {
	bracketSpacing: true,
	bracketSameLine: true,
	singleQuote: true,
	jsxSingleQuote: false,
	trailingComma: "es5",
	semi: true,
	printWidth: 110,
	arrowParens: "always",
	endOfLine: "auto",
	importOrder: [
	  // External package imports (npm packages, etc.)
	  "^react(.*)$",
	  "^@?\\w",
	  // Absolute imports from your project (if any)
	  "^src/(.*)$",
	  // Relative imports (local files)
	  "^../(.*)$",
	  "^./(.*)$",
	],
	importOrderSeparation: true,
	importOrderSortSpecifiers: true,
	plugins: [
	  "@trivago/prettier-plugin-sort-imports",
	  /**
	   * **NOTE** tailwind plugin must come last!
	   * @see https://github.com/tailwindlabs/prettier-plugin-tailwindcss#compatibility-with-other-prettier-plugins
	   */
	  "prettier-plugin-tailwindcss",
	],
  };
