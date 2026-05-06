/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { spawn, exec as execCb, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { promisify } from 'util';

const exec = promisify(execCb);
const AFM_FOUNDATION_PORT = 9999; // Apple Foundation Model
const AFM_MLX_PORT = 8080;        // MLX models (afm mlx -m <model> -p 8080)

// Electron apps don't source the shell, so PATH is minimal (/usr/bin:/bin).
// We enrich it with common Homebrew paths so `afm` and `brew` can be found.
const HOMEBREW_PATHS = [
	'/opt/homebrew/bin',    // Apple Silicon
	'/usr/local/bin',       // Intel Mac
	'/opt/homebrew/sbin',
	'/usr/local/sbin',
];

const enrichedEnv = (): NodeJS.ProcessEnv => {
	const currentPath = process.env.PATH ?? '';
	const extra = HOMEBREW_PATHS.filter(p => !currentPath.includes(p)).join(':');
	return { ...process.env, PATH: extra ? `${extra}:${currentPath}` : currentPath };
};

/**
 * Returns true if something is already listening on the given port.
 */
const isPortInUse = (port: number): Promise<boolean> => {
	return new Promise((resolve) => {
		const server = createServer();
		server.once('error', () => resolve(true));   // port is taken
		server.once('listening', () => {
			server.close(() => resolve(false));       // port is free
		});
		server.listen(port, '127.0.0.1');
	});
};

/**
 * Returns true if the given command is available in PATH (including Homebrew paths).
 */
const isCommandAvailable = async (cmd: string): Promise<boolean> => {
	try {
		await exec(`which ${cmd}`, { env: enrichedEnv() });
		return true;
	} catch {
		return false;
	}
};

/**
 * Tries to install `afm` via Homebrew.
 * Returns true if installation succeeded.
 */
const installAfmViaBrew = async (log: (msg: string) => void): Promise<boolean> => {
	const brewAvailable = await isCommandAvailable('brew');
	if (!brewAvailable) {
		log('[Void] afm: not found and Homebrew is not installed. Install afm manually: brew install scouzi1966/afm/afm');
		return false;
	}

	log('[Void] afm: not found — installing via Homebrew (this may take a moment)…');
	try {
		await exec('brew install scouzi1966/afm/afm', { env: enrichedEnv() });
		log('[Void] afm: installed successfully via Homebrew');
		return true;
	} catch (e) {
		log(`[Void] afm: Homebrew installation failed: ${e}`);
		return false;
	}
};

/**
 * Tries to start the `afm -g` backend (Apple Foundation Model + API gateway).
 * - Only runs on macOS.
 * - If `afm` is not installed, auto-installs it via Homebrew.
 * - If port 9999 is already in use (user started afm manually), leaves it untouched.
 * - If we spawn the process, we register a shutdown hook to kill it cleanly when
 *   Void exits.
 */
export const startAfmIfNeeded = async (
	onShutdown: (cb: () => void) => void,
	log: (msg: string) => void,
): Promise<void> => {

	if (process.platform !== 'darwin') {
		return; // afm is macOS-only
	}

	const portInUse = await isPortInUse(AFM_FOUNDATION_PORT);
	if (portInUse) {
		log('[Void] afm: port 9999 already in use — using existing afm instance');
		return;
	}

	// Check if an MLX model is already running on port 8080
	const mlxPortInUse = await isPortInUse(AFM_MLX_PORT);
	if (mlxPortInUse) {
		log('[Void] afm: MLX model detected on port 8080');
	}

	// Auto-install if afm is not in PATH
	const afmAvailable = await isCommandAvailable('afm');
	if (!afmAvailable) {
		const installed = await installAfmViaBrew(log);
		if (!installed) {
			return;
		}
	}

	// Spawn afm -g (gateway mode: auto-discovers Ollama, LM Studio, Jan, etc.)
	let afmProcess: ChildProcess | null = null;

	try {
		afmProcess = spawn('afm', ['-g'], {
			detached: false,
			stdio: 'ignore',
			env: enrichedEnv(),
		});
	} catch (e) {
		log(`[Void] afm: could not start: ${e}`);
		return;
	}

	afmProcess.on('error', (err) => {
		log(`[Void] afm: error: ${err.message}`);
		afmProcess = null;
	});

	afmProcess.on('exit', (code, signal) => {
		log(`[Void] afm: exited (code=${code}, signal=${signal})`);
		afmProcess = null;
	});

	log('[Void] afm: started on port 9999 with gateway mode (-g)');

	// Kill afm when Void shuts down — only if WE started it
	onShutdown(() => {
		if (afmProcess) {
			log('[Void] afm: stopping on Void shutdown');
			try {
				afmProcess.kill();
			} catch (_) {
				// process may have already exited
			}
			afmProcess = null;
		}
	});
};
