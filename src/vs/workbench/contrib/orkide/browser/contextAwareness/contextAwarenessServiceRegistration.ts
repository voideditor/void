/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from 'vs/platform/instantiation/common/extensions';
import { IOrkideContextAwarenessService } from './contextAwarenessService';
import { OrkideContextAwarenessService } from './contextAwarenessServiceImpl';

registerSingleton(IOrkideContextAwarenessService, OrkideContextAwarenessService, InstantiationType.Eager);