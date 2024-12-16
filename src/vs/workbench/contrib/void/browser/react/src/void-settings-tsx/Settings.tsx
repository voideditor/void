import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js'
import { ModelMenu } from './ModelSettings.js'
import { VoidProviderSettings } from './ProviderSettings.js'


export const Settings = () => {
	return <div className='@@void-scope w-full h-full'>
		<ErrorBoundary>
			<ModelMenu />
		</ErrorBoundary>

		<ErrorBoundary>
			<VoidProviderSettings />
		</ErrorBoundary>

	</div>
}
