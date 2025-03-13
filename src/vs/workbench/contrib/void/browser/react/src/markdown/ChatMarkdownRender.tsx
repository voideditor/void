/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { JSX, useState } from 'react'
import { marked, MarkedToken, Token } from 'marked'
import { BlockCode, BlockCodeWithApply } from './BlockCode.js'
import { nameToVscodeLanguage } from '../../../../common/helpers/detectLanguage.js'
import { useApplyButtonHTML } from './ApplyBlockHoverButtons.js'
import { useAccessor, useChatThreadsState } from '../util/services.js'
import { Range } from '../../../../../../services/search/common/searchExtTypes.js'
import { IRange } from '../../../../../../../base/common/range.js'
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js'


export type ChatMessageLocation = {
	threadId: string;
	messageIdx: number;
}

type ApplyBoxLocation = ChatMessageLocation & { tokenIdx: string }

const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) => {
	return `${threadId}-${messageIdx}-${tokenIdx}`
}


const Codespan = ({ text, className, onClick }: { text: string, className?: string, onClick?: () => void }) => {

	return <code
		className={`font-mono font-medium rounded-sm bg-void-bg-1 px-1 ${className}`}
		onClick={onClick}
	>
		{text}
	</code>

}

const CodespanWithLink = ({ text, rawText, chatMessageLocation }: { text: string, rawText: string, chatMessageLocation: ChatMessageLocation }) => {

	const accessor = useAccessor()

	const chatThreadService = accessor.get('IChatThreadService')
	const commandSerivce = accessor.get('ICommandService')
	const editorService = accessor.get('ICodeEditorService')

	const { messageIdx, threadId } = chatMessageLocation

	const [didComputeCodespanLink, setDidComputeCodespanLink] = useState<boolean>(false)

	let link = undefined
	if (rawText.endsWith("`")) { // if codespan was completed

		// get link from cache
		link = chatThreadService.getCodespanLink({ codespanStr: text, messageIdx, threadId })

		if (link === undefined) {
			// if no link, generate link and add to cache
			(chatThreadService.generateCodespanLink(text)
				.then(link => {
					chatThreadService.addCodespanLink({ newLinkText: text, newLinkLocation: link, messageIdx, threadId })
					setDidComputeCodespanLink(true) // rerender
				})
			)
		}

	}


	const onClick = () => {

		if (!link) return;
		const selection = link.selection

		// open the file
		commandSerivce.executeCommand('vscode.open', link.uri).then(() => {

			// select the text
			setTimeout(() => {
				if (!selection) return;

				const editor = editorService.getActiveCodeEditor()
				if (!editor) return;

				editor.setSelection(selection)
				editor.revealRange(selection, ScrollType.Immediate)

			}, 50) // needed when document was just opened and needs to initialize

		})

	}

	return <Codespan
		text={text}
		onClick={onClick}
		className={link ? 'underline hover:brightness-90 transition-all duration-200 cursor-pointer' : ''}
	/>
}


export type RenderTokenOptions = { isApplyEnabled?: boolean, isLinkDetectionEnabled?: boolean }
const RenderToken = ({ token, nested, chatMessageLocation, tokenIdx, ...options }: { token: Token | string, nested?: boolean, chatMessageLocation?: ChatMessageLocation, tokenIdx: string, } & RenderTokenOptions): JSX.Element => {

	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken

	if (t.raw.trim() === '') {
		return <></>;
	}

	if (t.type === "space") {
		return <span>{t.raw}</span>
	}

	if (t.type === "code") {

		const language = t.lang === undefined ? undefined : nameToVscodeLanguage[t.lang]

		// TODO user should only be able to apply this when the code has been closed (t.raw ends with "```")

		if (options.isApplyEnabled && chatMessageLocation) {

			const applyBoxId = getApplyBoxId({
				threadId: chatMessageLocation.threadId,
				messageIdx: chatMessageLocation.messageIdx,
				tokenIdx: tokenIdx,
			})

			return <BlockCodeWithApply
				initValue={t.text}
				language={language}
				applyBoxId={applyBoxId}
			/>
		}

		return <BlockCode
			initValue={t.text}
			language={language}
		/>
	}

	if (t.type === "heading") {

		const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements

		return <HeadingTag>{t.text}</HeadingTag>
	}

	if (t.type === "table") {
		return (
			<div>
				<table>
					<thead>
						<tr>
							{t.header.map((cell: any, index: number) => (
								<th key={index}>
									{cell.raw}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{t.rows.map((row: any[], rowIndex: number) => (
							<tr key={rowIndex}>
								{row.map((cell: any, cellIndex: number) => (
									<td key={cellIndex} >
										{cell.raw}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)
		// return (
		// 	<div>
		// 		<table className={"min-w-full border border-void-bg-2"}>
		// 			<thead>
		// 				<tr className="bg-void-bg-1">
		// 					{t.header.map((cell: any, index: number) => (
		// 						<th
		// 							key={index}
		// 							className="px-4 py-2 border border-void-bg-2 font-semibold"
		// 							style={{ textAlign: t.align[index] || "left" }}
		// 						>
		// 							{cell.raw}
		// 						</th>
		// 					))}
		// 				</tr>
		// 			</thead>
		// 			<tbody>
		// 				{t.rows.map((row: any[], rowIndex: number) => (
		// 					<tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-void-bg-1'}>
		// 						{row.map((cell: any, cellIndex: number) => (
		// 							<td
		// 								key={cellIndex}
		// 								className={"px-4 py-2 border border-void-bg-2"}
		// 								style={{ textAlign: t.align[cellIndex] || "left" }}
		// 							>
		// 								{cell.raw}
		// 							</td>
		// 						))}
		// 					</tr>
		// 				))}
		// 			</tbody>
		// 		</table>
		// 	</div>
		// )
	}

	if (t.type === "hr") {
		return <hr />
	}

	if (t.type === "blockquote") {
		return <blockquote>{t.text}</blockquote>
	}

	if (t.type === 'list_item') {
		return <li>
			<input type="checkbox" checked={t.checked} readOnly />
			<span>
				<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={t.text} nested={true} {...options} />
			</span>
		</li>
	}

	if (t.type === "list") {
		const ListTag = t.ordered ? "ol" : "ul"

		return (
			<ListTag start={t.start ? t.start : undefined}>
				{t.items.map((item, index) => (
					<li key={index}>
						{item.task && (
							<input type="checkbox" checked={item.checked} readOnly />
						)}
						<span>
							<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={item.text} nested={true} {...options} />
						</span>
					</li>
				))}
			</ListTag>
		)
	}

	if (t.type === "paragraph") {
		const contents = <>
			{t.tokens.map((token, index) => (
				<RenderToken key={index}
					token={token}
					tokenIdx={`${tokenIdx ? `${tokenIdx}-` : ''}${index}`} // assign a unique tokenId to nested components
					chatMessageLocation={chatMessageLocation}
					{...options}
				/>
			))}
		</>

		if (nested) return contents

		return <p>
			{contents}
		</p>
	}

	if (t.type === "html") {
		return (
			<p>
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
				onClick={() => { window.open(t.href) }}
				href={t.href}
				title={t.title ?? undefined}
				className='underline cursor-pointer hover:brightness-90 transition-all duration-200'
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

		/>
	}

	if (t.type === "strong") {
		return <strong>{t.text}</strong>
	}

	if (t.type === "em") {
		return <em>{t.text}</em>
	}

	// inline code
	if (t.type === "codespan") {

		if (options.isLinkDetectionEnabled && chatMessageLocation) {
			return <CodespanWithLink
				text={t.text}
				rawText={t.raw}
				chatMessageLocation={chatMessageLocation}
			/>

		}

		return <Codespan text={t.text} />
	}

	if (t.type === "br") {
		return <br />
	}

	// strikethrough
	if (t.type === "del") {
		return <del>{t.text}</del>
	}
	// default
	return (
		<div className="bg-orange-50 rounded-sm overflow-hidden p-2">
			<span className="text-sm text-orange-500">Unknown token rendered...</span>
		</div>
	)
}

export const ChatMarkdownRender = ({ string, nested = false, chatMessageLocation, ...options }: { string: string, nested?: boolean, chatMessageLocation: ChatMessageLocation | undefined } & RenderTokenOptions) => {
	const tokens = marked.lexer(string); // https://marked.js.org/using_pro#renderer
	return (
		<>
			{tokens.map((token, index) => (
				<RenderToken key={index} token={token} nested={nested} chatMessageLocation={chatMessageLocation} tokenIdx={index + ''} {...options} />
			))}
		</>
	)
}

