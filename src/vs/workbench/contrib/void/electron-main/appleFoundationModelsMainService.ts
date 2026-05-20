/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as _exec } from 'child_process';
import { isMacintosh } from '../../../../base/common/platform.js';
import {
	AFM_HOMEBREW_FORMULA,
	AFM_HOMEBREW_TAP,
	AFM_PIP_PACKAGE,
	APPLE_FOUNDATION_MODELS_DEFAULT_PORT,
	AppleFoundationModelsEnsureResult,
	IAppleFoundationModelsMainService,
	MACLOCAL_API_REPO_URL,
} from '../common/appleFoundationModelsTypes.js';

const exec = promisify(_exec);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class AppleFoundationModelsMainService implements IAppleFoundationModelsMainService {
	readonly _serviceBrand: undefined;

	private _child: ChildProcess | null = null;
	private _spawnedByVoid = false;

	async ensureReady(options: { installIfMissing: boolean; startServer: boolean; port?: number }): Promise<AppleFoundationModelsEnsureResult> {
		const log: string[] = [];
		const port = options.port ?? APPLE_FOUNDATION_MODELS_DEFAULT_PORT;
		const endpoint = `http://127.0.0.1:${port}`;

		if (!isMacintosh) {
			return { ok: false, reason: 'not-mac', log };
		}

		if (await this._isServerUp(endpoint)) {
			log.push(`maclocal-api (afm) already running at ${endpoint}`);
			return { ok: true, endpoint, action: 'already-running', log };
		}

		let didInstall = false;
		let afmPath = await this._whichAfm();
		if (!afmPath) {
			if (!options.installIfMissing) {
				log.push('`afm` not found (maclocal-api).');
				return {
					ok: false,
					reason: 'afm-missing',
					log,
					errorMessage: `Install from ${MACLOCAL_API_REPO_URL} — Homebrew: brew tap ${AFM_HOMEBREW_TAP} && brew install ${AFM_HOMEBREW_FORMULA} — or pip: pip install ${AFM_PIP_PACKAGE}`,
				};
			}

			const installedViaBrew = await this._tryInstallViaHomebrew(log);
			if (installedViaBrew) {
				didInstall = true;
			} else {
				const installedViaPip = await this._tryInstallViaPip(log);
				if (installedViaPip) {
					didInstall = true;
				} else {
					return {
						ok: false,
						reason: 'install-failed',
						log,
						errorMessage: `Could not install afm. See ${MACLOCAL_API_REPO_URL}`,
					};
				}
			}

			afmPath = await this._whichAfm();
			if (!afmPath) {
				log.push('`afm` still not on PATH after install.');
				return { ok: false, reason: 'afm-missing', log };
			}
		} else {
			log.push(`Found afm: ${afmPath}`);
		}

		if (options.startServer) {
			await this._startServer(afmPath, port, log);
		}

		for (let i = 0; i < 45; i++) {
			if (await this._isServerUp(endpoint)) {
				const action = didInstall ? 'installed-and-started' as const : 'started' as const;
				log.push(`maclocal-api ready at ${endpoint} (model: foundation)`);
				return { ok: true, endpoint, action, log };
			}
			await sleep(1000);
		}

		log.push('Timed out waiting for afm.');
		return {
			ok: false,
			reason: 'server-timeout',
			log,
			errorMessage: `Server did not respond at ${endpoint}. Run manually: afm -p ${port} -H 127.0.0.1`,
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

	private async _tryInstallViaHomebrew(log: string[]): Promise<boolean> {
		const brewPath = await this._whichBrew();
		if (!brewPath) {
			log.push('Homebrew not found; will try pip install macafm.');
			return false;
		}

		log.push(`Installing afm via Homebrew (${AFM_HOMEBREW_FORMULA})…`);
		try {
			await exec(`"${brewPath}" tap ${AFM_HOMEBREW_TAP}`, { timeout: 120_000 });
			await exec(`"${brewPath}" install ${AFM_HOMEBREW_FORMULA}`, { timeout: 600_000 });
			log.push('Homebrew install finished.');
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.push(`Homebrew install failed: ${msg}`);
			return false;
		}
	}

	private async _tryInstallViaPip(log: string[]): Promise<boolean> {
		const pythonPath = await this._whichPython3();
		if (!pythonPath) {
			log.push('python3 not found; cannot pip install macafm.');
			return false;
		}

		log.push(`Installing ${AFM_PIP_PACKAGE} via pip (${MACLOCAL_API_REPO_URL})…`);
		try {
			await exec(`"${pythonPath}" -m pip install --upgrade ${AFM_PIP_PACKAGE}`, { timeout: 600_000 });
			log.push('pip install finished.');
			return true;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			log.push(`pip install failed: ${msg}`);
			return false;
		}
	}

	private async _whichPython3(): Promise<string | null> {
		for (const cmd of ['python3', 'python']) {
			try {
				const { stdout } = await exec(`which ${cmd}`, { timeout: 5_000 });
				const path = stdout.trim();
				if (path) {
					return path;
				}
			} catch {
				// try next
			}
		}
		return null;
	}

	private async _whichAfm(): Promise<string | null> {
		try {
			const { stdout } = await exec('which afm', { timeout: 5_000 });
			const path = stdout.trim();
			return path || null;
		} catch {
			return null;
		}
	}

	private async _whichBrew(): Promise<string | null> {
		try {
			const { stdout } = await exec('which brew', { timeout: 5_000 });
			const path = stdout.trim();
			return path || null;
		} catch {
			return null;
		}
	}

	private async _isServerUp(endpoint: string): Promise<boolean> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 2_500);
		try {
			const health = await fetch(`${endpoint}/health`, { signal: controller.signal });
			if (health.ok) {
				return true;
			}
		} catch {
			// try /v1/models next
		} finally {
			clearTimeout(timeout);
		}

		const controller2 = new AbortController();
		const timeout2 = setTimeout(() => controller2.abort(), 2_500);
		try {
			const models = await fetch(`${endpoint}/v1/models`, { signal: controller2.signal });
			return models.ok;
		} catch {
			return false;
		} finally {
			clearTimeout(timeout2);
		}
	}

	private async _startServer(afmPath: string, port: number, log: string[]): Promise<void> {
		if (this._child && !this._child.killed) {
			log.push('Void afm process already running.');
			return;
		}

		log.push(`Starting maclocal-api: afm -p ${port} -H 127.0.0.1…`);
		const child = spawn(afmPath, ['-p', String(port), '-H', '127.0.0.1'], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		this._child = child;
		this._spawnedByVoid = true;
	}
}
