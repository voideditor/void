/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IDisposable {
	dispose(): void;
}

export interface Event<T> {
	(listener: (e: T) => any, thisArgs?: any, disposables?: IDisposable[]): IDisposable;
}

/**
 * Returns a promise that resolves when the event fires, or when cancellation
 * is requested, whichever happens first.
 */
export function toPromise<T>(event: Event<T>): Promise<T>;
export function toPromise<T>(event: Event<T>, signal: AbortSignal): Promise<T | undefined>;
export function toPromise<T>(event: Event<T>, signal?: AbortSignal): Promise<T | undefined> {
	if (!signal) {
		return new Promise<T>((resolve) => once(event, resolve));
	}

	if (signal.aborted) {
		return Promise.resolve(undefined);
	}

	return new Promise((resolve) => {
		const d2 = once(event, (data) => {
			(signal as any).removeEventListener('abort', d1);
			resolve(data);
		});

		const d1 = () => {
			d2.dispose();
			(signal as any).removeEventListener('abort', d1);
			resolve(undefined);
		};

		(signal as any).addEventListener('abort', d1);
	});
}

/**
 * Adds a handler that handles one event on the emitter, then disposes itself.
 */
export const once = <T>(event: Event<T>, listener: (data: T) => void): IDisposable => {
	const disposable = event((value) => {
		listener(value);
		disposable.dispose();
	});

	return disposable;
};

/**
 * Base event emitter. Calls listeners when data is emitted.
 */
export class EventEmitter<T> {
	private listeners?: Array<(data: T) => void> | ((data: T) => void);

	/**
	 * Event<T> function.
	 */
	public readonly event: Event<T> = (listener, thisArgs, disposables) => {
		const d = this.add(thisArgs ? listener.bind(thisArgs) : listener);
		disposables?.push(d);
		return d;
	};

	/**
	 * Gets the number of event listeners.
	 */
	public get size() {
		if (!this.listeners) {
			return 0;
		} else if (typeof this.listeners === 'function') {
			return 1;
		} else {
			return this.listeners.length;
		}
	}

	/**
	 * Emits event data.
	 */
	public fire(value: T) {
		if (!this.listeners) {
			// no-op
		} else if (typeof this.listeners === 'function') {
			this.listeners(value);
		} else {
			for (const listener of this.listeners) {
				listener(value);
			}
		}
	}

	/**
	 * Disposes of the emitter.
	 */
	public dispose() {
		this.listeners = undefined;
	}

	private add(listener: (data: T) => void): IDisposable {
		if (!this.listeners) {
			this.listeners = listener;
		} else if (typeof this.listeners === 'function') {
			this.listeners = [this.listeners, listener];
		} else {
			this.listeners.push(listener);
		}

		return { dispose: () => this.rm(listener) };
	}

	private rm(listener: (data: T) => void) {
		if (!this.listeners) {
			return;
		}

		if (typeof this.listeners === 'function') {
			if (this.listeners === listener) {
				this.listeners = undefined;
			}
			return;
		}

		const index = this.listeners.indexOf(listener);
		if (index === -1) {
			return;
		}

		if (this.listeners.length === 2) {
			this.listeners = index === 0 ? this.listeners[1] : this.listeners[0];
		} else {
			this.listeners = this.listeners.slice(0, index).concat(this.listeners.slice(index + 1));
		}
	}
}
