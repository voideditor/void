import { awaitVSCodeResponse, getVSCodeAPI } from '../sidebar/getVscodeApi';

export async function getRules() {
	try {
		getVSCodeAPI().postMessage({ type: 'getRules', rules: '' })
		const rules = await awaitVSCodeResponse('getRules')
		return rules.rules
	} catch (error) {
		console.error('Error reading .voidrules file:', error);
		throw error;
	}
}
