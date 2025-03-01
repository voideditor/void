/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { errorDetails } from '../../../../../../../workbench/contrib/void/common/llmMessageTypes.js';
import { useSettingsState } from '../util/services.js';


export const ErrorDisplay = ({
  message: message_,
  fullError,
  onDismiss,
  showDismiss





}: {message: string;fullError: Error | null;onDismiss: (() => void) | null;showDismiss?: boolean;}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const details = errorDetails(fullError);
  const isExpandable = !!details;

  const message = message_ + '';

  return (
    <div className={`void-rounded-lg void-border void-border-red-200 void-bg-red-50 void-p-4 void-overflow-auto`}>
			{/* Header */}
			<div className="void-flex void-items-start void-justify-between">
				<div className="void-flex void-gap-3">
					<AlertCircle className="void-h-5 void-w-5 void-text-red-600 void-mt-0.5" />
					<div className="void-flex-1">
						<h3 className="void-font-semibold void-text-red-800">
							{/* eg Error */}
							Error
						</h3>
						<p className="void-text-red-700 void-mt-1">
							{/* eg Something went wrong */}
							{message}
						</p>
					</div>
				</div>

				<div className="void-flex void-gap-2">
					{isExpandable &&
          <button className="void-text-red-600 hover:void-text-red-800 void-p-1 void-rounded"
          onClick={() => setIsExpanded(!isExpanded)}>

							{isExpanded ?
            <ChevronUp className="void-h-5 void-w-5" /> :

            <ChevronDown className="void-h-5 void-w-5" />
            }
						</button>
          }
					{showDismiss && onDismiss &&
          <button className="void-text-red-600 hover:void-text-red-800 void-p-1 void-rounded"
          onClick={onDismiss}>

							<X className="void-h-5 void-w-5" />
						</button>
          }
				</div>
			</div>

			{/* Expandable Details */}
			{isExpanded && details &&
      <div className="void-mt-4 void-space-y-3 void-border-t void-border-red-200 void-pt-3 void-overflow-auto">
					<div>
						<span className="void-font-semibold void-text-red-800">Full Error: </span>
						<pre className="void-text-red-700">{details}</pre>
					</div>
				</div>
      }
		</div>);

};