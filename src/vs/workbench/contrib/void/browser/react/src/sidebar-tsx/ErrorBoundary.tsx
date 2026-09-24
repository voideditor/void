/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { WarningBox } from '../void-settings-tsx/WarningBox.js';

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
	onDismiss?: () => void;
}

interface State {
	hasError: boolean;
	error: Error | null;
	errorInfo: ErrorInfo | null;
}

const serializeError = (err: unknown): string => {
	if (err === null || err === undefined) return String(err);
	if (typeof err !== 'object') return String(err);

	const anyErr = err as any;
	const ctor = anyErr?.constructor?.name ?? 'unknown';
	const message = typeof anyErr?.message === 'string' ? anyErr.message : '';
	const stack = typeof anyErr?.stack === 'string' ? anyErr.stack : '';

	let props = '';
	try {
		const keys = Object.keys(anyErr);
		if (keys.length > 0) {
			props = '\nProperties: ' + keys.map(k => `${k}=${JSON.stringify(anyErr[k])}`).join(', ');
		}
	} catch { /* ignore */ }

	return `[${ctor}] ${message}${props}${stack ? '\n--- Stack ---\n' + stack : ''}`;
};

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = {
			hasError: false,
			error: null,
			errorInfo: null
		};
	}

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { hasError: true, error };
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error('[ErrorBoundary] render error caught:');
		console.error('  Error (serialized):', serializeError(error));
		console.error('  Error (raw):', error);
		console.error('  Component stack:', errorInfo?.componentStack ?? '(none)');

		try {
			this.setState({ error, errorInfo });
		} catch { /* ignore - setState during unmount is harmless */ }
	}

	override render(): ReactNode {
		if (this.state.hasError && this.state.error) {
			if (this.props.fallback) {
				return this.props.fallback;
			}
			const msg = `${serializeError(this.state.error)}\n${this.state.errorInfo?.componentStack ?? ''}`;
			return <WarningBox text={msg} />;
		}
		return this.props.children;
	}
}

export default ErrorBoundary;
