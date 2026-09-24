/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { findLastIdx } from '../../../../base/common/arraysFind.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { CheckpointEntry, ChatMessage } from '../../../../platform/void/common/chatThreadServiceTypes.js';
import { VoidFileSnapshot } from '../../../../platform/void/common/editCodeServiceTypes.js';

export interface ICheckpointThreadAccess {
	getThreadMessages(threadId: string): ChatMessage[];
	getThreadState(threadId: string): { currCheckpointIdx: number | null };

	addMessageToThread(threadId: string, message: ChatMessage): void;
	editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage): void;
	setThreadState(threadId: string, state: Partial<{ currCheckpointIdx: number | null }>): void;

	isStreaming(threadId: string): boolean;
}

export class ChatCheckpointManager {
	constructor(
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService
	) { }

	private _uriFromFsPath(fsPath: string): URI {
		const { model } = this._voidModelService.getModelFromFsPath(fsPath);
		return model?.uri ?? URI.file(fsPath);
	}

	public addToolEditCheckpoint(threadId: string, uri: URI, access: ICheckpointThreadAccess) {
		const { model } = this._voidModelService.getModel(uri);
		if (!model) return;

		const diffAreasSnapshot = this._editCodeService.getVoidFileSnapshot(uri);
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'tool_edit',
			voidFileSnapshotOfURI: { [uri.fsPath]: diffAreasSnapshot },
			userModifications: { voidFileSnapshotOfURI: {} },
		}, access);
	}

	public addUserCheckpoint(threadId: string, access: ICheckpointThreadAccess) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }, access) ?? {};
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'user_edit',
			voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {},
			userModifications: { voidFileSnapshotOfURI: {}, },
		}, access);
	}

	public jumpToCheckpointBeforeMessageIdx(
		opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean },
		access: ICheckpointThreadAccess
	) {
		const { threadId, messageIdx, jumpToUserModified } = opts;

		// 1. Ensure we are standing on a checkpoint currently (create temp if needed)
		this._makeUsStandOnCheckpoint(threadId, access);

		const msgs = access.getThreadMessages(threadId);

		if (access.isStreaming(threadId)) return;

		// 2. Find target checkpoint
		const c = this._getCheckpointBeforeMessage(msgs, messageIdx);
		if (c === undefined) return; // should never happen

		const fromIdx = access.getThreadState(threadId).currCheckpointIdx;
		if (fromIdx === null) return; // should never happen based on step 1

		const [_, toIdx] = c;
		if (toIdx === fromIdx) return;

		// 3. Update the user's modifications to current checkpoint before jumping away
		this._addUserModificationsToCurrCheckpoint({ threadId }, access);

		/*
			UNDO Logic (Going Back)
			A,B,C are all files. x means a checkpoint where the file changed.
			We need to revert anything that happened between to+1 and from.
			We do this by finding the last x from 0...`to` for each file and applying those contents.
		*/
		if (toIdx < fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween(msgs, toIdx + 1, fromIdx);
			const pendingFsPaths = new Set(Object.keys(lastIdxOfURI));

			const idxes = function* () {
				for (let k = toIdx; k >= 0; k -= 1) { // first go up
					yield k;
				}
				for (let k = toIdx + 1; k < msgs.length; k += 1) { // then go down
					yield k;
				}
			};

			for (const k of idxes()) {
				if (pendingFsPaths.size === 0) break;
				const message = msgs[k];
				if (message.role !== 'checkpoint') continue;

				for (const fsPath in message.voidFileSnapshotOfURI) {
					if (!pendingFsPaths.has(fsPath)) continue;

					const res = this._getCheckpointInfo(message as CheckpointEntry, fsPath, { includeUserModifiedChanges: jumpToUserModified });
					if (!res) continue;

					const { voidFileSnapshot } = res;
					if (!voidFileSnapshot) continue;

					this._editCodeService.restoreVoidFileSnapshot(this._uriFromFsPath(fsPath), voidFileSnapshot);
					pendingFsPaths.delete(fsPath);
				}
			}
		}

		/*
			REDO Logic (Going Forward)
			We need to apply latest change for anything that happened between from+1 and to.
		*/
		if (toIdx > fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween(msgs, fromIdx + 1, toIdx);
			const pendingFsPaths = new Set(Object.keys(lastIdxOfURI));

			// apply lowest down content for each uri
			for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
				if (pendingFsPaths.size === 0) break;
				const message = msgs[k];
				if (message.role !== 'checkpoint') continue;

				for (const fsPath in message.voidFileSnapshotOfURI) {
					if (!pendingFsPaths.has(fsPath)) continue;

					const res = this._getCheckpointInfo(message as CheckpointEntry, fsPath, { includeUserModifiedChanges: jumpToUserModified });
					if (!res) continue;

					const { voidFileSnapshot } = res;
					if (!voidFileSnapshot) continue;

					this._editCodeService.restoreVoidFileSnapshot(this._uriFromFsPath(fsPath), voidFileSnapshot);
					pendingFsPaths.delete(fsPath);
				}
			}
		}

		access.setThreadState(threadId, { currCheckpointIdx: toIdx });
	}

	// --- Private Helpers ---

	private _addCheckpoint(threadId: string, checkpoint: CheckpointEntry, access: ICheckpointThreadAccess) {
		access.addMessageToThread(threadId, checkpoint);
	}

	private _computeNewCheckpointInfo(opts: { threadId: string }, access: ICheckpointThreadAccess) {
		const msgs = access.getThreadMessages(opts.threadId);

		const lastCheckpointIdx = findLastIdx(msgs, (m) => m.role === 'checkpoint') ?? -1;
		if (lastCheckpointIdx === -1) return;

		const voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined } = {};

		// add a change for all the URIs in the checkpoint history
		const { lastIdxOfURI } = this._getCheckpointsBetween(msgs, 0, lastCheckpointIdx) ?? {};

		for (const fsPath in lastIdxOfURI ?? {}) {
			const { model } = this._voidModelService.getModelFromFsPath(fsPath);
			if (!model) continue;

			const checkpoint2 = msgs[lastIdxOfURI[fsPath]] || null;
			if (!checkpoint2) continue;
			if (checkpoint2.role !== 'checkpoint') continue;

			const res = this._getCheckpointInfo(checkpoint2, fsPath, { includeUserModifiedChanges: false });
			if (!res) continue;
			const { voidFileSnapshot: oldVoidFileSnapshot } = res;

			// if there was any change to the str or diffAreaSnapshot, update
			const voidFileSnapshot = this._editCodeService.getVoidFileSnapshot(this._uriFromFsPath(fsPath));
			if (oldVoidFileSnapshot === voidFileSnapshot) continue;

			voidFileSnapshotOfURI[fsPath] = voidFileSnapshot;
		}

		return { voidFileSnapshotOfURI };
	}

	private _getCheckpointsBetween(messages: ChatMessage[], loIdx: number, hiIdx: number) {
		const lastIdxOfURI: { [fsPath: string]: number } = {};
		for (let i = loIdx; i <= hiIdx; i += 1) {
			const message = messages[i];
			if (message?.role !== 'checkpoint') continue;
			for (const fsPath in message.voidFileSnapshotOfURI) {
				// do not include userModified.beforeStrOfURI here
				lastIdxOfURI[fsPath] = i;
			}
		}
		return { lastIdxOfURI };
	}

	private _getCheckpointInfo(checkpointMessage: CheckpointEntry, fsPath: string, opts: { includeUserModifiedChanges: boolean }) {
		const voidFileSnapshot = checkpointMessage.voidFileSnapshotOfURI ? checkpointMessage.voidFileSnapshotOfURI[fsPath] ?? null : null;
		if (!opts.includeUserModifiedChanges) { return { voidFileSnapshot }; }

		const userModifiedVoidFileSnapshot = fsPath in checkpointMessage.userModifications.voidFileSnapshotOfURI
			? checkpointMessage.userModifications.voidFileSnapshotOfURI[fsPath] ?? null
			: null;

		return { voidFileSnapshot: userModifiedVoidFileSnapshot ?? voidFileSnapshot };
	}

	private _makeUsStandOnCheckpoint(threadId: string, access: ICheckpointThreadAccess) {
		const state = access.getThreadState(threadId);

		if (state.currCheckpointIdx === null) {
			const msgs = access.getThreadMessages(threadId);
			const lastMsg = msgs[msgs.length - 1];

			if (lastMsg?.role !== 'checkpoint') {
				this.addUserCheckpoint(threadId, access);
			}
			// Update state after adding checkpoint implies messages length changed
			const updatedMsgs = access.getThreadMessages(threadId);
			access.setThreadState(threadId, { currCheckpointIdx: updatedMsgs.length - 1 });
		}
	}

	private _readCurrentCheckpoint(threadId: string, access: ICheckpointThreadAccess): [CheckpointEntry, number] | undefined {
		const msgs = access.getThreadMessages(threadId);
		const { currCheckpointIdx } = access.getThreadState(threadId);

		if (currCheckpointIdx === null) return;

		const checkpoint = msgs[currCheckpointIdx];
		if (!checkpoint) return;
		if (checkpoint.role !== 'checkpoint') return;

		return [checkpoint, currCheckpointIdx];
	}

	private _addUserModificationsToCurrCheckpoint(opts: { threadId: string }, access: ICheckpointThreadAccess) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId: opts.threadId }, access) ?? {};
		const res = this._readCurrentCheckpoint(opts.threadId, access);
		if (!res) return;

		const [checkpoint, checkpointIdx] = res;
		access.editMessageInThread(opts.threadId, checkpointIdx, {
			...checkpoint,
			userModifications: { voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {}, },
		});
	}

	private _getCheckpointBeforeMessage(messages: ChatMessage[], messageIdx: number): [CheckpointEntry, number] | undefined {
		for (let i = messageIdx; i >= 0; i--) {
			const message = messages[i];
			if (message.role === 'checkpoint') {
				return [message, i];
			}
		}
		return undefined;
	}
}
