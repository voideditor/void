/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';


export const ErrorDisplay = ({
	message,
	fullError,
	onDismiss,
	showDismiss,
}: {
	message: string,
	fullError: Error | null,
	onDismiss: (() => void) | null,
	showDismiss?: boolean,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);

	let details: string | null = null;

	if (fullError === null) {
		details = null
	}
	else if (typeof fullError === 'object') {
		details = JSON.stringify(fullError, null, 2)
	}
	else if (typeof fullError === 'string') {
		details = null
	}


	return (
		<div className={`rounded-lg border border-red-200 bg-red-50 p-4 overflow-auto`}>
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex gap-3">
					<AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
					<div className="flex-1">
						<h3 className="font-semibold text-red-800">
							{/* eg Error */}
							Error
						</h3>
						<p className="text-red-700 mt-1">
							{/* eg Something went wrong */}
							{message}
						</p>
					</div>
				</div>

				<div className="flex gap-2">
					{details && (
						<button className="text-red-600 hover:text-red-800 p-1 rounded"
							onClick={() => setIsExpanded(!isExpanded)}
						>
							{isExpanded ? (
								<ChevronUp className="h-5 w-5" />
							) : (
								<ChevronDown className="h-5 w-5" />
							)}
						</button>
					)}
					{showDismiss && onDismiss && (
						<button className="text-red-600 hover:text-red-800 p-1 rounded"
							onClick={onDismiss}
						>
							<X className="h-5 w-5" />
						</button>
					)}
				</div>
			</div>

			{/* Expandable Details */}
			{isExpanded && details && (
				<div className="mt-4 space-y-3 border-t border-red-200 pt-3 overflow-auto">
					<div>
						<span className="font-semibold text-red-800">Full Error: </span>
						<pre className="text-red-700">{details}</pre>
					</div>
				</div>
			)}
		</div>
	);
};
