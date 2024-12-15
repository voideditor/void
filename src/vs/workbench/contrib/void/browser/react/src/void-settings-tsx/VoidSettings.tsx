import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { VoidProviderSettings } from './VoidProviderSettings.js'


export const VoidSettings = () => {
	return <>
		<ErrorBoundary>
			<VoidProviderSettings />
		</ErrorBoundary>
	</>
}


