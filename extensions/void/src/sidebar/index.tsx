import * as React from "react"
import * as ReactDOM from "react-dom/client"
import Sidebar from "./Sidebar"
import { ThreadsProvider } from "./threadsContext"

// mount the sidebar on the id="root" element
if (typeof document === "undefined") {
	console.log("index.tsx error: document was undefined")
}

const rootElement = document.getElementById("root")!
console.log("Void root Element:", rootElement)

const extension = (
	<ThreadsProvider>
		<Sidebar />
	</ThreadsProvider>
)
const root = ReactDOM.createRoot(rootElement)
root.render(extension)
