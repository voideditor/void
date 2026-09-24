/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useMemo, useState } from 'react';
import { VoidButtonBgDarken, VoidSwitch, VoidCustomDropdownBox } from '../util/inputs.js';
import { useAccessor, useSettingsState } from '../util/services.js';
import { ChevronUp, ChevronDown, X, Plus } from 'lucide-react';
import {
	ALL_CHAT_MODEL_ERROR_POLICIES,
	DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS,
	DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS,
	type ChatModelErrorPolicy,
	type ChatModelFallbackSettings,
	type FallbackModelEntry,
	addFallbackModel,
	removeFallbackModel,
	moveFallbackModelUp,
	moveFallbackModelDown,
} from '../../../../../../../platform/void/common/chatModelFallbackPolicy.js';
import { type ModelOption } from '../../../../../../../platform/void/common/voidSettingsService.js';
import { modelSelectionsEqual } from '../../../../../../../platform/void/common/voidSettingsTypes.js';

const ERROR_POLICY_LABELS: Record<ChatModelErrorPolicy, string> = {
	'rate-limits-only': 'Rate Limits Only (HTTP 429)',
	'temporary-errors': 'Temporary Errors (429, 5xx, Network)',
	'any-provider-error': 'Any Provider Error',
};

const entryMatchesOption = (entry: FallbackModelEntry, option: ModelOption): boolean => {
	return entry.providerName === option.selection.providerName
		&& entry.modelName === option.selection.modelName;
};

export const FallbackModelsEditor = () => {
	const settingsState = useSettingsState();
	const accessor = useAccessor();
	const voidSettingsService = accessor.get('IVoidSettingsService');

	const fallbackSettings: ChatModelFallbackSettings =
		settingsState.globalSettings.chatModelFallback ?? DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS;

	const [selectedToAdd, setSelectedToAdd] = useState<ModelOption | null>(null);

	const updateFallbackSettings = (updates: Partial<ChatModelFallbackSettings>) => {
		voidSettingsService.setGlobalSetting('chatModelFallback', {
			...fallbackSettings,
			...updates,
		});
	};

	const chatPrimarySelection = settingsState.modelSelectionOfFeature['Chat'];
	const modelOptions = settingsState._modelOptions as ModelOption[];

	// Available options: exclude models already in the fallback list and the current Chat primary
	const availableOptions = useMemo(() => {
		return modelOptions.filter((option) => {
			const alreadyInList = fallbackSettings.fallbackModels.some(
				(entry) => entryMatchesOption(entry, option)
			);
			if (alreadyInList) return false;

			if (chatPrimarySelection
				&& option.selection.providerName === chatPrimarySelection.providerName
				&& option.selection.modelName === chatPrimarySelection.modelName
			) {
				return false;
			}

			return true;
		});
	}, [modelOptions, fallbackSettings.fallbackModels, chatPrimarySelection]);

	const isEntryAvailable = (entry: FallbackModelEntry): boolean => {
		return modelOptions.some((option) => entryMatchesOption(entry, option));
	};

	const handleAddModel = () => {
		const option = selectedToAdd ?? availableOptions[0];
		if (!option) return;
		const updated = addFallbackModel(fallbackSettings.fallbackModels, {
			providerName: option.selection.providerName,
			modelName: option.selection.modelName,
		});
		updateFallbackSettings({ fallbackModels: updated });
		setSelectedToAdd(null);
	};

	const handleRemoveModel = (entry: FallbackModelEntry) => {
		const updated = removeFallbackModel(fallbackSettings.fallbackModels, entry);
		updateFallbackSettings({ fallbackModels: updated });
	};

	const handleMoveUp = (index: number) => {
		const updated = moveFallbackModelUp(fallbackSettings.fallbackModels, index);
		updateFallbackSettings({ fallbackModels: updated });
	};

	const handleMoveDown = (index: number) => {
		const updated = moveFallbackModelDown(fallbackSettings.fallbackModels, index);
		updateFallbackSettings({ fallbackModels: updated });
	};

	const asDisplay = (option: ModelOption) => {
		const { providerName } = option.selection;
		const modelLabel = option.name;
		return { name: modelLabel, detail: providerName };
	};

	const dropdownOption = selectedToAdd ?? availableOptions[0];

	return (
		<div className='flex flex-col gap-2 w-full'>
			<div className='flex items-center gap-x-2'>
				<VoidSwitch
					size='xs'
					value={fallbackSettings.enabled}
					onChange={(enabled) => updateFallbackSettings({ enabled })}
				/>
				<span className='text-void-fg-3'>Enabled</span>
			</div>

			<div className='flex items-center gap-x-2'>
				<span className='text-void-fg-3 whitespace-nowrap'>Policy:</span>
				<select
					className='text-xs bg-void-bg-3 text-void-fg-1 border border-void-border-2 rounded px-1 py-0.5 flex-1'
					value={fallbackSettings.errorPolicy}
					onChange={(e) => updateFallbackSettings({ errorPolicy: e.target.value as ChatModelErrorPolicy })}
				>
					{ALL_CHAT_MODEL_ERROR_POLICIES.map((policy) => (
						<option key={policy} value={policy}>
							{ERROR_POLICY_LABELS[policy]}
						</option>
					))}
				</select>
			</div>

			<div className='flex items-center gap-x-2'>
				<span className='text-void-fg-3 whitespace-nowrap'>Max rotation attempts:</span>
				<input
					type='number'
					min={1}
					className='text-xs bg-void-bg-3 text-void-fg-1 border border-void-border-2 rounded px-1 py-0.5 w-20'
					value={fallbackSettings.maxRotationAttempts ?? DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS}
					onChange={(e) => {
						const parsed = Number.parseInt(e.target.value, 10);
						updateFallbackSettings({
							maxRotationAttempts: Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS,
						});
					}}
				/>
			</div>

			{fallbackSettings.fallbackModels.length > 0 && (
				<div className='flex flex-col gap-1'>
					{fallbackSettings.fallbackModels.map((entry, index) => {
						const available = isEntryAvailable(entry);
						return (
							<div
								key={`${entry.providerName}::${entry.modelName}`}
								className='flex items-center gap-x-1'
							>
								<span className={`flex-1 text-xs truncate ${available ? 'text-void-fg-2' : 'text-void-fg-4'}`}>
									{entry.providerName} / {entry.modelName}
									{!available && (
										<span className='ml-1 italic'>(unavailable)</span>
									)}
								</span>
								<button
									type='button'
									className='text-void-fg-3 hover:text-void-fg-1 disabled:opacity-30'
									onClick={() => handleMoveUp(index)}
									disabled={index === 0}
								>
									<ChevronUp size={12} />
								</button>
								<button
									type='button'
									className='text-void-fg-3 hover:text-void-fg-1 disabled:opacity-30'
									onClick={() => handleMoveDown(index)}
									disabled={index === fallbackSettings.fallbackModels.length - 1}
								>
									<ChevronDown size={12} />
								</button>
								<button
									type='button'
									className='text-void-fg-3 hover:text-void-fg-1'
									onClick={() => handleRemoveModel(entry)}
								>
									<X size={12} />
								</button>
							</div>
						);
					})}
				</div>
			)}

			{availableOptions.length > 0 && dropdownOption && (
				<div className='flex items-center gap-x-1'>
					<div className='flex-1'>
						<VoidCustomDropdownBox
							options={availableOptions}
							selectedOption={dropdownOption}
							onChangeOption={(option: ModelOption) => setSelectedToAdd(option)}
							getOptionDisplayName={(option: ModelOption) => asDisplay(option).name}
							getOptionDropdownName={(option: ModelOption) => asDisplay(option).name}
							getOptionDropdownDetail={(option: ModelOption) => asDisplay(option).detail}
							getOptionsEqual={(a: ModelOption, b: ModelOption) => modelSelectionsEqual(a.selection, b.selection)}
							className='w-full'
							matchInputWidth={false}
							enableSearch={true}
							getOptionSearchText={(option: ModelOption) => {
								const { providerName, modelName } = option.selection;
								const display = asDisplay(option).name;
								return `${display} ${providerName} ${modelName}`;
							}}
							searchPlaceholder='Search model to add...'
						/>
					</div>
					<VoidButtonBgDarken onClick={handleAddModel}>
						<Plus size={12} />
					</VoidButtonBgDarken>
				</div>
			)}
			{availableOptions.length === 0 && (
				<span className='text-void-fg-4 text-xs'>
					{modelOptions.length === 0
						? 'Configure models first to add fallbacks.'
						: 'All configured models are already in the fallback list or set as primary.'}
				</span>
			)}
		</div>
	);
};
