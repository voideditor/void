import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import Sidebar from './Sidebar'

// mount the sidebar on the id="root" element
if (typeof document === 'undefined') {
	console.log('index.tsx error: document was undefined')
}

const rootElement = document.getElementById('root')!
console.log('root Element', rootElement)
const root = ReactDOM.createRoot(rootElement)
root.render(<Sidebar />)



