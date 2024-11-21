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
3. Do not return duplicate code from either START or END.
4. Make sure the MIDDLE piece of code has balanced brackets that match the START and END.
5. The MIDDLE begins on the same line as START. Please include a newline character if you want to begin on the next line.
6. Around 90% of the time, you should return just one or a few lines of code. You should keep your outputs short unless you are confident the user is trying to write boilderplate code.

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

	const { prefix: fullPrefix, suffix: fullSuffix } = fimInfo
	const prefix = fullPrefix.split('\n').slice(-20).join('\n')
	const suffix = fullSuffix.split('\n').slice(0, 20).join('\n')


	console.log('prefix', JSON.stringify(prefix))
	console.log('suffix', JSON.stringify(suffix))

	if (!prefix.trim() && !suffix.trim()) return ''

	// TODO may want to trim the prefix and suffix
	switch (voidConfig.default.whichApi) {
		case 'ollama':
			if (voidConfig.ollama.model === 'codestral') {
				return `[SUFFIX]${suffix}[PREFIX] ${prefix}`
			} else if (voidConfig.ollama.model.includes('qwen')) {
				return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
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
${prefix}
\`\`\`
## END:
\`\`\`
${suffix}
\`\`\`
`
	}
}

