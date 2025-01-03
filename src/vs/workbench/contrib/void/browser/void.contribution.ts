/*------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for more information.
 *-----------------------------------------------------------------------------------------*/


// register inline diffs
import './inlineDiffsService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'
import './sidebarStateService.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'

// register Thread History
import './threadHistoryService.js'

// register Autocomplete
import './autocompleteService.js'

// settings pane
import './voidSettingsPane.js'

// register css
import './media/void.css'
