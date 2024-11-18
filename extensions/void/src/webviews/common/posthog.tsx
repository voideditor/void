import posthog from 'posthog-js'




const buildEnv = 'development';
const buildNumber = '1.0.0';
const isMac = process.platform === 'darwin';
// TODO use commandKey
const commandKey = isMac ? '⌘' : 'Ctrl';
const systemInfo = {
	buildEnv,
	buildNumber,
	isMac,
}


export const identifyUser = (id: string) => {
	posthog.identify(id)
}




export const captureEvent = (eventId: string, properties: object) => {
	posthog.capture(eventId, { ...properties, systemInfo })
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
