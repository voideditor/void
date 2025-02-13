/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { JSX, useCallback, useEffect, useState } from 'react'
import { marked, MarkedToken, Token } from 'marked'
import { BlockCode } from './BlockCode.js'
import { useAccessor, useChatThreadsState, useChatThreadsStreamState } from '../util/services.js'
import { ChatMessageLocation, } from '../../../searchAndReplaceService.js'
import { nameToVscodeLanguage } from '../../../helpers/detectLanguage.js'


enum CopyButtonState {
	Copy = 'Copy',
	Copied = 'Copied!',
	Error = 'Could not copy',
}

const COPY_FEEDBACK_TIMEOUT = 1000 // amount of time to say 'Copied!'



type ApplyBoxLocation = ChatMessageLocation & { tokenIdx: number }

const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) => {
	return `${threadId}-${messageIdx}-${tokenIdx}`
}



const ApplyButtonsOnHover = ({ applyStr, applyBoxId }: { applyStr: string, applyBoxId: string }) => {
	const accessor = useAccessor()

	const [copyButtonState, setCopyButtonState] = useState(CopyButtonState.Copy)
	const inlineDiffService = accessor.get('IInlineDiffsService')
	const clipboardService = accessor.get('IClipboardService')
	const metricsService = accessor.get('IMetricsService')

	useEffect(() => {

		if (copyButtonState !== CopyButtonState.Copy) {
			setTimeout(() => {
				setCopyButtonState(CopyButtonState.Copy)
			}, COPY_FEEDBACK_TIMEOUT)
		}
	}, [copyButtonState])

	const onCopy = useCallback(() => {
		clipboardService.writeText(applyStr)
			.then(() => { setCopyButtonState(CopyButtonState.Copied) })
			.catch(() => { setCopyButtonState(CopyButtonState.Error) })
		metricsService.capture('Copy Code', { length: applyStr.length }) // capture the length only

	}, [metricsService, clipboardService, applyStr])

	const onApply = useCallback(() => {

		inlineDiffService.startApplying({
			from: 'ClickApply',
			type: 'searchReplace',
			applyStr,
		})
		metricsService.capture('Apply Code', { length: applyStr.length }) // capture the length only
	}, [metricsService, inlineDiffService, applyStr])

	const isSingleLine = !applyStr.includes('\n')

	return <>
		<button
			className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
			onClick={onCopy}
		>
			{copyButtonState}
		</button>
		<button
			// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
			className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
			onClick={onApply}
		>
			Apply
		</button>
	</>
}

export const CodeSpan = ({ children, className }: { children: React.ReactNode, className?: string }) => {
	return <code className={`
			bg-void-bg-1
			px-1
			rounded-sm
			font-mono font-medium
			break-all
			${className}
		`}
	>
		{children}
	</code>
}

const RenderToken = ({ token, nested = false, noSpace = false, chatMessageLocation: chatLocation, tokenIdx }: { token: Token | string, nested?: boolean, noSpace?: boolean, chatMessageLocation?: ChatMessageLocation, tokenIdx: number }): JSX.Element => {


	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken
	// console.log('render:', t.raw)

	if (t.type === "space") {
		return <span>{t.raw}</span>
	}

	if (t.type === "code") {
		const isCodeblockClosed = t.raw?.startsWith('```') && t.raw?.endsWith('```');

		const applyBoxId = getApplyBoxId({
			threadId: chatLocation!.threadId,
			messageIdx: chatLocation!.messageIdx,
			tokenIdx: tokenIdx,
		})

		return <BlockCode
			initValue={t.text}
			language={t.lang === undefined ? undefined : nameToVscodeLanguage[t.lang]}
			buttonsOnHover={<ApplyButtonsOnHover applyStr={t.text} applyBoxId={applyBoxId} />}
		/>
	}

	if (t.type === "heading") {
		const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements
		const headingClasses: { [h: string]: string } = {
			h1: "text-4xl font-semibold mt-6 mb-4 pb-2 border-b border-void-bg-2",
			h2: "text-3xl font-semibold mt-6 mb-4 pb-2 border-b border-void-bg-2",
			h3: "text-2xl font-semibold mt-6 mb-4",
			h4: "text-xl font-semibold mt-6 mb-4",
			h5: "text-lg font-semibold mt-6 mb-4",
			h6: "text-base font-semibold mt-6 mb-4 text-gray-600"
		}
		return <HeadingTag className={headingClasses[HeadingTag]}>{t.text}</HeadingTag>
	}

	if (t.type === "table") {
		return (
			<div className={`${noSpace ? '' : 'my-4'} overflow-x-auto`}>
				<table className="min-w-full border border-void-bg-2">
					<thead>
						<tr className="bg-void-bg-1">
							{t.header.map((cell: any, index: number) => (
								<th
									key={index}
									className="px-4 py-2 border border-void-bg-2 font-semibold"
									style={{ textAlign: t.align[index] || "left" }}
								>
									{cell.raw}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{t.rows.map((row: any[], rowIndex: number) => (
							<tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-void-bg-1'}>
								{row.map((cell: any, cellIndex: number) => (
									<td
										key={cellIndex}
										className="px-4 py-2 border border-void-bg-2"
										style={{ textAlign: t.align[cellIndex] || "left" }}
									>
										{cell.raw}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)
	}

	if (t.type === "hr") {
		return <hr className="my-6 border-t border-void-bg-2" />
	}

	if (t.type === "blockquote") {
		return <blockquote className={`pl-4 border-l-4 border-void-bg-2 italic ${noSpace ? '' : 'my-4'}`}>{t.text}</blockquote>
	}

	if (t.type === "list") {
		const ListTag = t.ordered ? "ol" : "ul"
		return (
			<ListTag
				start={t.start ? t.start : undefined}
				className={`list-inside pl-2 ${noSpace ? '' : 'my-4'} ${t.ordered ? "list-decimal" : "list-disc"}`}
			>
				{t.items.map((item, index) => (
					<li key={index} className={`${noSpace ? '' : 'mb-4'}`}>
						{item.task && (
							<input type="checkbox" checked={item.checked} readOnly className="mr-2 form-checkbox" />
						)}
						<span className="ml-1">
							<ChatMarkdownRender string={item.text} nested={true} />
						</span>
					</li>
				))}
			</ListTag>
		)
	}

	if (t.type === "paragraph") {
		const contents = <>
			{t.tokens.map((token, index) => (
				<RenderToken key={index} token={token} tokenIdx={index} /> // assign a unique tokenId to nested components
			))}
		</>
		if (nested) return contents

		return <p className={`${noSpace ? '' : 'my-4'}`}>
			{contents}
		</p>
	}

	if (t.type === "html") {
		return (
			<p className={`${noSpace ? '' : 'my-4'}`}>
				{t.raw}
			</p>
		)
	}

	if (t.type === "text" || t.type === "escape") {
		return <span>{t.raw}</span>
	}

	if (t.type === "def") {
		return <></> // Definitions are typically not rendered
	}

	if (t.type === "link") {
		return (
			<a
				className='underline'
				onClick={() => { window.open(t.href) }}
				href={t.href}
				title={t.title ?? undefined}
			>
				{t.text}
			</a>
		)
	}

	if (t.type === "image") {
		return <img
			src={t.href}
			alt={t.text}
			title={t.title ?? undefined}
			className={`max4w-full h-auto rounded ${noSpace ? '' : 'my-4'}`}
		/>
	}

	if (t.type === "strong") {
		return <strong className="font-semibold">{t.text}</strong>
	}

	if (t.type === "em") {
		return <em className="italic">{t.text}</em>
	}

	// inline code
	if (t.type === "codespan") {
		return (
			<CodeSpan>
				{t.text}
			</CodeSpan>
		)
	}

	if (t.type === "br") {
		return <br />
	}

	// strikethrough
	if (t.type === "del") {
		return <del className="line-through">{t.text}</del>
	}

	// default
	return (
		<div className="bg-orange-50 rounded-sm overflow-hidden p-2">
			<span className="text-sm text-orange-500">Unknown type:</span>
			{t.raw}
		</div>
	)
}

export const ChatMarkdownRender = ({ string, nested = false, noSpace, chatMessageLocation }: { string: string, nested?: boolean, noSpace?: boolean, chatMessageLocation?: ChatMessageLocation }) => {
	const tokens = marked.lexer(string); // https://marked.js.org/using_pro#renderer
	return (
		<>
			{tokens.map((token, index) => (
				<RenderToken key={index} token={token} nested={nested} noSpace={noSpace} chatMessageLocation={chatMessageLocation} tokenIdx={index} />
			))}
		</>
	)
}

