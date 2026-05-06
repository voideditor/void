/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import Log from '../common/logger';
import { EventEmitter } from '../common/event';

const wslBinary = 'wsl.exe';

export interface WSLDistro {
	isDefault: boolean;
	name: string;
	state: string;
	version: string;
}

export interface WSLOnlineDistro {
	name: string;
	friendlyName: string;
}

export class WSLManager {
	constructor(private readonly logger: Log) {
	}

	async listDistros() {
		const resp = this._runWSLCommand(['--list', '--verbose'], 'utf16le');
		const { exitCode } = await resp.exitPromise;
		const { stdout, stderr } = resp;
		if (exitCode) {
			this.logger.trace(`Command wsl listDistros exited with code ${exitCode}`, stdout + '\n\n' + stderr);
			throw new Error(`Command wsl listDistros exited with code ${exitCode}`);
		}

		const regex = /(?<default>\*|\s)\s+(?<name>[\w\.-]+)\s+(?<state>[\w]+)\s+(?<version>\d)/;
		const distros: WSLDistro[] = [];
		for (const line of stdout.split(/\r?\n/)) {
			const matches = line.match(regex);
			if (matches && matches.groups) {
				distros.push({
					isDefault: matches.groups.default === '*',
					name: matches.groups.name,
					state: matches.groups.state,
					version: matches.groups.version,
				});
			}
		}

		return distros;
	}

	async listOnlineDistros() {
		const resp = this._runWSLCommand(['--list', '--online'], 'utf16le');
		const { exitCode } = await resp.exitPromise;
		const { stdout, stderr } = resp;
		if (exitCode) {
			this.logger.trace(`Command wsl listOnlineDistros exited with code ${exitCode}`, stdout + '\n\n' + stderr);
			throw new Error(`Command wsl listOnlineDistros exited with code ${exitCode}`);
		}

		let lines = stdout.split(/\r?\n/);
		const idx = lines.findIndex(l => /\s*NAME\s+FRIENDLY NAME\s*/.test(l));
		lines = lines.slice(idx + 1);

		const regex = /(?<name>[\w\.-]+)\s+(?<friendlyName>\w.+\w)/;
		const distros: WSLOnlineDistro[] = [];
		for (const line of lines) {
			const matches = line.match(regex);
			if (matches && matches.groups) {
				distros.push({
					name: matches.groups.name,
					friendlyName: matches.groups.friendlyName,
				});
			}
		}

		return distros;
	}

	async setDefaultDistro(distroName: string) {
		const resp = this._runWSLCommand(['--set-default', distroName], 'utf16le');
		const { exitCode } = await resp.exitPromise;
		const { stdout, stderr } = resp;
		if (exitCode) {
			this.logger.trace(`Command wsl setDefaultDistro exited with code ${exitCode}`, stdout + '\n\n' + stderr);
			throw new Error(`Command wsl setDefaultDistro exited with code ${exitCode}`);
		}
	}

	async deleteDistro(distroName: string) {
		const resp = this._runWSLCommand(['--unregister', distroName], 'utf16le');
		const { exitCode } = await resp.exitPromise;
		const { stdout, stderr } = resp;
		if (exitCode) {
			this.logger.trace(`Command wsl deleteDistro exited with code ${exitCode}`, stdout + '\n\n' + stderr);
			throw new Error(`Command wsl deleteDistro exited with code ${exitCode}`);
		}
	}

	async exec(cmd: string, args: string[], distro: string) {
		return this._runWSLCommand(['--distribution', distro, '--', cmd, ...args], 'utf8');
	}

	private _runWSLCommand(args: string[], encoding: 'utf8' | 'utf16le') {
		this.logger.trace(`Running WSL command: ${wslBinary} ${args.join(' ')}`);

		const cmd = cp.spawn(wslBinary, args, { windowsHide: true, windowsVerbatimArguments: true });

		const stdoutDataEmitter = new EventEmitter<Buffer>();
		const stdoutData: Buffer[] = [];
		const stderrDataEmitter = new EventEmitter<Buffer>();
		const stderrData: Buffer[] = [];
		cmd.stdout.on('data', (data: Buffer) => {
			stdoutData.push(data);
			stdoutDataEmitter.fire(data);
		});
		cmd.stderr.on('data', (data: Buffer) => {
			stderrData.push(data);
			stderrDataEmitter.fire(data);
		});

		const exitPromise = new Promise<{ exitCode: number }>((resolve, reject) => {
			cmd.on('error', (err) => {
				this.logger.error(`Error running WSL command: ${wslBinary} ${args.join(' ')}`, err);
				reject(err);
			});
			cmd.on('exit', (code, _signal) => {
				resolve({ exitCode: code ?? 0 });
			});
		});

		return {
			get stdout() {
				return Buffer.concat(stdoutData).toString(encoding);
			},
			get stderr() {
				return Buffer.concat(stderrData).toString(encoding);
			},
			get onStdoutData() {
				return stdoutDataEmitter.event;
			},
			get onStderrData() {
				return stderrDataEmitter.event;
			},
			exitPromise
		};
	}
}
