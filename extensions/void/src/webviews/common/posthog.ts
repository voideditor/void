import posthog from 'posthog-js'


export const identifyUser = (id: string) => {
	posthog.identify(id)
}

export const captureEvent = (eventId: string, properties: object) => {
	posthog.capture(eventId, properties)
}

export const initPosthog = () => {
	// We send absolutely no code to the server. We only track usage metrics like button clicks, etc. This might change and we might eventually add an opt-in or opt-out.
	posthog.init('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2',
		{
			api_host: 'https://us.i.posthog.com',
			person_profiles: 'identified_only' // we only track events from identified users. We identify them in Sidebar
		}
	)
}
