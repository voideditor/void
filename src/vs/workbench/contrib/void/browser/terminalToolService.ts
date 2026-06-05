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
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITerminalService, ITerminalInstance, ICreateTerminalOptions } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { MAX_TERMINAL_CHARS, MAX_TERMINAL_INACTIVE_TIME } from '../../../../platform/void/common/prompt/constants.js';
import { TerminalResolveReason } from '../../../../platform/void/common/toolsServiceTypes.js';
import { timeout } from '../../../../base/common/async.js';
import * as dom from '../../../../base/browser/dom.js';


export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	listPersistentTerminalIds(): string[];
	runCommand(
		command: string,
		opts:
			| { type: 'persistent'; persistentTerminalId: string; onOutput?: (chunk: string) => void }
			| { type: 'ephemeral'; cwd: string | null; terminalId: string; onOutput?: (chunk: string) => void }
	): Promise<{ interrupt: () => void; resPromise: Promise<{ result: string; resolveReason: TerminalResolveReason }> }>;
	focusPersistentTerminal(terminalId: string): Promise<void>
	persistentTerminalExists(terminalId: string): boolean
	readTerminal(terminalId: string): Promise<string>
	createPersistentTerminal(opts: { cwd: string | null }): Promise<string>
	killPersistentTerminal(terminalId: string): Promise<void>
	getPersistentTerminal(terminalId: string): ITerminalInstance | undefined
	getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined
}
export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');

export const persistentTerminalNameOfId = (id: string) => {
	if (id === '1') return 'Void Agent'
	return `Void Agent (${id})`
}
export const idOfPersistentTerminalName = (name: string) => {
	if (name === 'Void Agent') return '1'

	const match = name.match(/Void Agent \((\d+)\)/)
	if (!match) return null
	if (Number.isInteger(match[1]) && Number(match[1]) >= 1) return match[1]
	return null
}

export class TerminalToolService extends Disposable implements ITerminalToolService {
	readonly _serviceBrand: undefined;

	private persistentTerminalInstanceOfId: Record<string, ITerminalInstance> = {}
	private temporaryTerminalInstanceOfId: Record<string, ITerminalInstance> = {}

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();

		// runs on ALL terminals for simplicity
		const initializeTerminal = (terminal: ITerminalInstance) => {
			// when exit, remove
			const d = terminal.onExit(() => {
				const terminalId = idOfPersistentTerminalName(terminal.title)
				if (terminalId !== null && (terminalId in this.persistentTerminalInstanceOfId)) delete this.persistentTerminalInstanceOfId[terminalId]
				d.dispose()
			})
		}

		// initialize any terminals that are already open
		for (const terminal of terminalService.instances) {
			const proposedTerminalId = idOfPersistentTerminalName(terminal.title)
			if (proposedTerminalId) this.persistentTerminalInstanceOfId[proposedTerminalId] = terminal

			initializeTerminal(terminal)
		}

		this._register(
			terminalService.onDidCreateInstance(terminal => { initializeTerminal(terminal) })
		)

	}


	listPersistentTerminalIds() {
		return Object.keys(this.persistentTerminalInstanceOfId)
	}

	getValidNewTerminalId(): string {
		// {1 2 3} # size 3, new=4
		// {1 3 4} # size 3, new=2
		// 1 <= newTerminalId <= n + 1
		const n = Object.keys(this.persistentTerminalInstanceOfId).length;
		if (n === 0) return '1'

		for (let i = 1; i <= n + 1; i++) {
			const potentialId = i + '';
			if (!(potentialId in this.persistentTerminalInstanceOfId)) return potentialId;
		}
		throw new Error('This should never be reached by pigeonhole principle');
	}


	private async _createTerminal(props: { cwd: string | null, config: ICreateTerminalOptions['config'], hidden?: boolean }) {
		const { cwd: override_cwd, config, hidden } = props;

		const cwd: URI | string | undefined = (override_cwd ?? undefined) ?? this.workspaceContextService.getWorkspace().folders[0]?.uri;

		const options: ICreateTerminalOptions = {
			cwd,
			location: hidden ? undefined : TerminalLocation.Panel,
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

	createPersistentTerminal: ITerminalToolService['createPersistentTerminal'] = async ({ cwd }) => {
		const terminalId = this.getValidNewTerminalId();
		const config = { name: persistentTerminalNameOfId(terminalId), title: persistentTerminalNameOfId(terminalId) }
		const terminal = await this._createTerminal({ cwd, config, })
		this.persistentTerminalInstanceOfId[terminalId] = terminal
		return terminalId
	}

	async killPersistentTerminal(terminalId: string) {
		const terminal = this.persistentTerminalInstanceOfId[terminalId]
		if (!terminal) throw new Error(`Kill Terminal: Terminal with ID ${terminalId} did not exist.`);
		terminal.dispose()
		delete this.persistentTerminalInstanceOfId[terminalId]
		return
	}

	persistentTerminalExists(terminalId: string): boolean {
		return terminalId in this.persistentTerminalInstanceOfId
	}


	getTemporaryTerminal(terminalId: string): ITerminalInstance | undefined {
		if (!terminalId) return
		const terminal = this.temporaryTerminalInstanceOfId[terminalId]
		if (!terminal) return // should never happen
		return terminal
	}

	getPersistentTerminal(terminalId: string): ITerminalInstance | undefined {
		if (!terminalId) return
		const terminal = this.persistentTerminalInstanceOfId[terminalId]
		if (!terminal) return // should never happen
		return terminal
	}


	focusPersistentTerminal: ITerminalToolService['focusPersistentTerminal'] = async (terminalId) => {
		if (!terminalId) return
		const terminal = this.persistentTerminalInstanceOfId[terminalId]
		if (!terminal) return // should never happen
		this.terminalService.setActiveInstance(terminal)
		await this.terminalService.focusActiveInstance()
	}

	readTerminal: ITerminalToolService['readTerminal'] = async (terminalId) => {
		// Try persistent first, then temporary
		const terminal = this.getPersistentTerminal(terminalId) ?? this.getTemporaryTerminal(terminalId);
		if (!terminal) {
			throw new Error(`Read Terminal: Terminal with ID ${terminalId} does not exist.`);
		}

		// Ensure the xterm.js instance has been created – otherwise we cannot access the buffer.
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
		const cmdCap = terminal.capabilities.get(TerminalCapability.CommandDetection);
		if (cmdCap) return cmdCap

		const disposables: IDisposable[] = []

		const waitTimeout = timeout(10_000)
		const waitForCapability = new Promise<ITerminalCapabilityImplMap[TerminalCapability.CommandDetection]>((res) => {
			disposables.push(
				terminal.capabilities.onDidAddCapability((e) => {
					if (e.id === TerminalCapability.CommandDetection) res(e.capability)
				})
			)
		})

		const capability = await Promise.any([waitTimeout, waitForCapability])
			.finally(() => { disposables.forEach((d) => d.dispose()) })

		return capability ?? undefined
	}

	runCommand: ITerminalToolService['runCommand'] = async (command, params) => {
		await this.terminalService.whenConnected;

		const { type } = params;
		const isPersistent = type === 'persistent';

		const onOutput = params.onOutput;

		let terminal: ITerminalInstance;
		const disposables: IDisposable[] = [];

		let resolveReason: TerminalResolveReason | undefined;
		let resolveWaitUntilInterrupt: (() => void) | null = null;

		//accumulate the *entire* streamed output from the start of this command
		const streamedChunks: string[] = [];
		const appendStreamChunk = (chunk: string) => {
			if (!chunk) return;
			streamedChunks.push(chunk);
		};
		const getFullStreamedText = () => removeAnsiEscapeCodes(streamedChunks.join(''));

		if (isPersistent) {
			const { persistentTerminalId } = params;
			terminal = this.persistentTerminalInstanceOfId[persistentTerminalId];
			if (!terminal) throw new Error(`Unexpected internal error: Terminal with ID ${persistentTerminalId} did not exist.`);
		} else {
			const { cwd, terminalId } = params;
			terminal = await this._createTerminal({ cwd: cwd, config: undefined, hidden: true });
			this.temporaryTerminalInstanceOfId[terminalId] = terminal;
		}

		// IMPORTANT: don't dispose persistent terminals as part of command cleanup
		const cleanup = () => {
			if (!isPersistent) {
				terminal.dispose();
				const terminalId = (params as { terminalId: string }).terminalId;
				delete this.temporaryTerminalInstanceOfId[terminalId];
			}
		};

		const interrupt = () => {
			if (!resolveReason) {
				resolveReason = { type: 'timeout' };
			}

			try {
				if (isPersistent) {
					terminal.sendText('\x03', false);
				}
			} catch { /* noop */ }

			if (resolveWaitUntilInterrupt) {
				resolveWaitUntilInterrupt();
			}
			cleanup();
		};

		const waitForResult = async () => {
			if (isPersistent) {
				this.terminalService.setActiveInstance(terminal);
				await this.terminalService.focusActiveInstance();
			}

			resolveReason = undefined;

			const cmdCap = await this._waitForCommandDetectionCapability(terminal);
			if (!cmdCap) {
				throw new Error(
					`There was an error using the terminal: CommandDetection capability did not mount yet. Please try again in a few seconds or report this to the Void team.`
				);
			}

			let cmdFinishedOutput: string | null = null;

			const waitUntilDone = new Promise<void>(resolve => {
				const l = cmdCap.onCommandFinished(cmd => {
					if (resolveReason) return;
					resolveReason = { type: 'done', exitCode: cmd.exitCode ?? 0 };
					cmdFinishedOutput = cmd.getOutput() ?? '';
					l.dispose();
					resolve();
				});
				disposables.push(l);
			});

			const terminalId = isPersistent ? (params as { persistentTerminalId: string }).persistentTerminalId : (params as { terminalId: string }).terminalId;

			//allow per-call override for ephemeral inactivity timeout
			const inactivityOverrideSecondsRaw = (params as any).inactivityTimeoutSeconds;
			const inactivitySeconds =
				(!isPersistent && typeof inactivityOverrideSecondsRaw === 'number' && Number.isFinite(inactivityOverrideSecondsRaw) && inactivityOverrideSecondsRaw > 0)
					? inactivityOverrideSecondsRaw
					: MAX_TERMINAL_INACTIVE_TIME;

			let globalTimeoutId: ReturnType<typeof setTimeout> | undefined;
			const resetInactivityTimer = () => {
				if (isPersistent) return;
				if (!Number.isFinite(inactivitySeconds) || inactivitySeconds <= 0) return;

				if (globalTimeoutId) clearTimeout(globalTimeoutId);
				globalTimeoutId = setTimeout(() => {
					if (resolveReason) return;
					resolveReason = { type: 'timeout' };
					try { resolveWaitUntilInterrupt?.(); } catch { /* noop */ }
				}, inactivitySeconds * 1000);
			};

			let sawOnData = false;

			const dData = terminal.onData((data) => {
				sawOnData = true;

				const s = String(data ?? '');
				appendStreamChunk(s);

				resetInactivityTimer();

				if (!onOutput) return;
				try {
					onOutput(removeAnsiEscapeCodes(s));
				} catch { /* noop */ }
			});
			disposables.push(dData);

			// Polling fallback: only for ephemeral terminals, and only until onData is seen.
			let pollStop = false;
			let pollTimer: any = null;
			let lastSnapshot: string | null = null;

			const startPollingIfNeeded = () => {
				if (!onOutput) return;
				if (isPersistent) return;
				if (pollTimer) return;

				const { window } = dom.getActiveWindow();

				pollTimer = window.setInterval(async () => {
					if (pollStop) return;
					if (sawOnData) {
						try { window.clearInterval(pollTimer); } catch { /* noop */ }
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
							resetInactivityTimer();

							try { onOutput(delta); } catch { /* noop */ }
						}

						lastSnapshot = full;
					} catch {
						// ignore
					}
				}, 250);

				disposables.push(toDisposable(() => {
					try { window.clearInterval(pollTimer); } catch { /* noop */ }
					pollTimer = null;
				}));
			};

			startPollingIfNeeded();

			const waitUntilInterrupt = isPersistent
				? new Promise<void>((res) => {
					resolveWaitUntilInterrupt = res;
				})
				: new Promise<void>((res) => {
					resolveWaitUntilInterrupt = res;
					disposables.push(toDisposable(() => {
						if (globalTimeoutId) clearTimeout(globalTimeoutId);
					}));
					resetInactivityTimer();
				});

			await terminal.sendText(command, true);

			await Promise.any([waitUntilDone, waitUntilInterrupt]).finally(() => {
				pollStop = true;
				disposables.forEach(d => d.dispose());
			});

			if (!isPersistent) {
				cleanup();
			}

			if (!resolveReason) {
				throw new Error('Unexpected internal error: Promise.any should have resolved with a reason.');
			}

			let result: string;
			const reason = resolveReason as TerminalResolveReason;

			if (reason.type === 'done') {
				const fromCmdCap = cmdFinishedOutput ?? '';
				const fromStream = getFullStreamedText();
				result = (fromCmdCap.length >= fromStream.length) ? fromCmdCap : fromStream;
			} else {
				const fromStream = getFullStreamedText();
				result = fromStream.length ? fromStream : await this.readTerminal(terminalId);
			}

			if (!isPersistent) result = `$ ${command}\n${result}`;

			result = removeAnsiEscapeCodes(result);

			return { result, resolveReason: reason };
		};

		const resPromise = waitForResult();

		return {
			interrupt,
			resPromise,
		};
	};
}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);
