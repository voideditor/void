import * as React from "react"
import { useEffect } from "react"
import * as ReactDOM from "react-dom/client"
import Sidebar from "./Sidebar"
import { CtrlK } from "./CtrlK"
import { ThreadsProvider } from "./contextForThreads"
import { ConfigProvider } from "./contextForConfig"
import { MessageToSidebar } from "../common/shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, onMessageFromVSCode } from "./getVscodeApi"
import { identifyUser, initPosthog } from "./metrics/posthog"

if (typeof document === "undefined") {
	console.log("index.tsx error: document was undefined")
}


const CommonEffects = () => {
	// initialize posthog
	useEffect(() => {
		initPosthog()
	}, [])

	// when we get the deviceid, identify the user
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: 'getDeviceId' });
		awaitVSCodeResponse('deviceId').then((m => {
			identifyUser(m.deviceId)
		}))
	}, [])

	// Receive messages from the VSCode extension
	useEffect(() => {
		const listener = (event: MessageEvent) => {
			const m = event.data as MessageToSidebar;
			onMessageFromVSCode(m)
		}
		window.addEventListener('message', listener);
		return () => window.removeEventListener('message', listener)
	}, [])

	return null
}

(() => {
	// mount the sidebar on the id="root" element
	const rootElement = document.getElementById("root")!
	console.log("Void root Element:", rootElement)

	const sidebar = (<>
		<CommonEffects />

		<ThreadsProvider>
			<ConfigProvider>
				<Sidebar />
			</ConfigProvider>
		</ThreadsProvider>

		<ConfigProvider>
			<CtrlK />
		</ConfigProvider>

	</>)
	const root = ReactDOM.createRoot(rootElement)
	root.render(sidebar)
})();

