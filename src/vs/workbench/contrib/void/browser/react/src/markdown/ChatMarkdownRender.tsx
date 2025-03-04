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


const cn = (className: string) => className?.split(' ').map(c => c ? `void-${c}` : '').join(' ')


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



type TokenClasses = typeof defaultStyles

const RenderToken = ({ token, nested, chatMessageLocationForApply, tokenIdx, classes }: { token: Token | string, nested?: boolean, chatMessageLocationForApply?: ChatMessageLocation, tokenIdx: string, classes?: TokenClasses }): JSX.Element => {


	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken

	if(t.raw.trim() ===''){
		return <></>;
	}

	// compute the className
	const defaultClassName = defaultStyles[t.type]
	const classNameOverride = classes?.[t.type]
	const _className = classNameOverride ?? defaultClassName
	let className: string = ''
	if (typeof defaultClassName === 'string') {
		className = _className as string
	}

	if (t.type === "space") {
		return <span className={cn(className)}>{t.raw}</span>
	}

	if (t.type === "code") {

		const applyBoxId = chatMessageLocationForApply ? getApplyBoxId({
			threadId: chatMessageLocationForApply.threadId,
			messageIdx: chatMessageLocationForApply.messageIdx,
			tokenIdx: tokenIdx,
		}) : null

		return <div className={cn(className)}>
			<BlockCode
				initValue={t.text}
				language={t.lang === undefined ? undefined : nameToVscodeLanguage[t.lang]}
				buttonsOnHover={applyBoxId && <ApplyBlockHoverButtons applyBoxId={applyBoxId} codeStr={t.text} />}
			/>
		</div>
	}

	if (t.type === "heading") {

		const HeadingTag = `h${t.depth}` as keyof typeof defaultStyles.heading

		const className = classes?.heading[HeadingTag] ?? defaultStyles.heading[HeadingTag]

		return <HeadingTag className={cn(className)}>{t.text}</HeadingTag>
	}

	if (t.type === "table") {
		return (
			<div className={cn(className)}>
				<table className={"min-w-full border border-void-bg-2"}>
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
										className={"px-4 py-2 border border-void-bg-2"}
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
		return <hr className={cn(className)} />
	}

	if (t.type === "blockquote") {
		return <blockquote className={cn(className)}>{t.text}</blockquote>
	}

	if (t.type === 'list_item') {
		<li className={cn(className)}>
			<span className="ml-1">
				!!!!!!!!!!!!!
				<ChatMarkdownRender chatMessageLocationForApply={chatMessageLocationForApply} string={t.text} nested={true} />
			</span>
		</li>
	}

	if (t.type === "list") {
		const ListTag = t.ordered ? "ol" : "ul"

		const itemClassName = classes?.['list_item'] ?? defaultStyles['list_item']

		return (
			<ListTag
				start={t.start ? t.start : undefined}
				className={`${cn(className)} ${t.ordered ? "list-decimal" : "list-disc"}`}
			>
				{t.items.map((item, index) => (
					<li key={index} className={cn(itemClassName)}>
						{item.task && (
							<input type="checkbox" checked={item.checked} readOnly className="mr-2 form-checkbox" />
						)}
						<span className="ml-1">
							<ChatMarkdownRender chatMessageLocationForApply={chatMessageLocationForApply} string={item.text} nested={true} />
						</span>
					</li>
				))}
			</ListTag>
		)
		// attempt at indentation
		// return (
		// 	<ListTag
		// 		start={t.start ? t.start : undefined}
		// 			className={`${className} ${t.ordered ? "list-decimal" : "list-disc"}`}
		// 		>
		// 		{t.items.map((item, index) => (
		// 			<li key={index} className={`itemClassName`}>
		// 				{item.task && (
		// 					<input type="checkbox" className='mr-2 form-checkbox' checked={item.checked} readOnly />
		// 				)}
		// 				<span className-='inline-block pr-2'>
		// 					<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={item.text} nested={true} />
		// 				</span>
		// 			</li>
		// 		))}
		// 	</ListTag>
		// )
	}

	if (t.type === "paragraph") {
		const contents = <>
			{t.tokens.map((token, index) => (
				<RenderToken key={index} token={token} tokenIdx={`${tokenIdx ? `${tokenIdx}-` : ''}${index}`} classes={classes} /> // assign a unique tokenId to nested components
			))}
		</>
		if (nested) return contents

		return <p className={cn(className)}>
			{contents}
		</p>
	}

	if (t.type === "html") {
		return (
			<p className={cn(className)}>
				{t.raw}
			</p>
		)
	}

	if (t.type === "text" || t.type === "escape") {
		return <span className={cn(className)}>{t.raw}</span>
	}

	if (t.type === "def") {
		return <></> // Definitions are typically not rendered
	}

	if (t.type === "link") {
		return (
			<a
				className={cn(className)}
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
			className={cn(className)}
		/>
	}

	if (t.type === "strong") {
		return <strong className={cn(className)}>{t.text}</strong>
	}

	if (t.type === "em") {
		return <em className={cn(className)}>{t.text}</em>
	}

	// inline code
	if (t.type === "codespan") {
		return (
			<code className={cn(className)}>
				{t.text}
			</code>
		)
	}

	if (t.type === "br") {
		return <br className={cn(className)} />
	}

	// strikethrough
	if (t.type === "del") {
		return <del className={cn(className)}>{t.text}</del>
	}

	// default
	return (
		<div className="bg-orange-50 rounded-sm overflow-hidden p-2">
			<span className="text-sm text-orange-500">Unknown type:</span>
			{t.type}
			{t.raw}
		</div>
	)
}

export const ChatMarkdownRender = ({ string, nested = false, classes, chatMessageLocationForApply }: { string: string, nested?: boolean, classes?: TokenClasses, chatMessageLocationForApply?: ChatMessageLocation }) => {
	const tokens = marked.lexer(string); // https://marked.js.org/using_pro#renderer
	return (
		<>
			{tokens.map((token, index) => (
				<RenderToken key={index} token={token} nested={nested} classes={classes} chatMessageLocationForApply={chatMessageLocationForApply} tokenIdx={index + ''} />
			))}
		</>
	)
}

