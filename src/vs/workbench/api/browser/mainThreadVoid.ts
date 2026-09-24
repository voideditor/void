/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { MainContext, MainThreadWindowShape } from '../../api/common/extHost.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { Emitter } from '../../../base/common/event.js';
import { UriComponents } from '../../../base/common/uri.js';


interface IOpenUriOptions { }

@extHostNamedCustomer(MainContext.MainThreadWindow)
export class MainThreadVoid implements MainThreadWindowShape {
	private readonly _onModelsChanged = new Emitter<void>();
	public readonly onModelsChanged = this._onModelsChanged.event;

	constructor(
		context: IExtHostContext,
	) {
	}

	async $getInitialState(): Promise<{ isFocused: boolean; isActive: boolean }> {
		return { isFocused: true, isActive: true };
	}

	async $openUri(uri: UriComponents, uriString: string | undefined, options: IOpenUriOptions): Promise<boolean> {
		return true;
	}

	async $asExternalUri(uri: UriComponents, options: IOpenUriOptions): Promise<UriComponents> {
		return uri;
	}

	async $getOpenRouterModels(): Promise<{ [key: string]: any }> { return {}; }
	$updateOpenRouterModels(_models: { [key: string]: any }): void { /* no-op */ }

	dispose(): void {
		this._onModelsChanged.dispose();
	}
}
