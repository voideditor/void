/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react'
import { useIsDark, useSidebarState } from '../util/services.js'
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { CtrlKChat } from './CtrlKChat.js'
import { QuickEditPropsType } from '../../../quickEditActions.js'

export const CtrlK = (props: QuickEditPropsType) => {

	const isDark = useIsDark()

	return <div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
		<ErrorBoundary>
			<CtrlKChat {...props} />
		</ErrorBoundary>
	</div>


}
