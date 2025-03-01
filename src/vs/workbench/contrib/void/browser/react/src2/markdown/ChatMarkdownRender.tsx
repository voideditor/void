/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { JSX, useCallback, useEffect, useState } from 'react';
import { marked, MarkedToken, Token } from 'marked';
import { BlockCode } from './BlockCode.js';
import { useAccessor, useChatThreadsState, useChatThreadsStreamState } from '../util/services.js';
import { ChatMessageLocation } from '../../../searchAndReplaceService.js';
import { nameToVscodeLanguage } from '../../../helpers/detectLanguage.js';


enum CopyButtonState {
  Copy = 'Copy',
  Copied = 'Copied!',
  Error = 'Could not copy',
}

const COPY_FEEDBACK_TIMEOUT = 1000; // amount of time to say 'Copied!'



type ApplyBoxLocation = ChatMessageLocation & {tokenIdx: string;};

const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) => {
  return `${threadId}-${messageIdx}-${tokenIdx}`;
};



const ApplyButtonsOnHover = ({ applyStr, applyBoxId }: {applyStr: string;applyBoxId: string;}) => {
  const accessor = useAccessor();

  const [copyButtonState, setCopyButtonState] = useState(CopyButtonState.Copy);
  const inlineDiffService = accessor.get('IInlineDiffsService');
  const clipboardService = accessor.get('IClipboardService');
  const metricsService = accessor.get('IMetricsService');

  useEffect(() => {

    if (copyButtonState !== CopyButtonState.Copy) {
      setTimeout(() => {
        setCopyButtonState(CopyButtonState.Copy);
      }, COPY_FEEDBACK_TIMEOUT);
    }
  }, [copyButtonState]);

  const onCopy = useCallback(() => {
    clipboardService.writeText(applyStr).
    then(() => {setCopyButtonState(CopyButtonState.Copied);}).
    catch(() => {setCopyButtonState(CopyButtonState.Error);});
    metricsService.capture('Copy Code', { length: applyStr.length }); // capture the length only

  }, [metricsService, clipboardService, applyStr]);

  const onApply = useCallback(() => {

    inlineDiffService.startApplying({
      from: 'ClickApply',
      type: 'searchReplace',
      applyStr
    });
    metricsService.capture('Apply Code', { length: applyStr.length }); // capture the length only
  }, [metricsService, inlineDiffService, applyStr]);

  const isSingleLine = !applyStr.includes('\n');

  return <>
		<button
      className={`${isSingleLine ? "" : "void-px-1 void-py-0.5"} void-text-sm void-bg-void-bg-1 void-text-void-fg-1 hover:void-brightness-110 void-border void-border-vscode-input-border void-rounded`}
      onClick={onCopy}>

			{copyButtonState}
		</button>
		<button
    // btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
    className={`${isSingleLine ? "" : "void-px-1 void-py-0.5"} void-text-sm void-bg-void-bg-1 void-text-void-fg-1 hover:void-brightness-110 void-border void-border-vscode-input-border void-rounded`}
    onClick={onApply}>

			Apply
		</button>
	</>;
};

export const CodeSpan = ({ children, className }: {children: React.ReactNode;className?: string;}) => {
  return <code className={` void-bg-void-bg-1 void-px-1 void-rounded-sm void-font-mono void-font-medium void-break-all ${





  className} `}>


		{children}
	</code>;
};

const RenderToken = ({ token, nested = false, noSpace = false, chatMessageLocation: chatLocation, tokenIdx }: {token: Token | string;nested?: boolean;noSpace?: boolean;chatMessageLocation?: ChatMessageLocation;tokenIdx: string;}): JSX.Element => {


  // deal with built-in tokens first (assume marked token)
  const t = token as MarkedToken;
  // console.log('render:', t.raw)

  if (t.type === "space") {
    return <span>{t.raw}</span>;
  }

  if (t.type === "code") {
    const isCodeblockClosed = t.raw?.startsWith('```') && t.raw?.endsWith('```');

    const applyBoxId = getApplyBoxId({
      threadId: chatLocation!.threadId,
      messageIdx: chatLocation!.messageIdx,
      tokenIdx: tokenIdx
    });

    return <BlockCode
      initValue={t.text}
      language={t.lang === undefined ? undefined : nameToVscodeLanguage[t.lang]}
      buttonsOnHover={<ApplyButtonsOnHover applyStr={t.text} applyBoxId={applyBoxId} />} />;

  }

  if (t.type === "heading") {
    const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements;
    const headingClasses: {[h: string]: string;} = {
      h1: "text-4xl font-semibold mt-6 mb-4 pb-2 border-b border-void-bg-2",
      h2: "text-3xl font-semibold mt-6 mb-4 pb-2 border-b border-void-bg-2",
      h3: "text-2xl font-semibold mt-6 mb-4",
      h4: "text-xl font-semibold mt-6 mb-4",
      h5: "text-lg font-semibold mt-6 mb-4",
      h6: "text-base font-semibold mt-6 mb-4 text-gray-600"
    };
    return <HeadingTag className={headingClasses[HeadingTag]}>{t.text}</HeadingTag>;
  }

  if (t.type === "table") {
    return (
      <div className={`${noSpace ? "" : "void-my-4"} void-overflow-x-auto`}>
				<table className="void-min-w-full void-border void-border-void-bg-2">
					<thead>
						<tr className="void-bg-void-bg-1">
							{t.header.map((cell: any, index: number) =>
              <th
                key={index}
                className="void-px-4 void-py-2 void-border void-border-void-bg-2 void-font-semibold"
                style={{ textAlign: t.align[index] || "left" }}>

									{cell.raw}
								</th>
              )}
						</tr>
					</thead>
					<tbody>
						{t.rows.map((row: any[], rowIndex: number) =>
            <tr key={rowIndex} className={rowIndex % 2 === 0 ? "void-bg-white" : "void-bg-void-bg-1"}>
								{row.map((cell: any, cellIndex: number) =>
              <td
                key={cellIndex}
                className="void-px-4 void-py-2 void-border void-border-void-bg-2"
                style={{ textAlign: t.align[cellIndex] || "left" }}>

										{cell.raw}
									</td>
              )}
							</tr>
            )}
					</tbody>
				</table>
			</div>);

  }

  if (t.type === "hr") {
    return <hr className="void-my-6 void-border-t void-border-void-bg-2" />;
  }

  if (t.type === "blockquote") {
    return <blockquote className={`void-pl-4 void-border-l-4 void-border-void-bg-2 void-italic ${noSpace ? "" : "void-my-4"}`}>{t.text}</blockquote>;
  }

  if (t.type === "list") {
    const ListTag = t.ordered ? "ol" : "ul";
    return (
      <ListTag
        start={t.start ? t.start : undefined}
        className={`void-list-inside void-pl-2 ${noSpace ? "" : "void-my-4"} ${t.ordered ? "void-list-decimal" : "void-list-disc"}`}>

				{t.items.map((item, index) =>
        <li key={index} className={`${noSpace ? "" : "void-mb-4"}`}>
						{item.task &&
          <input type="checkbox" checked={item.checked} readOnly className="void-mr-2 void-form-checkbox" />
          }
						<span className="void-ml-1">
							<ChatMarkdownRender string={item.text} nested={true} />
						</span>
					</li>
        )}
			</ListTag>);

  }

  if (t.type === "paragraph") {
    const contents = <>
			{t.tokens.map((token, index) =>
      <RenderToken key={index} token={token} tokenIdx={`${tokenIdx ? `${tokenIdx}-` : ''}${index}`} /> // assign a unique tokenId to nested components
      )}
		</>;
    if (nested) return contents;

    return <p className={`${noSpace ? "" : "void-my-4"}`}>
			{contents}
		</p>;
  }

  if (t.type === "html") {
    return (
      <p className={`${noSpace ? "" : "void-my-4"}`}>
				{t.raw}
			</p>);

  }

  if (t.type === "text" || t.type === "escape") {
    return <span>{t.raw}</span>;
  }

  if (t.type === "def") {
    return <></>; // Definitions are typically not rendered
  }

  if (t.type === "link") {
    return (
      <a
        className="void-underline"
        onClick={() => {window.open(t.href);}}
        href={t.href}
        title={t.title ?? undefined}>

				{t.text}
			</a>);

  }

  if (t.type === "image") {
    return <img
      src={t.href}
      alt={t.text}
      title={t.title ?? undefined}
      className={`void-max4w-full void-h-auto void-rounded ${noSpace ? "" : "void-my-4"}`} />;

  }

  if (t.type === "strong") {
    return <strong className="void-font-semibold">{t.text}</strong>;
  }

  if (t.type === "em") {
    return <em className="void-italic">{t.text}</em>;
  }

  // inline code
  if (t.type === "codespan") {
    return (
      <CodeSpan>
				{t.text}
			</CodeSpan>);

  }

  if (t.type === "br") {
    return <br />;
  }

  // strikethrough
  if (t.type === "del") {
    return <del className="void-line-through">{t.text}</del>;
  }

  // default
  return (
    <div className="void-bg-orange-50 void-rounded-sm void-overflow-hidden void-p-2">
			<span className="void-text-sm void-text-orange-500">Unknown type:</span>
			{t.raw}
		</div>);

};

export const ChatMarkdownRender = ({ string, nested = false, noSpace, chatMessageLocation }: {string: string;nested?: boolean;noSpace?: boolean;chatMessageLocation?: ChatMessageLocation;}) => {
  const tokens = marked.lexer(string); // https://marked.js.org/using_pro#renderer
  return (
    <>
			{tokens.map((token, index) =>
      <RenderToken key={index} token={token} nested={nested} noSpace={noSpace} chatMessageLocation={chatMessageLocation} tokenIdx={index + ''} />
      )}
		</>);

};