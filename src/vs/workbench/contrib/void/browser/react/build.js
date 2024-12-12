/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';

// clear temp dirs
execSync('npx rimraf out/ && npx rimraf src2/')

// build and scope tailwind: https://www.npmjs.com/package/scope-tailwind
execSync('npx scope-tailwind ./src -o src2/ -s void-scope -c styles.css -p "prefix-" ')

// tsup to build src2/ into out/
execSync('npx tsup')


console.log('✅ Done building! Kill your build script(s) (Ctrl+D in them), then press Cmd+Shift+B again.')
