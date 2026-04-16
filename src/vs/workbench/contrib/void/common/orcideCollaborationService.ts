/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Orcest AI. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';

const ORCIDE_SHARES_KEY = 'orcide.sharedResources'
const ORCIDE_TEAM_KEY = 'orcide.teamMembers'
const ORCIDE_INVITATIONS_KEY = 'orcide.invitations'

export type SharePermission = 'view' | 'edit' | 'admin';

export type SharedResource = {
	id: string;
	type: 'project' | 'repository' | 'workspace' | 'file' | 'snippet' | 'chat-thread' | 'model-config' | 'mcp-server';
	name: string;
	description?: string;
	ownerId: string;
	ownerEmail: string;
	sharedWith: SharedUser[];
	createdAt: number;
	updatedAt: number;
	resourceUri?: string;
	metadata?: Record<string, unknown>;
}

export type SharedUser = {
	userId: string;
	email: string;
	name: string;
	permission: SharePermission;
	addedAt: number;
	addedBy: string;
}

export type TeamMember = {
	userId: string;
	email: string;
	name: string;
	role: 'owner' | 'admin' | 'member' | 'viewer';
	joinedAt: number;
	lastActive: number;
	status: 'active' | 'invited' | 'suspended';
}

export type Invitation = {
	id: string;
	email: string;
	role: 'admin' | 'member' | 'viewer';
	invitedBy: string;
	invitedByEmail: string;
	createdAt: number;
	expiresAt: number;
	status: 'pending' | 'accepted' | 'declined' | 'expired';
	resourceId?: string;
	permission?: SharePermission;
}

export type CollaborationState = {
	sharedResources: SharedResource[];
	teamMembers: TeamMember[];
	pendingInvitations: Invitation[];
	isTeamOwner: boolean;
}

export interface IOrcideCollaborationService {
	readonly _serviceBrand: undefined;
	readonly state: CollaborationState;
	onDidChangeState: Event<void>;
	onDidShareResource: Event<SharedResource>;
	onDidReceiveInvitation: Event<Invitation>;

	// Resource sharing
	shareResource(resource: Omit<SharedResource, 'id' | 'createdAt' | 'updatedAt'>): Promise<SharedResource>;
	unshareResource(resourceId: string): Promise<void>;
	updateResourcePermission(resourceId: string, userId: string, permission: SharePermission): Promise<void>;
	removeUserFromResource(resourceId: string, userId: string): Promise<void>;
	getSharedResources(): SharedResource[];
	getResourcesSharedWithMe(myUserId: string): SharedResource[];
	getResourcesSharedByMe(myUserId: string): SharedResource[];

	// Team management
	inviteTeamMember(email: string, role: TeamMember['role']): Promise<Invitation>;
	removeTeamMember(userId: string): Promise<void>;
	updateTeamMemberRole(userId: string, role: TeamMember['role']): Promise<void>;
	getTeamMembers(): TeamMember[];

	// Invitations
	acceptInvitation(invitationId: string): Promise<void>;
	declineInvitation(invitationId: string): Promise<void>;
	getPendingInvitations(): Invitation[];
	revokeInvitation(invitationId: string): Promise<void>;

	// Workspace sharing
	shareWorkspace(workspaceName: string, userIds: string[], permission: SharePermission): Promise<SharedResource>;
	shareChatThread(threadId: string, threadName: string, userIds: string[]): Promise<SharedResource>;
	shareModelConfig(configName: string, providerSettings: Record<string, unknown>, userIds: string[]): Promise<SharedResource>;
}

export const IOrcideCollaborationService = createDecorator<IOrcideCollaborationService>('orcideCollaborationService');


class OrcideCollaborationService extends Disposable implements IOrcideCollaborationService {
	readonly _serviceBrand: undefined;

	private _state: CollaborationState;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onDidShareResource = this._register(new Emitter<SharedResource>());
	readonly onDidShareResource: Event<SharedResource> = this._onDidShareResource.event;

	private readonly _onDidReceiveInvitation = this._register(new Emitter<Invitation>());
	readonly onDidReceiveInvitation: Event<Invitation> = this._onDidReceiveInvitation.event;

	get state(): CollaborationState {
		return this._state;
	}

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._state = {
			sharedResources: [],
			teamMembers: [],
			pendingInvitations: [],
			isTeamOwner: false,
		};
		this._loadFromStorage();
	}

	private _loadFromStorage(): void {
		const sharesStr = this.storageService.get(ORCIDE_SHARES_KEY, StorageScope.APPLICATION);
		if (sharesStr) {
			try { this._state.sharedResources = JSON.parse(sharesStr); } catch { /* ignore */ }
		}

		const teamStr = this.storageService.get(ORCIDE_TEAM_KEY, StorageScope.APPLICATION);
		if (teamStr) {
			try { this._state.teamMembers = JSON.parse(teamStr); } catch { /* ignore */ }
		}

		const invitesStr = this.storageService.get(ORCIDE_INVITATIONS_KEY, StorageScope.APPLICATION);
		if (invitesStr) {
			try { this._state.pendingInvitations = JSON.parse(invitesStr); } catch { /* ignore */ }
		}

		this._onDidChangeState.fire();
	}

	private _saveSharedResources(): void {
		this.storageService.store(ORCIDE_SHARES_KEY, JSON.stringify(this._state.sharedResources), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private _saveTeamMembers(): void {
		this.storageService.store(ORCIDE_TEAM_KEY, JSON.stringify(this._state.teamMembers), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private _saveInvitations(): void {
		this.storageService.store(ORCIDE_INVITATIONS_KEY, JSON.stringify(this._state.pendingInvitations), StorageScope.APPLICATION, StorageTarget.USER);
	}

	// Resource Sharing

	async shareResource(resource: Omit<SharedResource, 'id' | 'createdAt' | 'updatedAt'>): Promise<SharedResource> {
		const now = Date.now();
		const newResource: SharedResource = {
			...resource,
			id: generateUuid(),
			createdAt: now,
			updatedAt: now,
		};
		this._state = {
			...this._state,
			sharedResources: [...this._state.sharedResources, newResource],
		};
		this._saveSharedResources();
		this._onDidShareResource.fire(newResource);
		this._onDidChangeState.fire();
		return newResource;
	}

	async unshareResource(resourceId: string): Promise<void> {
		this._state = {
			...this._state,
			sharedResources: this._state.sharedResources.filter(r => r.id !== resourceId),
		};
		this._saveSharedResources();
		this._onDidChangeState.fire();
	}

	async updateResourcePermission(resourceId: string, userId: string, permission: SharePermission): Promise<void> {
		const resources = this._state.sharedResources.map(r => {
			if (r.id !== resourceId) return r;
			return {
				...r,
				updatedAt: Date.now(),
				sharedWith: r.sharedWith.map(u =>
					u.userId === userId ? { ...u, permission } : u
				),
			};
		});
		this._state = { ...this._state, sharedResources: resources };
		this._saveSharedResources();
		this._onDidChangeState.fire();
	}

	async removeUserFromResource(resourceId: string, userId: string): Promise<void> {
		const resources = this._state.sharedResources.map(r => {
			if (r.id !== resourceId) return r;
			return {
				...r,
				updatedAt: Date.now(),
				sharedWith: r.sharedWith.filter(u => u.userId !== userId),
			};
		});
		this._state = { ...this._state, sharedResources: resources };
		this._saveSharedResources();
		this._onDidChangeState.fire();
	}

	getSharedResources(): SharedResource[] {
		return this._state.sharedResources;
	}

	getResourcesSharedWithMe(myUserId: string): SharedResource[] {
		return this._state.sharedResources.filter(r =>
			r.ownerId !== myUserId && r.sharedWith.some(u => u.userId === myUserId)
		);
	}

	getResourcesSharedByMe(myUserId: string): SharedResource[] {
		return this._state.sharedResources.filter(r =>
			r.ownerId === myUserId && r.sharedWith.length > 0
		);
	}

	// Team Management

	async inviteTeamMember(email: string, role: TeamMember['role']): Promise<Invitation> {
		const now = Date.now();
		const invitation: Invitation = {
			id: generateUuid(),
			email,
			role: role === 'owner' ? 'admin' : role as 'admin' | 'member' | 'viewer',
			invitedBy: '', // populated by caller
			invitedByEmail: '',
			createdAt: now,
			expiresAt: now + (7 * 24 * 60 * 60 * 1000), // 7 days
			status: 'pending',
		};
		this._state = {
			...this._state,
			pendingInvitations: [...this._state.pendingInvitations, invitation],
		};
		this._saveInvitations();
		this._onDidReceiveInvitation.fire(invitation);
		this._onDidChangeState.fire();
		return invitation;
	}

	async removeTeamMember(userId: string): Promise<void> {
		this._state = {
			...this._state,
			teamMembers: this._state.teamMembers.filter(m => m.userId !== userId),
		};
		this._saveTeamMembers();
		this._onDidChangeState.fire();
	}

	async updateTeamMemberRole(userId: string, role: TeamMember['role']): Promise<void> {
		const members = this._state.teamMembers.map(m =>
			m.userId === userId ? { ...m, role } : m
		);
		this._state = { ...this._state, teamMembers: members };
		this._saveTeamMembers();
		this._onDidChangeState.fire();
	}

	getTeamMembers(): TeamMember[] {
		return this._state.teamMembers;
	}

	// Invitations

	async acceptInvitation(invitationId: string): Promise<void> {
		this._state = {
			...this._state,
			pendingInvitations: this._state.pendingInvitations.map(inv =>
				inv.id === invitationId ? { ...inv, status: 'accepted' as const } : inv
			),
		};
		this._saveInvitations();
		this._onDidChangeState.fire();
	}

	async declineInvitation(invitationId: string): Promise<void> {
		this._state = {
			...this._state,
			pendingInvitations: this._state.pendingInvitations.map(inv =>
				inv.id === invitationId ? { ...inv, status: 'declined' as const } : inv
			),
		};
		this._saveInvitations();
		this._onDidChangeState.fire();
	}

	getPendingInvitations(): Invitation[] {
		const now = Date.now();
		return this._state.pendingInvitations.filter(inv =>
			inv.status === 'pending' && inv.expiresAt > now
		);
	}

	async revokeInvitation(invitationId: string): Promise<void> {
		this._state = {
			...this._state,
			pendingInvitations: this._state.pendingInvitations.filter(inv => inv.id !== invitationId),
		};
		this._saveInvitations();
		this._onDidChangeState.fire();
	}

	// Convenience methods for sharing specific resource types

	async shareWorkspace(workspaceName: string, userIds: string[], permission: SharePermission): Promise<SharedResource> {
		const sharedUsers: SharedUser[] = userIds.map(userId => ({
			userId,
			email: '',
			name: '',
			permission,
			addedAt: Date.now(),
			addedBy: '',
		}));
		return this.shareResource({
			type: 'workspace',
			name: workspaceName,
			ownerId: '',
			ownerEmail: '',
			sharedWith: sharedUsers,
		});
	}

	async shareChatThread(threadId: string, threadName: string, userIds: string[]): Promise<SharedResource> {
		const sharedUsers: SharedUser[] = userIds.map(userId => ({
			userId,
			email: '',
			name: '',
			permission: 'view' as SharePermission,
			addedAt: Date.now(),
			addedBy: '',
		}));
		return this.shareResource({
			type: 'chat-thread',
			name: threadName,
			ownerId: '',
			ownerEmail: '',
			sharedWith: sharedUsers,
			resourceUri: threadId,
		});
	}

	async shareModelConfig(configName: string, providerSettings: Record<string, unknown>, userIds: string[]): Promise<SharedResource> {
		const sharedUsers: SharedUser[] = userIds.map(userId => ({
			userId,
			email: '',
			name: '',
			permission: 'view' as SharePermission,
			addedAt: Date.now(),
			addedBy: '',
		}));
		return this.shareResource({
			type: 'model-config',
			name: configName,
			ownerId: '',
			ownerEmail: '',
			sharedWith: sharedUsers,
			metadata: providerSettings,
		});
	}
}

registerSingleton(IOrcideCollaborationService, OrcideCollaborationService, InstantiationType.Eager);
