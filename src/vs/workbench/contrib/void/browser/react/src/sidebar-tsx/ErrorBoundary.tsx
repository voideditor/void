/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorDisplay } from './ErrorDisplay.js';

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

class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = {
			hasError: false,
			error: null,
			errorInfo: null
		};
	}

	static getDerivedStateFromError(error: Error): Partial<State> {
		return {
			hasError: true,
			error
		};
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		this.setState({
			error,
			errorInfo
		});
	}

	render(): ReactNode {
		if (this.state.hasError && this.state.error) {
			// If a custom fallback is provided, use it
			if (this.props.fallback) {
				return this.props.fallback;
			}

			// Use ErrorDisplay component as the default error UI
			return (
				<ErrorDisplay
					message={this.state.error + ''}
					fullError={this.state.error}
					onDismiss={this.props.onDismiss || null}
				/>
			);
		}

		return this.props.children;
	}
}

export default ErrorBoundary;
