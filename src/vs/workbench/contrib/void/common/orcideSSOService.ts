/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Orcest. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEncryptionService } from '../../../../platform/encryption/common/encryptionService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';


// ─── SSO Configuration ──────────────────────────────────────────────────────────

export const ORCIDE_SSO_CONFIG = {
	issuer: 'https://login.orcest.ai',
	clientId: 'orcide',
	authorizationEndpoint: 'https://login.orcest.ai/oauth2/authorize',
	tokenEndpoint: 'https://login.orcest.ai/oauth2/token',
	userInfoEndpoint: 'https://login.orcest.ai/oauth2/userinfo',
	jwksUri: 'https://login.orcest.ai/oauth2/jwks',
	redirectUri: 'https://ide.orcest.ai/auth/callback',
	scopes: 'openid profile email',
	logoutEndpoint: 'https://login.orcest.ai/oauth2/logout',
	endSessionEndpoint: 'https://login.orcest.ai/oauth2/logout',
} as const;

export const ORCIDE_SSO_STORAGE_KEY = 'orcide.ssoSessionState';
export const ORCIDE_SSO_PKCE_STORAGE_KEY = 'orcide.ssoPKCEState';

// Refresh tokens 5 minutes before they expire
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Minimum interval between refresh attempts to avoid hammering the server
const MIN_REFRESH_INTERVAL_MS = 30 * 1000;

// Maximum number of consecutive refresh failures before forcing logout
const MAX_REFRESH_FAILURES = 3;


// ─── Types ──────────────────────────────────────────────────────────────────────

export type SSOUserProfile = {
	id: string;
	email: string;
	name: string;
	role: string;
	avatar?: string;
};

export type SSOState = {
	isAuthenticated: boolean;
	user: SSOUserProfile | null;
	accessToken: string | null;
	refreshToken: string | null;
	idToken: string | null;
	expiresAt: number | null;
};

export type SSOTokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	token_type: string;
	id_token?: string;
	scope?: string;
};

export type SSOUserInfoResponse = {
	sub: string;
	email?: string;
	email_verified?: boolean;
	name?: string;
	preferred_username?: string;
	given_name?: string;
	family_name?: string;
	picture?: string;
	role?: string;
	roles?: string[];
	groups?: string[];
};

export type PKCEState = {
	codeVerifier: string;
	state: string;
	nonce: string;
	createdAt: number;
};


// ─── Service Interface ──────────────────────────────────────────────────────────

export interface IOrcideSSOService {
	readonly _serviceBrand: undefined;
	readonly state: SSOState;
	readonly waitForInitState: Promise<void>;

	onDidChangeState: Event<void>;

	login(): Promise<void>;
	logout(): Promise<void>;
	getAccessToken(): Promise<string | null>;
	getUserProfile(): SSOUserProfile | null;
	isAuthenticated(): boolean;
	refreshToken(): Promise<boolean>;

	/**
	 * Called by the browser-side service when the authorization callback is received.
	 * Exchanges the authorization code for tokens and updates the session.
	 */
	handleAuthorizationCallback(code: string, returnedState: string): Promise<void>;

	/**
	 * Retrieves the stored PKCE state for the current login flow.
	 * Used by the browser-side service to validate callbacks.
	 */
	getPendingPKCEState(): PKCEState | null;
}


// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically random string for use as PKCE code verifier,
 * state parameter, or nonce.
 */
function generateRandomString(length: number): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars[array[i] % chars.length];
	}
	return result;
}

/**
 * Creates a SHA-256 hash of the input string and returns it as a base64url-encoded string.
 * Used for PKCE code_challenge.
 */
async function sha256Base64Url(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = new Uint8Array(hashBuffer);
	let binary = '';
	for (let i = 0; i < hashArray.length; i++) {
		binary += String.fromCharCode(hashArray[i]);
	}
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/**
 * Parses a JWT token and returns the payload. Does NOT verify the signature;
 * signature verification should be done server-side or using the JWKS endpoint.
 */
function parseJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split('.');
		if (parts.length !== 3) {
			return null;
		}
		const payload = parts[1];
		const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
		const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
		return JSON.parse(decoded);
	} catch {
		return null;
	}
}


// ─── Default State ──────────────────────────────────────────────────────────────

const defaultSSOState = (): SSOState => ({
	isAuthenticated: false,
	user: null,
	accessToken: null,
	refreshToken: null,
	idToken: null,
	expiresAt: null,
});


// ─── Service Decorator ──────────────────────────────────────────────────────────

export const IOrcideSSOService = createDecorator<IOrcideSSOService>('OrcideSSOService');


// ─── Service Implementation ─────────────────────────────────────────────────────

class OrcideSSOService extends Disposable implements IOrcideSSOService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	state: SSOState;

	private readonly _resolver: () => void;
	waitForInitState: Promise<void>;

	private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private _lastRefreshAttempt: number = 0;
	private _consecutiveRefreshFailures: number = 0;

	// PKCE state stored transiently during login flow
	private _pendingPKCEState: PKCEState | null = null;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IEncryptionService private readonly _encryptionService: IEncryptionService,
	) {
		super();

		this.state = defaultSSOState();
		let resolver: () => void = () => { };
		this.waitForInitState = new Promise((res) => resolver = res);
		this._resolver = resolver;

		this._readAndInitializeState();
	}


	// ── Initialization ─────────────────────────────────────────────────────────

	private async _readAndInitializeState(): Promise<void> {
		try {
			const stored = await this._readState();
			if (stored && stored.accessToken) {
				this.state = stored;

				// Ensure idToken field exists for sessions stored before this field was added
				if (this.state.idToken === undefined) {
					this.state = { ...this.state, idToken: null };
				}

				// If the token is expired or about to expire, attempt a refresh
				if (this._isTokenExpiredOrExpiring()) {
					const refreshed = await this.refreshToken();
					if (!refreshed) {
						// Token refresh failed, clear the session
						this.state = defaultSSOState();
					}
				} else {
					this._scheduleTokenRefresh();
				}
			}
		} catch (e) {
			console.error('[OrcideSSOService] Failed to read stored state:', e);
			this.state = defaultSSOState();
		}

		// Also try to restore any pending PKCE state (e.g., if the user was in the
		// middle of a login flow when the window was refreshed)
		try {
			const pkceStr = this._storageService.get(ORCIDE_SSO_PKCE_STORAGE_KEY, StorageScope.APPLICATION);
			if (pkceStr) {
				const pkce = JSON.parse(pkceStr) as PKCEState;
				// Only restore if PKCE state is less than 10 minutes old
				const PKCE_MAX_AGE_MS = 10 * 60 * 1000;
				if (Date.now() - pkce.createdAt < PKCE_MAX_AGE_MS) {
					this._pendingPKCEState = pkce;
				} else {
					// Stale PKCE state; clean it up
					this._storageService.remove(ORCIDE_SSO_PKCE_STORAGE_KEY, StorageScope.APPLICATION);
				}
			}
		} catch (e) {
			console.warn('[OrcideSSOService] Failed to restore PKCE state:', e);
		}

		this._resolver();
		this._onDidChangeState.fire();
	}

	private async _readState(): Promise<SSOState | null> {
		const encryptedState = this._storageService.get(ORCIDE_SSO_STORAGE_KEY, StorageScope.APPLICATION);
		if (!encryptedState) {
			return null;
		}

		try {
			const stateStr = await this._encryptionService.decrypt(encryptedState);
			return JSON.parse(stateStr) as SSOState;
		} catch (e) {
			console.error('[OrcideSSOService] Failed to decrypt stored state:', e);
			return null;
		}
	}

	private async _storeState(): Promise<void> {
		try {
			const encryptedState = await this._encryptionService.encrypt(JSON.stringify(this.state));
			this._storageService.store(ORCIDE_SSO_STORAGE_KEY, encryptedState, StorageScope.APPLICATION, StorageTarget.USER);
		} catch (e) {
			console.error('[OrcideSSOService] Failed to store state:', e);
		}
	}

	private async _clearStoredState(): Promise<void> {
		this._storageService.remove(ORCIDE_SSO_STORAGE_KEY, StorageScope.APPLICATION);
		this._storageService.remove(ORCIDE_SSO_PKCE_STORAGE_KEY, StorageScope.APPLICATION);
	}

	private _storePKCEState(pkce: PKCEState): void {
		this._storageService.store(
			ORCIDE_SSO_PKCE_STORAGE_KEY,
			JSON.stringify(pkce),
			StorageScope.APPLICATION,
			StorageTarget.USER
		);
	}

	private _clearPKCEState(): void {
		this._pendingPKCEState = null;
		this._storageService.remove(ORCIDE_SSO_PKCE_STORAGE_KEY, StorageScope.APPLICATION);
	}


	// ── Login Flow ─────────────────────────────────────────────────────────────

	async login(): Promise<void> {
		// Generate PKCE parameters
		const codeVerifier = generateRandomString(64);
		const codeChallenge = await sha256Base64Url(codeVerifier);
		const stateParam = generateRandomString(32);
		const nonce = generateRandomString(32);

		// Store PKCE state for the callback (both in-memory and persisted for
		// surviving page reloads during the redirect-based login flow)
		const pkceState: PKCEState = {
			codeVerifier,
			state: stateParam,
			nonce,
			createdAt: Date.now(),
		};
		this._pendingPKCEState = pkceState;
		this._storePKCEState(pkceState);

		// Build the authorization URL
		const params = new URLSearchParams({
			response_type: 'code',
			client_id: ORCIDE_SSO_CONFIG.clientId,
			redirect_uri: ORCIDE_SSO_CONFIG.redirectUri,
			scope: ORCIDE_SSO_CONFIG.scopes,
			state: stateParam,
			nonce: nonce,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
		});

		const authUrl = `${ORCIDE_SSO_CONFIG.authorizationEndpoint}?${params.toString()}`;

		// Open the authorization URL; browser-side service handles the actual window/redirect
		this._openAuthorizationUrl(authUrl);
	}

	/**
	 * Opens the authorization URL. In the common layer this is a no-op;
	 * the browser-side service overrides this to open a popup or redirect.
	 */
	protected _openAuthorizationUrl(_url: string): void {
		// No-op in common; overridden in browser service
	}

	/**
	 * Returns the pending PKCE state for the browser-side service to use
	 * when handling the authorization callback.
	 */
	getPendingPKCEState(): PKCEState | null {
		return this._pendingPKCEState;
	}

	/**
	 * Called by the browser-side service when the authorization callback is received.
	 * Exchanges the authorization code for tokens.
	 */
	async handleAuthorizationCallback(code: string, returnedState: string): Promise<void> {
		// Validate the state parameter
		if (!this._pendingPKCEState || returnedState !== this._pendingPKCEState.state) {
			console.error('[OrcideSSOService] State mismatch in authorization callback');
			this._clearPKCEState();
			throw new Error('Invalid state parameter. Possible CSRF attack.');
		}

		const codeVerifier = this._pendingPKCEState.codeVerifier;
		const nonce = this._pendingPKCEState.nonce;
		this._clearPKCEState();

		// Exchange the authorization code for tokens
		const tokenResponse = await this._exchangeCodeForTokens(code, codeVerifier);

		// Validate the id_token nonce if present
		if (tokenResponse.id_token) {
			const idPayload = parseJwtPayload(tokenResponse.id_token);
			if (idPayload && idPayload['nonce'] !== nonce) {
				throw new Error('ID token nonce mismatch. Possible replay attack.');
			}
		}

		// Fetch user profile from the UserInfo endpoint
		const userProfile = await this._fetchUserProfile(tokenResponse.access_token);

		// Update state
		this.state = {
			isAuthenticated: true,
			user: userProfile,
			accessToken: tokenResponse.access_token,
			refreshToken: tokenResponse.refresh_token ?? null,
			idToken: tokenResponse.id_token ?? null,
			expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
		};

		this._consecutiveRefreshFailures = 0;
		await this._storeState();
		this._scheduleTokenRefresh();
		this._onDidChangeState.fire();
	}

	private async _exchangeCodeForTokens(code: string, codeVerifier: string): Promise<SSOTokenResponse> {
		const body = new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: ORCIDE_SSO_CONFIG.clientId,
			code: code,
			redirect_uri: ORCIDE_SSO_CONFIG.redirectUri,
			code_verifier: codeVerifier,
		});

		const response = await fetch(ORCIDE_SSO_CONFIG.tokenEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
		}

		return response.json() as Promise<SSOTokenResponse>;
	}

	private async _fetchUserProfile(accessToken: string): Promise<SSOUserProfile> {
		const response = await fetch(ORCIDE_SSO_CONFIG.userInfoEndpoint, {
			method: 'GET',
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Accept': 'application/json',
			},
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`UserInfo request failed (${response.status}): ${errorText}`);
		}

		const data = await response.json() as SSOUserInfoResponse;

		// Build a display name from available fields
		let displayName = data.name ?? '';
		if (!displayName && (data.given_name || data.family_name)) {
			displayName = [data.given_name, data.family_name].filter(Boolean).join(' ');
		}
		if (!displayName) {
			displayName = data.preferred_username ?? data.email ?? data.sub;
		}

		// Determine the user's primary role from the various possible fields
		let role = 'user';
		if (data.role) {
			role = data.role;
		} else if (data.roles && data.roles.length > 0) {
			role = data.roles[0];
		} else if (data.groups && data.groups.length > 0) {
			// Some OIDC providers use groups instead of roles
			const adminGroups = ['admin', 'admins', 'administrator'];
			if (data.groups.some(g => adminGroups.includes(g.toLowerCase()))) {
				role = 'admin';
			}
		}

		return {
			id: data.sub,
			email: data.email ?? '',
			name: displayName,
			role: role,
			avatar: data.picture,
		};
	}


	// ── Logout ─────────────────────────────────────────────────────────────────

	async logout(): Promise<void> {
		this._cancelRefreshTimer();
		this._consecutiveRefreshFailures = 0;

		const idToken = this.state.idToken;
		const accessToken = this.state.accessToken;

		// Clear local state first so the UI updates immediately
		this.state = defaultSSOState();
		await this._clearStoredState();
		this._onDidChangeState.fire();

		// Then notify the OIDC provider about the logout (best-effort)
		if (accessToken || idToken) {
			try {
				const params = new URLSearchParams({
					client_id: ORCIDE_SSO_CONFIG.clientId,
				});
				if (idToken) {
					params.set('id_token_hint', idToken);
				}
				if (accessToken) {
					params.set('token', accessToken);
				}
				await fetch(`${ORCIDE_SSO_CONFIG.logoutEndpoint}?${params.toString()}`, {
					method: 'GET',
					mode: 'no-cors',
				});
			} catch (e) {
				// Best-effort logout notification; do not block on failure
				console.warn('[OrcideSSOService] Failed to notify OIDC provider about logout:', e);
			}
		}
	}


	// ── Token Management ───────────────────────────────────────────────────────

	async getAccessToken(): Promise<string | null> {
		if (!this.state.isAuthenticated || !this.state.accessToken) {
			return null;
		}

		// If token is expired or about to expire, refresh it first
		if (this._isTokenExpiredOrExpiring()) {
			const refreshed = await this.refreshToken();
			if (!refreshed) {
				return null;
			}
		}

		return this.state.accessToken;
	}

	async refreshToken(): Promise<boolean> {
		if (!this.state.refreshToken) {
			return false;
		}

		// Throttle refresh attempts
		const now = Date.now();
		if (now - this._lastRefreshAttempt < MIN_REFRESH_INTERVAL_MS) {
			return this.state.isAuthenticated;
		}
		this._lastRefreshAttempt = now;

		try {
			const body = new URLSearchParams({
				grant_type: 'refresh_token',
				client_id: ORCIDE_SSO_CONFIG.clientId,
				refresh_token: this.state.refreshToken,
			});

			const response = await fetch(ORCIDE_SSO_CONFIG.tokenEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: body.toString(),
			});

			if (!response.ok) {
				this._consecutiveRefreshFailures++;
				console.error(`[OrcideSSOService] Token refresh failed (${response.status}), attempt ${this._consecutiveRefreshFailures}/${MAX_REFRESH_FAILURES}`);

				// If refresh fails with 401/403, or we've exceeded max retries, session is invalid
				if (response.status === 401 || response.status === 403 || this._consecutiveRefreshFailures >= MAX_REFRESH_FAILURES) {
					console.error('[OrcideSSOService] Session invalidated after refresh failure');
					await this.logout();
				}
				return false;
			}

			const tokenResponse = await response.json() as SSOTokenResponse;

			// Re-fetch user profile in case it changed (roles, name, etc.)
			let userProfile = this.state.user;
			try {
				userProfile = await this._fetchUserProfile(tokenResponse.access_token);
			} catch (e) {
				// Keep existing user profile if re-fetch fails
				console.warn('[OrcideSSOService] Failed to refresh user profile:', e);
			}

			this.state = {
				isAuthenticated: true,
				user: userProfile,
				accessToken: tokenResponse.access_token,
				refreshToken: tokenResponse.refresh_token ?? this.state.refreshToken,
				idToken: tokenResponse.id_token ?? this.state.idToken,
				expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
			};

			this._consecutiveRefreshFailures = 0;
			await this._storeState();
			this._scheduleTokenRefresh();
			this._onDidChangeState.fire();

			return true;
		} catch (e) {
			this._consecutiveRefreshFailures++;
			console.error(`[OrcideSSOService] Token refresh error (attempt ${this._consecutiveRefreshFailures}/${MAX_REFRESH_FAILURES}):`, e);

			if (this._consecutiveRefreshFailures >= MAX_REFRESH_FAILURES) {
				console.error('[OrcideSSOService] Max refresh retries exceeded, logging out');
				await this.logout();
			}
			return false;
		}
	}

	getUserProfile(): SSOUserProfile | null {
		return this.state.user;
	}

	isAuthenticated(): boolean {
		if (!this.state.isAuthenticated || !this.state.accessToken) {
			return false;
		}

		// Check if the token has fully expired (past the refresh buffer)
		if (this.state.expiresAt !== null && Date.now() > this.state.expiresAt) {
			return false;
		}

		return true;
	}


	// ── Auto-Refresh Scheduling ────────────────────────────────────────────────

	private _isTokenExpiredOrExpiring(): boolean {
		if (this.state.expiresAt === null) {
			return false;
		}
		return Date.now() >= (this.state.expiresAt - TOKEN_REFRESH_BUFFER_MS);
	}

	private _scheduleTokenRefresh(): void {
		this._cancelRefreshTimer();

		if (!this.state.expiresAt || !this.state.refreshToken) {
			return;
		}

		const timeUntilRefresh = this.state.expiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS;
		const delay = Math.max(timeUntilRefresh, MIN_REFRESH_INTERVAL_MS);

		this._refreshTimer = setTimeout(async () => {
			const success = await this.refreshToken();
			if (!success) {
				console.warn('[OrcideSSOService] Scheduled token refresh failed');
			}
		}, delay);
	}

	private _cancelRefreshTimer(): void {
		if (this._refreshTimer !== null) {
			clearTimeout(this._refreshTimer);
			this._refreshTimer = null;
		}
	}


	// ── Cleanup ────────────────────────────────────────────────────────────────

	override dispose(): void {
		this._cancelRefreshTimer();
		this._onDidChangeState.dispose();
		super.dispose();
	}
}


// ─── Registration ───────────────────────────────────────────────────────────────

registerSingleton(IOrcideSSOService, OrcideSSOService, InstantiationType.Eager);
