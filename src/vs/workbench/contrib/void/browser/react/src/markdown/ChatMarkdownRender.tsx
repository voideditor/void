/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { JSX } from 'react'
import { marked, MarkedToken, Token } from 'marked'
import { BlockCode } from './BlockCode.js'
import { nameToVscodeLanguage } from '../../../../common/helpers/detectLanguage.js'
import { ApplyBlockHoverButtons } from './ApplyBlockHoverButtons.js'

export type ChatMessageLocation = {
	threadId: string;
	messageIdx: number;
}

type ApplyBoxLocation = ChatMessageLocation & { tokenIdx: string }

const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) => {
	return `${threadId}-${messageIdx}-${tokenIdx}`
}




// all classnames must go in tailwind.config.js/safelist
export const noSpaceStyles = {
	blockquote: 'pl-4 border-l-4 border-void-bg-2 italic',
	br: '',
	code: '',
	codespan: 'bg-void-bg-1 px-1 rounded-sm font-mono font-medium break-all',
	def: '',
	del: 'line-through',
	em: 'italic',
	escape: '',
	heading: {
		h1: "text-4xl font-semibold pb-2 border-b border-void-bg-2",
		h2: "text-3xl font-semibold pb-2 border-b border-void-bg-2",
		h3: "text-2xl font-semibold",
		h4: "text-xl font-semibold",
		h5: "text-lg font-semibold",
		h6: "text-base font-semibold text-gray-600"
	},
	hr: 'border-t border-void-bg-2',
	html: '',
	image: 'max-w-full h-auto rounded',
	link: 'underline cursor-pointer',
	list: 'list-inside pl-2',
	list_item: '',
	paragraph: '',
	space: '',
	strong: 'font-semibold',
	table: 'overflow-x-auto',
	text: '',
}


const defaultStyles = {
	blockquote: 'mx-2 pl-4 border-l-4 border-void-bg-2 italic my-4',
	br: '',
	code: 'mx-2 my-4',
	codespan: 'bg-void-bg-1 px-1 rounded-sm font-mono font-medium break-all',
	def: '',
	del: 'line-through',
	em: 'italic',
	escape: '',
	heading: {
		h1: 'mx-2 text-4xl font-semibold mt-6 mb-4 pb-2 border-b border-void-bg-2',
		h2: 'mx-2 text-3xl font-semibold mt-6 mb-4 pb-2 border-b border-void-bg-2',
		h3: 'mx-2 text-2xl font-semibold mt-6 mb-4',
		h4: 'mx-2 text-xl font-semibold mt-6 mb-4',
		h5: 'mx-2 text-lg font-semibold mt-6 mb-4',
		h6: 'mx-2 text-base font-semibold mt-6 mb-4 text-gray-600'
	},
	hr: 'mx-2 my-6 border-t border-void-bg-2',
	html: 'mx-2 my-4',
	image: 'mx-2 my-4 max-w-full h-auto rounded',
	link: 'mx-2 underline',
	list: 'mx-2 my-2 list-inside pl-2',
	list_item: 'mx-2 mb-2',
	paragraph: 'mx-2 my-4',
	space: '',
	strong: 'mx-2 font-semibold',
	table: 'mx-2 my-4 overflow-x-auto',
	text: '',
}

const RenderToken = ({ token, nested, chatMessageLocationForApply, tokenIdx }: { token: Token | string, nested?: boolean, chatMessageLocationForApply?: ChatMessageLocation, tokenIdx: string }): JSX.Element => {

	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken

	if (t.raw.trim() === '') {
		return <></>;
	}

	if (t.type === "space") {
		return <span>{t.raw}</span>
	}

	if (t.type === "code") {

		const applyBoxId = chatMessageLocationForApply ? getApplyBoxId({
			threadId: chatMessageLocationForApply.threadId,
			messageIdx: chatMessageLocationForApply.messageIdx,
			tokenIdx: tokenIdx,
		}) : null

		return <div>
			<BlockCode
				initValue={t.text}
				language={t.lang === undefined ? undefined : nameToVscodeLanguage[t.lang]}
				buttonsOnHover={applyBoxId && <ApplyBlockHoverButtons applyBoxId={applyBoxId} codeStr={t.text} />}
			/>
		</div>
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
				<ChatMarkdownRender chatMessageLocationForApply={chatMessageLocationForApply} string={t.text} nested={true} />
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
							<ChatMarkdownRender chatMessageLocationForApply={chatMessageLocationForApply} string={item.text} nested={true} />
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
		return (
			<code className="font-mono font-semibold rounded-sm bg-void-bg-1 px-1">
				{t.text}
			</code>
		)
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

export const ChatMarkdownRender = ({ string, nested = false, chatMessageLocationForApply }: { string: string, nested?: boolean, chatMessageLocationForApply?: ChatMessageLocation }) => {
	const tokens = marked.lexer(string); // https://marked.js.org/using_pro#renderer
	return (
		<>
			{tokens.map((token, index) => (
				<RenderToken key={index} token={token} nested={nested} chatMessageLocationForApply={chatMessageLocationForApply} tokenIdx={index + ''} />
			))}
		</>
	)
}

