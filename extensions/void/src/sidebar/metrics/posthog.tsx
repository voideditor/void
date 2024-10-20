import posthog from 'posthog-js'
import { useEffect } from 'react'


export const identifyUser = (id: string) => {
	posthog.identify(id)
}

export const captureEvent = (eventId: string, properties: object) => {
	posthog.capture(eventId, properties)
}

export const useMetrics = () => {
	// We send absolutely no code to the server. We only track usage metrics like button clicks, etc. This might change and we might eventually add an opt-in or opt-out.
	useEffect(() => {
		posthog.init('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2',
			{
				api_host: 'https://us.i.posthog.com',
				person_profiles: 'identified_only' // we only track events from identified users. We identify them in Sidebar
			}
		)
	}, [])

}

