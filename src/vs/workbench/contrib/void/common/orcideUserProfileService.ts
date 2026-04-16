/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Orcest AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';


const ORCIDE_USER_PROFILE_KEY = 'orcide.userProfile'
const ORCIDE_USER_PREFERENCES_KEY = 'orcide.userPreferences'
const ORCIDE_USER_REPOS_KEY = 'orcide.userRepositories'

export type OrcideUserProfile = {
	id: string;
	email: string;
	name: string;
	role: 'admin' | 'developer' | 'researcher' | 'viewer';
	avatar?: string;
	organization?: string;
	lastLogin: number;
	createdAt: number;
}

export type OrcideUserPreferences = {
	theme: string;
	language: string;
	fontSize: number;
	defaultModel: string | null;
	autoSave: boolean;
	showWelcome: boolean;
	sidebarPosition: 'left' | 'right';
	terminalFont: string;
	enableTelemetry: boolean;
	collaborationEnabled: boolean;
}

export type OrcideRepository = {
	id: string;
	name: string;
	url: string;
	isPrivate: boolean;
	createdAt: number;
	lastAccessed: number;
	sharedWith: string[]; // user IDs
	owner: string; // user ID
}

export type OrcideUserSession = {
	sessionId: string;
	userId: string;
	startedAt: number;
	lastActivity: number;
	deviceInfo: string;
	ipAddress?: string;
}

export type UserProfileState = {
	profile: OrcideUserProfile | null;
	preferences: OrcideUserPreferences;
	repositories: OrcideRepository[];
	activeSessions: OrcideUserSession[];
	isLoaded: boolean;
}

const defaultPreferences: OrcideUserPreferences = {
	theme: 'dark',
	language: 'en',
	fontSize: 14,
	defaultModel: 'rainymodel-pro',
	autoSave: true,
	showWelcome: true,
	sidebarPosition: 'right',
	terminalFont: 'monospace',
	enableTelemetry: true,
	collaborationEnabled: true,
}

export interface IOrcideUserProfileService {
	readonly _serviceBrand: undefined;
	readonly state: UserProfileState;
	onDidChangeState: Event<void>;
	onDidChangeProfile: Event<OrcideUserProfile>;

	setProfile(profile: OrcideUserProfile): Promise<void>;
	clearProfile(): Promise<void>;
	getProfile(): OrcideUserProfile | null;

	setPreference<K extends keyof OrcideUserPreferences>(key: K, value: OrcideUserPreferences[K]): Promise<void>;
	getPreferences(): OrcideUserPreferences;
	resetPreferences(): Promise<void>;

	addRepository(repo: OrcideRepository): Promise<void>;
	removeRepository(repoId: string): Promise<void>;
	getRepositories(): OrcideRepository[];
	shareRepository(repoId: string, userId: string): Promise<void>;
	unshareRepository(repoId: string, userId: string): Promise<void>;

	addSession(session: OrcideUserSession): void;
	removeSession(sessionId: string): void;
	getActiveSessions(): OrcideUserSession[];
}

export const IOrcideUserProfileService = createDecorator<IOrcideUserProfileService>('orcideUserProfileService');


class OrcideUserProfileService extends Disposable implements IOrcideUserProfileService {
	readonly _serviceBrand: undefined;

	private _state: UserProfileState;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onDidChangeProfile = this._register(new Emitter<OrcideUserProfile>());
	readonly onDidChangeProfile: Event<OrcideUserProfile> = this._onDidChangeProfile.event;

	get state(): UserProfileState {
		return this._state;
	}

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._state = {
			profile: null,
			preferences: { ...defaultPreferences },
			repositories: [],
			activeSessions: [],
			isLoaded: false,
		};
		this._loadFromStorage();
	}

	private _loadFromStorage(): void {
		// Load profile
		const profileStr = this.storageService.get(ORCIDE_USER_PROFILE_KEY, StorageScope.APPLICATION);
		if (profileStr) {
			try {
				this._state.profile = JSON.parse(profileStr);
			} catch { /* ignore parse errors */ }
		}

		// Load preferences
		const prefsStr = this.storageService.get(ORCIDE_USER_PREFERENCES_KEY, StorageScope.APPLICATION);
		if (prefsStr) {
			try {
				const stored = JSON.parse(prefsStr);
				this._state.preferences = { ...defaultPreferences, ...stored };
			} catch { /* ignore parse errors */ }
		}

		// Load repositories
		const reposStr = this.storageService.get(ORCIDE_USER_REPOS_KEY, StorageScope.APPLICATION);
		if (reposStr) {
			try {
				this._state.repositories = JSON.parse(reposStr);
			} catch { /* ignore parse errors */ }
		}

		this._state.isLoaded = true;
		this._onDidChangeState.fire();
	}

	private _saveProfile(): void {
		if (this._state.profile) {
			this.storageService.store(ORCIDE_USER_PROFILE_KEY, JSON.stringify(this._state.profile), StorageScope.APPLICATION, StorageTarget.USER);
		} else {
			this.storageService.remove(ORCIDE_USER_PROFILE_KEY, StorageScope.APPLICATION);
		}
	}

	private _savePreferences(): void {
		this.storageService.store(ORCIDE_USER_PREFERENCES_KEY, JSON.stringify(this._state.preferences), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private _saveRepositories(): void {
		this.storageService.store(ORCIDE_USER_REPOS_KEY, JSON.stringify(this._state.repositories), StorageScope.APPLICATION, StorageTarget.USER);
	}

	async setProfile(profile: OrcideUserProfile): Promise<void> {
		this._state = { ...this._state, profile };
		this._saveProfile();
		this._onDidChangeProfile.fire(profile);
		this._onDidChangeState.fire();
	}

	async clearProfile(): Promise<void> {
		this._state = {
			...this._state,
			profile: null,
			repositories: [],
			activeSessions: [],
		};
		this._saveProfile();
		this._saveRepositories();
		this._onDidChangeState.fire();
	}

	getProfile(): OrcideUserProfile | null {
		return this._state.profile;
	}

	async setPreference<K extends keyof OrcideUserPreferences>(key: K, value: OrcideUserPreferences[K]): Promise<void> {
		this._state = {
			...this._state,
			preferences: { ...this._state.preferences, [key]: value },
		};
		this._savePreferences();
		this._onDidChangeState.fire();
	}

	getPreferences(): OrcideUserPreferences {
		return this._state.preferences;
	}

	async resetPreferences(): Promise<void> {
		this._state = {
			...this._state,
			preferences: { ...defaultPreferences },
		};
		this._savePreferences();
		this._onDidChangeState.fire();
	}

	async addRepository(repo: OrcideRepository): Promise<void> {
		const existingIdx = this._state.repositories.findIndex(r => r.id === repo.id);
		const newRepos = [...this._state.repositories];
		if (existingIdx >= 0) {
			newRepos[existingIdx] = repo;
		} else {
			newRepos.push(repo);
		}
		this._state = { ...this._state, repositories: newRepos };
		this._saveRepositories();
		this._onDidChangeState.fire();
	}

	async removeRepository(repoId: string): Promise<void> {
		this._state = {
			...this._state,
			repositories: this._state.repositories.filter(r => r.id !== repoId),
		};
		this._saveRepositories();
		this._onDidChangeState.fire();
	}

	getRepositories(): OrcideRepository[] {
		return this._state.repositories;
	}

	async shareRepository(repoId: string, userId: string): Promise<void> {
		const repo = this._state.repositories.find(r => r.id === repoId);
		if (!repo) return;
		if (repo.sharedWith.includes(userId)) return;
		const updatedRepo: OrcideRepository = {
			...repo,
			sharedWith: [...repo.sharedWith, userId],
		};
		await this.addRepository(updatedRepo);
	}

	async unshareRepository(repoId: string, userId: string): Promise<void> {
		const repo = this._state.repositories.find(r => r.id === repoId);
		if (!repo) return;
		const updatedRepo: OrcideRepository = {
			...repo,
			sharedWith: repo.sharedWith.filter(id => id !== userId),
		};
		await this.addRepository(updatedRepo);
	}

	addSession(session: OrcideUserSession): void {
		const newSessions = [...this._state.activeSessions, session];
		this._state = { ...this._state, activeSessions: newSessions };
		this._onDidChangeState.fire();
	}

	removeSession(sessionId: string): void {
		this._state = {
			...this._state,
			activeSessions: this._state.activeSessions.filter(s => s.sessionId !== sessionId),
		};
		this._onDidChangeState.fire();
	}

	getActiveSessions(): OrcideUserSession[] {
		return this._state.activeSessions;
	}
}

registerSingleton(IOrcideUserProfileService, OrcideUserProfileService, InstantiationType.Eager);
