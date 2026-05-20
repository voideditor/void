/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as _exec } from 'child_process';
import { isMacintosh } from '../../../../base/common/platform.js';
import {
	MLX_DEFAULT_MODEL,
	MLX_DEFAULT_PORT,
	IMlxMainService,
	MlxEnsureResult,
} from '../common/mlxTypes.js';

const exec = promisify(_exec);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type MlxServerCommand = { command: string; baseArgs: string[] };

export class MlxMainService implements IMlxMainService {
	readonly _serviceBrand: undefined;

	private _child: ChildProcess | null = null;
	private _spawnedByVoid = false;

	async ensureReady(options: { installIfMissing: boolean; startServer: boolean; port?: number; model?: string }): Promise<MlxEnsureResult> {
		const log: string[] = [];
		const port = options.port ?? MLX_DEFAULT_PORT;
		const model = options.model ?? MLX_DEFAULT_MODEL;
		const endpoint = `http://127.0.0.1:${port}`;

		if (!isMacintosh) {
			return { ok: false, reason: 'not-mac', log };
		}

		if (await this._isServerUp(endpoint)) {
			log.push(`Server already running at ${endpoint}`);
			return { ok: true, endpoint, action: 'already-running', log };
		}

		const pythonPath = await this._whichPython3();
		if (!pythonPath) {
			log.push('python3 not found.');
			return { ok: false, reason: 'python-missing', log, errorMessage: 'Install Python 3, then run: python3 -m pip install mlx-lm' };
		}
		log.push(`Using ${pythonPath}`);

		let didInstall = false;
		let serverCmd = await this._resolveMlxServerCommand(pythonPath);
		if (!serverCmd) {
			if (!options.installIfMissing) {
				log.push('mlx-lm is not installed.');
				return { ok: false, reason: 'mlx-missing', log, errorMessage: 'Run: python3 -m pip install mlx-lm' };
			}

			log.push('Installing mlx-lm via pip…');
			try {
				await exec(`"${pythonPath}" -m pip install --upgrade mlx-lm`, { timeout: 600_000 });
				didInstall = true;
				log.push('pip install finished.');
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				log.push(`Install failed: ${msg}`);
				return { ok: false, reason: 'install-failed', log, errorMessage: msg };
			}

			serverCmd = await this._resolveMlxServerCommand(pythonPath);
			if (!serverCmd) {
				log.push('mlx-lm still not available after install.');
				return { ok: false, reason: 'mlx-missing', log };
			}
		}

		if (options.startServer) {
			await this._startServer(serverCmd, port, model, log);
		}

		// First launch may download the model from Hugging Face (can take several minutes).
		for (let i = 0; i < 300; i++) {
			if (await this._isServerUp(endpoint)) {
				const action = didInstall ? 'installed-and-started' as const : 'started' as const;
				log.push(`Server ready at ${endpoint}`);
				return { ok: true, endpoint, action, log };
			}
			await sleep(2000);
		}

		log.push('Timed out waiting for mlx_lm.server.');
		return {
			ok: false,
			reason: 'server-timeout',
			log,
			errorMessage: `Server did not respond at ${endpoint}. Run manually: mlx_lm.server --model ${model} --port ${port}`,
		};
	}

	async stopServerIfSpawnedByVoid(): Promise<void> {
		if (!this._spawnedByVoid || !this._child || this._child.killed) {
			return;
		}
		try {
			this._child.kill();
		} catch {
			// ignore
		}
		this._child = null;
		this._spawnedByVoid = false;
	}

	private async _whichPython3(): Promise<string | null> {
		for (const cmd of ['python3', 'python']) {
			try {
				const { stdout } = await exec(`which ${cmd}`, { timeout: 5_000 });
				const path = stdout.trim();
				if (path) return path;
			} catch {
				// try next
			}
		}
		return null;
	}

	private async _resolveMlxServerCommand(pythonPath: string): Promise<MlxServerCommand | null> {
		try {
			const { stdout } = await exec('which mlx_lm.server', { timeout: 5_000 });
			const path = stdout.trim();
			if (path) {
				return { command: path, baseArgs: [] };
			}
		} catch {
			// fall through
		}

		try {
			await exec(`"${pythonPath}" -m mlx_lm.server --help`, { timeout: 10_000 });
			return { command: pythonPath, baseArgs: ['-m', 'mlx_lm.server'] };
		} catch {
			return null;
		}
	}

	private async _isServerUp(endpoint: string): Promise<boolean> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2_500);
		try {
			const res = await fetch(`${endpoint}/v1/models`, { signal: controller.signal });
			return res.ok;
		} catch {
			return false;
		} finally {
			clearTimeout(timeout);
		}
	}

	private async _startServer(serverCmd: MlxServerCommand, port: number, model: string, log: string[]): Promise<void> {
		if (this._child && !this._child.killed) {
			log.push('Void mlx server process already running.');
			return;
		}

		log.push(`Starting mlx_lm.server on port ${port} with model ${model}…`);
		const args = [...serverCmd.baseArgs, '--model', model, '--port', String(port)];
		const child = spawn(serverCmd.command, args, {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		this._child = child;
		this._spawnedByVoid = true;
	}
}
