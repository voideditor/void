import React, { JSX, useState } from 'react';
import { MarkedToken, Token, TokensList } from 'marked';
import { awaitVSCodeResponse, getVSCodeAPI } from './getVscodeApi';


// code block with Apply button at top
export const BlockCode = ({ text, disableApplyButton = false }: { text: string, disableApplyButton?: boolean }) => {
	return <div className='py-1'>
		{disableApplyButton ? null : <div className='text-sm'>
			<button className='btn btn-secondary px-3 py-1 text-sm rounded-t-sm'
				onClick={async () => { getVSCodeAPI().postMessage({ type: 'applyChanges', code: text }) }}>Apply</button>
		</div>}
		<div className={`overflow-x-auto rounded-sm text-vscode-editor-fg bg-vscode-editor-bg ${disableApplyButton ? '' : 'rounded-tl-none'}`}>
			<pre className='p-3'>
				{text}
			</pre>
		</div>
	</div>
}

const Render = ({ token }: { token: Token }) => {

	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken

	if (t.type === "space") {
		return <span>{t.raw}</span>;
	}

	if (t.type === "code") {
		return <BlockCode text={t.text} />
	}

	if (t.type === "heading") {
		const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements;
		return <HeadingTag>{t.text}</HeadingTag>;
	}

	if (t.type === "table") {
		return (
			<table>
				<thead>
					<tr>
						{t.header.map((cell: any, index: number) => (
							<th key={index} style={{ textAlign: t.align[index] || 'left' }}>
								{cell.raw}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{t.rows.map((row: any[], rowIndex: number) => (
						<tr key={rowIndex}>
							{row.map((cell: any, cellIndex: number) => (
								<td key={cellIndex} style={{ textAlign: t.align[cellIndex] || 'left' }}>
									{cell.raw}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		);
	}

	if (t.type === "hr") {
		return <hr />;
	}

	if (t.type === "blockquote") {
		return <blockquote>{t.text}</blockquote>;
	}

	if (t.type === "list") {

		const ListTag = t.ordered ? 'ol' : 'ul';
		return (
			<ListTag start={t.start !== '' ? t.start : undefined}
				className={`list-inside ${t.ordered ? 'list-decimal' : 'list-disc'}`}
			>
				{t.items.map((item, index) => (
					<li key={index}>
						{item.task && (
							<input type="checkbox" checked={item.checked} readOnly />
						)}
						{item.text}
					</li>
				))}
			</ListTag>
		);
	}

	if (t.type === "paragraph") {
		return <p>
			{t.tokens.map((token, index) => (
				<Render key={index} token={token} />
			))}
		</p>;
	}

	if (t.type === "html") {
		return <pre>{`<html>`}{t.raw}{`</html>`}</pre>;
	}

	if (t.type === "text" || t.type === "escape") {
		return <span>{t.raw}</span>;
	}

	if (t.type === "def") {
		return null; // Definitions are typically not rendered
	}

	if (t.type === "link") {
		return <a href={t.href} title={t.title ?? undefined}>{t.text}</a>;
	}

	if (t.type === "image") {
		return <img src={t.href} alt={t.text} title={t.title ?? undefined} />;
	}

	if (t.type === "strong") {
		return <strong>{t.text}</strong>;
	}

	if (t.type === "em") {
		return <em>{t.text}</em>;
	}

	// inline code
	if (t.type === "codespan") {
		return <code className='text-vscode-editor-fg bg-vscode-editor-bg px-1 rounded-sm font-mono'>{t.text}</code>;
	}

	if (t.type === "br") {
		return <br />;
	}

	if (t.type === "del") {
		return <del>{t.text}</del>;
	}


	// default
	return <div className='bg-orange-50 rounded-sm overflow-hidden'>
		<span className='text-xs text-orange-500'>Unknown type:</span>
		{t.raw}
	</div>;
};

const MarkdownRender = ({ tokens }: { tokens: TokensList }) => {
	return (
		<>
			{tokens.map((token, index) => (
				<Render key={index} token={token} />
			))}
		</>
	);
};

export default MarkdownRender;
