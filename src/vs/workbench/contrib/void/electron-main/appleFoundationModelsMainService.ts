/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { spawn, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as _exec } from 'child_process';
import { isMacintosh } from '../../../../base/common/platform.js';
import {
	APPLE_FOUNDATION_MODELS_DEFAULT_PORT,
	AppleFoundationModelsEnsureResult,
	IAppleFoundationModelsMainService,
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
			log.push(`Serveur déjà actif sur ${endpoint}`);
			return { ok: true, endpoint, action: 'already-running', log };
		}

		let didInstall = false;
		let afmPath = await this._whichAfm();
		if (!afmPath) {
			if (!options.installIfMissing) {
				log.push('Commande `afm` introuvable.');
				return { ok: false, reason: 'afm-missing', log, errorMessage: 'Installez afm avec Homebrew : brew tap scouzi1966/afm && brew install afm' };
			}

			const brewPath = await this._whichBrew();
			if (!brewPath) {
				log.push('Homebrew introuvable — impossible d’installer afm automatiquement.');
				return { ok: false, reason: 'brew-missing', log, errorMessage: 'Installez Homebrew puis : brew tap scouzi1966/afm && brew install afm' };
			}

			log.push('Installation de afm via Homebrew…');
			try {
				await exec(`${brewPath} tap scouzi1966/afm`, { timeout: 120_000 });
				await exec(`${brewPath} install afm`, { timeout: 600_000 });
				didInstall = true;
				log.push('Installation Homebrew terminée.');
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				log.push(`Échec installation : ${msg}`);
				return { ok: false, reason: 'install-failed', log, errorMessage: msg };
			}

			afmPath = await this._whichAfm();
			if (!afmPath) {
				log.push('afm toujours introuvable après installation.');
				return { ok: false, reason: 'afm-missing', log };
			}
		} else {
			log.push(`afm trouvé : ${afmPath}`);
		}

		if (options.startServer) {
			await this._startServer(afmPath, port, log);
		}

		for (let i = 0; i < 45; i++) {
			if (await this._isServerUp(endpoint)) {
				const action = didInstall ? 'installed-and-started' as const : 'started' as const;
				log.push(`Serveur prêt sur ${endpoint}`);
				return { ok: true, endpoint, action, log };
			}
			await sleep(1000);
		}

		log.push('Délai dépassé en attendant le serveur afm.');
		return { ok: false, reason: 'server-timeout', log, errorMessage: `Le serveur n’a pas répondu sur ${endpoint}. Lancez \`afm -p ${port}\` manuellement.` };
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
			// try models next
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
			log.push('Processus afm Void déjà en cours.');
			return;
		}

		log.push(`Démarrage de afm sur le port ${port}…`);
		const child = spawn(afmPath, ['-p', String(port), '-H', '127.0.0.1'], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		this._child = child;
		this._spawnedByVoid = true;
	}
}
