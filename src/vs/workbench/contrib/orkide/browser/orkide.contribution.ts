/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


// register inline diffs
import './editCodeService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'


// register Autocomplete
import './autocompleteService.js'

// register Context services
// import './contextGatheringService.js'
// import './contextUserChangesService.js'

// settings pane
import './orkideSettingsPane.js'

// register css
import './media/orkide.css'

// update (frontend part, also see platform/)
import './orkideUpdateActions.js'

import './convertToLLMMessageWorkbenchContrib.js'

// tools
import './toolsService.js'
import './terminalToolService.js'

// register Thread History
import './chatThreadService.js'

// ping
import './metricsPollService.js'

// helper services
import './helperServices/consistentItemService.js'

// register selection helper
import './orkideSelectionHelperWidget.js'

// register tooltip service
import './tooltipService.js'

// register onboarding service
import './orkideOnboardingService.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register source control management
import './orkideSCMService.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// voidSettings
import '../common/orkideSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/orkideUpdateService.js'

// model service
import '../common/orkideModelService.js'

// Advanced Context Awareness
import './contextAwareness/contextAwarenessServiceRegistration.js'

// Multi-Agent Orchestration
import './multiAgent/multiAgentServiceRegistration.js'

// RAG (Retrieval-Augmented Generation)
import './rag/ragServiceRegistration.js'

// Planning Mode
import './planning/planningServiceRegistration.js'
