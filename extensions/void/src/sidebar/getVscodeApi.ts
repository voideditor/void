import { useEffect } from "react";
import { MessageFromSidebar, MessageToSidebar, } from "../common/shared_types";
import { v4 as uuidv4 } from 'uuid';


type Command = MessageToSidebar['type']

// messageType -> res[]
const onetimeCallbacks: { [C in Command]: ((res: any) => void)[] } = {
	"ctrl+l": [],
	"files": [],
	"partialVoidConfig": [],
	"startNewThread": [],
	"allThreads": [],
	"toggleThreadSelector": [],
	"toggleSettings": [],
	"deviceId": [],
}

// messageType -> id -> res
const callbacks: { [C in Command]: { [id: string]: ((res: any) => void) } } = {
	"ctrl+l": {},
	"files": {},
	"partialVoidConfig": {},
	"startNewThread": {},
	"allThreads": {},
	"toggleThreadSelector": {},
	"toggleSettings": {},
	"deviceId": {}
}


// use this function to await responses
export const awaitVSCodeResponse = <C extends Command>(c: C) => {
	let result: Promise<MessageToSidebar & { type: C }> = new Promise((res, rej) => {
		onetimeCallbacks[c].push(res)
	})
	return result
}


// use this function to add a listener to a certain type of message
export const useOnVSCodeMessage = <C extends Command>(messageType: C, fn: (e: MessageToSidebar & { type: C }) => void) => {
	useEffect(() => {
		const mType = messageType
		const callbackId: string = uuidv4();
		// @ts-ignore
		callbacks[mType][callbackId] = fn;
		return () => { delete callbacks[mType][callbackId] }
	}, [messageType, fn])
}



// this function gets called whenever sidebar receives a message - it should only mount once
export const onMessageFromVSCode = (m: MessageToSidebar) => {
	// resolve all promises for this message type
	for (let res of onetimeCallbacks[m.type]) {
		res(m)
		onetimeCallbacks[m.type].splice(0) // clear the array
	}
	// call the listener for this message type
	for (let res of Object.values(callbacks[m.type])) {
		res(m)
	}
}



type AcquireVsCodeApiType = () => {
	postMessage(message: MessageFromSidebar): void;
	// setState(state: any): void; // getState and setState are made obsolete by us using { retainContextWhenHidden: true }
	// getState(): any;
};

// VS Code exposes the function acquireVsCodeApi() to us, this variable makes sure it only gets called once
let vsCodeApi: ReturnType<AcquireVsCodeApiType> | undefined;

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
