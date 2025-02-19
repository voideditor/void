import { ToolName, toolNames } from '../../common/toolsService.js';



const toolNamesSet = new Set<string>(toolNames)

export const isAToolName = (toolName: string): toolName is ToolName => {
	const isAToolName = toolNamesSet.has(toolName)
	return isAToolName
}
