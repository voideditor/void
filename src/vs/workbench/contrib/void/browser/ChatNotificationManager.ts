/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { truncate } from '../../../../base/common/strings.js';
import { getErrorMessage } from '../../../../platform/void/common/sendLLMMessageTypes.js';

export class ChatNotificationManager {
	constructor(
		private readonly _notificationService: INotificationService
	) { }

	
	public wrapRunAgentToNotify(
		p: Promise<void>,
		threadId: string,
		getCurrentThreadId: () => string,
		getLastUserMessageContent: () => string | undefined,
		onJumpToChat: (threadId: string) => void
	) {
		const notify = ({ error }: { error: string | null }) => {
			
			const userMsgContent = getLastUserMessageContent();
			if (!userMsgContent) return;

			const messageContentTruncated = truncate(userMsgContent, 50, '...');

			this._notificationService.notify({
				severity: error ? Severity.Warning : Severity.Info,
				message: error ? `Error: ${error} ` : `A new Chat result is ready.`,
				source: messageContentTruncated,
				sticky: true,
				actions: {
					primary: [{
						id: 'void.goToChat',
						enabled: true,
						label: `Jump to Chat`,
						tooltip: '',
						class: undefined,
						run: () => {
							onJumpToChat(threadId);
						}
					}]
				},
			});
		};

		p.then(() => {
			if (threadId !== getCurrentThreadId()) notify({ error: null });
		}).catch((e) => {
			if (threadId !== getCurrentThreadId()) notify({ error: getErrorMessage(e) });
			throw e;
		});
	}
}
