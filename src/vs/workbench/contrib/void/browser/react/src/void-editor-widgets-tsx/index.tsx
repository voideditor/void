/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { VoidCommandBarMain } from './VoidCommandBar.js'
import { VoidSelectionHelperMain } from './VoidSelectionHelper.js'

export const mountVoidCommandBar = mountFnGenerator(VoidCommandBarMain)

export const mountVoidSelectionHelper = mountFnGenerator(VoidSelectionHelperMain)

