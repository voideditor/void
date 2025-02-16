/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../shared.webpack.config');
const { IgnorePlugin } = require('webpack');

module.exports = withDefaults({
	context: __dirname,
	resolve: {
		mainFields: ['module', 'main']
	},
	entry: {
		extension: './src/extension.ts',
	},
	externals: {
		vscode: "commonjs vscode",
		bufferutil: "commonjs bufferutil",
		"utf-8-validate": "commonjs utf-8-validate",
	},
	plugins: [
		new IgnorePlugin({
			resourceRegExp: /crypto\/build\/Release\/sshcrypto\.node$/,
		}),
		new IgnorePlugin({
			resourceRegExp: /cpu-features/,
		})
	]
});
