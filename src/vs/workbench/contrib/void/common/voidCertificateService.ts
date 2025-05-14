/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { Emitter } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IRequestContext } from '../../../../base/parts/request/common/request.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Service for managing and applying custom certificate paths for secure requests.
 */
export interface IVoidCertificateService {
	readonly _serviceBrand: undefined;

	/**
	 * Get all configured custom certificates as an array of file URIs.
	 */
	getCustomCertificates(): URI[];

	/**
	 * Add a new custom certificate path.
	 */
	addCustomCertificate(certificatePath: URI): Promise<void>;

	/**
	 * Remove a custom certificate path.
	 */
	removeCustomCertificate(certificatePath: URI): Promise<void>;

	/**
	 * Verify that a certificate path exists and is readable.
	 */
	verifyCertificatePath(certificatePath: URI): Promise<boolean>;

	/**
	 * Get all certificate contents as a concatenated string for use with HTTPS requests.
	 */
	getCertificateContents(): Promise<string[]>;
}

export const IVoidCertificateService = createDecorator<IVoidCertificateService>('VoidCertificateService');

/**
 * Service implementation for managing custom certificates.
 */
export class VoidCertificateService extends Disposable implements IVoidCertificateService {
	readonly _serviceBrand: undefined;

	private readonly _onCertificatesChanged = new Emitter<void>();

	constructor(
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@ILogService private readonly logService: ILogService,
		@IRequestService private readonly requestService: IRequestService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		// Override the original request service to include our custom certificates
		this._overrideRequestService();
	}

	/**
	 * Get all configured custom certificates
	 */
	getCustomCertificates(): URI[] {
		const certificatePaths = this.voidSettingsService.state.globalSettings.customRootCertificates || [];
		return certificatePaths.map(path => URI.parse(path));
	}

	/**
	 * Add a new custom certificate path
	 */
	async addCustomCertificate(certificatePath: URI): Promise<void> {
		// Verify the certificate path exists
		const isValid = await this.verifyCertificatePath(certificatePath);
		if (!isValid) {
			throw new Error(`Certificate file not found or not readable: ${certificatePath.toString()}`);
		}

		// Get current certificates
		const currentCertificates = this.getCustomCertificates();

		// Check if already exists
		if (currentCertificates.some(cert => cert.toString() === certificatePath.toString())) {
			return; // Already exists, nothing to do
		}

		// Add the new certificate path
		const newCertificates = [...currentCertificates, certificatePath];
		await this.voidSettingsService.setGlobalSetting('customRootCertificates', newCertificates.map(uri => uri.toString()));

		this._onCertificatesChanged.fire();
		this.logService.info(`Added custom certificate: ${certificatePath.toString()}`);
	}

	/**
	 * Remove a custom certificate path
	 */
	async removeCustomCertificate(certificatePath: URI): Promise<void> {
		const currentCertificates = this.getCustomCertificates();

		// Remove the certificate
		const newCertificates = currentCertificates.filter(cert => cert.toString() !== certificatePath.toString());

		// Update settings
		await this.voidSettingsService.setGlobalSetting('customRootCertificates', newCertificates.map(uri => uri.toString()));

		this._onCertificatesChanged.fire();
		this.logService.info(`Removed custom certificate: ${certificatePath.toString()}`);
	}

	/**
	 * Verify a certificate path exists and is readable
	 */
	async verifyCertificatePath(certificatePath: URI): Promise<boolean> {
		try {
			// Check if file exists and is readable
			const stats = await this.fileService.stat(certificatePath);
			if (!stats.isFile) {
				return false;
			}

			// Check if we can read the file
			await this.fileService.readFile(certificatePath);
			return true;
		} catch (error) {
			this.logService.error(`Error verifying certificate path: ${error}`);
			return false;
		}
	}

	/**
	 * Get all certificate contents
	 */
	async getCertificateContents(): Promise<string[]> {
		const certificatePaths = this.getCustomCertificates();
		const contents: string[] = [];

		for (const certPath of certificatePaths) {
			try {
				if (await this.verifyCertificatePath(certPath)) {
					const fileContent = await this.fileService.readFile(certPath);
					contents.push(fileContent.value.toString());
				}
			} catch (error) {
				this.logService.error(`Error reading certificate ${certPath.toString()}: ${error}`);
			}
		}

		return contents;
	}

	/**
	 * Override the original request service to include our custom certificates
	 */
	private _overrideRequestService(): void {
		// Store the original request method
		const originalRequest = this.requestService.request.bind(this.requestService);

		// Override the request method to inject our certificates
		// @ts-ignore - We're monkey patching the request service
		this.requestService.request = async (options: any, token: CancellationToken): Promise<IRequestContext> => {
			// Only add certificates for HTTPS requests
			if (options.url?.startsWith('https://')) {
				try {
					// Load system certificates
					const systemCerts = await this.requestService.loadCertificates();

					// Load our custom certificates
					const customCertContents = await this.getCertificateContents();

					if (customCertContents.length > 0) {
						// Create custom CA option
						// Documentation in Node.js: https://nodejs.org/api/https.html#https_https_request_options_callback
						// The 'ca' option can be a string, Buffer, or array of strings/Buffers
						(options as any).ca = [...systemCerts, ...customCertContents];

						this.logService.debug(`Added ${customCertContents.length} custom certificates to request to ${options.url}`);
					}
				} catch (error) {
					this.logService.error(`Error adding custom certificates: ${error}`);
				}
			}

			// Forward to the original request implementation
			return originalRequest(options, token);
		};
	}
}

// Register the service
registerSingleton(IVoidCertificateService, VoidCertificateService, InstantiationType.Eager);