/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../base/common/platform';

// import { OperatingSystem, OS } from '../../../../base/common/platform.js';
// OS === OperatingSystem.Macintosh
export function getCmdKey(): string {
	if (isMacintosh) {
		return '⌘';
	} else {
		return 'Ctrl';
	}
}




