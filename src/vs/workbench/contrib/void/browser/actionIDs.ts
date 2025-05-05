// Normally you'd want to put these exports in the files that register them, but if you do that you'll get an import order error if you import them in certain cases.
// (importing them runs the whole file to get the ID, causing an import error). I guess it's best practice to separate out IDs, pretty annoying...

export const VOID_CTRL_L_ACTION_ID = 'void.ctrlLAction'

export const VOID_CTRL_K_ACTION_ID = 'void.ctrlKAction'

export const VOID_ACCEPT_DIFF_ACTION_ID = 'void.acceptDiff'

export const VOID_REJECT_DIFF_ACTION_ID = 'void.rejectDiff'
