import React from "react";
import * as ReactDOM from "react-dom/client"
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation';
// import { initPosthog, identifyUser } from "./posthog";

// const ListenersAndTracking = () => {
// 	// initialize posthog
// 	useEffect(() => {
// 		initPosthog()
// 	}, [])

// 	// // when we get the deviceid, identify the user
// 	// useEffect(() => {
// 	// 	getVSCodeAPI().postMessage({ type: 'getDeviceId' });
// 	// 	awaitVSCodeResponse('deviceId').then((m => {
// 	// 		identifyUser(m.deviceId)
// 	// 	}))
// 	// }, [])

// 	// // Receive messages from the VSCode extension
// 	// useEffect(() => {
// 	// 	const listener = (event: MessageEvent) => {
// 	// 		const m = event.data as MessageToSidebar;
// 	// 		onMessageFromVSCode(m)
// 	// 	}
// 	// 	window.addEventListener('message', listener);
// 	// 	return () => window.removeEventListener('message', listener)
// 	// }, [])

// 	return null
// }




export const mountFnGenerator = (Component: React.FC<{ accessor: ServicesAccessor }>) => (rootElement: HTMLElement, accessor: ServicesAccessor) => {
	if (typeof document === "undefined") {
		console.error("index.tsx error: document was undefined")
		return
	}
	const root = ReactDOM.createRoot(rootElement)
	root.render(<Component accessor={accessor} />);
}
