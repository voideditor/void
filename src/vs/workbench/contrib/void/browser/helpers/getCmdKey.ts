/*------------------------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Glass Devtools, Inc. All rights reserved.
 *  Void Editor licensed under the AGPL 3.0 License. See LICENSE.txt in the project root for more information.
 *-----------------------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../../base/common/platform.js';

// import { OperatingSystem, OS } from '../../../../base/common/platform.js';
// OS === OperatingSystem.Macintosh
export function getCmdKey(): string {
	if (isMacintosh) {
		return '⌘';
	} else {
		return 'Ctrl';
	}
}




