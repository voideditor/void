// import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISendLLMMessageService } from '../common/sendLLMMessage.js';
import { sendLLMMessage } from '../../../workbench/contrib/void/browser/react/out/util/sendLLMMessage.js';
// import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
// import { ipcMain } from 'electron';

// NODE IMPLEMENTATION OF SENDLLMMESSAGE
export class SendLLMMessageService implements ISendLLMMessageService {
	readonly _serviceBrand: undefined;

	async sendLLMMessage(data: any) {
		console.log('NODE sendLLMMessage', data);
		// ipcMain.emit('vscode:sendLLMMessage', data)

		return sendLLMMessage(data)
	}
}

// we don't need to register this, it's registered in app.ts:
// registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);
