import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';

import { getCmdKey } from '../../../getCmdKey.js';

const opaqueMessage = `\
Unfortunately, Void can't see the full error. However, you should be able to find more details by pressing ${getCmdKey()}+Shift+P, typing "Toggle Developer Tools", and looking at the console.\n
This error often means you have an incorrect API key. If you're self-hosting your own server, it might mean your CORS headers are off, and you should make sure your server's response has the header "Access-Control-Allow-Origins" set to "*", or at least allows "vscode-file://vscode-app".`

// Get detailed error information
const getErrorDetails = (error: unknown) => {

	let details: { message: string, name: string, stack: string | null, cause: string | null, code: string | null, additional: Record<string, any> };

	let e: Error & { [other: string]: undefined | any }



	// If fetch() fails, it gives an opaque message. We add extra details to the error.
	if ((error instanceof Error) && (error.cause + '').includes('TypeError: Failed to fetch')) {
		e = error as any
		e['Void Team'] = opaqueMessage
	}
	else if (error instanceof Error) {
		e = error
	}
	else {
		e = new Error(String(error))
	}

	const message = e.message && e.error ?
		(e.message + ':\n' + e.error)
		: e.message || e.error || JSON.stringify(error)

	details = {
		name: e.name || 'Error',
		message: message,
		stack: e.stack || null,
		cause: e.cause ? String(e.cause) : null,
		code: e.code || null,
		additional: {}
	}


	// Collect any additional properties from the e
	for (let prop of Object.getOwnPropertyNames(e).filter((prop) => !Object.keys(details).includes(prop)))
		details.additional[prop] = (e as any)[prop]

	return details;
};



export const ErrorDisplay = ({
	error,
	onDismiss = null,
	showDismiss = true,
	className = ''
}: {
	error: Error | string,
	onDismiss: (() => void) | null,
	showDismiss?: boolean,
	className?: string
}) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const details = getErrorDetails(error);
	const hasDetails = details.stack || details.cause || Object.keys(details.additional).length > 0;

	return (
		<div className={`rounded-lg border border-red-200 bg-red-50 p-4 ${className}`}>
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex gap-3">
					<AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
					<div className="flex-1">
						<h3 className="font-semibold text-red-800">
							{details.name}
						</h3>
						<p className="text-red-700 mt-1">
							{details.message}
						</p>
					</div>
				</div>

				<div className="flex gap-2">
					{hasDetails && (
						<button
							onClick={() => setIsExpanded(!isExpanded)}
							className="text-red-600 hover:text-red-800 p-1 rounded"
						>
							{isExpanded ? (
								<ChevronUp className="h-5 w-5" />
							) : (
								<ChevronDown className="h-5 w-5" />
							)}
						</button>
					)}
					{showDismiss && onDismiss && (
						<button
							onClick={onDismiss}
							className="text-red-600 hover:text-red-800 p-1 rounded"
						>
							<X className="h-5 w-5" />
						</button>
					)}
				</div>
			</div>

			{/* Expandable Details */}
			{isExpanded && hasDetails && (
				<div className="mt-4 space-y-3 border-t border-red-200 pt-3">
					{details.code && (
						<div>
							<span className="font-semibold text-red-800">Error Code: </span>
							<span className="text-red-700">{details.code}</span>
						</div>
					)}

					{details.cause && (
						<div>
							<span className="font-semibold text-red-800">Cause: </span>
							<span className="text-red-700">{details.cause}</span>
						</div>
					)}

					{Object.keys(details.additional).length > 0 && (
						<div>
							<span className="font-semibold text-red-800">Additional Information:</span>
							<pre className="mt-1 text-sm text-red-700 overflow-x-auto whitespace-pre-wrap">
								{Object.keys(details.additional).map(key => `${key}:\n${details.additional[key]}`).join('\n')}
							</pre>
						</div>
					)}

					{details.stack && (
						<div>
							<span className="font-semibold text-red-800">Stack Trace:</span>
							<pre className="mt-1 text-sm text-red-700 overflow-x-auto whitespace-pre-wrap">
								{details.stack}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
