import { Command, WebviewMessage } from "../shared_types";



// message -> res[]
const awaiting: { [c in Command]: ((res: any) => void)[] } = {
	"ctrl+l": [],
	"applyChanges": [],
	"requestFiles": [],
	"files": [],
	"apiConfig": [],
	"getApiConfig": [],
	"startNewThread": [],
	"getAllThreads": [],
	"allThreads": [],
	"persistThread": [],
	"toggleThreadSelector": []
}

// use this function to await responses
export const awaitVSCodeResponse = <C extends Command>(c: C) => {
	let result: Promise<WebviewMessage & { type: C }> = new Promise((res, rej) => {
		awaiting[c].push(res)
	})
	return result
}

export const resolveAwaitingVSCodeResponse = (m: WebviewMessage) => {
	// resolve all promises for this message
	for (let res of awaiting[m.type]) {
		res(m)
		awaiting[m.type].splice(0) // clear the array
	}
}


// VS Code exposes the function acquireVsCodeApi() to us, it should only get called once
let vsCodeApi: ReturnType<AcquireVsCodeApiType> | undefined;

type AcquireVsCodeApiType = () => {
	postMessage(message: WebviewMessage): void;
	// setState(state: any): void; // getState and setState are made obsolete by us using { retainContextWhenHidden: true }
	// getState(): any;
};

export function getVSCodeAPI(): ReturnType<AcquireVsCodeApiType> {
	if (vsCodeApi)
		return vsCodeApi;

	try {
		// @ts-expect-error
		// eslint-disable-next-line no-undef
		vsCodeApi = acquireVsCodeApi();
		return vsCodeApi!;
	} catch (error) {
		console.error('Failed to acquire VS Code API:', error);
		throw new Error('This script must be run in a VS Code webview context');
	}
}
