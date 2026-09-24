/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { ITerminalCapabilityImplMap, TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { URI } from '../../../../base/common/uri.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService, ITerminalInstance, ICreateTerminalOptions } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { MAX_TERMINAL_CHARS } from '../../../../platform/void/common/prompt/constants.js';
import { TerminalResolveReason } from '../../../../platform/void/common/toolsServiceTypes.js';
import { normalizeTerminalCommandOutput } from '../../../../platform/void/common/terminalToolOutput.js';
import * as dom from '../../../../base/browser/dom.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { defaultGlobalSettings } from '../../../../platform/void/common/voidSettingsTypes.js';


export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	runCommand(
		command: string,
		opts: { type?: 'ephemeral'; cwd: string | null; terminalId: string; onOutput?: (chunk: string) => void }
	): Promise<{ interrupt: () => void; resPromise: Promise<{ result: string; output: string; stdoutStderr: string; commandHeader: string; cwd?: string; cwdLabel?: string; exitStatus?: { exitCode: number | null; signal: string | null }; resolveReason: TerminalResolveReason }> }>;
	readTerminal(terminalId: string): Promise<string>
	getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined
}
export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');

export class TerminalToolService extends Disposable implements ITerminalToolService {
	readonly _serviceBrand: undefined;

	private temporaryTerminalInstanceOfId: Record<string, ITerminalInstance> = {}

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
	) {
		super();
	}

	private async _createTerminal(props: { cwd: string | null, config: ICreateTerminalOptions['config'], hidden?: boolean }) {
		const { cwd: override_cwd, config, hidden } = props;

		const cwd: URI | string | undefined = (override_cwd ?? undefined) ?? this.workspaceContextService.getWorkspace().folders[0]?.uri;

		const options: ICreateTerminalOptions = {
			cwd,
			config: {
				name: config && 'name' in config ? config.name : undefined,
				forceShellIntegration: true,
				hideFromUser: hidden ? true : undefined,
				// Copy any other properties from the provided config
				...config,
			},
			// Skip profile check to ensure the terminal is created quickly
			skipContributedProfileCheck: true,
		};

		const terminal = await this.terminalService.createTerminal(options)
		return terminal

	}

	private _workspaceFolderFsPaths(): string[] {
		return this.workspaceContextService.getWorkspace().folders
			.map(folder => folder.uri.fsPath)
			.filter(path => typeof path === 'string' && path.length > 0);
	}

	private _displayCwdForRun(cwd: string | null): string | null {
		if (cwd) return cwd;
		return this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? null;
	}

	private _terminalCommandTimeoutMs(): number {
		const minutes = this.voidSettingsService.state.globalSettings.terminalCommandTimeoutMinutes
		const defaultMinutes = defaultGlobalSettings.terminalCommandTimeoutMinutes
		const validMinutes = typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : defaultMinutes
		return validMinutes * 60 * 1000
	}

	getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined {
		if (!terminalId) return
		const terminal = this.temporaryTerminalInstanceOfId[terminalId]
		if (!terminal) return // should never happen
		return terminal
	}

	readTerminal: ITerminalToolService['readTerminal'] = async (terminalId) => {
		const terminal = this.getTemporaryTerminal(terminalId);
		if (!terminal) {
			throw new Error(`Read Terminal: Terminal with ID ${terminalId} does not exist.`);
		}

		// Ensure the xterm.js instance has been created - otherwise we cannot access the buffer.
		if (!terminal.xterm) {
			throw new Error('Read Terminal: The requested terminal has not yet been rendered and therefore has no scrollback buffer available.');
		}

		// Collect lines from the buffer iterator (oldest to newest)
		const lines: string[] = [];
		for (const line of terminal.xterm.getBufferReverseIterator()) {
			lines.unshift(line);
		}

		let result = removeAnsiEscapeCodes(lines.join('\n'));

		// IMPORTANT: This is a snapshot of xterm scrollback, not an authoritative full log.
		// Limit size to protect UI/memory and avoid huge tool payloads.
		if (result.length > MAX_TERMINAL_CHARS) {
			result = result.slice(0, MAX_TERMINAL_CHARS);
		}

		return result;
	};

	private async _waitForCommandDetectionCapability(terminal: ITerminalInstance) {
		const mounted = terminal.capabilities.get(TerminalCapability.CommandDetection);
		if (mounted) return mounted

		const disposables: IDisposable[] = []
		let resolveCapability: (capability: ITerminalCapabilityImplMap[TerminalCapability.CommandDetection] | undefined) => void = () => { }
		const capabilityPromise = new Promise<ITerminalCapabilityImplMap[TerminalCapability.CommandDetection] | undefined>(resolve => {
			resolveCapability = resolve
		})

		disposables.push(
			terminal.capabilities.onDidAddCapability((e) => {
				if (e.id === TerminalCapability.CommandDetection) resolveCapability(e.capability)
			})
		)

		const capabilityTimeout = setTimeout(() => {
			resolveCapability(terminal.capabilities.get(TerminalCapability.CommandDetection))
		}, 10_000)

		return capabilityPromise.finally(() => {
			clearTimeout(capabilityTimeout)
			disposables.forEach((d) => d.dispose())
		})
	}

	runCommand: ITerminalToolService['runCommand'] = async (command, params) => {
		await this.terminalService.whenConnected;

		const { cwd, terminalId } = params;
		const cwdForResult = this._displayCwdForRun(cwd);
		const onOutput = params.onOutput;
		const terminal = await this._createTerminal({ cwd: cwd, config: undefined, hidden: true });
		this.temporaryTerminalInstanceOfId[terminalId] = terminal;

		const disposables: IDisposable[] = [];
		let cleanedUp = false;

		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			terminal.dispose();
			delete this.temporaryTerminalInstanceOfId[terminalId];
		};

		let resolveReason: TerminalResolveReason | undefined;
		let resolveWaitUntilInterrupt: (() => void) | null = null;

		//accumulate the *entire* streamed output from the start of this command
		const streamedChunks: string[] = [];
		const appendStreamChunk = (chunk: string) => {
			if (!chunk) return;
			streamedChunks.push(chunk);
		};
		const getFullStreamedText = () => removeAnsiEscapeCodes(streamedChunks.join(''));

		const interrupt = () => {
			if (!resolveReason) {
				resolveReason = { type: 'interrupted' };
			}

			try {
				terminal.sendText('\x03', false);
			} catch { /* noop */ }

			if (resolveWaitUntilInterrupt) {
				resolveWaitUntilInterrupt();
			}
		};

		const waitForResult = async () => {
			try {
				resolveReason = undefined;

				// Wait for the PTY process to actually be created before expecting the
				// CommandDetection capability to mount. Without this, `createTerminal()`
				// (which returns immediately for hidden terminals) can leave us racing the
				// asynchronous process spawn, causing spurious "capability did not mount"
				// failures under load / parallel execution.
				await terminal.processReady;

				const cmdCap = await this._waitForCommandDetectionCapability(terminal);
				if (!cmdCap) {
					throw new Error(
						`There was an error using the terminal: CommandDetection capability did not mount yet. Please try again in a few seconds or report this to the Void team.`
					);
				}

				let cmdFinishedOutput: string | null = null;

				const waitUntilDone = new Promise<TerminalResolveReason>(resolve => {
					const l = cmdCap.onCommandFinished(cmd => {
						if (resolveReason) return;
						const reason: TerminalResolveReason = { type: 'done', exitCode: cmd.exitCode ?? 0 };
						resolveReason = reason;
						cmdFinishedOutput = cmd.getOutput() ?? '';
						l.dispose();
						resolve(reason);
					});
					disposables.push(l);
				});

				let sawOnData = false;

				const dData = terminal.onData((data) => {
					sawOnData = true;

					const s = String(data ?? '');
					appendStreamChunk(s);

					if (!onOutput) return;
					try {
						onOutput(removeAnsiEscapeCodes(s));
					} catch { /* noop */ }
				});
				disposables.push(dData);

				// Polling fallback: only until onData is seen.
				let pollStop = false;
				let pollTimer: ReturnType<Window['setInterval']> | null = null;
				let lastSnapshot: string | null = null;

				const startPollingIfNeeded = () => {
					if (!onOutput) return;
					if (pollTimer) return;

					const { window } = dom.getActiveWindow();

					pollTimer = window.setInterval(async () => {
						if (pollStop) return;
						if (sawOnData) {
							if (pollTimer) {
								try { window.clearInterval(pollTimer); } catch { /* noop */ }
							}
							pollTimer = null;
							return;
						}

						try {
							const full = removeAnsiEscapeCodes(await this.readTerminal(terminalId));

							if (lastSnapshot === null) {
								lastSnapshot = full;
								return;
							}

							let delta = '';
							if (full.startsWith(lastSnapshot)) {
								delta = full.slice(lastSnapshot.length);
							} else {
								delta = full;
							}

							if (delta) {
								appendStreamChunk(delta);

								try { onOutput(delta); } catch { /* noop */ }
							}

							lastSnapshot = full;
						} catch {
							// ignore
						}
					}, 250);

					disposables.push(toDisposable(() => {
						if (pollTimer) {
							try { window.clearInterval(pollTimer); } catch { /* noop */ }
						}
						pollTimer = null;
					}));
				};

				startPollingIfNeeded();

				let commandTimeoutId: ReturnType<typeof setTimeout> | undefined;
				const waitUntilInterrupt = new Promise<TerminalResolveReason>((res) => {
					resolveWaitUntilInterrupt = () => {
						const reason = resolveReason ?? { type: 'interrupted' };
						resolveReason = reason;
						res(reason);
					};
					commandTimeoutId = setTimeout(() => {
						if (resolveReason) return;
						const reason: TerminalResolveReason = { type: 'timeout' };
						resolveReason = reason;
						res(reason);
					}, this._terminalCommandTimeoutMs());
					disposables.push(toDisposable(() => {
						if (commandTimeoutId) clearTimeout(commandTimeoutId);
					}));
				});

				await terminal.sendText(command, true);

				const reason = await Promise.any([waitUntilDone, waitUntilInterrupt]).finally(() => {
					pollStop = true;
					disposables.forEach(d => d.dispose());
				});

				let result: string;

				if (reason.type === 'done') {
					const fromCmdCap = cmdFinishedOutput ?? '';
					const fromStream = getFullStreamedText();
					if (fromStream.length > fromCmdCap.length) {
						result = fromStream;
					} else if (fromCmdCap.length) {
						result = fromCmdCap;
					} else {
						result = fromStream.length ? fromStream : await this.readTerminal(terminalId);
					}
				} else {
					const fromStream = getFullStreamedText();
					result = fromStream.length ? fromStream : await this.readTerminal(terminalId);
				}

				const normalized = normalizeTerminalCommandOutput({
					command,
					rawOutput: result,
					cwd: cwdForResult,
					workspaceFolders: this._workspaceFolderFsPaths(),
					exitCode: reason.type === 'done' ? reason.exitCode : undefined,
					signal: null,
					includeCommandHeader: true,
					includeExitStatus: reason.type === 'done',
				});

				return {
					result: normalized.text,
					output: normalized.text,
					stdoutStderr: normalized.stdoutStderr,
					commandHeader: normalized.commandHeader,
					...(normalized.cwd ? { cwd: normalized.cwd } : {}),
					...(normalized.cwdLabel ? { cwdLabel: normalized.cwdLabel } : {}),
					...(normalized.exitStatus ? { exitStatus: normalized.exitStatus } : {}),
					resolveReason: reason
				};
			} finally {
				cleanup();
			}
		};

		const resPromise = waitForResult();

		return {
			interrupt,
			resPromise,
		};
	};
}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);
