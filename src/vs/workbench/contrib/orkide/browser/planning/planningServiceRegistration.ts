/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from 'vs/platform/instantiation/common/extensions';
import { IOrkidePlanningService } from './planningService';
import { OrkidePlanningService } from './planningServiceImpl';

registerSingleton(IOrkidePlanningService, OrkidePlanningService, InstantiationType.Eager);