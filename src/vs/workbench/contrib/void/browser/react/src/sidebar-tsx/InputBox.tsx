// import { useEffect, useRef } from 'react'
// import { HistoryInputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js'
// import { useService } from '../util/services.js'
// import { defaultInputBoxStyles } from '../../../../../../../platform/theme/browser/defaultStyles.js'

// export const InputBox = ({ onChangeText, placeholder, className }: { onChangeText: (value: string) => void, placeholder: string, className: string }) => {

// 	const domNodeRef = useRef<HTMLDivElement | null>(null)

// 	const contextViewProvider = useService('contextViewService')


// 	useEffect(() => {

// 		const htmlNode = domNodeRef.current
// 		if (!htmlNode) return


// 		console.log('creating inputbox')
// 		const widget = new HistoryInputBox(htmlNode, contextViewProvider, {
// 			inputBoxStyles: defaultInputBoxStyles,
// 			placeholder,
// 			history: [],
// 		})


// 		widget.onDidChange((newStr) => { onChangeText(newStr) })

// 		return () => {
// 			console.log('disposing inputbox')
// 			widget.dispose()
// 		}
// 	}, [onChangeText, contextViewProvider, placeholder])

// 	return <div ref={domNodeRef}className={className}/>
// }
