/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem, OS } from '../../../../base/common/platform.js';

export function getCmdKey(): string {
	if (OS === OperatingSystem.Macintosh) {
		return '⌘';
	} else {
		return 'Ctrl';
	}
}




