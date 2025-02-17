/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { isLinux, isMacintosh, isWindows } from '../../../../../base/common/platform.js';

// import { OS, OperatingSystem } from '../../../../../base/common/platform.js';
// alternatively could use ^ and OS === OperatingSystem.Windows ? ...



export const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null

export const arch = process.arch
export const osplatform = process.platform;

