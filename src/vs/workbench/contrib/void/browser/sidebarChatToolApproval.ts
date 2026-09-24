/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { getToolApprovalRequirement } from '../../../../platform/void/common/toolApprovalPolicy.js';
import type { ChatMessage, ToolMessage } from '../../../../platform/void/common/chatThreadServiceTypes.js';

export function shouldRenderToolRequestApprovalControls(toolName: string, toolCallId: string, messages: readonly ChatMessage[]): boolean {
	if (!toolCallId) return false;
	const requestMessages = messages.filter((message): message is Extract<ToolMessage, { type: 'tool_request' }> =>
		message.role === 'tool' && message.type === 'tool_request'
	);
	const activeRequest = requestMessages.find(message => message.id === toolCallId);
	if (!activeRequest || activeRequest.name !== toolName) return false;
	if (requestMessages.length !== 1) return false;
	const approvalRequirement = getToolApprovalRequirement(toolName);
	return approvalRequirement.kind === 'dynamic-policy' || approvalRequirement.kind === 'manual';
}

export function getToolRequestApprovalControlLabels(toolName: string, toolCallId: string, messages: readonly ChatMessage[]): readonly string[] {
	return shouldRenderToolRequestApprovalControls(toolName, toolCallId, messages)
		? ['Approve', 'Cancel', 'Skip']
		: [];
}
