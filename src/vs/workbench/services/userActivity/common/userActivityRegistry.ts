/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IDisposable, isDisposable } from '../../../../base/common/lifecycle.js';
import { IUserActivityService } from './userActivityService.js';

class UserActivityRegistry {
	private todo: { new(s: IUserActivityService, ...args: any[]): unknown }[] = [];

	public add = (ctor: { new(s: IUserActivityService, ...args: any[]): unknown }) => {
		this.todo.push(ctor);
	};

	public take(userActivityService: IUserActivityService, instantiation: IInstantiationService, register: (d: IDisposable) => void) {
		this.add = ctor => {
			const instance = instantiation.createInstance(ctor, userActivityService);
			if (isDisposable(instance)) {
				register(instance);
			}
		};
		this.todo.forEach(this.add);
		this.todo = [];
	}
}

export const userActivityRegistry = new UserActivityRegistry();
