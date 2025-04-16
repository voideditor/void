/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import { Brain, Check, ChevronRight, DollarSign, ExternalLink, Lock, X } from 'lucide-react';
import { displayInfoOfProviderName, ProviderName, providerNames, refreshableProviderNames } from '../../../../common/voidSettingsTypes.js';
import { getModelCapabilities, ollamaRecommendedModels } from '../../../../common/modelCapabilities.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { AddModelInputBox, AnimatedCheckmarkButton, ollamaSetupInstructions, OneClickSwitchButton, SettingsForProvider } from '../void-settings-tsx/Settings.js';

const OVERRIDE_VALUE = false

export const VoidOnboarding = () => {

	const voidSettingsState = useSettingsState()
	const isOnboardingComplete = voidSettingsState.globalSettings.isOnboardingComplete || OVERRIDE_VALUE

	const isDark = useIsDark()

	return (
		<div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
			<div
				className={`
					bg-void-bg-3 fixed top-0 right-0 bottom-0 left-0 width-full h-full z-[99999]
					transition-all duration-1000 ${isOnboardingComplete ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}
				`}
			>
				<VoidOnboardingContent />
			</div>
		</div>
	)
}


const FADE_DURATION_MS = 2000

const FadeIn = ({ children, className, delayMs = 0, durationMs, ...props }: { children: React.ReactNode, delayMs?: number, durationMs?: number, className?: string } & React.HTMLAttributes<HTMLDivElement>) => {

	const [opacity, setOpacity] = useState(0)

	const effectiveDurationMs = durationMs ?? FADE_DURATION_MS

	useEffect(() => {

		const timeout = setTimeout(() => {
			setOpacity(1)
		}, delayMs)

		return () => clearTimeout(timeout)
	}, [setOpacity, delayMs])


	return (
		<div className={className} style={{ opacity, transition: `opacity ${effectiveDurationMs}ms ease-in-out` }} {...props}>
			{children}
		</div>
	)
}

// Onboarding
// 	OnboardingPage
// 		title:
// 			div
// 				"Welcome to Void"
// 			image
// 		content:<></>
// 		title
// 		content
// 		prev/next

// 	OnboardingPage
// 		title:
// 			div
// 				"How would you like to use Void?"
// 		content:
// 			ModelQuestionContent
// 				|
// 					div
// 						"I want to:"
// 					div
// 						"Use the smartest models"
// 						"Keep my data fully private"
// 						"Save money"
// 						"I don't know"
// 				| div
// 					| div
// 						"We recommend using "
// 						"Set API"
// 					| div
// 						""
// 					| div
//
// 		title
// 		content
// 		prev/next
//
// 	OnboardingPage
// 		title
// 		content
// 		prev/next

const NextButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 bg-zinc-100 enabled:hover:bg-zinc-100 disabled:bg-zinc-100/40 disabled:cursor-not-allowed rounded text-black duration-600 transition-all"
			{...props.disabled && {
				'data-tooltip-id': 'void-tooltip',
				'data-tooltip-content': 'Please enter all required fields or choose another provider',
				'data-tooltip-place': 'top',
			}}
			{...props}
		>
			Next
		</button>
	)
}

const PreviousButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded text-void-fg-3 opacity-80 hover:brightness-115 duration-600 transition-all"
			{...props}
		>
			Back
		</button>
	)
}



const OnboardingPageShell = ({ top, bottom, content, hasMaxWidth = true, className = '', }: {
	top?: React.ReactNode,
	bottom?: React.ReactNode,
	content?: React.ReactNode,
	hasMaxWidth?: boolean,
	className?: string,
}) => {
	return (
		<div className={`min-h-full text-lg flex flex-col gap-4 w-full mx-auto ${hasMaxWidth ? 'max-w-[600px]' : ''} ${className}`}>
			{top && <FadeIn className='w-full mb-auto pt-16'>{top}</FadeIn>}
			{content && <FadeIn className='w-full my-auto'>{content}</FadeIn>}
			{bottom && <div className='w-full pb-8'>{bottom}</div>}
		</div>
	)
}

const OllamaDownloadOrRemoveModelButton = ({ modelName, isModelInstalled, sizeGb }: { modelName: string, isModelInstalled: boolean, sizeGb: number | false | 'not-known' }) => {


	// for now just link to the ollama download page
	return <a
		href={`https://ollama.com/library/${modelName}`}
		target="_blank"
		rel="noopener noreferrer"
		className="flex items-center justify-center text-void-fg-2 hover:text-void-fg-1"
	>
		<ExternalLink className="w-3.5 h-3.5" />
	</a>

	// if (isModelInstalled) {
	// 	return <div className="flex items-center">

	// 		<span className="flex items-center">Uninstall</span>

	// 		<IconShell1
	// 			className="ml-1"
	// 			Icon={Trash}
	// 			onClick={() => {

	// 				setIsModelInstalling(false);
	// 			}}
	// 		/>

	// 	</div>
	// }



	// else if (isModelInstalling) {
	// 	return <div className="flex items-center">

	// 		<span className="flex items-center">{`Download? ${typeof sizeGb === 'number' ? `(${sizeGb} Gb)` : ''}`}</span>

	// 		<IconShell1
	// 			className="ml-1"
	// 			Icon={Square}
	// 			onClick={() => {
	// 				// abort()

	// 				// TODO!!!!!!!!!!! don't do this
	// 				setIsModelInstalling(false);
	// 			}}
	// 		/>

	// 	</div>
	// }


	// else if (!isModelInstalled) {

	// 	return <div className="flex items-center">

	// 		<span className="flex items-center">Download ({sizeGb} Gb)</span>

	// 		<IconShell1
	// 			className="ml-1"
	// 			Icon={Download}
	// 			onClick={() => {
	// 				// this is a check for whether the model was installed:

	// 				if (isModelInstalling) return


	// 				// TODO!!!!!! don't do this


	// 				// install(modelname), callback = setIsModelInstalling(false);

	// 				setIsModelInstalling(true);
	// 			}}
	// 		/>

	// 	</div>

	// }

	// return <></>


}


const YesNoText = ({ val }: { val: boolean | null }) => {

	return <div
		className={
			val === true ? "text text-emerald-500"
				: val === false ? 'text-rose-600'
					: "text text-amber-300"
		}
	>
		{
			val === true ? "Yes"
				: val === false ? 'No'
					: "Yes*"
		}
	</div>

}



const abbreviateNumber = (num: number): string => {
	if (num >= 1000000) {
		// For millions
		return Math.floor(num / 1000000) + 'M';
	} else if (num >= 1000) {
		// For thousands
		return Math.floor(num / 1000) + 'K';
	} else {
		// For numbers less than 1000
		return num.toString();
	}
}

const TableOfModelsForProvider = ({ providerName }: { providerName: ProviderName }) => {

	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()
	const isDetectableLocally = (refreshableProviderNames as ProviderName[]).includes(providerName)
	// const providerCapabilities = getProviderCapabilities(providerName)


	// info used to show the table
	const infoOfModelName: Record<string, { showAsDefault: boolean, isDownloaded: boolean }> = {}

	voidSettingsState.settingsOfProvider[providerName].models.forEach(m => {
		infoOfModelName[m.modelName] = {
			showAsDefault: m.isDefault,
			isDownloaded: true
		}
	})

	// special case  columns for ollama; show recommended models as default
	if (providerName === 'ollama') {
		for (const modelName of ollamaRecommendedModels) {
			if (modelName in infoOfModelName) continue
			infoOfModelName[modelName] = {
				...infoOfModelName[modelName],
				showAsDefault: true,
			}
		}
	}

	return <table className="table-fixed border-collapse mb-6 bg-void-bg-2 text-sm mx-auto select-text">
		<thead>
			<tr className="border-b border-void-border-1 text-nowrap text-ellipsis">
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[200px]">Models Offered</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Cost/M</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Context</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Chat</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Agent</th>
				<th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Autotab</th>
				{/* <th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Reasoning</th> */}
				{isDetectableLocally && <th className="text-left py-2 px-3 font-normal text-void-fg-3 min-w-[10%]">Detected</th>}
				{providerName === 'ollama' && <th className="text-left py-2 px-3 font-normal text-void-fg-3">Download</th>}
			</tr>
		</thead>
		<tbody>
			{Object.keys(infoOfModelName).map(modelName => {
				const { showAsDefault, isDownloaded } = infoOfModelName[modelName]


				const capabilities = getModelCapabilities(providerName, modelName)
				const {
					downloadable,
					cost,
					supportsFIM,
					reasoningCapabilities,
					contextWindow,

					isUnrecognizedModel,
					maxOutputTokens,
					supportsSystemMessage,
				} = capabilities

				// TODO update this when tools work

				const removeModelButton = <button
					className="absolute -left-1 top-1/2 transform -translate-y-1/2 -translate-x-full text-void-fg-3 hover:text-void-fg-1 text-xs"
					onClick={() => voidSettingsService.deleteModel(providerName, modelName)}
				>
					<X className="w-3.5 h-3.5" />
				</button>



				return (
					<tr key={modelName} className="border-b border-void-border-1 hover:bg-void-bg-3/50">
						<td className="py-2 px-3 relative">
							{!showAsDefault && removeModelButton}
							{modelName}
						</td>
						<td className="py-2 px-3">${cost.output ?? ''}</td>
						<td className="py-2 px-3">{contextWindow ? abbreviateNumber(contextWindow) : ''}</td>
						<td className="py-2 px-3"><YesNoText val={true} /></td>
						<td className="py-2 px-3"><YesNoText val={!!true} /></td>
						<td className="py-2 px-3"><YesNoText val={!!supportsFIM} /></td>
						{/* <td className="py-2 px-3"><YesNoText val={!!reasoningCapabilities} /></td> */}
						{isDetectableLocally && <td className="py-2 px-3 flex items-center justify-center">{!!isDownloaded ? <Check className="w-4 h-4" /> : <></>}</td>}
						{providerName === 'ollama' && <th className="py-2 px-3">
							<OllamaDownloadOrRemoveModelButton modelName={modelName} isModelInstalled={infoOfModelName[modelName].isDownloaded} sizeGb={downloadable && downloadable.sizeGb} />
						</th>}

					</tr>
				)
			})}
			<tr className="hover:bg-void-bg-3/50">
				<td className="py-2 px-3 text-void-accent">
					<AddModelInputBox
						key={providerName}
						providerName={providerName}
						compact={true} />
				</td>
				<td colSpan={4}></td>
			</tr>
		</tbody>
	</table>
}



const PrimaryActionButton = ({ children, className, ringSize, ...props }: { children: React.ReactNode, ringSize?: undefined | 'xl' | 'screen' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {


	return (
		<button
			type='button'
			className={`
				flex items-center justify-center

				text-white dark:text-black
				bg-black/90 dark:bg-white/90

				${ringSize === 'xl' ? `
					gap-2 px-16 py-8
					hover:ring-8 active:ring-8
					transition-all duration-300 ease-in-out
					`
					: ringSize === 'screen' ? `
					gap-2 px-16 py-8
					ring-[3000px]
					transition-all duration-1000 ease-in-out
					`: ringSize === undefined ? `
					gap-1 px-4 py-2
					hover:ring-2 active:ring-2
					transition-all duration-300 ease-in-out
				`: ''}

				hover:ring-black/90 dark:hover:ring-white/90
				active:ring-black/90 dark:active:ring-white/90

				rounded-lg
				group
				${className}
			`}
			{...props}
		>
			{children}
			<ChevronRight
				className={`
					transition-all duration-300 ease-in-out

					transform
					group-hover:translate-x-1
					group-active:translate-x-1
				`}
			/>
		</button>
	)
}


type WantToUseOption = 'smart' | 'private' | 'cheap' | 'all'

const VoidOnboardingContent = () => {


	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const voidSettingsState = useSettingsState()

	const [pageIndex, setPageIndex] = useState(0)


	// page 1 state
	const [wantToUseOption, setWantToUseOption] = useState<WantToUseOption>('smart')

	// Replace the single selectedProviderName with four separate states
	// page 2 state - each tab gets its own state
	const [selectedIntelligentProvider, setSelectedIntelligentProvider] = useState<ProviderName>('anthropic');
	const [selectedPrivateProvider, setSelectedPrivateProvider] = useState<ProviderName>('ollama');
	const [selectedAffordableProvider, setSelectedAffordableProvider] = useState<ProviderName>('gemini');
	const [selectedAllProvider, setSelectedAllProvider] = useState<ProviderName>('anthropic');

	// Helper function to get the current selected provider based on active tab
	const getSelectedProvider = (): ProviderName => {
		switch (wantToUseOption) {
			case 'smart': return selectedIntelligentProvider;
			case 'private': return selectedPrivateProvider;
			case 'cheap': return selectedAffordableProvider;
			case 'all': return selectedAllProvider;
		}
	}

	// Helper function to set the selected provider for the current tab
	const setSelectedProvider = (provider: ProviderName) => {
		switch (wantToUseOption) {
			case 'smart': setSelectedIntelligentProvider(provider); break;
			case 'private': setSelectedPrivateProvider(provider); break;
			case 'cheap': setSelectedAffordableProvider(provider); break;
			case 'all': setSelectedAllProvider(provider); break;
		}
	}

	const providerNamesOfWantToUseOption: { [wantToUseOption in WantToUseOption]: ProviderName[] } = {
		smart: ['anthropic', 'openAI', 'gemini', 'openRouter'],
		private: ['ollama', 'vLLM', 'openAICompatible'],
		cheap: ['gemini', 'deepseek', 'openRouter', 'ollama', 'vLLM'],
		all: providerNames,
	}


	const selectedProviderName = getSelectedProvider();
	const didFillInProviderSettings = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName]._didFillInProviderSettings
	const isApiKeyLongEnoughIfApiKeyExists = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName].apiKey ? voidSettingsState.settingsOfProvider[selectedProviderName].apiKey.length > 15 : true
	const isAtLeastOneModel = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName].models.length >= 1

	const didFillInSelectedProviderSettings = !!(didFillInProviderSettings && isApiKeyLongEnoughIfApiKeyExists && isAtLeastOneModel)

	const prevAndNextButtons = <div className="max-w-[600px] w-full mx-auto flex flex-col items-end">
		<div className="flex items-center gap-2">
			<PreviousButton
				onClick={() => { setPageIndex(pageIndex - 1) }}
			/>
			<NextButton
				onClick={() => { setPageIndex(pageIndex + 1) }}
				disabled={pageIndex === 2 && !didFillInSelectedProviderSettings}
			/>
		</div>
	</div>


	const lastPagePrevAndNextButtons = <div className="max-w-[600px] w-full mx-auto flex flex-col items-end">
		<div className="flex items-center gap-2">
			<PreviousButton
				onClick={() => { setPageIndex(pageIndex - 1) }}
			/>
			<PrimaryActionButton
				onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', true); }}
				ringSize={voidSettingsState.globalSettings.isOnboardingComplete ? 'screen' : undefined}
			>Enter the Void</PrimaryActionButton>
		</div>
	</div>


	// cannot be md
	const basicDescOfWantToUseOption: { [wantToUseOption in WantToUseOption]: string } = {
		smart: "Models with the best performance on benchmarks.",
		private: "Host on your computer or local network for full data privacy.",
		cheap: "Free and affordable options.",
		all: "",
	}

	// can be md
	const detailedDescOfWantToUseOption: { [wantToUseOption in WantToUseOption]: string } = {
		smart: "Most intelligent and best for agent mode.",
		private: "Private-hosted so your data never leaves your computer or network. [Email us](mailto:founders@voideditor.com) for help setting up at your company.",
		cheap: "Use great deals like Gemini 2.5 Pro, or self-host a model with Ollama or vLLM for free.",
		all: "",
	}

	// Modified: initialize separate provider states on initial render instead of watching wantToUseOption changes
	useEffect(() => {
		if (selectedIntelligentProvider === undefined) {
			setSelectedIntelligentProvider(providerNamesOfWantToUseOption['smart'][0]);
		}
		if (selectedPrivateProvider === undefined) {
			setSelectedPrivateProvider(providerNamesOfWantToUseOption['private'][0]);
		}
		if (selectedAffordableProvider === undefined) {
			setSelectedAffordableProvider(providerNamesOfWantToUseOption['cheap'][0]);
		}
		if (selectedAllProvider === undefined) {
			setSelectedAllProvider(providerNamesOfWantToUseOption['all'][0]);
		}
	}, []);

	// reset the page to page 0 if the user redos onboarding
	useEffect(() => {
		if (!voidSettingsState.globalSettings.isOnboardingComplete) {
			setPageIndex(0)
		}
	}, [setPageIndex, voidSettingsState.globalSettings.isOnboardingComplete])


	const contentOfIdx: { [pageIndex: number]: React.ReactNode } = {
		0: <OnboardingPageShell
			content={
				<div className='flex flex-col items-center gap-8'>
					<div className="text-5xl font-light text-center">Welcome to Void</div>

					{/* Slice of Void image */}
					<div className='max-w-md w-full h-[30vh] mx-auto'>
						<div className="@@void-void-icon" />
					</div>


					<FadeIn
						delayMs={1000}
					>
						<PrimaryActionButton
							onClick={() => { setPageIndex(pageIndex + 1) }}
						>
							Get Started
						</PrimaryActionButton>
					</FadeIn>

				</div>
			}
		/>,
		1: <OnboardingPageShell

			hasMaxWidth={false}
			top={<></>}
			content={<div className='flex flex-col items-center -translate-y-[20vh]'>
				{/* <div className="text-5xl text-center mb-8">AI Preferences</div> */}

				<div className="text-4xl text-void-fg-2 mb-8 text-center">Model Preferences</div>


				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-[800px] mx-auto mt-8">
					<button
						onClick={() => { setWantToUseOption('smart'); setPageIndex(pageIndex + 1); }}
						className="flex flex-col p-6 rounded bg-void-bg-2 border border-void-border-3 hover:bg-zinc-200/10 dark:hover:bg-zinc-700/50 transition-colors focus:outline-none focus:border-void-accent-border relative overflow-hidden min-h-[160px]"
					>
						<div className="flex items-center mb-3">
							<Brain size={24} className="text-void-fg-2 mr-2" />
							<div className="text-lg font-medium text-void-fg-1">Intelligent</div>
						</div>
						<div className="text-sm text-void-fg-2 text-left">{basicDescOfWantToUseOption['smart']}</div>
					</button>

					<button
						onClick={() => { setWantToUseOption('private'); setPageIndex(pageIndex + 1); }}
						className="flex flex-col p-6 rounded bg-void-bg-2 border border-void-border-3 hover:bg-zinc-200/10 dark:hover:bg-zinc-700/50 transition-colors focus:outline-none focus:border-void-accent-border relative overflow-hidden min-h-[160px]"
					>
						<div className="flex items-center mb-3">
							<Lock size={24} className="text-void-fg-2 mr-2" />
							<div className="text-lg font-medium text-void-fg-1">Private</div>
						</div>
						<div className="text-sm text-void-fg-2 text-left">{basicDescOfWantToUseOption['private']}</div>
					</button>

					<button
						onClick={() => { setWantToUseOption('cheap'); setPageIndex(pageIndex + 1); }}
						className="flex flex-col p-6 rounded bg-void-bg-2 border border-void-border-3 hover:bg-zinc-200/10 dark:hover:bg-zinc-700/50 transition-colors focus:outline-none focus:border-void-accent-border relative overflow-hidden min-h-[160px]"
					>
						<div className="flex items-center mb-3">
							<DollarSign size={24} className="text-void-fg-2 mr-2" />
							<div className="text-lg font-medium text-void-fg-1">Affordable</div>
						</div>
						<div className="text-sm text-void-fg-2 text-left">{basicDescOfWantToUseOption['cheap']}</div>
					</button>
				</div>


			</div>}
			bottom={
				<div className='mx-auto w-full max-w-[800px]'>
					<PreviousButton onClick={() => { setPageIndex(pageIndex - 1) }} />
				</div>
			}
		/>,
		2: <OnboardingPageShell
			top={
				<>
					{/* Title */}

					<div className="text-5xl font-light text-center mt-[10vh] mb-6">Choose a Provider</div>

					{/* Preference Selector */}

					<div
						className="mb-6 w-fit mx-auto flex items-center overflow-hidden bg-zinc-700/5 dark:bg-zinc-300/5 rounded-md"
					>
						{[
							{ id: 'smart', label: 'Intelligent' },
							{ id: 'private', label: 'Private' },
							{ id: 'cheap', label: 'Affordable' },
							{ id: 'all', label: 'All' }
						].map(option => (
							<button
								key={option.id}
								onClick={() => setWantToUseOption(option.id as WantToUseOption)}
								className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors ${wantToUseOption === option.id
									? 'dark:text-white text-black font-medium'
									: 'text-void-fg-3 hover:text-void-fg-2'
									}`}
								data-tooltip-id='void-tooltip'
								data-tooltip-content={`${option.label} providers`}
								data-tooltip-place='bottom'
							>
								{option.label}
							</button>
						))}
					</div>



					{/* Provider Buttons - Modified to use separate components for each tab */}
					<div className="mb-2 w-full">
						{/* Intelligent tab */}
						<div className={`flex flex-wrap items-center w-full ${wantToUseOption === 'smart' ? 'flex' : 'hidden'}`}>
							{providerNamesOfWantToUseOption['smart'].map((providerName) => {
								const isSelected = selectedIntelligentProvider === providerName;
								return (
									<button
										key={providerName}
										onClick={() => setSelectedIntelligentProvider(providerName)}
										className={`py-[2px] px-2 mx-0.5 my-0.5 text-xs font-medium cursor-pointer relative rounded-full transition-all duration-300
											${isSelected ? 'bg-zinc-100 text-zinc-900 shadow-sm border-white/80' : 'bg-zinc-100/40 hover:bg-zinc-100/50 text-zinc-900 border-white/20'}`}
									>
										{displayInfoOfProviderName(providerName).title}
									</button>
								);
							})}
						</div>

						{/* Private tab */}
						<div className={`flex flex-wrap items-center w-full ${wantToUseOption === 'private' ? 'flex' : 'hidden'}`}>
							{providerNamesOfWantToUseOption['private'].map((providerName) => {
								const isSelected = selectedPrivateProvider === providerName;
								return (
									<button
										key={providerName}
										onClick={() => setSelectedPrivateProvider(providerName)}
										className={`py-[2px] px-2 mx-0.5 my-0.5 text-xs font-medium cursor-pointer relative rounded-full transition-all duration-300
											${isSelected ? 'bg-zinc-100 text-zinc-900 shadow-sm border-white/80' : 'bg-zinc-100/40 hover:bg-zinc-100/50 text-zinc-900 border-white/20'}`}
									>
										{displayInfoOfProviderName(providerName).title}
									</button>
								);
							})}
						</div>

						{/* Affordable tab */}
						<div className={`flex flex-wrap items-center w-full ${wantToUseOption === 'cheap' ? 'flex' : 'hidden'}`}>
							{providerNamesOfWantToUseOption['cheap'].map((providerName) => {
								const isSelected = selectedAffordableProvider === providerName;
								return (
									<button
										key={providerName}
										onClick={() => setSelectedAffordableProvider(providerName)}
										className={`py-[2px] px-2 mx-0.5 my-0.5 text-xs font-medium cursor-pointer relative rounded-full transition-all duration-300
											${isSelected ? 'bg-zinc-100 text-zinc-900 shadow-sm border-white/80' : 'bg-zinc-100/40 hover:bg-zinc-100/50 text-zinc-900 border-white/20'}`}
									>
										{displayInfoOfProviderName(providerName).title}
									</button>
								);
							})}
						</div>

						{/* All tab */}
						<div className={`flex flex-wrap items-center w-full ${wantToUseOption === 'all' ? 'flex' : 'hidden'}`}>
							{providerNames.map((providerName) => {
								const isSelected = selectedAllProvider === providerName;
								return (
									<button
										key={providerName}
										onClick={() => setSelectedAllProvider(providerName)}
										className={`py-[2px] px-2 mx-0.5 my-0.5 text-xs font-medium cursor-pointer relative rounded-full transition-all duration-300
											${isSelected ? 'bg-zinc-100 text-zinc-900 shadow-sm border-white/80' : 'bg-zinc-100/40 hover:bg-zinc-100/50 text-zinc-900 border-white/20'}`}
									>
										{displayInfoOfProviderName(providerName).title}
									</button>
								);
							})}
						</div>
					</div>

					{/* Description */}
					<div className="text-left self-start text-sm text-void-fg-3 px-2 py-1">
						<ChatMarkdownRender string={detailedDescOfWantToUseOption[wantToUseOption]} chatMessageLocation={undefined} />
					</div>


					{/* ModelsTable and ProviderFields */}
					{selectedProviderName && <div className='mt-4 w-fit mx-auto'>


						{/* Models Table */}
						<TableOfModelsForProvider providerName={selectedProviderName} />


						{/* Add provider section - simplified styling */}
						<div className='mb-5 mt-8 mx-auto'>
							<div className=''>
								Add {displayInfoOfProviderName(selectedProviderName).title}

								<div className='my-4'>
									{selectedProviderName === 'ollama' ? ollamaSetupInstructions : ''}
								</div>

							</div>

							{selectedProviderName &&
								<SettingsForProvider providerName={selectedProviderName} showProviderTitle={false} showProviderSuggestions={false} />
							}

							{/* Button and status indicators */}
							{!didFillInProviderSettings ? <p className="text-xs text-void-fg-3 mt-2">Please fill in all fields to continue</p>
								: !isAtLeastOneModel ? <p className="text-xs text-void-fg-3 mt-2">Please add a model to continue</p>
									: !isApiKeyLongEnoughIfApiKeyExists ? <p className="text-xs text-void-fg-3 mt-2">Please enter a valid API key</p>
										: <AnimatedCheckmarkButton className='text-xs text-void-fg-3 mt-2' text='Added' />}
						</div>

					</div>}
				</>
			}

			bottom={
				<FadeIn delayMs={50} durationMs={10}>
					{prevAndNextButtons}
				</FadeIn>

			}

		/>,

		// 2.5: <div className="max-w-[600px] w-full h-full text-left mx-auto flex flex-col items-center justify-between">
		// 	<FadeIn>
		// 		<div className="text-5xl font-light mb-6 mt-12 text-center">Autocomplete</div>

		// 		<div className="text-center flex flex-col gap-4 w-full max-w-md mx-auto">
		// 			<h4 className="text-void-fg-3 mb-2">Void offers free autocomplete with locally hosted models</h4>
		// 			<h4 className="text-void-fg-3 mb-2">[have buttons for Ollama install Qwen2.5coder3b and memory requirements] </h4>

		// 		</div>
		// 	</FadeIn>

		// 	{prevAndNextButtons}
		// </div>,
		3: <OnboardingPageShell

			content={
				<div>
					<div className="text-5xl font-light text-center">Settings and Themes</div>

					<div className="mt-8 text-center flex flex-col items-center gap-4 w-full max-w-md mx-auto">
						<h4 className="text-void-fg-3 mb-4">Transfer your settings from an existing editor?</h4>
						<OneClickSwitchButton className='w-full px-4 py-2' fromEditor="VS Code" />
						<OneClickSwitchButton className='w-full px-4 py-2' fromEditor="Cursor" />
						<OneClickSwitchButton className='w-full px-4 py-2' fromEditor="Windsurf" />
					</div>
				</div>
			}
			bottom={lastPagePrevAndNextButtons}
		// bottom={prevAndNextButtons}
		/>,
		// 4: <OnboardingPageShell
		// 	content={
		// 		<>
		// 			<div
		// 				className='flex justify-center'
		// 			>
		// 				<PrimaryActionButton
		// 					onClick={() => { voidSettingsService.setGlobalSetting('isOnboardingComplete', true); }}
		// 					ringSize={voidSettingsState.globalSettings.isOnboardingComplete ? 'screen' : undefined}
		// 					className='text-4xl'
		// 				>Enter the Void</PrimaryActionButton>
		// 			</div>
		// 		</>
		// 	}
		// 	bottom={
		// 		<PreviousButton
		// 			onClick={() => { setPageIndex(pageIndex - 1) }}
		// 		/>
		// 	}
		// />,
	}


	return <div key={pageIndex} className="w-full h-full text-left mx-auto overflow-y-scroll flex flex-col items-center justify-around">
		{contentOfIdx[pageIndex]}
	</div>

}
