import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ipcRenderer } from '../../../../base/parts/sandbox/electron-sandbox/globals.js';
import { mainWindow } from '../../../../base/browser/window.js';

let trackingInterval: any = null;
let lastBoundsStr = '';

function startTracking() {
	if (trackingInterval) mainWindow.clearInterval(trackingInterval);
	trackingInterval = mainWindow.setInterval(() => {
		const iframes = Array.from(mainWindow.document.querySelectorAll('iframe'));
		let activeIframe: HTMLIFrameElement | null = null;
		let maxArea = 0;

		for (const iframe of iframes) {
			const rect = iframe.getBoundingClientRect();
			const area = rect.width * rect.height;
			if (rect.width > 50 && rect.height > 50 && iframe.style.visibility !== 'hidden' && iframe.style.display !== 'none') {
				const isEditor = iframe.closest('.part.editor') !== null;
				const weight = isEditor ? area * 2 : area;
				if (weight > maxArea) {
					maxArea = weight;
					activeIframe = iframe;
				}
			}
		}

		if (activeIframe) {
			const rect = activeIframe.getBoundingClientRect();
			const bounds = {
				x: Math.round(rect.left),
				y: Math.round(rect.top + 40), // 40px offset for the address bar
				width: Math.round(rect.width),
				height: Math.round(rect.height - 40)
			};
			const boundsStr = JSON.stringify(bounds);
			if (boundsStr !== lastBoundsStr) {
				lastBoundsStr = boundsStr;
				ipcRenderer.send('vscode:hypno-browser-command', { type: 'setBounds', bounds });
			}
		} else {
			if (lastBoundsStr !== 'hidden') {
				lastBoundsStr = 'hidden';
				ipcRenderer.send('vscode:hypno-browser-command', { type: 'hide' });
			}
		}
	}, 16);
}

function stopTracking() {
	if (trackingInterval) {
		mainWindow.clearInterval(trackingInterval);
		trackingInterval = null;
	}
	lastBoundsStr = '';
}

// Register internal commands to bridge Extension Host ↔ Main Process
CommandsRegistry.registerCommand('_hypno.showBrowser', (_accessor, args) => {
	ipcRenderer.send('vscode:hypno-browser-command', { type: 'show', ...args });
	startTracking();
});

CommandsRegistry.registerCommand('_hypno.hideBrowser', () => {
	ipcRenderer.send('vscode:hypno-browser-command', { type: 'hide' });
	stopTracking();
});

CommandsRegistry.registerCommand('_hypno.updateBrowserBounds', (_accessor, _bounds) => {
	// Let the polling loop take care of it
});

// Phase 2: Forward Webview Actions (go-back, load-url, etc.)
CommandsRegistry.registerCommand('_hypno.browserAction', (_accessor, action) => {
	ipcRenderer.send('vscode:hypno-browser-command', { type: 'action', action });
});

// Phase 3: Listen for element selection from the Main Process → forward to Extension Host Continues
ipcRenderer.on('vscode:hypno-forward-to-continue', (_event: unknown, data: any) => {
	CommandsRegistry.getCommand('hypno.browser.onElementSelected')?.handler(undefined as any, data);
});

// Phase 2: Listen for URL changes from the Main Process → forward to Extension Host Address Bar
ipcRenderer.on('vscode:hypno-browser-navigated', (_event: unknown, url: string) => {
	CommandsRegistry.getCommand('hypno.browser.onNavigate')?.handler(undefined as any, url);
});

// Phase 4: Listen for loading states
ipcRenderer.on('vscode:hypno-browser-loading-state', (_event: unknown, isLoading: boolean) => {
	CommandsRegistry.getCommand('hypno.browser.onLoadingState')?.handler(undefined as any, isLoading);
});

// Phase 4: Listen for inspect mode auto-disable
ipcRenderer.on('vscode:hypno-browser-inspect-disabled', () => {
	CommandsRegistry.getCommand('hypno.browser.onInspectDisabled')?.handler(undefined as any);
});
