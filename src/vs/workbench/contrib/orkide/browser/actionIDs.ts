// Normally you'd want to put these exports in the files that register them, but if you do that you'll get an import order error if you import them in certain cases.
// (importing them runs the whole file to get the ID, causing an import error). I guess it's best practice to separate out IDs, pretty annoying...

export const VOID_CTRL_L_ACTION_ID = 'void.ctrlLAction'

export const VOID_CTRL_K_ACTION_ID = 'void.ctrlKAction'

export const VOID_ACCEPT_DIFF_ACTION_ID = 'void.acceptDiff'

export const VOID_REJECT_DIFF_ACTION_ID = 'void.rejectDiff'

export const VOID_GOTO_NEXT_DIFF_ACTION_ID = 'void.goToNextDiff'

export const VOID_GOTO_PREV_DIFF_ACTION_ID = 'void.goToPrevDiff'

export const VOID_GOTO_NEXT_URI_ACTION_ID = 'void.goToNextUri'

export const VOID_GOTO_PREV_URI_ACTION_ID = 'void.goToPrevUri'

export const VOID_ACCEPT_FILE_ACTION_ID = 'void.acceptFile'

export const VOID_REJECT_FILE_ACTION_ID = 'void.rejectFile'

export const VOID_ACCEPT_ALL_DIFFS_ACTION_ID = 'void.acceptAllDiffs'

export const VOID_REJECT_ALL_DIFFS_ACTION_ID = 'void.rejectAllDiffs'
