/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useAccessor, useIsDark, useSettingsState } from '../util/services.js';
import { Check, ExternalLink, X } from 'lucide-react';
import { displayInfoOfProviderName, ProviderName, providerNames, refreshableProviderNames } from '../../../../common/voidSettingsTypes.js';
import { getModelCapabilities, ollamaRecommendedModels } from '../../../../common/modelCapabilities.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { AddModelInputBox, AnimatedCheckmarkButton, ollamaSetupInstructions, OneClickSwitchButton, SettingsForProvider } from '../void-settings-tsx/Settings.js';


export const VoidOnboarding = () => {

	const voidSettingsState = useSettingsState()
	const isOnboardingComplete = voidSettingsState.globalSettings.isOnboardingComplete

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


const FadeIn = ({ children, className, delayMs = 0, ...props }: { children: React.ReactNode, delayMs?: number, className?: string } & React.HTMLAttributes<HTMLDivElement>) => {

	const [opacity, setOpacity] = useState(0)

	useEffect(() => {

		const timeout = setTimeout(() => {
			setOpacity(1)
		}, delayMs)

		return () => clearTimeout(timeout)
	}, [setOpacity, delayMs])


	return (
		<div className={className} style={{ opacity, transition: `opacity ${FADE_DURATION_MS}ms ease-in-out` }} {...props}>
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
			className="px-6 py-2 bg-[#0e70c0] enabled:hover:bg-[#1177cb] disabled:opacity-50 disabled:cursor-not-allowed rounded text-white duration-300 transition-all"
			{...props.disabled && {
				'data-tooltip-id': 'void-tooltip',
				'data-tooltip-content': 'Disabled (Please enter all required fields or choose another Provider)',
				'data-tooltip-place': 'top',
			}}
			{...props}
		>
			Next
		</button>
	)
}

const SkipButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded bg-void-bg-2 hover:bg-void-bg-3 text-void-fg-2 duration-300 transition-all"
			{...props}
		>
			Skip
		</button>
	)
}

const PreviousButton = ({ onClick, ...props }: { onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	return (
		<button
			onClick={onClick}
			className="px-6 py-2 rounded text-void-fg-3 opacity-80 hover:brightness-110 duration-300 transition-all"
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
		<div className={`min-h-full flex flex-col gap-4 w-full mx-auto ${hasMaxWidth ? 'max-w-[600px]' : ''} ${className}`}>
			<FadeIn className='w-full pt-16'>{top}</FadeIn>
			<FadeIn className='w-full my-auto'>{content}</FadeIn>
			<div className='w-full pb-8'>{bottom}</div>
		</div>
	)
}

const OllamaDownloadOrRemoveModelButton = ({ modelName, isModelInstalled, sizeGb }: { modelName: string, isModelInstalled: boolean, sizeGb: number | false | 'not-known' }) => {


	// for now just link to the ollama download page
	return <a
		href={`https://ollama.com/library/${modelName}`}
		target="_blank"
		rel="noopener noreferrer"
		className="flex items-center text-void-fg-2 hover:text-void-fg-1"
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
			val === true ? "text text-green-500"
				: val === false ? 'text-red-500'
					: "text text-yellow-500"
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
				const supportsTools = !!!((capabilities as unknown as any).supportsTools)

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
						<td className="py-2 px-3"><YesNoText val={!!supportsTools} /></td>
						<td className="py-2 px-3"><YesNoText val={!!supportsFIM} /></td>
						{/* <td className="py-2 px-3"><YesNoText val={!!reasoningCapabilities} /></td> */}
						{isDetectableLocally && <td className="py-2 px-3">{!!isDownloaded ? <Check className="w-4 h-4" /> : <></>}</td>}
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



type WantToUseOption = 'smart' | 'private' | 'cheap' | 'all'

const VoidOnboardingContent = () => {


	const accessor = useAccessor()
	const voidSettingsService = accessor.get('IVoidSettingsService')

	const voidSettingsState = useSettingsState()

	const [pageIndex, setPageIndex] = useState(0)


	// page 1 state
	const [wantToUseOption, setWantToUseOption] = useState<WantToUseOption>('smart')

	// page 2 state
	const [selectedProviderName, setSelectedProviderName] = useState<ProviderName | null>(null)

	const providerNamesOfWantToUseOption: { [wantToUseOption in WantToUseOption]: ProviderName[] } = {
		smart: ['anthropic', 'openAI', 'gemini', 'openRouter'],
		private: ['ollama', 'vLLM', 'openAICompatible'],
		cheap: ['gemini', 'deepseek', 'openRouter', 'ollama', 'vLLM'],
		all: providerNames,
		// TODO allow user to redo onboarding
	}


	const didFillInProviderSettings = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName]._didFillInProviderSettings
	const isApiKeyLongEnoughIfApiKeyExists = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName].apiKey ? voidSettingsState.settingsOfProvider[selectedProviderName].apiKey.length > 15 : true
	const isAtLeastOneModel = selectedProviderName && voidSettingsState.settingsOfProvider[selectedProviderName].models.length >= 1

	const didFillInSelectedProviderSettings = !!(didFillInProviderSettings && isApiKeyLongEnoughIfApiKeyExists && isAtLeastOneModel)

	const prevAndNextButtons = <div className="max-w-[600px] w-full mx-auto flex flex-col items-end">
		<div className="flex items-center gap-4">
			<PreviousButton
				onClick={() => { setPageIndex(pageIndex - 1) }}
			/>
			<NextButton
				onClick={() => { setPageIndex(pageIndex + 1) }}
				disabled={pageIndex === 2 && !didFillInSelectedProviderSettings}
			/>
		</div>
	</div>


	// cannot be md
	const basicDescOfWantToUseOption: { [wantToUseOption in WantToUseOption]: string } = {
		smart: "Models with the best performance on benchmarks.",
		private: "Fully private and hosted on your computer/network.",
		cheap: "Free and low-cost options.",
		all: "",
	}

	// can be md
	const detailedDescOfWantToUseOption: { [wantToUseOption in WantToUseOption]: string } = {
		smart: "Most intelligent and best for agent mode.",
		private: "Private-hosted so your data never leaves your computer or network. [Email us](mailto:founders@voideditor.com) for help setting up at your company.",
		cheap: "Great deals like Gemini 2.5 Pro or self-host a model with Ollama or vLLM for free.",
		all: "",
	}

	// set the selected provider name appropriately
	useEffect(() => {
		if (wantToUseOption && providerNamesOfWantToUseOption[wantToUseOption].length > 0) {
			setSelectedProviderName(providerNamesOfWantToUseOption[wantToUseOption][0]);
		} else {
			setSelectedProviderName(null);
		}
	}, [wantToUseOption]);

	// set wantToUseOption to smart when page changes
	useEffect(() => {
		setWantToUseOption(wantToUseOption);
	}, [pageIndex]);


	// reset the page to page 0 if the user redos onboarding
	useEffect(() => {
		if (!voidSettingsState.globalSettings.isOnboardingComplete) {
			setPageIndex(0)
		}
	}, [setPageIndex, voidSettingsState.globalSettings.isOnboardingComplete])


	// TODO add a description next to the skip button saying (you can always restart the onboarding in Settings)
	const contentOfIdx: { [pageIndex: number]: React.ReactNode } = {
		// 0: <OnboardingPageShell
		// 	top={
		// 		<div className='bg-green-600 h-6 w-32' />
		// 	}
		// 	content={
		// 		<div className='bg-red-600 h-[10000px] w-32' />
		// 	}
		// 	bottom={
		// 		<div className='bg-blue-600 h-6 w-32' />
		// 	}
		// />,
		0: <OnboardingPageShell
			top={
				<div className="text-5xl font-light text-center">Welcome to Void</div>
			}
			content={
				<FadeIn
					delayMs={500}
					className="text-center"
					onClick={() => { setPageIndex(pageIndex + 1) }}
				>
					Get Started
				</FadeIn>
			}
			bottom={
				''
			}
		/>,
		1: <OnboardingPageShell
			hasMaxWidth={false}
			top={
				<FadeIn className='flex flex-col items-center'>
					<div className="text-5xl font-light text-center">AI Preferences</div>

					<div className="mt-[10%] text-base text-void-fg-2 mb-8 text-center">What are you looking for in an AI model?</div>

					<div className="flex justify-center w-full md:flex-nowrap md:max-w-[80%] max-w-[90%] gap-4">
						<div
							onClick={() => { setWantToUseOption('smart'); setPageIndex(pageIndex + 1); }}
							className="w-full max-w-[250px] h-full relative p-6 aspect-[8/7] border border-void-border-1 rounded-md group flex flex-col items-center justify-center cursor-pointer"
						>
							<div className="absolute inset-0 bg-gradient-to-br from-[#0e70c0]/15 via-[#0e70c0]/5 to-transparent dark:from-[#0e70c0]/20 dark:via-[#0e70c0]/10 dark:to-[#0e70c0]/5 transition-opacity duration-300 ease-in-out opacity-100"></div>
							<div className="absolute inset-0 bg-gradient-to-br from-[#0e70c0]/25 via-[#0e70c0]/10 to-[#0e70c0]/5 dark:from-[#0e70c0]/30 dark:via-[#0e70c0]/15 dark:to-[#0e70c0]/5 transition-opacity duration-300 ease-in-out opacity-0 group-hover:opacity-100"></div>
							<span className="text-5xl mb-4 relative z-10">🧠</span>
							<h3 className="text-xl font-medium mb-3 relative z-10">Intelligence</h3>
							<p className="text-center text-root text-void-fg-2 relative z-10">{basicDescOfWantToUseOption['smart']}</p>
						</div>

						<div
							onClick={() => { setWantToUseOption('private'); setPageIndex(pageIndex + 1); }}
							className="w-full max-w-[250px] h-full relative p-6 aspect-[8/7] border border-void-border-1 rounded-md group flex flex-col items-center justify-center cursor-pointer"
						>
							<div className="absolute inset-0 bg-gradient-to-br from-[#0e70c0]/15 via-[#0e70c0]/5 to-transparent dark:from-[#0e70c0]/20 dark:via-[#0e70c0]/10 dark:to-[#0e70c0]/5 transition-opacity duration-300 ease-in-out opacity-100"></div>
							<div className="absolute inset-0 bg-gradient-to-br from-[#0e70c0]/25 via-[#0e70c0]/10 to-[#0e70c0]/5 dark:from-[#0e70c0]/30 dark:via-[#0e70c0]/15 dark:to-[#0e70c0]/5 transition-opacity duration-300 ease-in-out opacity-0 group-hover:opacity-100"></div>
							<span className="text-5xl mb-4 relative z-10">🔒</span>
							<h3 className="text-xl font-medium mb-3 relative z-10">Privacy</h3>
							<p className="text-center text-root text-void-fg-2 relative z-10">{basicDescOfWantToUseOption['private']}</p>
						</div>

						<div
							onClick={() => { setWantToUseOption('cheap'); setPageIndex(pageIndex + 1); }}
							className="w-full max-w-[250px] h-full relative p-6 aspect-[8/7] border border-void-border-1 rounded-md group flex flex-col items-center justify-center cursor-pointer"
						>
							<div className="absolute inset-0 bg-gradient-to-br from-[#0e70c0]/15 via-[#0e70c0]/5 to-transparent dark:from-[#0e70c0]/20 dark:via-[#0e70c0]/10 dark:to-[#0e70c0]/5 transition-opacity duration-300 ease-in-out opacity-100"></div>
							<div className="absolute inset-0 bg-gradient-to-br from-[#0e70c0]/25 via-[#0e70c0]/10 to-[#0e70c0]/5 dark:from-[#0e70c0]/30 dark:via-[#0e70c0]/15 dark:to-[#0e70c0]/5 transition-opacity duration-300 ease-in-out opacity-0 group-hover:opacity-100"></div>
							<span className="text-5xl mb-4 relative z-10">💵</span>
							<h3 className="text-xl font-medium mb-3 relative z-10">Affordability</h3>
							<p className="text-center text-root text-void-fg-2 relative z-10">{basicDescOfWantToUseOption['cheap']}</p>
						</div>
					</div>

				</FadeIn>
			}
			content={<></>}
		/>,
		2: <OnboardingPageShell
			top={
				<div className='flex flex-col items-center'>
					{/* Title */}
					<div className="text-5xl font-light text-center">Choose a Provider</div>

					{/* Preference Selector */}
					<div className="mt-6 mb-6 mx-auto flex items-center overflow-hidden bg-zinc-700/5 dark:bg-zinc-300/5 rounded-md">
						<button
							onClick={() => {
								setWantToUseOption('smart');
							}}
							className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'smart'
									? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
									: 'text-void-fg-3 hover:text-void-fg-2'
								}
							`}
						>
							Intelligent
						</button>
						<button
							onClick={() => {
								setWantToUseOption('private');
							}}
							className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'private'
									? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
									: 'text-void-fg-3 hover:text-void-fg-2'
								}
							`}
						>
							Private
						</button>
						<button
							onClick={() => {
								setWantToUseOption('cheap');
							}}
							className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'cheap'
									? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
									: 'text-void-fg-3 hover:text-void-fg-2'
								}
							`}
						>
							Low-Cost
						</button>
						<button
							onClick={() => {
								setWantToUseOption('all')
							}}
							className={`py-1 px-2 text-xs cursor-pointer whitespace-nowrap rounded-sm transition-colors
								${wantToUseOption === 'all'
									? 'bg-zinc-700/10 dark:bg-zinc-300/10 text-white font-medium'
									: 'text-void-fg-3 hover:text-void-fg-2'
								}
							`}
						>
							All
						</button>
					</div>


					{/* Provider Buttons */}
					<div
						key={wantToUseOption}
						className="mb-2 flex flex-wrap items-center w-full"
					>

						{(wantToUseOption === 'all' ? providerNames : providerNamesOfWantToUseOption[wantToUseOption]).map((providerName) => {
							const isSelected = selectedProviderName === providerName

							return (
								<button
									key={providerName}
									onClick={() => setSelectedProviderName(providerName)}
									className={`py-[2px] px-2 mx-0.5 my-0.5 text-xs font-medium cursor-pointer relative rounded-full transition-colors duration-150 border
											${isSelected ? 'bg-[#0e70c0] text-white shadow-sm border-[#0e70c0]/80' : 'bg-[#0e70c0]/10 text-void-fg-3 hover:bg-[#0e70c0]/30 border-[#0e70c0]/20'}
										`}
								>
									{displayInfoOfProviderName(providerName).title}
								</button>
							)
						})}

					</div>

					{/* Description */}
					<div className="text-left self-start text-sm text-void-fg-3 px-2 py-1">
						<ChatMarkdownRender string={detailedDescOfWantToUseOption[wantToUseOption]} chatMessageLocation={undefined} />
					</div>


					{/* ModelsTable and ProviderFields */}
					{selectedProviderName && <div className='mt-4'>


						{/* Models Table */}
						<TableOfModelsForProvider providerName={selectedProviderName} />


						{/* Add provider section - simplified styling */}
						<div className='mb-5 mt-8'>
							<div className=''>
								Add {displayInfoOfProviderName(selectedProviderName).title}


								{selectedProviderName === 'ollama' ? ollamaSetupInstructions : ''}

							</div>

							{selectedProviderName &&
								<SettingsForProvider providerName={selectedProviderName} showProviderTitle={false} showProviderSuggestions={false} />
							}

							{/* Button and status indicators */}
							{!didFillInProviderSettings ? <p className="text-xs text-void-fg-3 mt-2">Please fill in all fields to continue</p>
								: !isAtLeastOneModel ? <p className="text-xs text-void-fg-3 mt-2">Please add a model to continue</p>
									: !isApiKeyLongEnoughIfApiKeyExists ? <p className="text-xs text-void-fg-3 mt-2">Please enter a valid API key</p>
										: <div className="mt-2"><AnimatedCheckmarkButton text='Added' /></div>}
						</div>

					</div>}

				</div>

			}

			bottom={
				prevAndNextButtons
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
			top={
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
			bottom={prevAndNextButtons}
		/>,
		4: <OnboardingPageShell
			top={
				<div className="text-5xl font-light text-center">Jump in</div>
			}
			content={
				<div
					className="text-center"
					onClick={() => {
						// TODO make a fadeout effect
						voidSettingsService.setGlobalSetting('isOnboardingComplete', true)
					}}

				>
					Enter the Void
				</div>
			}
			bottom={
				<PreviousButton
					onClick={() => { setPageIndex(pageIndex - 1) }}
				/>
			}
		/>,
	}


	return <div key={pageIndex} className="w-full h-full text-left mx-auto overflow-y-auto flex flex-col items-center justify-around">
		{contentOfIdx[pageIndex]}
	</div>

}
