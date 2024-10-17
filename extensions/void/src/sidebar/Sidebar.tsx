import React, { useState, useEffect } from "react"
import { MessageToSidebar } from "../shared_types"
import { getVSCodeAPI, onMessageFromVSCode } from "./getVscodeApi"

import { SidebarThreadSelector } from "./SidebarThreadSelector";
import { SidebarChat } from "./SidebarChat";



const Sidebar = () => {
	const [isThreadSelectorOpen, setIsThreadSelectorOpen] = useState(false)

	// get Api Config on mount
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: 'getApiConfig' })
	}, [])

	// Receive messages from the VSCode extension
	useEffect(() => {
		const listener = (event: MessageEvent) => {
			const m = event.data as MessageToSidebar;
			onMessageFromVSCode(m)
		}
		window.addEventListener('message', listener);
		return () => { window.removeEventListener('message', listener) }
	}, [])


	return <>
		<div className="flex flex-col h-screen w-full">
			{isThreadSelectorOpen && (
				<div className="mb-2 max-h-[30vh] overflow-y-auto">
					<SidebarThreadSelector onClose={() => setIsThreadSelectorOpen(false)} />
				</div>
			)}

			<SidebarChat setIsThreadSelectorOpen={setIsThreadSelectorOpen} />
		</div>

	</>

}

export default Sidebar
