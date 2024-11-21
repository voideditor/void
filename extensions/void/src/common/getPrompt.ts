import { configFields, VoidConfig } from "../webviews/common/contextForConfig"
import { FimInfo } from "./sendLLMMessage"


type GetFIMPrompt = ({ voidConfig, fimInfo }: { voidConfig: VoidConfig, fimInfo: FimInfo, }) => string

export const getFIMSystem: GetFIMPrompt = ({ voidConfig, fimInfo }) => {

	switch (voidConfig.default.whichApi) {
		case 'ollama':
			return ''
		case 'anthropic':
		case 'openAI':
		case 'gemini':
		case 'greptile':
		case 'openRouter':
		case 'openAICompatible':
		case 'azure':
		default:
			return `You are given the START and END to a piece of code. Please FILL IN THE MIDDLE between the START and END.

Instruction summary:
1. Return the MIDDLE of the code between the START and END.
2. Do not give an explanation, description, or any other code besides the middle.
2. Do not return duplicate code from either START or END.
3. Make sure the MIDDLE piece of code has balanced brackets that match the START and END.
4. The MIDDLE begins on the same line as START. Please include a newline character if you want to begin on the next line.

# EXAMPLE

## START:
\`\`\` python
def add(a,b):
	return a + b
def subtract(a,b):
	return a - b
\`\`\`
## END:
\`\`\` python
def divide(a,b):
	return a / b
\`\`\`
## EXPECTED OUTPUT:
\`\`\` python

def multiply(a,b):
	return a * b
\`\`\`

# EXAMPLE
## START:
\`\`\` javascript
const x = 1

const y
\`\`\`
## END:
\`\`\` javascript

const z = 3
\`\`\`
## EXPECTED OUTPUT:
\`\`\` javascript
= 2
\`\`\`
`
	}


}


export const getFIMPrompt: GetFIMPrompt = ({ voidConfig, fimInfo }) => {

	// if no prefix or suffix, return empty string
	if (!fimInfo.prefix.trim() && !fimInfo.suffix.trim()) return ''

	// TODO may want to trim the prefix and suffix
	switch (voidConfig.default.whichApi) {
		case 'ollama':
			if (voidConfig.ollama.model === 'codestral') {
				return `[SUFFIX]${fimInfo.suffix}[PREFIX] ${fimInfo.prefix}`
			}
			return ''
		case 'anthropic':
		case 'openAI':
		case 'gemini':
		case 'greptile':
		case 'openRouter':
		case 'openAICompatible':
		case 'azure':
		default:
			return `## START:
\`\`\`
${fimInfo.prefix}
\`\`\`
## END:
\`\`\`
${fimInfo.suffix}
\`\`\`
`

	}
}

