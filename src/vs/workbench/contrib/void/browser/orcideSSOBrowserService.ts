/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Orcest. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { IOrcideSSOService, ORCIDE_SSO_CONFIG } from '../common/orcideSSOService.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';


// ─── Constants ──────────────────────────────────────────────────────────────────

// Popup window dimensions
const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 700;

// Maximum time to wait for the popup to complete (10 minutes)
const POPUP_TIMEOUT_MS = 10 * 60 * 1000;

// Interval for polling the popup window state
const POPUP_POLL_INTERVAL_MS = 500;


// ─── Browser SSO Contribution ───────────────────────────────────────────────────

/**
 * Workbench contribution that handles browser-specific SSO behavior:
 * - Listens for OAuth2 callback messages from the popup window
 * - Handles the authorization code exchange
 * - Manages the popup window lifecycle
 */
export class OrcideSSOBrowserContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.orcideSSO';

	private _popupWindow: Window | null = null;
	private _popupPollTimer: ReturnType<typeof setInterval> | null = null;
	private _popupTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		@IOrcideSSOService private readonly _ssoService: IOrcideSSOService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();
		this._initialize();
	}

	private _initialize(): void {
		const targetWindow = getActiveWindow();

		// Listen for postMessage from the OAuth2 callback popup.
		// The callback page at /auth/callback posts a message with the authorization
		// code and state back to the opener window.
		const messageHandler = (event: MessageEvent) => {
			this._handleOAuthMessage(event);
		};
		targetWindow.addEventListener('message', messageHandler);
		this._register({
			dispose: () => targetWindow.removeEventListener('message', messageHandler),
		});

		// Also check if the current URL itself is a callback (for redirect-based flow
		// where the entire IDE is redirected to the callback URL)
		this._handleRedirectCallback(targetWindow);
	}


	// ── Redirect Flow Handling ─────────────────────────────────────────────────

	/**
	 * If the IDE is loaded at the callback URL itself (redirect-based OAuth flow),
	 * extract the code and state from the URL parameters and process the callback.
	 */
	private _handleRedirectCallback(targetWindow: Window): void {
		try {
			const url = new URL(targetWindow.location.href);
			const callbackPath = new URL(ORCIDE_SSO_CONFIG.redirectUri).pathname;

			if (url.pathname !== callbackPath) {
				return;
			}

			const code = url.searchParams.get('code');
			const state = url.searchParams.get('state');
			const error = url.searchParams.get('error');
			const errorDescription = url.searchParams.get('error_description');

			// Clean the callback parameters from the URL so they don't persist
			// in the address bar or browser history
			url.searchParams.delete('code');
			url.searchParams.delete('state');
			url.searchParams.delete('error');
			url.searchParams.delete('error_description');
			url.searchParams.delete('session_state');
			targetWindow.history.replaceState({}, '', url.pathname + url.search + url.hash);

			if (error) {
				const message = errorDescription ?? error;
				console.error(`[OrcideSSOBrowser] OAuth error in redirect: ${message}`);
				this._notificationService.notify({
					severity: Severity.Error,
					message: `SSO login failed: ${message}`,
				});
				return;
			}

			if (code && state) {
				this._processAuthorizationCode(code, state);
			}
		} catch (e) {
			// Not a callback URL, or parsing failed. This is expected in the
			// common case where the IDE is loaded normally.
		}
	}


	// ── Popup Flow Handling ────────────────────────────────────────────────────

	/**
	 * Opens the SSO login page in a centered popup window.
	 * Called when the login() method triggers _openAuthorizationUrl.
	 */
	openLoginPopup(authUrl: string): void {
		// Close any existing popup
		this._closePopup();

		const targetWindow = getActiveWindow();

		// Calculate center position for the popup
		const left = Math.max(0, Math.round(targetWindow.screenX + (targetWindow.outerWidth - POPUP_WIDTH) / 2));
		const top = Math.max(0, Math.round(targetWindow.screenY + (targetWindow.outerHeight - POPUP_HEIGHT) / 2));

		const features = [
			`width=${POPUP_WIDTH}`,
			`height=${POPUP_HEIGHT}`,
			`left=${left}`,
			`top=${top}`,
			'menubar=no',
			'toolbar=no',
			'location=yes',
			'status=yes',
			'resizable=yes',
			'scrollbars=yes',
		].join(',');

		this._popupWindow = targetWindow.open(authUrl, 'orcide-sso-login', features);

		if (!this._popupWindow) {
			// Popup was blocked by the browser. Fall back to redirect flow.
			console.warn('[OrcideSSOBrowser] Popup blocked, falling back to redirect flow');
			this._notificationService.notify({
				severity: Severity.Warning,
				message: 'Popup was blocked by the browser. Redirecting to SSO login page...',
			});
			targetWindow.location.href = authUrl;
			return;
		}

		// Focus the popup
		this._popupWindow.focus();

		// Poll the popup to detect if the user closes it manually
		this._popupPollTimer = setInterval(() => {
			if (this._popupWindow && this._popupWindow.closed) {
				this._cleanupPopup();
			}
		}, POPUP_POLL_INTERVAL_MS);

		// Set a timeout to auto-close the popup if it takes too long
		this._popupTimeoutTimer = setTimeout(() => {
			if (this._popupWindow && !this._popupWindow.closed) {
				console.warn('[OrcideSSOBrowser] Login popup timed out');
				this._closePopup();
				this._notificationService.notify({
					severity: Severity.Warning,
					message: 'SSO login timed out. Please try again.',
				});
			}
		}, POPUP_TIMEOUT_MS);
	}


	// ── Message Handling ───────────────────────────────────────────────────────

	/**
	 * Handles postMessage events from the OAuth callback page.
	 * The callback page at the redirect URI should post a message with:
	 * { type: 'orcide-sso-callback', code: string, state: string }
	 * or
	 * { type: 'orcide-sso-callback', error: string, errorDescription?: string }
	 */
	private _handleOAuthMessage(event: MessageEvent): void {
		// Validate the origin - only accept messages from our SSO issuer or
		// from the IDE itself (for same-origin callback pages)
		const allowedOrigins = [
			ORCIDE_SSO_CONFIG.issuer,
			new URL(ORCIDE_SSO_CONFIG.redirectUri).origin,
		];

		if (!allowedOrigins.includes(event.origin)) {
			return;
		}

		const data = event.data;
		if (!data || typeof data !== 'object' || data.type !== 'orcide-sso-callback') {
			return;
		}

		// Close the popup since we got our response
		this._closePopup();

		if (data.error) {
			const message = data.errorDescription ?? data.error;
			console.error(`[OrcideSSOBrowser] OAuth error from callback: ${message}`);
			this._notificationService.notify({
				severity: Severity.Error,
				message: `SSO login failed: ${message}`,
			});
			return;
		}

		if (data.code && data.state) {
			this._processAuthorizationCode(data.code, data.state);
		}
	}


	// ── Authorization Code Processing ──────────────────────────────────────────

	/**
	 * Processes the received authorization code by delegating to the SSO service
	 * to exchange it for tokens and set up the session.
	 */
	private async _processAuthorizationCode(code: string, state: string): Promise<void> {
		try {
			await this._ssoService.handleAuthorizationCallback(code, state);

			const user = this._ssoService.getUserProfile();
			const displayName = user?.name || user?.email || 'User';
			this._notificationService.notify({
				severity: Severity.Info,
				message: `Welcome, ${displayName}! You are now signed in.`,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error('[OrcideSSOBrowser] Failed to process authorization code:', e);
			this._notificationService.notify({
				severity: Severity.Error,
				message: `SSO login failed: ${message}`,
			});
		}
	}


	// ── Popup Lifecycle ────────────────────────────────────────────────────────

	private _closePopup(): void {
		if (this._popupWindow && !this._popupWindow.closed) {
			this._popupWindow.close();
		}
		this._cleanupPopup();
	}

	private _cleanupPopup(): void {
		this._popupWindow = null;

		if (this._popupPollTimer !== null) {
			clearInterval(this._popupPollTimer);
			this._popupPollTimer = null;
		}

		if (this._popupTimeoutTimer !== null) {
			clearTimeout(this._popupTimeoutTimer);
			this._popupTimeoutTimer = null;
		}
	}


	// ── Cleanup ────────────────────────────────────────────────────────────────

	override dispose(): void {
		this._closePopup();
		super.dispose();
	}
}


// ─── Register the browser contribution ──────────────────────────────────────────

registerWorkbenchContribution2(
	OrcideSSOBrowserContribution.ID,
	OrcideSSOBrowserContribution,
	WorkbenchPhase.AfterRestored
);


// ─── Command Palette Actions ────────────────────────────────────────────────────

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'orcide.sso.login',
			f1: true,
			title: localize2('orcideSSOLogin', 'Orcide: Sign In with SSO'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const ssoService = accessor.get(IOrcideSSOService);
		const notificationService = accessor.get(INotificationService);

		if (ssoService.isAuthenticated()) {
			const user = ssoService.getUserProfile();
			notificationService.notify({
				severity: Severity.Info,
				message: `Already signed in as ${user?.name ?? user?.email ?? 'unknown user'}.`,
			});
			return;
		}

		try {
			await ssoService.login();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			notificationService.notify({
				severity: Severity.Error,
				message: `SSO login failed: ${message}`,
			});
		}
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'orcide.sso.logout',
			f1: true,
			title: localize2('orcideSSOLogout', 'Orcide: Sign Out'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const ssoService = accessor.get(IOrcideSSOService);
		const notificationService = accessor.get(INotificationService);

		if (!ssoService.isAuthenticated()) {
			notificationService.notify({
				severity: Severity.Info,
				message: 'You are not currently signed in.',
			});
			return;
		}

		const user = ssoService.getUserProfile();
		try {
			await ssoService.logout();
			notificationService.notify({
				severity: Severity.Info,
				message: `Signed out${user?.name ? ` (${user.name})` : ''}. See you next time!`,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			notificationService.notify({
				severity: Severity.Error,
				message: `Sign out failed: ${message}`,
			});
		}
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'orcide.sso.status',
			f1: true,
			title: localize2('orcideSSOStatus', 'Orcide: SSO Status'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const ssoService = accessor.get(IOrcideSSOService);
		const notificationService = accessor.get(INotificationService);

		if (!ssoService.isAuthenticated()) {
			notificationService.notify({
				severity: Severity.Info,
				message: 'Not signed in. Use "Orcide: Sign In with SSO" to authenticate.',
			});
			return;
		}

		const user = ssoService.getUserProfile();
		const { expiresAt } = ssoService.state;
		const expiresIn = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000 / 60)) : 'unknown';

		const lines = [
			`Signed in as: ${user?.name ?? 'Unknown'}`,
			`Email: ${user?.email ?? 'N/A'}`,
			`Role: ${user?.role ?? 'N/A'}`,
			`Token expires in: ${expiresIn} minutes`,
		];

		notificationService.notify({
			severity: Severity.Info,
			message: lines.join('\n'),
		});
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'orcide.sso.refreshToken',
			f1: true,
			title: localize2('orcideSSORefresh', 'Orcide: Refresh SSO Token'),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const ssoService = accessor.get(IOrcideSSOService);
		const notificationService = accessor.get(INotificationService);

		if (!ssoService.isAuthenticated()) {
			notificationService.notify({
				severity: Severity.Warning,
				message: 'Cannot refresh token: not signed in.',
			});
			return;
		}

		try {
			const success = await ssoService.refreshToken();
			if (success) {
				notificationService.notify({
					severity: Severity.Info,
					message: 'SSO token refreshed successfully.',
				});
			} else {
				notificationService.notify({
					severity: Severity.Error,
					message: 'Failed to refresh SSO token. You may need to sign in again.',
				});
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			notificationService.notify({
				severity: Severity.Error,
				message: `Token refresh failed: ${message}`,
			});
		}
	}
});
