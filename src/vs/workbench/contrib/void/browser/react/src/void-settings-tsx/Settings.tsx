/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
	displayInfoOfFeatureName,
	defaultGlobalSettings
} from '../../../../../../../platform/void/common/voidSettingsTypes.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { VoidButtonBgDarken, VoidCustomDropdownBox, VoidInputBox2, VoidSimpleInputBox, VoidSwitch } from '../util/inputs.js';
import { useAccessor, useIsDark, useMCPServiceState, useSettingsState } from '../util/services.js';
import { X, ChevronRight } from 'lucide-react';
import { ModelDropdown } from './ModelDropdown.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { WarningBox } from './WarningBox.js';
import { os } from '../../../../../../../platform/void/common/helpers/systemInfo.js';
import { IconLoading } from '../sidebar-tsx/SidebarChatUI.js';
import { ToolApprovalType, toolApprovalTypes } from '../../../../../../../platform/void/common/toolsServiceTypes.js';
import Severity from '../../../../../../../base/common/severity.js';
import type { RequestParamsConfig, ParameterInjectionMode } from '../../../../../../../platform/void/common/sendLLMMessageTypes.js';
import { computeRequestParamsTemplate, filterSupportedParams } from '../../../../../../../platform/void/common/requestParams.js';
import { parseAcpProcessArgs } from '../../../../../../../platform/void/common/acpArgs.js';
import { TransferEditorType } from '../../../extensionTransferTypes.js';
import { MCPServer, removeMCPToolNamePrefix } from '../../../../../../../platform/void/common/mcpServiceTypes.js';
import { toolNames as staticToolNames } from '../../../../../../../platform/void/common/toolsRegistry.js';
import { ILanguageModelToolsService, IToolData } from '../../../../../chat/common/languageModelToolsService.js';
import '../../../../../../../platform/void/common/providerReg.js';

type Tab = 'models' | 'mcp' | 'allTools' | 'feature' | 'options' | 'general';

const cacheControlSnippet = `"supportCacheControl": true`;

const promptCachingDocsUrl = 'https://openrouter.ai/docs/guides/best-practices/prompt-caching';

const PromptCachingHelp: React.FC = () => {
	const [open, setOpen] = useState(false);
	// allow-any-unicode-next-line
	const expandedIcon = '▲';
	// allow-any-unicode-next-line
	const collapsedIcon = '▼';
	const onDocsHover = () => {
		try {
			if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
				navigator.clipboard.writeText(promptCachingDocsUrl).catch(() => { /* ignore */ });
			}
		} catch {
			// ignore
		}
	};
	return (
		<div className="mt-3 p-2 rounded border border-void-border-2 bg-void-bg-2/50 select-text">
			<button
				type="button"
				className="w-full flex items-center justify-between text-xs text-void-fg-3"
				onClick={() => setOpen(v => !v)}
			>
				<span>Prompt caching (cache_control)</span>
				<span className="ml-2 text-[10px]">{open ? expandedIcon : collapsedIcon}</span>
			</button>
			{open && (
				<div className="mt-1 space-y-1 text-xs text-void-fg-3">
					<p>
						This currently works 100% for all OpenRouter and Anthropic models. You can enable it (add field to JSON preset), but there's no guarantee it will work.
						{' '}
						<a
							href={promptCachingDocsUrl}
							className="underline"
							onMouseEnter={onDocsHover}
							target="_blank"
							rel="noreferrer"
						>
							OpenRouter prompt caching docs
						</a>.
					</p>
					<div className="inline-block px-2 py-1 rounded bg-void-bg-3 font-mono text-[11px]">
						{cacheControlSnippet}
					</div>
				</div>
			)}
		</div>
	);
};

const ReasoningHelp: React.FC<{ rc: any | null }> = ({ rc }) => {
	const [open, setOpen] = useState(false);
	// allow-any-unicode-next-line
	const expandedIcon = '▲';
	// allow-any-unicode-next-line
	const collapsedIcon = '▼';
	if (!rc) return null;

	const hasSlider = rc && typeof rc === 'object' && rc.reasoningSlider && typeof rc.reasoningSlider === 'object';
	const isBudget = hasSlider && rc.reasoningSlider.type === 'budget_slider';
	const isEffort = hasSlider && rc.reasoningSlider.type === 'effort_slider';
	const hasTags = Array.isArray(rc.openSourceThinkTags);

	return (
		<div className="mt-3 p-2 rounded border border-void-border-2 bg-void-bg-2/50 select-text">
			<button
				type="button"
				className="w-full flex items-center justify-between text-xs text-void-fg-3"
				onClick={() => setOpen(v => !v)}
			>
				<span>Reasoning capabilities (current, read-only)</span>
				<span className="ml-2 text-[10px]">{open ? expandedIcon : collapsedIcon}</span>
			</button>
			{open && (
				<ul className="mt-1 text-xs list-disc ml-4 space-y-1">
					<li>supportsReasoning: {String(!!rc.supportsReasoning)}</li>
					<li>canTurnOffReasoning: {String(!!rc.canTurnOffReasoning)}</li>
					<li>canIOReasoning: {String(!!rc.canIOReasoning)}</li>
					{typeof rc.hideEncryptedReasoning !== 'undefined' && (
						<li>hideEncryptedReasoning: {String(!!rc.hideEncryptedReasoning)}</li>
					)}
					{isBudget && (
						<li>
							Slider: budget_slider (min: {rc.reasoningSlider.min}, max: {rc.reasoningSlider.max}, default: {rc.reasoningSlider.default})
						</li>
					)}
					{isEffort && (
						<li>
							Slider: effort_slider (values: {Array.isArray(rc.reasoningSlider.values) ? rc.reasoningSlider.values.join(', ') : ''}, default: {rc.reasoningSlider.default})
						</li>
					)}
					{hasTags && (
						<li>Open-source think tags: {rc.openSourceThinkTags.join(' ')}</li>
					)}
					<li>
						Note: If you are not seeing reasoning content in chat, it may be encrypted by the provider.
						To verify this, temporarily add <code>"hideEncryptedReasoning": false</code> to <code>reasoningCapabilities</code>
						for this model override and check if a reasoning spoiler appears.
					</li>
				</ul>
			)}
		</div>
	);
};

export const AnimatedCheckmarkButton = ({ text, className }: { text?: string, className?: string }) => {
	const [dashOffset, setDashOffset] = useState(40);
	useEffect(() => {
		const startTime = performance.now();
		const duration = 500;
		const animate = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const newOffset = 40 - (progress * 40);
			setDashOffset(newOffset);
			if (progress < 1) {
				requestAnimationFrame(animate);
			}
		};
		const animationId = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animationId);
	}, []);

	return <div
		className={`flex items-center gap-1.5 w-fit
			${className ? className : `px-2 py-0.5 text-xs text-zinc-900 bg-zinc-100 rounded-sm`}
		`}
	>
		<svg className="size-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M5 13l4 4L19 7"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				style={{
					strokeDasharray: 40,
					strokeDashoffset: dashOffset
				}}
			/>
		</svg>
		{text}
	</div>
}

// ConfirmButton prompts for a second click to confirm an action, cancels if clicking outside
const ConfirmButton = ({ children, onConfirm, className }: { children: React.ReactNode, onConfirm: () => void, className?: string }) => {
	const [confirm, setConfirm] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!confirm) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setConfirm(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [confirm]);

	return (
		<div ref={ref} className="inline-block">
			<VoidButtonBgDarken className={className} onClick={() => {
				if (!confirm) {
					setConfirm(true);
				} else {
					onConfirm();
					setConfirm(false);
				}
			}}>
				{confirm ? `Confirm Reset` : children}
			</VoidButtonBgDarken>
		</div>
	);
};

export const DynamicProviderSettings = () => {
	const accessor = useAccessor();
	const registry = accessor.get('IDynamicProviderRegistryService') as any;
	const [providers, setProviders] = useState<any[]>([]);
	const [configured, setConfigured] = useState<string[]>([]);
	const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle');
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [form, setForm] = useState({
		slug: '',
		endpoint: '',
		apiKey: '',
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'disabled',
		additionalHeadersText: '{\n}'
	});

	const snapshot = useCallback(() => {
		try {
			const list = registry.getProviders() || [];
			if (!list.some((p: any) => String(p.slug).toLowerCase() === 'openrouter')) {
				list.unshift({ name: 'OpenRouter', slug: 'openrouter' });
			}
			setProviders(list);
			setConfigured(registry.getConfiguredProviderSlugs());
		} catch {
			// ignore
		}
	}, [registry]);

	useEffect(() => {
		let unsub: (() => void) | undefined;
		setStatus('loading');
		(async () => {
			await registry.initialize();
			if (registry.onDidChangeProviders) {
				const disposable = registry.onDidChangeProviders(() => {
					snapshot();
					setStatus('idle');
				});
				unsub = () => disposable.dispose?.();
			}
			await registry.refreshProviders(true);
			snapshot();
			setStatus('idle');
		})();
		return () => { unsub?.(); };
	}, [registry, snapshot]);

	const defaultHeadersForSlug = (slug: string) => {
		if (slug.toLowerCase() === 'openrouter') {
			return {
				'HTTP-Referer': 'https://github.com/voideditor/void',
				'X-Title': 'Void',
			};
		}
		return {};
	};

	const loadProviderToForm = useCallback((slug: string) => {
		const cur = registry.getUserProviderSettings(slug) || {};
		const defaultEndpoint =
			slug.toLowerCase() === 'openrouter'
				? 'https://openrouter.ai/api/v1'
				: (cur.endpoint || '');

		const mergedHeaders = {
			...defaultHeadersForSlug(slug),
			...(cur.additionalHeaders || {}),
		};

		setForm({
			slug,
			endpoint: defaultEndpoint,
			apiKey: cur.apiKey || '',
			apiStyle: cur.apiStyle || 'openai-compatible',
			supportsSystemMessage: cur.supportsSystemMessage ?? 'system-role',
			specialToolFormat: cur.specialToolFormat ?? 'disabled',
			additionalHeadersText: JSON.stringify(mergedHeaders, null, 2),
		});
		setErrorMsg(null);
		setStatus('idle');
	}, [registry]);

	const onSave = useCallback(async () => {
		if (!form.slug) {
			setErrorMsg('Slug cannot be empty');
			setStatus('error');
			return;
		}
		if (!form.endpoint || !form.endpoint.trim()) {
			setErrorMsg('Endpoint is required');
			setStatus('error');
			return;
		}
		try {
			new URL(form.endpoint.trim());
		} catch {
			setErrorMsg('Endpoint must be a valid URL');
			setStatus('error'); return;
		}

		setStatus('saving');
		setErrorMsg(null);
		let headers: Record<string, string> = {};
		try {
			const trimmed = form.additionalHeadersText.trim();
			headers = trimmed ? JSON.parse(trimmed) : {};
			if (headers && typeof headers !== 'object') throw new Error('Headers must be an object.');
		} catch {
			setStatus('error');
			setErrorMsg('Invalid JSON in Additional Headers');
			return;
		}

		try {
			await registry.setUserProviderSettings(form.slug, {
				endpoint: form.endpoint || undefined,
				apiKey: form.apiKey || undefined,
				apiStyle: form.apiStyle,
				supportsSystemMessage: form.supportsSystemMessage,
				specialToolFormat: form.specialToolFormat,
				auth: { header: 'Authorization', format: 'Bearer' },
				additionalHeaders: headers
			});
			setStatus('saved');
			setTimeout(() => setStatus('idle'), 1500);
			snapshot();
		} catch (e) {
			console.error('setUserProviderSettings error', e);
			setStatus('error');
			setErrorMsg('Failed to save provider settings');
		}
	}, [form, registry, snapshot]);

	const onDelete = useCallback(async () => {
		if (!form.slug) return;
		try {
			await registry.deleteUserProviderSettings(form.slug);
			setForm(f => ({ ...f, endpoint: '', apiKey: '', additionalHeadersText: '{\n}' }));
			setStatus('saved');
			setTimeout(() => setStatus('idle'), 1500);
			snapshot();
		} catch (e) {
			setStatus('error');
			setErrorMsg('Failed to delete provider settings');
		}
	}, [form.slug, registry, snapshot]);

	return (
		<div className="mt-8 w-full">
			<h3 className="text-xl mb-2">Custom Providers</h3>
			<div className="grid gap-4 md:grid-cols-2">
				<div>
					<div className="text-xs text-void-fg-1 mb-2">From OpenRouter:</div>
					<div className="border border-void-border-2 rounded p-2 max-h-48 overflow-auto">
						{providers.length === 0 && status !== 'loading' && (
							<div className="text-xs text-void-fg-4">No providers loaded</div>
						)}
						{providers.map((p: any) => (
							<div key={p.slug} className="flex items-center justify-between py-1">
								<span className="truncate" title={p.slug}>{p.name}</span>
								<button className="text-xs underline" onClick={() => loadProviderToForm(p.slug)}>Configure</button>
							</div>
						))}
					</div>
				</div>
				<div>
					<div className="text-xs text-void-fg-1 mb-2">Configured providers:</div>
					<div className="border border-void-border-2 rounded p-2 max-h-48 overflow-auto">
						{configured.length === 0 && <div className="text-xs text-void-fg-4">None</div>}
						{configured.map((slug: string) => (
							<div key={slug} className="flex items-center justify-between py-1">
								<span className="truncate">{slug}</span>
								<button className="text-xs underline" onClick={() => loadProviderToForm(slug)}>Edit</button>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="mt-4 grid gap-2 max-w-3xl w-full">
				<VoidSimpleInputBox
					value={form.slug}
					onChangeValue={(v) => setForm(f => ({ ...f, slug: v.trim() }))}
					placeholder="provider slug (e.g. openai)"
					compact
					data-tooltip-id="void-tooltip"
					data-tooltip-place="right"
					data-tooltip-content="Slug - prefix in modelId, e.g. openai in openai/gpt-4. Any (optionally from the list) can be used, but modelId must start with this slug."
				/>
				<VoidSimpleInputBox
					value={form.endpoint}
					onChangeValue={(v) => setForm(f => ({ ...f, endpoint: v }))}
					placeholder="Endpoint (required, e.g. https://openrouter.ai/api/v1)"
					compact
					data-tooltip-id="void-tooltip"
					data-tooltip-place="right"
					data-tooltip-content="Basic API URL. OpenAI-compatible - usually /v1; Anthropic - /v1 (but need anthropic-version header); Gemini - generativelanguage.googleapis.com/v1."
				/>
				<VoidSimpleInputBox
					value={form.apiKey}
					onChangeValue={(v) => setForm(f => ({ ...f, apiKey: v }))}
					placeholder="API Key (stored locally)"
					passwordBlur
					compact
				/>
				<div className="flex gap-2">
					<VoidCustomDropdownBox
						options={['openai-compatible', 'anthropic-style', 'gemini-style']}
						selectedOption={form.apiStyle}
						onChangeOption={(opt) => setForm(f => ({ ...f, apiStyle: opt as any }))}
						getOptionDisplayName={o => o}
						getOptionDropdownName={o => o}
						getOptionsEqual={(a, b) => a === b}
						className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
						data-tooltip-id="void-tooltip"
						data-tooltip-place="right"
						data-tooltip-content="API compatibility: OpenAI - most /v1; Anthropic - messages + anthropic-version; Gemini - generativelanguage.googleapis.com."
					/>
					<VoidCustomDropdownBox
						options={[false, 'system-role', 'developer-role', 'separated']}
						selectedOption={form.supportsSystemMessage}
						onChangeOption={(opt) => setForm(f => ({ ...f, supportsSystemMessage: opt as any }))}
						getOptionDisplayName={o => o === false ? 'false' : String(o)}
						getOptionDropdownName={o => o === false ? 'false' : String(o)}
						getOptionsEqual={(a, b) => a === b}
						className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
						data-tooltip-id="void-tooltip"
						data-tooltip-place="right"
						data-tooltip-content="system-role - OpenAI-compatible; developer-role - OpenAI (some models); separated - Anthropic/Gemini (system separately); false - disable system message."
					/>
					<VoidCustomDropdownBox
						options={['disabled', 'openai-style', 'anthropic-style', 'gemini-style']}
						selectedOption={form.specialToolFormat}
						onChangeOption={(opt) => setForm(f => ({ ...f, specialToolFormat: opt as any }))}
						getOptionDisplayName={o => o === 'disabled' ? 'tool: disabled' : o}
						getOptionDropdownName={o => o}
						getOptionsEqual={(a, b) => a === b}
						className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
						data-tooltip-id="void-tooltip"
						data-tooltip-place="right"
						data-tooltip-content="Special formatting for tools (if model doesn't support native tools)."
					/>
				</div>
				<div>
					<div className="text-xs text-void-fg-1 mb-1">Additional Headers (JSON)</div>
					<textarea
						className="w-full min-h-[120px] p-2 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-xs"
						value={form.additionalHeadersText}
						onChange={(e) => setForm(f => ({ ...f, additionalHeadersText: e.target.value }))}
						data-tooltip-id="void-tooltip"
						data-tooltip-place="right"
						data-tooltip-content="Additional headers (JSON), e.g. {'anthropic-version': '2023-06-01' }."
					/>
					{errorMsg && <div className="text-xs text-red-500 mt-1">{errorMsg}</div>}
				</div>
				<div className="flex gap-2 items-center">
					<VoidButtonBgDarken
						onClick={onSave}
						className="px-3 py-1 !bg-[var(--vscode-button-background)] !text-[var(--vscode-button-foreground)] hover:!bg-[var(--vscode-button-hoverBackground)]"
					>
						{status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : 'Save provider'}
					</VoidButtonBgDarken>
					<VoidButtonBgDarken
						onClick={onDelete}
						className="px-3 py-1 !bg-[var(--vscode-button-secondaryBackground)] !text-[var(--vscode-button-secondaryForeground)] hover:!bg-[var(--vscode-button-secondaryHoverBackground)]"
					>
						Delete
					</VoidButtonBgDarken>
					{status === 'loading' && <span className="text-xs text-void-fg-4">Loading providers…</span>}
				</div>
				<div className="text-xs text-void-fg-2">
					Save: saves the provider and enables its configuration in the API-resolver. Delete: removes the provider.
				</div>
			</div>
		</div>
	);
};

const DynamicModelSettingsDialog = ({
	isOpen,
	onClose,
	slug,
	modelId
}: {
	isOpen: boolean;
	onClose: () => void;
	slug: string | null;
	modelId: string | null;
}) => {
	// Excluded request params handled via filterSupportedParams/computeRequestParamsTemplate
	const accessor = useAccessor();
	const registry = accessor.get('IDynamicProviderRegistryService') as any;
	const [loading, setLoading] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [overrideEnabled, setOverrideEnabled] = useState(false);
	const [jsonText, setJsonText] = useState<string>('');
	const [placeholder, setPlaceholder] = useState<string>('{}');
	// request params injection state
	const [paramMode, setParamMode] = useState<ParameterInjectionMode>('default');
	const [paramJson, setParamJson] = useState<string>('{}');
	const [defaultParamsStr, setDefaultParamsStr] = useState<string>('{}');
	const [supportedParamsStr, setSupportedParamsStr] = useState<string>('');
	const [effectiveCaps, setEffectiveCaps] = useState<any | null>(null);
	// OpenRouter provider routing state
	const defaultRoutingJson = '{\n  "order": ["openai", "anthropic"],\n  "allow_fallbacks": true,\n  "sort": "throughput",\n  "max_price": { "prompt": 0.000005, "completion": 0.00002 }\n}';
	const [routingEnabled, setRoutingEnabled] = useState(false);
	const [routingJson, setRoutingJson] = useState<string>(defaultRoutingJson);

	type ReasoningPreset = 'budget' | 'effort' | 'thinking' | 'none';
	const [preset, setPreset] = useState<ReasoningPreset>('none');
	type ToolFormatPreset = 'inherit' | 'disabled' | 'openai-style' | 'anthropic-style' | 'gemini-style';
	const [toolFormatPreset, setToolFormatPreset] = useState<ToolFormatPreset>('inherit');
	type SystemMessagePreset = 'inherit' | 'false' | 'system-role' | 'developer-role' | 'separated';
	const [systemPreset, setSystemPreset] = useState<SystemMessagePreset>('inherit');


	const allowedKeys = [
		'contextWindow',
		'reservedOutputTokenSpace',
		'supportsSystemMessage',
		'specialToolFormat',
		'supportsFIM',
		'reasoningCapabilities',
		'supportCacheControl',
	] as const;

	const isOpenRouter = (slug ?? '').toLowerCase() === 'openrouter';

	const providerTitle = useMemo(() => {
		try {
			const ps = registry.getProviders() || [];
			const p = ps.find((x: any) => x.slug === slug);
			return p?.name || slug || '';
		} catch { return slug || ''; }
	}, [slug, registry]);


	const inferPresetFromRC = (rc: any): ReasoningPreset => {
		if (!rc || typeof rc !== 'object') return 'none';
		if (Array.isArray(rc.openSourceThinkTags)) return 'thinking';
		const rs = rc.reasoningSlider;
		if (rs && rs.type === 'budget_slider') return 'budget';
		if (rs && rs.type === 'effort_slider') return 'effort';
		return 'none';
	};

	const inferToolFormatPreset = (caps: any): ToolFormatPreset => {
		const v = caps?.specialToolFormat;
		if (v === 'disabled' || v === 'openai-style' || v === 'anthropic-style' || v === 'gemini-style') {
			return v;
		}
		return 'inherit';
	};

	const inferSystemPreset = (caps: any): SystemMessagePreset => {
		const v = caps?.supportsSystemMessage;
		if (v === false) return 'false';
		if (v === 'system-role' || v === 'developer-role' || v === 'separated') {
			return v;
		}
		return 'inherit';
	};

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			if (!isOpen || !slug || !modelId) return;
			setLoading(true);
			setErrorMsg(null);
			try {
				const caps = await registry.getEffectiveModelCapabilities(slug, modelId);
				if (cancelled) return;
				setEffectiveCaps(caps);


				const basePartial: any = {};
				for (const k of allowedKeys) {
					if (k in (caps || {})) {
						basePartial[k] = (caps as any)[k];
					}
				}
				const ph = JSON.stringify(basePartial, null, 2);
				setPlaceholder(ph);

				const ov = registry.getModelCapabilityOverride(slug, modelId);
				setOverrideEnabled(!!ov);
				setJsonText(ov ? JSON.stringify(ov, null, 2) : ph);

				// presets: prefer explicit overrides when present; fall back to effective caps
				const rcOverride = (ov as any)?.reasoningCapabilities ?? (caps as any)?.reasoningCapabilities;
				setPreset(inferPresetFromRC(rcOverride));
				setToolFormatPreset(inferToolFormatPreset(ov ?? {}));
				setSystemPreset(inferSystemPreset(ov ?? {}));

				// compute default request params to display
				try {
					// For display only, try to show provider defaults if any; otherwise leave empty
					setDefaultParamsStr('{}');
				} catch { /* ignore */ }

				// gather supported parameters (OpenRouter models); exclude tools/tool_choice/response_format
				let templateStr = '';
				try {
					const dyn = accessor.get('IDynamicModelService') as any;
					await dyn.initialize?.();
					const list: string[] = dyn.getSupportedParameters?.(modelId) || [];
					const defaults: Record<string, any> = dyn.getDefaultParameters?.(modelId) || {};
					const template = computeRequestParamsTemplate(list, defaults);
					const filtered = filterSupportedParams(list);
					templateStr = filtered.length ? JSON.stringify(template, null, 2) : '';
					setSupportedParamsStr(templateStr);
				} catch { /* ignore */ }

				// load per-model request param injection if present
				try {
					const cp = (accessor.get('IVoidSettingsService') as any).state.customProviders?.[slug] || {};
					const perModel: Record<string, any> = cp.perModel || {};
					const cfg = perModel[modelId];
					const rp = (cfg?.requestParams ?? {}) as RequestParamsConfig;
					if (rp && (rp.mode === 'default' || rp.mode === 'off' || rp.mode === 'override')) {
						setParamMode(rp.mode);
						setParamJson(rp.params ? JSON.stringify(rp.params, null, 2) : (templateStr || '{}'));
					} else {
						setParamMode('default');
						setParamJson(templateStr || '{}');
					}
					const pr = cfg?.providerRouting;
					if (pr && typeof pr === 'object') {
						setRoutingEnabled(true);
						setRoutingJson(JSON.stringify(pr, null, 2));
					} else {
						setRoutingEnabled(false);
						setRoutingJson(defaultRoutingJson);
					}
				} catch { /* ignore */ }

			} catch (e) {
				if (!cancelled) setErrorMsg('Failed to load model capabilities');
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		load();
		return () => { cancelled = true; };
	}, [isOpen, slug, modelId, registry]);

	// when user switches to override, prefill with supported parameters (fallback to default) if empty
	useEffect(() => {
		const trim = (s: string) => (s || '').trim();
		const isEmptyJson = (s: string) => {
			const t = trim(s);
			if (!t) return true;
			try { return JSON.stringify(JSON.parse(t)) === '{}'; } catch { return false; }
		};

		if (paramMode === 'override' && isEmptyJson(paramJson)) {
			setParamJson(supportedParamsStr || defaultParamsStr || '{}');
		}
	}, [paramMode, supportedParamsStr, defaultParamsStr]);


	const buildPresetRC = (kind: ReasoningPreset, base?: any) => {
		if (kind === 'thinking') {
			const tags = base?.openSourceThinkTags ?? ['<think>', '</think>'];
			return {
				supportsReasoning: true,
				canTurnOffReasoning: false,
				canIOReasoning: true,
				openSourceThinkTags: Array.isArray(tags) ? tags : ['<think>', '</think>']
			};
		}
		if (kind === 'budget') {

			const min = base?.reasoningSlider?.min ?? 1024;
			const max = base?.reasoningSlider?.max ?? 8192;
			const dfl = base?.reasoningSlider?.default ?? 1024;
			return {
				supportsReasoning: true,
				canTurnOffReasoning: false,
				canIOReasoning: true,
				reasoningSlider: {
					type: 'budget_slider',
					min,
					max,
					default: dfl
				}
			};
		}
		if (kind === 'effort') {
			const vals = base?.reasoningSlider?.values ?? ['low', 'medium', 'high'];
			const dfl = base?.reasoningSlider?.default ?? 'low';
			return {
				supportsReasoning: true,
				canTurnOffReasoning: true,
				canIOReasoning: true,
				reasoningSlider: {
					type: 'effort_slider',
					values: Array.isArray(vals) ? vals : ['low', 'medium', 'high'],
					default: dfl
				}
			};
		}
		return undefined;
	};


	const applyPreset = (kind: ReasoningPreset) => {
		if (!overrideEnabled) return;
		try {
			const obj = JSON.parse(jsonText || '{}');
			const baseRC = effectiveCaps?.reasoningCapabilities;
			const rc = buildPresetRC(kind, baseRC);
			if (rc) {
				obj.reasoningCapabilities = rc;
				setJsonText(JSON.stringify(obj, null, 2));
			}
		} catch {

			try {
				const obj = JSON.parse(placeholder || '{}');
				const baseRC = effectiveCaps?.reasoningCapabilities;
				const rc = buildPresetRC(kind, baseRC);
				if (rc) {
					obj.reasoningCapabilities = rc;
					setJsonText(JSON.stringify(obj, null, 2));
				}
			} catch {

			}
		}
	};

	const applySpecialToolPreset = (kind: ToolFormatPreset) => {
		if (!overrideEnabled) return;
		const applyToObj = (obj: any) => {
			if (kind === 'inherit') {
				delete obj.specialToolFormat;
			} else {
				obj.specialToolFormat = kind;
			}
		};
		try {
			const obj = JSON.parse(jsonText || '{}');
			applyToObj(obj);
			setJsonText(JSON.stringify(obj, null, 2));
		} catch {
			try {
				const obj = JSON.parse(placeholder || '{}');
				applyToObj(obj);
				setJsonText(JSON.stringify(obj, null, 2));
			} catch { /* ignore */ }
		}
	};

	const applySystemPreset = (kind: SystemMessagePreset) => {
		if (!overrideEnabled) return;
		const applyToObj = (obj: any) => {
			if (kind === 'inherit') {
				delete obj.supportsSystemMessage;
			} else if (kind === 'false') {
				obj.supportsSystemMessage = false;
			} else {
				obj.supportsSystemMessage = kind;
			}
		};
		try {
			const obj = JSON.parse(jsonText || '{}');
			applyToObj(obj);
			setJsonText(JSON.stringify(obj, null, 2));
		} catch {
			try {
				const obj = JSON.parse(placeholder || '{}');
				applyToObj(obj);
				setJsonText(JSON.stringify(obj, null, 2));
			} catch { /* ignore */ }
		}
	};

	const onSave = async () => {
		if (!slug || !modelId) return;
		if (!overrideEnabled) {
			await registry.setModelCapabilityOverride(slug, modelId, undefined);
			// save request params alongside
			try {
				const svc = accessor.get('IVoidSettingsService') as any;
				const cp = svc.state.customProviders?.[slug] || {};
				const perModel = { ...(cp.perModel || {}) };
				perModel[modelId] = { ...(perModel[modelId] || {}) };

				// In 'default' and 'off' modes, do not persist params
				if (paramMode === 'override') {
					let parsed: Record<string, any> | undefined;
					try { parsed = JSON.parse(paramJson || '{}'); } catch { parsed = undefined; }
					perModel[modelId].requestParams = parsed && Object.keys(parsed).length > 0
						? ({ mode: 'override', params: parsed } as RequestParamsConfig)
						: ({ mode: 'override' } as RequestParamsConfig);
				} else {
					perModel[modelId].requestParams = { mode: paramMode } as RequestParamsConfig;
				}

				// Provider routing: persist raw object when enabled, clear otherwise
				if (isOpenRouter) {
					if (routingEnabled) {
						try {
							const parsedRouting = JSON.parse(routingJson || '{}');
							if (parsedRouting && typeof parsedRouting === 'object' && Object.keys(parsedRouting).length > 0) {
								perModel[modelId].providerRouting = parsedRouting;
							} else {
								delete perModel[modelId].providerRouting;
							}
						} catch {
							setErrorMsg('Invalid JSON in Provider Routing');
							return;
						}
					} else if (perModel[modelId]) {
						delete perModel[modelId].providerRouting;
					}
				}
				await svc.setCustomProviderSettings(slug, { ...cp, perModel });
			} catch { /* ignore */ }
			onClose();
			return;
		}

		let parsed: any;
		try {
			parsed = JSON.parse(jsonText);
		} catch {
			setErrorMsg('Invalid JSON');
			return;
		}


		const cleaned: any = {};
		for (const k of allowedKeys) {
			if (k in parsed && parsed[k] !== null && parsed[k] !== undefined && parsed[k] !== '') {
				cleaned[k] = parsed[k];
			}
		}

		try {
			await registry.setModelCapabilityOverride(slug, modelId, cleaned);

			// also persist request params
			try {
				const svc = accessor.get('IVoidSettingsService') as any;
				const cp = svc.state.customProviders?.[slug] || {};
				const perModel = { ...(cp.perModel || {}) };
				perModel[modelId] = { ...(perModel[modelId] || {}) };

				let rp: RequestParamsConfig = { mode: paramMode };
				if (paramMode === 'override') {
					try {
						const parsed = JSON.parse(paramJson || '{}');
						rp = Object.keys(parsed || {}).length > 0 ? { mode: 'override', params: parsed } : { mode: 'override' };
					} catch {
						setErrorMsg('Invalid JSON in Request Params');
						return;
					}
				} else if (paramMode === 'default') {
					// Do not persist default params; renderer/main will not synthesize them
					rp = { mode: 'default' };
				}
				perModel[modelId].requestParams = rp;

				// Provider routing alongside overrides
				if (isOpenRouter) {
					if (routingEnabled) {
						try {
							const parsedRouting = JSON.parse(routingJson || '{}');
							if (parsedRouting && typeof parsedRouting === 'object' && Object.keys(parsedRouting).length > 0) {
								perModel[modelId].providerRouting = parsedRouting;
							} else {
								delete perModel[modelId].providerRouting;
							}
						} catch {
							setErrorMsg('Invalid JSON in Provider Routing');
							return;
						}
					} else {
						delete perModel[modelId].providerRouting;
					}
				}
				await svc.setCustomProviderSettings(slug, { ...cp, perModel });
			} catch { /* ignore */ }
			onClose();
		} catch {
			setErrorMsg('Failed to save overrides');
		}
	};

	if (!isOpen || !slug || !modelId) return null;

	return (
		<div
			className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999999]"
			onMouseDown={(e) => e.stopPropagation()}
		>
			<div
				className="bg-void-bg-1 rounded-md p-4 max-w-xl w-full shadow-xl overflow-y-auto max-h-[90vh] select-text"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex justify-between items-center mb-4">
					<h3 className="text-lg font-medium">
						Change Defaults for {modelId} ({providerTitle})
					</h3>
					<button onClick={onClose} className="text-void-fg-3 hover:text-void-fg-1">
						<X className="size-5" />
					</button>
				</div>
				<div className="text-sm text-void-fg-3 mb-4">
					{loading ? 'Loading…' : 'Override model defaults for this provider/model pair.'}
				</div>
				<div className="flex items-center gap-2 mb-2">
					<VoidSwitch size="xs" value={overrideEnabled} onChange={setOverrideEnabled} />
					<span className="text-void-fg-3 text-sm">Override model defaults</span>
				</div>

				{/* Request parameter injection (OpenRouter supported parameters) */}
				<div className="mt-3">
					<div className="text-xs text-void-fg-3 mb-1">Request parameters</div>
					<div className="flex items-center gap-2 text-xs">
						<VoidCustomDropdownBox
							options={['default', 'override'] as ParameterInjectionMode[]}
							selectedOption={paramMode}
							onChangeOption={(opt) => setParamMode(opt as ParameterInjectionMode)}
							getOptionDisplayName={(o) => o}
							getOptionDropdownName={(o) => o}
							getOptionsEqual={(a, b) => a === b}
							className="text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1"
						/>
					</div>
					{paramMode === 'default' && (
						<div className="text-xs text-void-fg-3 mt-2">Default mode: no parameters will be injected unless you switch to override.</div>
					)}
					{paramMode === 'override' && (
						<textarea
							className="w-full min-h-[120px] p-2 mt-2 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-xs"
							value={paramJson}
							onChange={(e) => setParamJson(e.target.value)}
							placeholder={supportedParamsStr || defaultParamsStr}
						/>
					)}
				</div>

				{isOpenRouter && (
					<div className="mt-3">
						<div className="flex items-center gap-2 mb-1">
							<div className="text-xs text-void-fg-3">Provider routing (OpenRouter)</div>
							<VoidSwitch
								size="xs"
								value={routingEnabled}
								onChange={setRoutingEnabled}
							/>
						</div>
						<div className="text-xs text-void-fg-3 mb-1">
							When enabled, Void will send this object as the <code>provider</code> field
							in OpenRouter requests (e.g. order, allow_fallbacks, sort, max_price). See
							{' '}
							https://openrouter.ai/docs/guides/routing/provider-selection for all options.
						</div>
						<textarea
							className={`w-full min-h-[120px] p-2 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-xs ${!routingEnabled ? 'text-void-fg-3' : ''}`}
							value={routingEnabled ? routingJson : routingJson || '{}'}
							onChange={routingEnabled ? (e) => setRoutingJson(e.target.value) : undefined}
							readOnly={!routingEnabled}
							placeholder={defaultRoutingJson}
						/>
					</div>
				)}

				{!loading && <ReasoningHelp rc={effectiveCaps?.reasoningCapabilities ?? null} />}
				{!loading && <PromptCachingHelp />}

				{/* Presets for reasoningCapabilities, specialToolFormat and supportsSystemMessage */}
				{overrideEnabled && (
					<div className="mt-3 space-y-3">
						<div>
							<div className="text-xs text-void-fg-3 mb-1">Use JSON preset for reasoningCapabilities</div>
							<div className="flex gap-1 flex-wrap">
								{(['budget', 'effort', 'thinking'] as ReasoningPreset[]).map((k) => (
									<button
										key={k}
										className={`text-xs px-2 py-1 rounded border ${preset === k ? 'border-[#0e70c0] text-white bg-[#0e70c0]' : 'border-void-border-2 hover:border-void-border-1'}`}
										onClick={() => {
											setPreset(k);
											applyPreset(k);
										}}
										title={
											k === 'budget' ? 'budget_slider: control token budget (min/max/default)'
												: k === 'effort' ? 'effort_slider: choose effort level (values/default)'
													: 'thinking-only: use open-source <think> tags'
										}
									>
										{k === 'budget' ? 'Budget' : k === 'effort' ? 'Effort' : 'Thinking'}
									</button>
								))}
								<button
									className={`text-xs px-2 py-1 rounded border ${preset === 'none' ? 'border-[#0e70c0] text-white bg-[#0e70c0]' : 'border-void-border-2 hover:border-void-border-1'}`}
									onClick={() => {
										// Off preset: set reasoningCapabilities=false in JSON override
										setPreset('none');
										if (!overrideEnabled) return;
										try {
											const obj = JSON.parse(jsonText || '{}');
											obj.reasoningCapabilities = false;
											setJsonText(JSON.stringify(obj, null, 2));
										} catch {
											try {
												const obj = JSON.parse(placeholder || '{}');
												obj.reasoningCapabilities = false;
												setJsonText(JSON.stringify(obj, null, 2));
											} catch { /* ignore */ }
										}
									}}
									title="Disable reasoning (reasoningCapabilities=false)"
								>
									Off
								</button>
							</div>
						</div>
						<div>
							<div className="text-xs text-void-fg-3 mb-1">Quick presets for tools (specialToolFormat)</div>
							<div className="flex gap-1 flex-wrap">
								{(['inherit', 'disabled', 'openai-style', 'anthropic-style', 'gemini-style'] as ToolFormatPreset[]).map((k) => (
									<button
										key={k}
										className={`text-xs px-2 py-1 rounded border ${toolFormatPreset === k ? 'border-[#0e70c0] text-white bg-[#0e70c0]' : 'border-void-border-2 hover:border-void-border-1'}`}
										onClick={() => {
											setToolFormatPreset(k);
											applySpecialToolPreset(k);
										}}
										title={
											k === 'inherit'
												? 'Use provider default (do not override specialToolFormat)'
												: `Set specialToolFormat="${k}"`
										}
									>
										{k === 'inherit' ? 'Inherit' : k}
									</button>
								))}
							</div>
						</div>
						<div>
							<div className="text-xs text-void-fg-3 mb-1">Quick presets for system message (supportsSystemMessage)</div>
							<div className="flex gap-1 flex-wrap">
								{(['inherit', 'false', 'system-role', 'developer-role', 'separated'] as SystemMessagePreset[]).map((k) => (
									<button
										key={k}
										className={`text-xs px-2 py-1 rounded border ${systemPreset === k ? 'border-[#0e70c0] text-white bg-[#0e70c0]' : 'border-void-border-2 hover:border-void-border-1'}`}
										onClick={() => {
											setSystemPreset(k);
											applySystemPreset(k);
										}}
										title={
											k === 'inherit'
												? 'Use provider default (do not override supportsSystemMessage)'
												: k === 'false'
													? 'Disable system message support (supportsSystemMessage=false)'
													: `Set supportsSystemMessage="${k}"`
										}
									>
										{k === 'inherit' ? 'Inherit' : k}
									</button>
								))}
							</div>
						</div>
					</div>
				)}

				<textarea
					className={`w-full min-h-[220px] p-2 mt-3 rounded-sm border border-void-border-2 bg-void-bg-2 resize-none font-mono text-sm ${!overrideEnabled ? 'text-void-fg-3' : ''}`}
					value={overrideEnabled ? jsonText : placeholder}
					placeholder={placeholder}
					onChange={overrideEnabled ? (e) => setJsonText(e.target.value) : undefined}
					readOnly={!overrideEnabled}
				/>

				{errorMsg && (
					<div className="text-red-500 mt-2 text-sm">{errorMsg}</div>
				)}

				<div className="flex justify-end gap-2 mt-4">
					<VoidButtonBgDarken onClick={onClose} className="px-3 py-1">
						Cancel
					</VoidButtonBgDarken>
					<VoidButtonBgDarken
						onClick={onSave}
						className="px-3 py-1 !bg-[var(--vscode-button-background)] !text-[var(--vscode-button-foreground)] hover:!bg-[var(--vscode-button-hoverBackground)]"
					>
						Save
					</VoidButtonBgDarken>
				</div>
			</div>
		</div>
	);
};

export const DynamicProviderModels = () => {
	const accessor = useAccessor();
	const registry = accessor.get('IDynamicProviderRegistryService') as any;
	const [configured, setConfigured] = useState<string[]>([]);
	const [providers, setProviders] = useState<any[]>([]);
	const [busySlug, setBusySlug] = useState<string | null>(null);
	const [manualAdd, setManualAdd] = useState<Record<string, string>>({});
	const [openModel, setOpenModel] = useState<{ slug: string; modelId: string } | null>(null);
	const [renameTarget, setRenameTarget] = useState<{ slug: string; oldName: string } | null>(null);
	const [renameValue, setRenameValue] = useState<string>('');
	const [showFreeOnly, setShowFreeOnly] = useState<Record<string, boolean>>({});
	const [modelsCollapsedBySlug, setModelsCollapsedBySlug] = useState<Record<string, boolean>>({});
	const [, force] = useState(0);
	// allow-any-unicode-next-line
	const removeModelIcon = '✕';

	const isOpenRouterSlug = (slug: string) => String(slug).toLowerCase() === 'openrouter';

	const toShortName = (id: string) => id;

	const isFreeVariant = (name: string) => name.endsWith(':free') || name.includes(':free');

	const snapshot = useCallback(() => {
		try {
			setConfigured(registry.getConfiguredProviderSlugs());
			setProviders(registry.getProviders());
			force(x => x + 1);
		} catch { }
	}, [registry]);

	useEffect(() => {
		let unsubA: any;
		let unsubB: any;
		(async () => {
			await registry.initialize();
			snapshot();
			if (registry.onDidChangeProviders) {
				const d = registry.onDidChangeProviders(() => snapshot());
				unsubA = () => d.dispose?.();
			}
			if (registry.onDidChangeProviderModels) {
				const d2 = registry.onDidChangeProviderModels(() => snapshot());
				unsubB = () => d2.dispose?.();
			}
		})();
		return () => { unsubA?.(); unsubB?.(); };
	}, [registry, snapshot]);

	const displayNameOf = (slug: string) => {
		const p = providers.find((x: any) => x.slug === slug);
		return p?.name || slug;
	};

	const rawModelsOf = (slug: string): string[] => {
		try { return registry.getProviderModels(slug) || []; } catch { return []; }
	};


	const visibleModelsOf = (slug: string): string[] => {
		const models = Array.from(new Set(rawModelsOf(slug)));
		const onlyFree = !!showFreeOnly[slug];
		if (onlyFree) return models.filter(isFreeVariant);
		return models;
	};

	const hasFreeModels = (slug: string): boolean => {
		const raw = rawModelsOf(slug);

		return raw.some(id => isFreeVariant(id));
	};

	const onRefresh = async (slug: string) => {
		setBusySlug(slug);
		try {
			await registry.refreshModelsForProvider(slug);
		} catch (e) {
			console.error('refreshModelsForProvider error', e);
		} finally {
			setBusySlug(null);
		}
	};

	const onAddModel = async (slug: string) => {
		let m = (manualAdd[slug] || '').trim();
		if (!m) return;

		const raw = rawModelsOf(slug);

		if (isOpenRouterSlug(slug)) {
			if (raw.includes(m)) {
				setManualAdd(s => ({ ...s, [slug]: '' }));
				return;
			}
			await registry.setProviderModels(slug, [...raw, m]);
		} else {
			if (isFreeVariant(m)) {
				setManualAdd(s => ({ ...s, [slug]: '' }));
				return;
			}
			if (raw.includes(m)) {
				setManualAdd(s => ({ ...s, [slug]: '' }));
				return;
			}
			await registry.setProviderModels(slug, [...raw, m]);
		}
		setManualAdd(s => ({ ...s, [slug]: '' }));
	};

	const onRemoveModel = async (slug: string, visibleName: string) => {
		const raw = rawModelsOf(slug);
		const next = raw.filter(x => x !== visibleName);
		await registry.setProviderModels(slug, next);
	};

	const openRename = (slug: string, visibleName: string) => {
		setRenameTarget({ slug, oldName: visibleName });
		setRenameValue(visibleName);
	};

	const commitRename = async () => {
		if (!renameTarget) return;
		const { slug, oldName } = renameTarget;
		const nv = renameValue.trim();

		if (!nv || nv === oldName) {
			setRenameTarget(null);
			return;
		}
		const raw = rawModelsOf(slug);
		if (raw.includes(nv)) {
			setRenameTarget(null);
			return;
		}

		const next = raw.map(x => (x === oldName ? nv : x));
		await registry.setProviderModels(slug, next);
		setRenameTarget(null);
	};

	const cancelRename = () => {
		setRenameTarget(null);
		setRenameValue('');
	};

	return (
		<div className="mt-6 select-text w-full">
			<h3 className="text-xl mb-2">Dynamic Provider Models</h3>
			{configured.length === 0 ? (
				<div className="text-xs text-void-fg-4">No configured providers yet. Save a provider above.</div>
			) : (
				<div className="flex flex-col gap-4">
					{configured.map(slug => {
						const models = visibleModelsOf(slug);
						const s = (() => {
							try { return registry.getUserProviderSettings(slug) || {}; } catch { return {}; }
						})();
						const hasFree = hasFreeModels(slug);
						const onlyFree = !!showFreeOnly[slug];
						const isCollapsed = !!modelsCollapsedBySlug[slug];

						return (
							<div key={slug} className="border border-void-border-2 rounded p-2 w-full flex flex-col gap-2">
								<div className="flex items-center justify-between">
									<div className="font-medium" title={slug}>{displayNameOf(slug)}</div>
									<div className="flex items-center gap-3">
										{hasFree && (
											<label className="flex items-center gap-1 text-xs">
												<input
													type="checkbox"
													checked={onlyFree}
													onChange={(e) => setShowFreeOnly(prev => ({ ...prev, [slug]: e.target.checked }))}
												/>
												Show only free
											</label>
										)}
										<VoidButtonBgDarken
											disabled={busySlug === slug}
											onClick={() => onRefresh(slug)}
											className="px-2 py-0.5"
											data-tooltip-id="void-tooltip"
											data-tooltip-place="left"
											data-tooltip-content={isOpenRouterSlug(slug)
												? 'Fetch models via DynamicModelService (OpenRouter aggregator)'
												: 'Fetch models via OpenRouter filtering or local endpoint'}
										>
											{busySlug === slug ? 'Refreshing…' : 'Refresh models'}
										</VoidButtonBgDarken>
									</div>
								</div>

								<div className="text-xs text-void-fg-2">
									API style: {s.apiStyle ?? 'openai-compatible'} · Endpoint: {s.endpoint || '(not set)'}
								</div>

								<div>
									<button
										type="button"
										className="flex items-center gap-1 text-xs text-void-fg-3 mb-1 cursor-pointer select-none hover:brightness-110"
										onClick={() => setModelsCollapsedBySlug(prev => ({ ...prev, [slug]: !isCollapsed }))}
									>
										<ChevronRight
											className={`h-3 w-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
										/>
										<span>
											Models{models.length ? ` (${models.length})` : ''}
										</span>
									</button>
									{!isCollapsed && (
										models.length === 0 ? (
											<div className="text-xs text-void-fg-4">
												{onlyFree ? 'No free models.' : 'No models yet. Click Refresh models or add manually below.'}
											</div>
										) : (
											<div className="flex flex-wrap gap-2">
												{models.map(visibleName => {
													const isRenaming = !!renameTarget && renameTarget.slug === slug && renameTarget.oldName === visibleName;
													if (isRenaming) {
														return (
															<div
																key={`${slug}::${visibleName}`}
																className="text-xs border border-void-border-2 rounded px-2 py-0.5 flex items-center gap-2"
																onContextMenu={(e) => { e.preventDefault(); openRename(slug, visibleName); }}
																title="Right-click to rename; click name to edit overrides"
															>
																<div className="flex items-center gap-1">
																	<input
																		className="text-xs bg-void-bg-1 border border-void-border-2 rounded px-1 py-0.5"
																		value={renameValue}
																		onChange={(e) => setRenameValue(e.target.value)}
																		onKeyDown={(e) => {
																			if (e.key === 'Enter') commitRename();
																			if (e.key === 'Escape') cancelRename();
																		}}
																		autoFocus
																	/>
																	<button className="text-void-fg-3 hover:text-void-fg-1" onClick={commitRename}>Save</button>
																	<button className="text-void-fg-4 hover:text-void-fg-2" onClick={cancelRename}>Cancel</button>
																</div>
															</div>
														);
													}
													return (
														<div
															key={`${slug}::${visibleName}`}
															className="text-xs border border-void-border-2 rounded px-2 py-0.5 flex items-center gap-2"
															onContextMenu={(e) => { e.preventDefault(); openRename(slug, visibleName); }}
															title="Right-click to rename; click name to edit overrides"
														>
															<button
																className="truncate hover:underline"
																onClick={() => setOpenModel({ slug, modelId: visibleName })}
															>
																{visibleName}
															</button>
															<button
																className="text-void-fg-4 hover:text-void-fg-2"
																onClick={() => onRemoveModel(slug, visibleName)}
																title="Remove model"
															>
																{removeModelIcon}
															</button>
														</div>
													);
												})}
											</div>
										))}
								</div>

								<div className="flex items-center gap-2">
									<VoidSimpleInputBox
										value={manualAdd[slug] || ''}
										onChangeValue={(v) => setManualAdd(s => ({ ...s, [slug]: v }))}
										placeholder={
											isOpenRouterSlug(slug)
												? 'Add model id (e.g. minimax/minimax-m2)'
												: 'Add model name (e.g. minimax-m2)'
										}
										compact
									/>
									<VoidButtonBgDarken onClick={() => onAddModel(slug)} className="px-2 py-0.5">Add</VoidButtonBgDarken>
								</div>

								<DynamicModelSettingsDialog
									isOpen={!!openModel && openModel.slug === slug}
									onClose={() => setOpenModel(null)}
									slug={openModel?.slug ?? null}
									modelId={openModel?.modelId ?? null}
								/>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};

export const AIInstructionsBox = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	return <VoidInputBox2
		className='w-full min-h-[81px] p-3 rounded-sm border border-void-border-2 bg-void-bg-1'
		initValue={voidSettingsState.globalSettings.aiInstructions}
		placeholder={`Insert your instruction here; this will add your instructions to the system prompt. To make them global, save your instructions in a .voidrules file at the workspace root.`}
		multiline
		onChangeText={(newText) => {
			voidSettingsService.setGlobalSetting('aiInstructions', newText)
		}}
	/>
}

const FastApplyMethodDropdown = () => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const options = useMemo(() => [true, false], [])
	const onChangeOption = useCallback((newVal: boolean) => {
		voidSettingsService.setGlobalSetting('enableFastApply', newVal)
	}, [voidSettingsService])
	return <VoidCustomDropdownBox
		className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
		options={options}
		selectedOption={voidSettingsService.state.globalSettings.enableFastApply}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownName={(val) => val ? 'Fast Apply' : 'Slow Apply'}
		getOptionDropdownDetail={(val) => val ? 'Output Search/Replace blocks' : 'Rewrite whole files'}
		getOptionsEqual={(a, b) => a === b}
	/>
}

const RedoOnboardingButton = ({ className }: { className?: string }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	return <div
		className={`text-void-fg-2 flex flex-nowrap text-nowrap items-center hover:brightness-110 cursor-pointer ${className}`}
		onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', false) }}
	>
		See onboarding screen?
	</div>
}

export const ToolApprovalTypeSwitch = ({ approvalType, size, desc, onApproveCurrent }: { approvalType: ToolApprovalType, size: "xxs" | "xs" | "sm" | "sm+" | "md", desc: string, onApproveCurrent?: () => void }) => {
	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	const metricsService = accessor.get('IMetricsService')

	const onToggleAutoApprove = useCallback((approvalType: ToolApprovalType, newValue: boolean) => {
		voidSettingsService.setGlobalSetting('autoApprove', {
			...voidSettingsService.state.globalSettings.autoApprove,
			[approvalType]: newValue
		})
		if (newValue && onApproveCurrent) {
			onApproveCurrent()
		}
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [voidSettingsService, metricsService, onApproveCurrent])

	return <>
		<VoidSwitch
			size={size}
			value={voidSettingsState.globalSettings.autoApprove[approvalType] ?? false}
			onChange={(newVal) => onToggleAutoApprove(approvalType, newVal)}
		/>
		<span className="text-void-fg-3 text-xs">{desc}</span>
	</>
}

export const OneClickSwitchButton = ({ fromEditor = 'VS Code', className = '' }: { fromEditor?: TransferEditorType, className?: string }) => {
	const accessor = useAccessor()
	const extensionTransferService = accessor.get('IExtensionTransferService')
	const [transferState, setTransferState] = useState<{ type: 'done', error?: string } | { type: | 'loading' | 'justfinished' }>({ type: 'done' })

	const onClick = async () => {
		if (transferState.type !== 'done') return
		setTransferState({ type: 'loading' })
		const errAcc = await extensionTransferService.transferExtensions(os, fromEditor)
		const hadError = !!errAcc

		if (hadError) {
			setTransferState({ type: 'done', error: errAcc })
		}
		else {
			setTransferState({ type: 'justfinished' })
			setTimeout(() => { setTransferState({ type: 'done' }); }, 3000)
		}
	}

	return <>
		<VoidButtonBgDarken className={`max-w-48 p-4 ${className}`} disabled={transferState.type !== 'done'} onClick={onClick}>
			{transferState.type === 'done' ? `Transfer from ${fromEditor}`
				: transferState.type === 'loading' ? <span className='text-nowrap flex flex-nowrap'>Transferring<IconLoading /></span>
					: transferState.type === 'justfinished' ? <AnimatedCheckmarkButton text='Settings Transferred' className='bg-none' />
						: null
			}
		</VoidButtonBgDarken>
		{transferState.type === 'done' && transferState.error ? <WarningBox text={transferState.error} /> : null}
	</>
}

const ArgumentsInput = ({ value, onChange }: { value: string; onChange: (args: string[]) => void }) => {
	const [inputValue, setInputValue] = useState(value);
	const debounceTimer = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		setInputValue(value);
	}, [value]);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value;
		setInputValue(newValue);

		if (debounceTimer.current) {
			clearTimeout(debounceTimer.current);
		}
		debounceTimer.current = setTimeout(() => {
			const args = parseAcpProcessArgs(newValue);
			onChange(args);
		}, 500);
	};

	useEffect(() => {
		return () => {
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current);
			}
		};
	}, []);

	return (
		<input
			className='text-xs text-void-fg-1 bg-void-bg-1 border border-void-border-1 rounded px-2 py-1'
			type='text'
			placeholder='e.g. --port 8080 --config "my config.json"'
			value={inputValue}
			onChange={handleChange}
		/>
	);
};

const EnvironmentInput = ({ value, onChange }: { value: Record<string, string>; onChange: (env: Record<string, string>) => void }) => {
	const [inputValue, setInputValue] = useState(JSON.stringify(value, null, 2));
	const debounceTimer = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		setInputValue(JSON.stringify(value, null, 2));
	}, [value]);

	const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = e.target.value;
		setInputValue(newValue);

		if (debounceTimer.current) {
			clearTimeout(debounceTimer.current);
		}
		debounceTimer.current = setTimeout(() => {
			try {
				const parsed = JSON.parse(newValue);
				onChange(parsed);
			} catch {
				// ignore invalid json while typing
			}
		}, 500);
	};

	useEffect(() => {
		return () => {
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current);
			}
		};
	}, []);

	return (
		<textarea
			className='text-xs text-void-fg-1 bg-void-bg-1 border border-void-border-1 rounded px-2 py-1 font-mono'
			rows={3}
			placeholder='{"MY_ENV": "value"}'
			value={inputValue}
			onChange={handleChange}
		/>
	);
};

type AllToolEntry = {
	name: string;
	displayName: string;
	description: string;
	sourceLabel: string;
};

const normalizedToolNameSet = (names?: readonly string[]): Set<string> => {
	if (!Array.isArray(names)) return new Set();
	return new Set(names.map(v => String(v ?? '').trim()).filter(Boolean));
};

const mcpSafePrefixFromSource = (source: IToolData['source'] | undefined): string => {
	if (!source || source.type !== 'mcp') return 'mcp';
	const rawId = source.definitionId || source.collectionId || 'mcp';
	const idParts = String(rawId).split('.');
	const serverName = idParts[idParts.length - 1] || rawId;
	const safePrefix = String(serverName).replace(/[^a-zA-Z0-9_]/g, '_');
	return safePrefix || 'mcp';
};

const collectSettingsJsonMCPTools = (accessor: ReturnType<typeof useAccessor>): AllToolEntry[] => {
	try {
		const instantiationService = accessor.get('IInstantiationService');
		const lmToolsService = instantiationService.invokeFunction(serviceAccessor => serviceAccessor.get(ILanguageModelToolsService));
		const tools = Array.from(lmToolsService.getTools());

		return tools
			.filter(toolData => toolData.source?.type === 'mcp')
			.map(toolData => {
				const baseName = toolData.toolReferenceName || toolData.displayName || toolData.id;
				const prefix = mcpSafePrefixFromSource(toolData.source);
				const fullName = `${prefix}__${baseName}`;
				const rawId = toolData.source?.type === 'mcp'
					? (toolData.source.definitionId || toolData.source.collectionId || 'mcp')
					: 'mcp';
				return {
					name: fullName,
					displayName: removeMCPToolNamePrefix(fullName),
					description: toolData.modelDescription || toolData.userDescription || '',
					sourceLabel: `settings.json MCP (${rawId})`,
				};
			});
	} catch {
		return [];
	}
};

// MCP UI
const MCPServerComponent = ({
	name,
	server,
	disabledToolNames,
	onToggleToolDisabled,
}: {
	name: string,
	server: MCPServer,
	disabledToolNames: Set<string>,
	onToggleToolDisabled: (toolName: string, disabled: boolean) => void,
}) => {
	const accessor = useAccessor();
	const mcpService = accessor.get('IMCPService');
	const voidSettings = useSettingsState()
	const isOn = voidSettings.mcpUserStateOfName?.[name]?.isOn

	return (
		<div className="border border-void-border-2 bg-void-bg-1 py-3 px-4 rounded-sm my-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className={`w-2 h-2 rounded-full
						${server.status === 'success' ? 'bg-green-500'
							: server.status === 'error' ? 'bg-red-500'
								: server.status === 'loading' ? 'bg-yellow-500'
									: server.status === 'offline' ? 'bg-void-fg-3'
										: ''}
					`}></div>
					<div className="text-sm font-medium text-void-fg-1">{name}</div>
				</div>
				<VoidSwitch
					value={isOn ?? false}
					size='xs'
					disabled={server.status === 'error'}
					onChange={() => mcpService.toggleServerIsOn(name, !isOn)}
				/>
			</div>
			{isOn && (
				<div className="mt-3">
					<div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
						{(server.tools ?? []).length > 0 ? (
							(server.tools ?? []).map((tool: { name: string; description?: string }) => (
								<div
									key={tool.name}
									className="flex items-center justify-between gap-2 px-2 py-1 bg-void-bg-2 rounded-sm"
								>
									<span
										className="text-xs text-void-fg-2 font-mono"
										data-tooltip-id='void-tooltip'
										data-tooltip-content={tool.description || ''}
										data-tooltip-class-name='void-max-w-[300px]'
									>
										{removeMCPToolNamePrefix(tool.name)}
									</span>
									<VoidSwitch
										size='xs'
										value={!disabledToolNames.has(tool.name)}
										onChange={(enabled) => onToggleToolDisabled(tool.name, !enabled)}
									/>
								</div>
							))
						) : (
							<span className="text-xs text-void-fg-3">No tools available</span>
						)}
					</div>
				</div>
			)}
			{isOn && server.command && (
				<div className="mt-3">
					<div className="text-xs text-void-fg-3 mb-1">Command:</div>
					<div className="px-2 py-1 bg-void-bg-2 text-xs font-mono overflow-x-auto whitespace-nowrap text-void-fg-2 rounded-sm">
						{server.command}
					</div>
				</div>
			)}
			{server.error && (
				<div className="mt-3">
					<WarningBox text={server.error} />
				</div>
			)}
		</div>
	);
};

const MCPServersList = ({
	disabledToolNames,
	onToggleToolDisabled,
}: {
	disabledToolNames: Set<string>,
	onToggleToolDisabled: (toolName: string, disabled: boolean) => void,
}) => {
	const mcpServiceState = useMCPServiceState()
	let content: React.ReactNode

	if (mcpServiceState.error) {
		content = <div className="text-void-fg-3 text-sm mt-2">
			{mcpServiceState.error}
		</div>
	}
	else {
		const entries = Object.entries(mcpServiceState.mcpServerOfName)
		if (entries.length === 0) {
			content = <div className="text-void-fg-3 text-sm mt-2">
				No servers found
			</div>
		}
		else {
			content = entries.map(([name, server]) => (
				<MCPServerComponent
					key={name}
					name={name}
					server={server}
					disabledToolNames={disabledToolNames}
					onToggleToolDisabled={onToggleToolDisabled}
				/>
			))
		}
	}
	return <div className="my-2">{content}</div>
};

// full settings
export const Settings = () => {
	const isDark = useIsDark()
	const accessor = useAccessor()
	// sidebar tabs
	const [selectedSection, setSelectedSection] = useState<Tab>('models')
	const navItems: { tab: Tab; label: string }[] = [
		{ tab: 'models', label: 'Models' },
		{ tab: 'mcp', label: 'MCP' },
		{ tab: 'allTools', label: 'All Tools' },
		{ tab: 'feature', label: 'Feature' },
		{ tab: 'options', label: 'Options' },
		{ tab: 'general', label: 'General' },
	]
	const shouldShowTab = (tab: Tab) => selectedSection === tab

	const commandService = accessor.get('ICommandService')
	const environmentService = accessor.get('IEnvironmentService')
	const nativeHostService = accessor.get('INativeHostService')
	const settingsState = useSettingsState()
	const mcpServiceState = useMCPServiceState()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const chatThreadsService = accessor.get('IChatThreadService')
	const notificationService = accessor.get('INotificationService')
	const mcpService = accessor.get('IMCPService')
	const [showAcpAdvanced, setShowAcpAdvanced] = useState(false)
	const [showLoopGuard, setShowLoopGuard] = useState(false)
	const [showAdvancedChat, setShowAdvancedChat] = useState(false)
	const [showStaticToolToggles, setShowStaticToolToggles] = useState(false)

	const disabledToolNames = useMemo(
		() => normalizedToolNameSet(settingsState.globalSettings.disabledToolNames),
		[settingsState.globalSettings.disabledToolNames]
	);

	const setToolDisabled = useCallback((toolName: string, disabled: boolean) => {
		void voidSettingsService.setToolDisabled(toolName, disabled);
	}, [voidSettingsService]);

	const allTools = useMemo<AllToolEntry[]>(() => {
		const byName = new Map<string, AllToolEntry>();

		for (const name of staticToolNames) {
			byName.set(name, {
				name,
				displayName: name,
				description: 'Built-in Void tool',
				sourceLabel: 'Void static tool',
			});
		}

		for (const [serverName, server] of Object.entries(mcpServiceState.mcpServerOfName)) {
			if (!server || server.status !== 'success' || !Array.isArray(server.tools)) continue;
			for (const tool of server.tools) {
				const toolName = String(tool.name ?? '').trim();
				if (!toolName) continue;
				byName.set(toolName, {
					name: toolName,
					displayName: removeMCPToolNamePrefix(toolName),
					description: String(tool.description ?? ''),
					sourceLabel: `mcp.json (${serverName})`,
				});
			}
		}

		for (const tool of collectSettingsJsonMCPTools(accessor)) {
			if (!byName.has(tool.name)) byName.set(tool.name, tool);
		}

		return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
	}, [accessor, mcpServiceState.mcpServerOfName]);

	const acpMode = (settingsState.globalSettings.acpMode || 'builtin') as any

	const onDownload = (t: 'Chats' | 'Settings') => {
		let dataStr: string
		let downloadName: string
		if (t === 'Chats') {
			dataStr = JSON.stringify(chatThreadsService.state, null, 2)
			downloadName = 'void-chats.json'
		}
		else if (t === 'Settings') {
			dataStr = JSON.stringify(voidSettingsService.state, null, 2)
			downloadName = 'void-settings.json'
		}
		else {
			dataStr = ''
			downloadName = ''
		}
		const blob = new Blob([dataStr], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = downloadName
		a.click()
		URL.revokeObjectURL(url)
	}

	const fileInputSettingsRef = useRef<HTMLInputElement>(null)
	const fileInputChatsRef = useRef<HTMLInputElement>(null)

	const [s, ss] = useState(0)
	const handleUpload = (t: 'Chats' | 'Settings') => (e: React.ChangeEvent<HTMLInputElement>,) => {
		const files = e.target.files
		if (!files) return
		const file = files[0]
		if (!file) return

		const reader = new FileReader()
		reader.onload = () => {
			try {
				const json = JSON.parse(reader.result as string)
				if (t === 'Chats') {
					chatThreadsService.dangerousSetState(json as any)
				}
				else if (t === 'Settings') {
					voidSettingsService.dangerousSetState(json as any)
				}
				notificationService.info(`${t} imported successfully!`)
			} catch (err) {
				notificationService.notify({ message: `Failed to import ${t}`, source: err + '', severity: Severity.Error })
			}
		}
		reader.readAsText(file)
		e.target.value = ''
		ss(s => s + 1)
	}

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ height: '100%', width: '100%', overflow: 'auto' }}>
			<div className="flex flex-col md:flex-row w-full gap-6 max-w-[1100px] mx-auto mb-32" style={{ minHeight: '80vh' }}>
				<aside className="md:w-1/4 w-full p-6 shrink-0">
					<div className="flex flex-col gap-2 mt-12">
						{navItems.map(({ tab, label }) => (
							<button
								key={tab}
								onClick={() => {
									setSelectedSection(tab)
									window.scrollTo({ top: 0, behavior: 'smooth' })
								}}
								className={`
									py-2 px-4 rounded-md text-left transition-all duration-200
									${selectedSection === tab
										? 'bg-[#0e70c0]/80 text-white font-medium shadow-sm'
										: 'bg-void-bg-2 hover:bg-void-bg-2/80 text-void-fg-1'}
								`}
							>
								{label}
							</button>
						))}
					</div>
				</aside>
				<main className="flex-1 p-6 select-text">
					<div className='max-w-3xl'>
						<h1 className='text-2xl w-full'>{`Void's Settings`}</h1>
						<div className='w-full h-[1px] my-2' />
						<ErrorBoundary>
							<RedoOnboardingButton />
						</ErrorBoundary>
						<div className='w-full h-[1px] my-4' />

						<div className='flex flex-col gap-12'>
							{/* Models (only dynamic custom providers) */}
							<div className={shouldShowTab('models') ? `` : 'hidden'}>
								<ErrorBoundary>
									<DynamicProviderSettings />
									<DynamicProviderModels />
								</ErrorBoundary>
							</div>

							{/* MCP */}
							<div className={shouldShowTab('mcp') ? `flex flex-col gap-2` : 'hidden'}>
								<ErrorBoundary>
									<h4 className={`text-void-fg-3`}>
										<ChatMarkdownRender
											inPTag={true}
											string={`Use Model Context Protocol to provide Agent mode with more tools.`}
											chatMessageLocation={undefined}
										/>
									</h4>
									<VoidButtonBgDarken
										className='px-4 py-1 w-full max-w-48'
										onClick={async () => { await mcpService.revealMCPConfigFile() }}
									>
										Add MCP Server
									</VoidButtonBgDarken>
									<div className="flex items-center gap-x-2">
										<VoidSwitch
											size='xs'
											value={settingsState.globalSettings.mcpAutoApprove}
											onChange={(newVal) => voidSettingsService.setGlobalSetting('mcpAutoApprove', newVal)}
										/>
										<span className='text-void-fg-3 text-xs pointer-events-none'>Auto-approve MCP tools</span>
									</div>
									<ErrorBoundary>
										<MCPServersList
											disabledToolNames={disabledToolNames}
											onToggleToolDisabled={setToolDisabled}
										/>
									</ErrorBoundary>
								</ErrorBoundary>
							</div>

							{/* All Tools */}
							<div className={shouldShowTab('allTools') ? `flex flex-col gap-2` : 'hidden'}>
								<ErrorBoundary>
									<h4 className='text-base'>All Tools</h4>
									<div className='text-sm italic text-void-fg-3'>
										Enable or disable each static and MCP tool individually.
									</div>
									<div className='mt-2 flex flex-col gap-1'>
										{allTools.length > 0 ? allTools.map(tool => (
											<div
												key={tool.name}
												className='flex items-center justify-between gap-3 px-2 py-1 rounded border border-void-border-2 bg-void-bg-1'
											>
												<div className='min-w-0'>
													<div
														className='text-xs font-mono text-void-fg-1 truncate'
														data-tooltip-id='void-tooltip'
														data-tooltip-content={tool.description || ''}
														data-tooltip-class-name='void-max-w-[300px]'
													>
														{tool.name}
													</div>
													<div className='text-[11px] text-void-fg-3'>{tool.sourceLabel}</div>
												</div>
												<VoidSwitch
													size='xs'
													value={!disabledToolNames.has(tool.name)}
													onChange={(enabled) => setToolDisabled(tool.name, !enabled)}
												/>
											</div>
										)) : (
											<div className='text-xs text-void-fg-3'>No tools found</div>
										)}
									</div>
								</ErrorBoundary>
							</div>

							{/* Feature */}
							<div className={shouldShowTab('feature') ? `` : 'hidden'}>
								<ErrorBoundary>
									<div className='flex flex-col gap-y-8 my-4'>
										<ErrorBoundary>
											<div>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('Autocomplete')}</h4>
												<div className='text-sm italic text-void-fg-3 mt-1'>
													<span>
														Experimental.{` `}
													</span>
													<span
														className='hover:brightness-110'
														data-tooltip-id='void-tooltip'
														data-tooltip-content='We recommend using the largest qwen2.5-coder model you can with Ollama (try qwen2.5-coder:3b).'
														data-tooltip-class-name='void-max-w-[20px]'
													>
														Only works with FIM models.*
													</span>
												</div>
												<div className='mt-2 flex flex-col gap-2'>
													<div className='flex items-center gap-x-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.enableAutocomplete}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('enableAutocomplete', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>
															{settingsState.globalSettings.enableAutocomplete ? 'Enabled' : 'Disabled'}
														</span>
													</div>
													<div className={!settingsState.globalSettings.enableAutocomplete ? 'hidden' : ''}>
														<ModelDropdown
															featureName={'Autocomplete'}
															className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
														/>
													</div>
												</div>
											</div>
										</ErrorBoundary>

										<ErrorBoundary>
											<div>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('Apply')}</h4>
												<div className='text-sm italic text-void-fg-3 mt-1'>
													Settings that control the behavior of the Apply button.
												</div>
												<div className='mt-2 flex flex-col gap-2'>
													<div className='flex items-center gap-x-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.syncApplyToChat}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('syncApplyToChat', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>
															{settingsState.globalSettings.syncApplyToChat ? 'Same as Chat model' : 'Different model'}
														</span>
													</div>
													<div className={settingsState.globalSettings.syncApplyToChat ? 'hidden' : ''}>
														<ModelDropdown
															featureName={'Apply'}
															className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
														/>
													</div>
													<div className='flex items-center gap-x-2'>
														<FastApplyMethodDropdown />
													</div>
												</div>
											</div>
										</ErrorBoundary>

										{/* Commit Message Generator (SCM) */}
										<ErrorBoundary>
											<div>
												<h4 className={`text-base`}>{displayInfoOfFeatureName('SCM')}</h4>
												<div className='text-sm italic text-void-fg-3 mt-1'>
													Settings that control the behavior of the commit message generator.
												</div>
												<div className='my-2 flex flex-col gap-2'>
													<div className='flex items-center gap-x-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.syncSCMToChat}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('syncSCMToChat', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>
															{settingsState.globalSettings.syncSCMToChat ? 'Same as Chat model' : 'Different model'}
														</span>
													</div>
													<div className={settingsState.globalSettings.syncSCMToChat ? 'hidden' : ''}>
														<ModelDropdown
															featureName={'SCM'}
															className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-1 rounded p-0.5 px-1'
														/>
													</div>
												</div>
											</div>
										</ErrorBoundary>
									</div>
								</ErrorBoundary>
							</div>

							{/* Options */}
							<div className={shouldShowTab('options') ? `` : 'hidden'}>
								<ErrorBoundary>
									<div className='flex flex-col gap-y-8 my-4'>
										<div>
											<h4 className={`text-base`}>Tools</h4>
											<div className='text-sm italic text-void-fg-3 mt-1'>
												{`Tools are functions that LLMs can call. Some tools require user approval.`}
											</div>
											<div className='my-2'>
												<ErrorBoundary>
													{[...toolApprovalTypes].map((approvalType) => {
														return (
															<div key={approvalType} className="flex items-center gap-x-2 my-2">
																<ToolApprovalTypeSwitch size='xs' approvalType={approvalType} desc={`Auto-approve ${approvalType}`} />
															</div>
														)
													})}
												</ErrorBoundary>
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.includeToolLintErrors}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('includeToolLintErrors', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>
															{settingsState.globalSettings.includeToolLintErrors ? 'Fix lint errors' : `Fix lint errors`}
														</span>
													</div>
												</ErrorBoundary>
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.applyAstInference}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('applyAstInference', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>
															Use AST inference for Apply
														</span>
													</div>
												</ErrorBoundary>
												<ErrorBoundary>
													<div className='mt-4 p-2 rounded border border-void-border-1 bg-void-bg-1/50'>
														<div className='flex items-center justify-between mb-1'>
															<span className='text-sm'>LLM Loop Detector</span>
															<button
																className='text-xs underline hover:opacity-80'
																onClick={() => setShowLoopGuard(v => !v)}
															>
																{showLoopGuard ? 'Hide thresholds' : 'Show thresholds'}
															</button>
														</div>
														{showLoopGuard && (
															<>
																<div className='text-xs text-void-fg-3 mb-2'>
																	Loop detection thresholds (advanced). Void will stop streaming when the assistant or the same tool call repeats too many times.
																</div>
																<div className='flex flex-col gap-2 text-xs'>
																	<div className='flex items-center gap-x-2'>
																		<span className='w-56'>Max assistant turns per prompt</span>
																		<div className='w-20'>
																			<VoidSimpleInputBox
																				compact
																				placeholder='12'
																				value={String(settingsState.globalSettings.loopGuardMaxTurnsPerPrompt)}
																				onChangeValue={(raw) => {
																					const n = parseInt(raw, 10)
																					const safe = Number.isFinite(n) && n > 0 ? n : 1
																					voidSettingsService.setGlobalSetting('loopGuardMaxTurnsPerPrompt', safe)
																				}}
																			/>
																		</div>
																	</div>
																	<div className='flex items-center gap-x-2'>
																		<span className='w-56'>Max same assistant prefix</span>
																		<div className='w-20'>
																			<VoidSimpleInputBox
																				compact
																				placeholder='3'
																				value={String(settingsState.globalSettings.loopGuardMaxSameAssistantPrefix)}
																				onChangeValue={(raw) => {
																					const n = parseInt(raw, 10)
																					const safe = Number.isFinite(n) && n > 0 ? n : 1
																					voidSettingsService.setGlobalSetting('loopGuardMaxSameAssistantPrefix', safe)
																				}}
																			/>
																		</div>
																	</div>
																	<div className='flex items-center gap-x-2'>
																		<span className='w-56'>Max same tool call</span>
																		<div className='w-20'>
																			<VoidSimpleInputBox
																				compact
																				placeholder='3'
																				value={String(settingsState.globalSettings.loopGuardMaxSameToolCall)}
																				onChangeValue={(raw) => {
																					const n = parseInt(raw, 10)
																					const safe = Number.isFinite(n) && n > 0 ? n : 1
																					voidSettingsService.setGlobalSetting('loopGuardMaxSameToolCall', safe)
																				}}
																			/>
																		</div>
																	</div>
																</div>
															</>
														)}
													</div>
												</ErrorBoundary>
												<ErrorBoundary>
													<div className='mt-4 p-2 rounded border border-void-border-1 bg-void-bg-1/50'>
														<div className='flex items-center justify-between mb-1'>
															<span className='text-sm'>Advanced Chat & Tool Settings</span>
															<button
																className='text-xs underline hover:opacity-80'
																onClick={() => setShowAdvancedChat(v => !v)}
															>
																{showAdvancedChat ? 'Hide settings' : 'Show settings'}
															</button>
														</div>
														{showAdvancedChat && (
															<>
																<div className='text-xs text-void-fg-3 mb-2'>
																	Configure retry behavior and tool output limits.
																</div>
																<div className='flex flex-col gap-2 text-xs'>
																	<div className='flex items-center gap-x-2'>
																		<span className='w-56'>Chat Retries</span>
																		<div className='w-20'>
																			<VoidSimpleInputBox
																				compact
																				placeholder={String(defaultGlobalSettings.chatRetries)}
																				value={String(settingsState.globalSettings.chatRetries ?? defaultGlobalSettings.chatRetries)}
																				onChangeValue={(raw) => {
																					const n = parseInt(raw, 10)
																					const safe = Number.isFinite(n) && n >= 0 ? n : 0
																					voidSettingsService.setGlobalSetting('chatRetries', safe)
																				}}
																			/>
																		</div>
																	</div>
																	<div className='flex items-center gap-x-2'>
																		<span className='w-56'>Retry Delay (ms)</span>
																		<div className='w-20'>
																			<VoidSimpleInputBox
																				compact
																				placeholder={String(defaultGlobalSettings.retryDelay)}
																				value={String(settingsState.globalSettings.retryDelay ?? defaultGlobalSettings.retryDelay)}
																				onChangeValue={(raw) => {
																					const n = parseInt(raw, 10)
																					const safe = Number.isFinite(n) && n >= 0 ? n : 0
																					voidSettingsService.setGlobalSetting('retryDelay', safe)
																				}}
																			/>
																		</div>
																	</div>
																	<div className='flex items-center gap-x-2'>
																		<span className='w-56'>Max Tool Output Length</span>
																		<div className='w-20'>
																			<VoidSimpleInputBox
																				compact
																				placeholder={String(defaultGlobalSettings.maxToolOutputLength)}
																				value={String(settingsState.globalSettings.maxToolOutputLength ?? defaultGlobalSettings.maxToolOutputLength)}
																				onChangeValue={(raw) => {
																					const n = parseInt(raw, 10)
																					const safe = Number.isFinite(n) && n > 0 ? n : 1000
																					voidSettingsService.setGlobalSetting('maxToolOutputLength', safe)
																				}}
																			/>
																		</div>
																	</div>
																	<div className='flex items-center gap-x-2'>
																		<span className='w-56'>Read File Chunk Lines</span>
																		<div className='w-20'>
																			<VoidSimpleInputBox
																				compact
																				placeholder={String(defaultGlobalSettings.readFileChunkLines)}
																				value={String(settingsState.globalSettings.readFileChunkLines ?? defaultGlobalSettings.readFileChunkLines)}
																				onChangeValue={(raw) => {
																					const n = parseInt(raw, 10)
																					const safe = Number.isFinite(n) && n > 0 ? n : 200
																					voidSettingsService.setGlobalSetting('readFileChunkLines', safe)
																				}}
																			/>
																		</div>
																	</div>
																	<div className='flex items-center gap-x-2 mt-1'>
																		<VoidSwitch
																			size='xs'
																			value={settingsState.globalSettings.notifyOnTruncation ?? defaultGlobalSettings.notifyOnTruncation}
																			onChange={(newVal) => voidSettingsService.setGlobalSetting('notifyOnTruncation', newVal)}
																		/>
																		<span className='text-void-fg-3 text-xs pointer-events-none'>
																			Warn when LLM output is truncated
																		</span>
																	</div>
																	<div className='mt-2 pt-2 border-t border-void-border-2'>
																		<div className='flex items-center justify-between mb-1'>
																			<div className='text-xs text-void-fg-3'>
																				Static tool toggles
																			</div>
																			<button
																				className='text-xs underline hover:opacity-80'
																				onClick={() => setShowStaticToolToggles(v => !v)}
																			>
																				{showStaticToolToggles ? 'Hide tools' : 'Show tools'}
																			</button>
																		</div>
																		{showStaticToolToggles && (
																			<div className='flex flex-col gap-1'>
																				{staticToolNames.map((toolName) => (
																					<div key={toolName} className='flex items-center justify-between gap-2 px-2 py-1 rounded bg-void-bg-2'>
																						<span className='text-xs font-mono text-void-fg-2'>{toolName}</span>
																						<VoidSwitch
																							size='xs'
																							value={!disabledToolNames.has(toolName)}
																							onChange={(enabled) => setToolDisabled(toolName, !enabled)}
																						/>
																					</div>
																				))}
																			</div>
																		)}
																	</div>
																</div>
															</>
														)}
													</div>
												</ErrorBoundary>
												<ErrorBoundary>
													<div className='mt-4 p-2 rounded border border-void-border-1 bg-void-bg-1/50'>
														<div className="flex items-center gap-x-2 my-2">
															<VoidSwitch
																size='xs'
																value={settingsState.globalSettings.useAcp}
																onChange={(newVal) => voidSettingsService.setGlobalSetting('useAcp', newVal)}
															/>
															<span
																className='text-sm'
																title="Agent Client Protocol. When enabled, chat will use the ACP agent (plans, tool calls, etc.)."
															>
																Use ACP (Agent Client Protocol)
															</span>
														</div>
														<div className='text-xs text-void-fg-3'>
															<button
																className='underline hover:opacity-80'
																onClick={() => setShowAcpAdvanced(v => !v)}
															>
																{showAcpAdvanced ? 'Hide ACP options' : 'Show ACP options'}
															</button>
														</div>
														{showAcpAdvanced && (
															<div className='mt-3 flex flex-col gap-2 text-xs'>
																<div className='flex flex-col gap-1'>
																	<label className='text-void-fg-3'>Agent Type</label>
																	<VoidCustomDropdownBox
																		options={['builtin', 'process', 'websocket']}
																		selectedOption={acpMode}
																		onChangeOption={(val) => voidSettingsService.setGlobalSetting('acpMode', val as any)}
																		getOptionDisplayName={o =>
																			o === 'builtin' ? 'Built-in Void Agent' :
																				o === 'process' ? 'Local Process (CLI)' :
																					'Remote Server (WebSocket)'
																		}
																		getOptionDropdownName={o =>
																			o === 'builtin' ? 'Built-in Void Agent' :
																				o === 'process' ? 'Local Process (CLI)' :
																					'Remote Server (WebSocket)'
																		}
																		getOptionsEqual={(a, b) => a === b}
																		className="text-xs text-void-fg-1 bg-void-bg-1 border border-void-border-1 rounded px-2 py-1"
																	/>
																</div>
																{acpMode === 'builtin' && (
																	<div className='text-xs text-void-fg-3 italic px-1'>
																		Uses the internal Void agent. You can select the model in the chat window.
																	</div>
																)}
																{acpMode === 'websocket' && (
																	<div className='flex flex-col gap-1'>
																		<label className='text-void-fg-3'>Agent URL</label>
																		<input
																			className='text-xs text-void-fg-1 bg-void-bg-1 border border-void-border-1 rounded px-2 py-1'
																			type='text'
																			placeholder='ws://127.0.0.1:3000'
																			value={settingsState.globalSettings.acpAgentUrl ?? ''}
																			onChange={(e) => voidSettingsService.setGlobalSetting('acpAgentUrl', e.target.value)}
																		/>
																	</div>
																)}
																{acpMode === 'process' && (
																	<>
																		<div className='flex flex-col gap-1'>
																			<label className='text-void-fg-3'>Command</label>
																			<input
																				className='text-xs text-void-fg-1 bg-void-bg-1 border border-void-border-1 rounded px-2 py-1'
																				type='text'
																				placeholder='e.g. node, python, or /path/to/gemini-cli'
																				value={settingsState.globalSettings.acpProcessCommand ?? ''}
																				onChange={(e) => voidSettingsService.setGlobalSetting('acpProcessCommand', e.target.value)}
																			/>
																		</div>
																		<div className='flex flex-col gap-1'>
																			<label className='text-void-fg-3'>Arguments</label>
																			<ArgumentsInput
																				value={(settingsState.globalSettings.acpProcessArgs ?? []).join(' ')}
																				onChange={(args) => voidSettingsService.setGlobalSetting('acpProcessArgs', args)}
																			/>
																		</div>
																		<div className='flex flex-col gap-1'>
																			<label className='text-void-fg-3'>Environment (JSON)</label>
																			<EnvironmentInput
																				value={settingsState.globalSettings.acpProcessEnv ?? {}}
																				onChange={(env) => voidSettingsService.setGlobalSetting('acpProcessEnv', env)}
																			/>
																		</div>
																	</>
																)}
																<div className='flex flex-col gap-1'>
																	<label className='text-void-fg-3'>ACP Model (optional)</label>
																	<input
																		className='text-xs text-void-fg-1 bg-void-bg-1 border border-void-border-1 rounded px-2 py-1'
																		type='text'
																		placeholder='e.g. o3-mini, llama3.1:70b...'
																		value={settingsState.globalSettings.acpModel ?? ''}
																		onChange={(e) => voidSettingsService.setGlobalSetting('acpModel', e.target.value || null)}
																	/>
																</div>
																<div className='flex flex-col gap-1'>
																	<label className='text-void-fg-3'>ACP System Prompt (optional)</label>
																	<textarea
																		className='text-xs text-void-fg-1 bg-void-bg-1 border border-void-border-1 rounded px-2 py-1'
																		rows={4}
																		placeholder='System instructions for the agent'
																		value={settingsState.globalSettings.acpSystemPrompt ?? ''}
																		onChange={(e) => voidSettingsService.setGlobalSetting('acpSystemPrompt', e.target.value || null)}
																	/>
																</div>
																<div className="flex items-center gap-x-2 my-1">
																	<VoidSwitch
																		size='xs'
																		value={settingsState.globalSettings.showAcpPlanInChat}
																		onChange={(newVal) => voidSettingsService.setGlobalSetting('showAcpPlanInChat', newVal)}
																	/>
																	<span className='text-xs text-void-fg-3'>
																		Show ACP plan in chat
																	</span>
																</div>
															</div>
														)}
													</div>
												</ErrorBoundary>
											</div>
										</div>
										<div>
											<h4 className={`text-base`}>Editor</h4>
											<div className='text-sm italic text-void-fg-3 mt-1'>
												{`Settings that control the visibility of Void suggestions in the code editor.`}
											</div>
											<div className='my-2'>
												<ErrorBoundary>
													<div className='flex items-center gap-x-2 my-2'>
														<VoidSwitch
															size='xs'
															value={settingsState.globalSettings.showInlineSuggestions}
															onChange={(newVal) => voidSettingsService.setGlobalSetting('showInlineSuggestions', newVal)}
														/>
														<span className='text-void-fg-3 text-xs pointer-events-none'>
															{settingsState.globalSettings.showInlineSuggestions ? 'Show suggestions on select' : 'Show suggestions on select'}
														</span>
													</div>
												</ErrorBoundary>
											</div>
										</div>
									</div>
								</ErrorBoundary>
							</div>

							{/* General */}
							<div className={shouldShowTab('general') ? `flex flex-col gap-12` : 'hidden'}>
								<ErrorBoundary>
									<h2 className='text-3xl mb-2'>One-Click Switch</h2>
									<h4 className='text-void-fg-3 mb-4'>{`Transfer your editor settings into Void.`}</h4>
									<div className='flex flex-col gap-2'>
										<OneClickSwitchButton className='w-48' fromEditor="VS Code" />
										<OneClickSwitchButton className='w-48' fromEditor="Cursor" />
										<OneClickSwitchButton className='w-48' fromEditor="Windsurf" />
									</div>
								</ErrorBoundary>

								<div>
									<h2 className='text-3xl mb-2'>Import/Export</h2>
									<h4 className='text-void-fg-3 mb-4'>{`Transfer Void's settings and chats in and out of Void.`}</h4>
									<div className='flex flex-col gap-8'>
										<div className='flex flex-col gap-2 max-w-48 w-full'>
											<input key={2 * s} ref={fileInputSettingsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Settings')} />
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputSettingsRef.current?.click() }}>
												Import Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Settings')}>
												Export Settings
											</VoidButtonBgDarken>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { voidSettingsService.resetState() }}>
												Reset Settings
											</ConfirmButton>
										</div>
										<div className='flex flex-col gap-2 w-full max-w-48'>
											<input key={2 * s + 1} ref={fileInputChatsRef} type='file' accept='.json' className='hidden' onChange={handleUpload('Chats')} />
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => { fileInputChatsRef.current?.click() }}>
												Import Chats
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1 w-full' onClick={() => onDownload('Chats')}>
												Export Chats
											</VoidButtonBgDarken>
											<ConfirmButton className='px-4 py-1 w-full' onConfirm={() => { chatThreadsService.resetState() }}>
												Reset Chats
											</ConfirmButton>
										</div>
									</div>
								</div>

								<div>
									<h2 className={`text-3xl mb-2`}>Built-in Settings</h2>
									<h4 className={`text-void-fg-3 mb-4`}>{`IDE settings, keyboard settings, and theme customization.`}</h4>
									<ErrorBoundary>
										<div className='flex flex-col gap-2 justify-center max-w-48 w-full'>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openSettings') }}>
												General Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.openGlobalKeybindings') }}>
												Keyboard Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { commandService.executeCommand('workbench.action.selectTheme') }}>
												Theme Settings
											</VoidButtonBgDarken>
											<VoidButtonBgDarken className='px-4 py-1' onClick={() => { nativeHostService.showItemInFolder(environmentService.logsHome.fsPath) }}>
												Open Logs
											</VoidButtonBgDarken>
										</div>
									</ErrorBoundary>
								</div>

								<div>
									<h2 className={`text-3xl mb-2`}>Privacy</h2>
									<h4 className={`text-void-fg-3 mb-4`}>{`Privacy and telemetry settings.`}</h4>
									<ErrorBoundary>
										<div className='flex items-center gap-x-2 my-2'>
											<VoidSwitch
												size='xs'
												value={settingsState.globalSettings.disableTelemetry}
												onChange={(newVal) => voidSettingsService.setGlobalSetting('disableTelemetry', newVal)}
												data-tooltip-id='void-tooltip'
												data-tooltip-content='Disables Void telemetry sent to posthog.com. Enabled by default. To disable all VSCode telemetry, use "telemetry.telemetryLevel": "off" in settings.'
												data-tooltip-place='right'
											/>
											<span className='text-void-fg-3 text-xs pointer-events-none'>Void telemetry disabled</span>
										</div>
									</ErrorBoundary>
								</div>

								<div className='max-w-[600px]'>
									<h2 className={`text-3xl mb-2`}>AI Instructions</h2>
									<h4 className={`text-void-fg-3 mb-4`}>
										<ChatMarkdownRender
											inPTag={true}
											string={`
System instructions to include with all AI requests.
Alternatively, place a \`.voidrules\` file in the root of your workspace.
								`}
											chatMessageLocation={undefined}
										/>
									</h4>
									<ErrorBoundary>
										<AIInstructionsBox />
									</ErrorBoundary>
								</div>
							</div>
						</div>
					</div>
				</main>
			</div>
		</div>
	)
}
