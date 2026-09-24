/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, isEqualOrParent } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFileService, FileOperation } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { parseAgentSkillMarkdown } from '../common/skills/agentSkillsParser.js';
import { formatAgentSkillActivationContent } from '../common/skills/agentSkillsPrompt.js';
import { IAgentSkillsService } from '../common/skills/agentSkillsService.js';
import {
	AgentSkillActivation,
	AgentSkillCatalog,
	AgentSkillDiagnostic,
	AgentSkillRecord,
	AgentSkillResource,
	AgentSkillResourceKind,
	AgentSkillScope,
	AgentSkillSource,
} from '../common/skills/agentSkillsTypes.js';

const SKILL_FILE_NAME = 'SKILL.md';
const RESOURCE_DIRS: AgentSkillResourceKind[] = ['scripts', 'references', 'assets'];
const MAX_RESOURCE_LISTING = 80;

type SkillRoot = {
	uri: URI;
	scope: AgentSkillScope;
	source: AgentSkillSource;
	priority: number;
};

export class AgentSkillsService extends Disposable implements IAgentSkillsService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeCatalog = new Emitter<void>();
	readonly onDidChangeCatalog = this._onDidChangeCatalog.event;

	private _catalog: AgentSkillCatalog | null = null;
	private _catalogPromise: Promise<AgentSkillCatalog> | null = null;
	private _lastDiagnostics: AgentSkillDiagnostic[] = [];
	private _knownRoots: URI[] = [];

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IPathService private readonly _pathService: IPathService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._settingsService.onDidChangeState(() => this._invalidate('settings')));
		this._register(this._workspaceTrustManagementService.onDidChangeTrust(() => this._invalidate('workspaceTrust')));
		this._register(this._fileService.onDidFilesChange(e => {
			for (const root of this._knownRoots) {
				if (e.contains(root)) {
					this._invalidate('filesChange');
					return;
				}
			}
		}));
		this._register(this._fileService.onDidRunOperation(e => {
			if (!this._isRelevantOperation(e.operation)) return;
			const uris = [e.resource, e.target].filter((uri): uri is URI => !!uri);
			for (const uri of uris) {
				if (this._isKnownSkillsPath(uri)) {
					this._invalidate(`fileOperation:${e.operation}`);
					return;
				}
			}
		}));
	}

	getDiagnostics(): AgentSkillDiagnostic[] {
		return [...this._lastDiagnostics];
	}

	async getCatalog(opts?: { forceRefresh?: boolean }): Promise<AgentSkillCatalog> {
		if (!opts?.forceRefresh && this._catalog) return this._catalog;
		if (!opts?.forceRefresh && this._catalogPromise) return this._catalogPromise;

		this._catalogPromise = this._computeCatalog()
			.then(catalog => {
				this._catalog = catalog;
				this._lastDiagnostics = catalog.diagnostics;
				this._logDiagnostics(catalog.diagnostics);
				return catalog;
			})
			.finally(() => {
				this._catalogPromise = null;
			});

		return this._catalogPromise;
	}

	async activateSkill(name: string): Promise<AgentSkillActivation> {
		const catalog = await this.getCatalog();
		const normalizedName = String(name ?? '').trim();
		const record = catalog.skills.find(skill => skill.name === normalizedName);
		if (!record) {
			throw new Error(`Skill "${normalizedName}" is unavailable. It may be missing, disabled, invalid, or blocked by workspace trust.`);
		}

		const content = await this._fileService.readFile(record.skillFileUri);
		const parsed = parseAgentSkillMarkdown(content.value.toString(), {
			uri: record.skillFileUri,
			expectedDirectoryName: basename(record.skillDirUri),
		});
		const blockingError = parsed.diagnostics.find(d => d.severity === 'error' && (d.code === 'missing_name' || d.code === 'missing_description' || d.code === 'missing_frontmatter' || d.code === 'unterminated_frontmatter'));
		if (blockingError) {
			throw new Error(`Skill "${normalizedName}" is unavailable: ${blockingError.message}`);
		}

		const resourceResult = await this._listResources(record.skillDirUri);
		const diagnostics = [...parsed.diagnostics, ...resourceResult.diagnostics];
		const contentForModel = formatAgentSkillActivationContent({
			name: record.name,
			body: parsed.body,
			skillFileUri: record.skillFileUri.toString(),
			skillDirUri: record.skillDirUri.toString(),
			resources: resourceResult.resources,
			diagnostics,
		});

		return {
			name: record.name,
			body: parsed.body,
			skillFileUri: record.skillFileUri,
			skillDirUri: record.skillDirUri,
			resources: resourceResult.resources,
			diagnostics,
			contentForModel,
		};
	}

	async resolveExplicitMentions(text: string, catalog?: AgentSkillCatalog): Promise<{
		resolved: { raw: string; name: string; record: AgentSkillRecord }[];
		diagnostics: AgentSkillDiagnostic[];
	}> {
		const effectiveCatalog = catalog ?? await this.getCatalog();
		const byName = new Map(effectiveCatalog.skills.map(skill => [skill.name, skill]));
		const resolved: { raw: string; name: string; record: AgentSkillRecord }[] = [];
		const diagnostics: AgentSkillDiagnostic[] = [];
		const seen = new Set<string>();

		for (const match of String(text ?? '').matchAll(/\$([A-Za-z0-9][A-Za-z0-9_-]*)\b/g)) {
			const raw = match[0];
			const name = match[1];
			if (seen.has(name)) continue;
			seen.add(name);
			const record = byName.get(name);
			if (!record) {
				diagnostics.push({
					severity: 'info',
					code: 'explicit_mention_unresolved',
					message: `Explicit skill mention "${raw}" did not match an available skill.`,
					name,
				});
				continue;
			}
			resolved.push({ raw, name, record });
		}

		if (diagnostics.length) {
			this._lastDiagnostics = [...this._lastDiagnostics, ...diagnostics];
			this._logDiagnostics(diagnostics);
		}

		return { resolved, diagnostics };
	}

	private async _computeCatalog(): Promise<AgentSkillCatalog> {
		const settings = this._settingsService.state.globalSettings;
		const diagnostics: AgentSkillDiagnostic[] = [];

		if (settings.enableAgentSkills === false) {
			const catalog = { skills: [], diagnostics, computedAt: new Date().toISOString() };
			return catalog;
		}

		const roots = await this._getSkillRoots(diagnostics);
		this._knownRoots = roots.map(root => root.uri);
		for (const root of this._knownRoots) {
			try {
				this._register(this._fileService.watch(root, { recursive: true, excludes: [] }));
			} catch {
				// Some file providers cannot watch missing directories. Discovery still works by explicit refresh.
			}
		}

		const disabled = new Set(
			(Array.isArray(settings.disabledAgentSkillNames) ? settings.disabledAgentSkillNames : [])
				.map(v => String(v ?? '').trim())
				.filter(Boolean)
		);

		const discovered: Array<{ root: SkillRoot; record: AgentSkillRecord }> = [];
		for (const root of roots) {
			const records = await this._scanRoot(root, diagnostics);
			for (const record of records) {
				if (disabled.has(record.name)) {
					diagnostics.push({
						severity: 'info',
						code: 'skill_disabled',
						message: `Skill "${record.name}" is disabled in Void settings.`,
						uri: record.skillFileUri,
						name: record.name,
					});
					continue;
				}
				discovered.push({ root, record });
			}
		}

		discovered.sort((a, b) =>
			a.root.priority - b.root.priority ||
			a.record.name.localeCompare(b.record.name) ||
			a.record.skillFileUri.toString().localeCompare(b.record.skillFileUri.toString())
		);

		const selected = new Map<string, AgentSkillRecord>();
		for (const entry of discovered) {
			const existing = selected.get(entry.record.name);
			if (!existing) {
				selected.set(entry.record.name, entry.record);
				continue;
			}

			diagnostics.push({
				severity: 'warning',
				code: 'skill_shadowed',
				message: `Skill "${entry.record.name}" from ${entry.record.skillFileUri.toString()} was shadowed by ${existing.skillFileUri.toString()}.`,
				uri: entry.record.skillFileUri,
				name: entry.record.name,
			});
		}

		return {
			skills: Array.from(selected.values()).sort((a, b) => a.name.localeCompare(b.name)),
			diagnostics,
			computedAt: new Date().toISOString(),
		};
	}

	private async _getSkillRoots(diagnostics: AgentSkillDiagnostic[]): Promise<SkillRoot[]> {
		const roots: SkillRoot[] = [];
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		const trusted = this._workspaceTrustManagementService.isWorkspaceTrusted();

		if (!trusted && workspaceFolders.length) {
			diagnostics.push({
				severity: 'warning',
				code: 'project_roots_untrusted',
				message: 'Project Agent Skill roots were skipped because the workspace is untrusted.',
			});
		}

		if (trusted) {
			for (const folder of workspaceFolders) {
				roots.push({ uri: URI.joinPath(folder.uri, '.void', 'skills'), scope: 'project', source: 'void', priority: 0 });
				roots.push({ uri: URI.joinPath(folder.uri, '.agents', 'skills'), scope: 'project', source: 'agents', priority: 1 });
			}
		}

		try {
			const userHome = await this._pathService.userHome();
			if (userHome) {
				roots.push({ uri: URI.joinPath(userHome, '.void', 'skills'), scope: 'user', source: 'void', priority: 2 });
				roots.push({ uri: URI.joinPath(userHome, '.agents', 'skills'), scope: 'user', source: 'agents', priority: 3 });
			}
		} catch {
			diagnostics.push({
				severity: 'warning',
				code: 'user_home_unavailable',
				message: 'User Agent Skill roots were skipped because Void could not resolve a local home directory.',
			});
		}

		return roots;
	}

	private async _scanRoot(root: SkillRoot, diagnostics: AgentSkillDiagnostic[]): Promise<AgentSkillRecord[]> {
		let stat: any;
		try {
			stat = await this._fileService.resolve(root.uri);
		} catch {
			return [];
		}

		const children = Array.isArray(stat.children) ? stat.children : [];
		const records: AgentSkillRecord[] = [];
		const sortedChildren = children
			.filter((child: any) => child?.isDirectory)
			.sort((a: any, b: any) => String(a.name ?? '').localeCompare(String(b.name ?? '')));

		for (const child of sortedChildren) {
			const skillDirUri = child.resource ?? child.uri ?? URI.joinPath(root.uri, String(child.name));
			const skillFileUri = URI.joinPath(skillDirUri, SKILL_FILE_NAME);
			let fileContent: VSBuffer;
			try {
				fileContent = (await this._fileService.readFile(skillFileUri)).value;
			} catch {
				continue;
			}

			const parsed = parseAgentSkillMarkdown(fileContent.toString(), {
				uri: skillFileUri,
				expectedDirectoryName: basename(skillDirUri),
			});
			diagnostics.push(...parsed.diagnostics);

			if (!parsed.frontmatter.name || !parsed.frontmatter.description || parsed.diagnostics.some(d => d.severity === 'error')) {
				diagnostics.push({
					severity: 'warning',
					code: 'skill_omitted',
					message: `Skill at ${skillFileUri.toString()} was omitted because required metadata could not be validated.`,
					uri: skillFileUri,
					name: parsed.frontmatter.name,
				});
				continue;
			}

			records.push({
				name: parsed.frontmatter.name,
				description: parsed.frontmatter.description,
				skillFileUri,
				skillDirUri,
				rootUri: root.uri,
				scope: root.scope,
				source: root.source,
				allowedTools: parsed.frontmatter.allowedTools,
				diagnostics: parsed.diagnostics,
			});
		}

		return records;
	}

	private async _listResources(skillDirUri: URI): Promise<{ resources: AgentSkillResource[]; diagnostics: AgentSkillDiagnostic[] }> {
		const resources: AgentSkillResource[] = [];
		const diagnostics: AgentSkillDiagnostic[] = [];
		let capped = false;

		const visit = async (kind: AgentSkillResourceKind, dir: URI, prefix: string): Promise<void> => {
			if (resources.length >= MAX_RESOURCE_LISTING) {
				capped = true;
				return;
			}

			let stat: any;
			try {
				stat = await this._fileService.resolve(dir);
			} catch {
				return;
			}

			const children = Array.isArray(stat.children) ? stat.children : [];
			const sorted = children.sort((a: any, b: any) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
			for (const child of sorted) {
				if (resources.length >= MAX_RESOURCE_LISTING) {
					capped = true;
					return;
				}
				const name = String(child.name ?? '');
				if (!name) continue;
				const uri = child.resource ?? child.uri ?? URI.joinPath(dir, name);
				const relativePath = prefix ? `${prefix}/${name}` : `${kind}/${name}`;
				const isDirectory = !!child.isDirectory;
				resources.push({ kind, relativePath, uri, isDirectory });
				if (isDirectory) {
					await visit(kind, uri, relativePath);
				}
			}
		};

		for (const kind of RESOURCE_DIRS) {
			await visit(kind, URI.joinPath(skillDirUri, kind), '');
		}

		if (capped) {
			diagnostics.push({
				severity: 'warning',
				code: 'resource_listing_capped',
				message: `Skill resource listing was capped at ${MAX_RESOURCE_LISTING} entries.`,
				uri: skillDirUri,
			});
		}

		return { resources, diagnostics };
	}

	private _invalidate(reason: string): void {
		this._catalog = null;
		this._catalogPromise = null;
		this._logService.debug(`[AgentSkillsService] invalidated catalog: ${reason}`);
		this._onDidChangeCatalog.fire();
	}

	private _isRelevantOperation(operation: FileOperation): boolean {
		return operation === FileOperation.WRITE ||
			operation === FileOperation.CREATE ||
			operation === FileOperation.MOVE ||
			operation === FileOperation.COPY ||
			operation === FileOperation.DELETE;
	}

	private _isKnownSkillsPath(uri: URI): boolean {
		for (const root of this._knownRoots) {
			if (isEqualOrParent(uri, root)) return true;
		}
		const s = uri.toString();
		return s.includes('/.void/skills/') || s.includes('/.agents/skills/');
	}

	private _logDiagnostics(diagnostics: AgentSkillDiagnostic[]): void {
		for (const diagnostic of diagnostics) {
			const msg = `[AgentSkillsService] ${diagnostic.code}: ${diagnostic.message}`;
			if (diagnostic.severity === 'error') this._logService.warn(msg);
			else if (diagnostic.severity === 'warning') this._logService.warn(msg);
			else this._logService.debug(msg);
		}
	}
}

registerSingleton(IAgentSkillsService, AgentSkillsService, InstantiationType.Delayed);
