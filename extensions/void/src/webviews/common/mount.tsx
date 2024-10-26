import React, { useEffect } from "react";
import * as ReactDOM from "react-dom/client"
import { MessageToSidebar } from "../../common/shared_types";
import { getVSCodeAPI, awaitVSCodeResponse, onMessageFromVSCode } from "./getVscodeApi";
import { initPosthog, identifyUser } from "./posthog";
import { ThreadsProvider } from "./contextForThreads";
import { ConfigProvider } from "./contextForConfig";
import { PropsProvider } from "./contextForProps";

const ListenersAndTracking = () => {
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




export const mount = (children: React.ReactNode) => {

	if (typeof document === "undefined") {
		console.error("index.tsx error: document was undefined")
		return
	}

	// mount the sidebar on the id="root" element
	const rootElement = document.getElementById("root")!
	console.log("Void root Element:", rootElement)

	let props = rootElement.getAttribute("data-void-props")
	let propsObj: object | null = null
	if (props !== null) {
		propsObj = JSON.parse(decodeURIComponent(props))
	}

	const content = (<>
		<ListenersAndTracking />

		<PropsProvider props={propsObj}>
			<ThreadsProvider>
				<ConfigProvider>
					{children}
				</ConfigProvider>
			</ThreadsProvider>
		</PropsProvider>
	</>)

	const root = ReactDOM.createRoot(rootElement)
	root.render(content);

}