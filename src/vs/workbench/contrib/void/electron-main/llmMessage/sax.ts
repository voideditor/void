/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Define options for the parser.
export interface SaxParserOptions {
	lowercase?: boolean;
}

// Define the structure for a parsed node.
export interface SaxNode {
	name: string;
	attributes: { [key: string]: string };
}

// Define the interface for the SAX-like parser.
export interface SaxParser {
	// Event handlers that can be set by the consumer.
	onopentag: ((node: SaxNode) => void) | null;
	ontext: ((text: string) => void) | null;
	onclosetag: ((tagName: string) => void) | null;
	// Properties to track current positions (used for raw text extraction).
	startTagPosition: number;
	position: number;
	// Processes a new chunk of text.
	write(chunk: string): void;
}

/**
 * Creates a minimal, event-driven SAX-like parser.
 *
 * @param options An object of type `SaxParserOptions`. Passing `{ lowercase: true }` will force all tag names to be lower-cased.
 * @returns A parser object implementing the `SaxParser` interface.
 */
export function createSaxParser(options: SaxParserOptions = {}): SaxParser {
	// Buffer to hold any leftover text (part of an incomplete tag).
	let buffer: string = '';
	// Global counter to track the total processed characters.
	let globalPos: number = 0;

	const parser: SaxParser = {
		onopentag: null,
		ontext: null,
		onclosetag: null,
		startTagPosition: 0,
		position: 0,

		write(chunk: string): void {
			// Set the starting position before processing the new chunk.
			this.startTagPosition = globalPos;
			buffer += chunk;
			globalPos += chunk.length;
			// Set the current position to the end of the processed chunk.
			this.position = globalPos - 1;

			let cursor: number = 0;
			while (cursor < buffer.length) {
				// Look for the next opening '<' character.
				const ltIndex = buffer.indexOf('<', cursor);
				if (ltIndex === -1) {
					// No more tags found. Emit any remaining text as a text node.
					if (cursor < buffer.length && this.ontext) {
						this.ontext(buffer.substring(cursor));
					}
					// Clear the buffer since all content is processed.
					buffer = '';
					break;
				}

				// Emit any text that appears before the tag.
				if (ltIndex > cursor && this.ontext) {
					this.ontext(buffer.substring(cursor, ltIndex));
				}

				// Look for the closing '>' character.
				const gtIndex = buffer.indexOf('>', ltIndex);
				if (gtIndex === -1) {
					// Incomplete tag detected—retain the remaining content in the buffer.
					buffer = buffer.substring(ltIndex);
					break;
				}

				// Extract the tag content (excluding the '<' and '>').
				let tagContent = buffer.substring(ltIndex + 1, gtIndex).trim();
				if (!tagContent) {
					cursor = gtIndex + 1;
					continue;
				}

				// Check if this is a closing tag (starts with '/').
				if (tagContent[0] === '/') {
					let tagName = tagContent.substring(1).trim();
					if (options.lowercase && tagName) {
						tagName = tagName.toLowerCase();
					}
					if (this.onclosetag) {
						this.onclosetag(tagName);
					}
				} else {
					// Check for self-closing tags (ending with '/').
					let selfClosing = false;
					if (tagContent[tagContent.length - 1] === '/') {
						selfClosing = true;
						tagContent = tagContent.slice(0, -1).trim();
					}
					// Determine the tag name (first word before whitespace).
					const spaceIndex = tagContent.indexOf(' ');
					let tagName = (spaceIndex !== -1 ? tagContent.substring(0, spaceIndex) : tagContent).trim();
					if (options.lowercase && tagName) {
						tagName = tagName.toLowerCase();
					}
					// Call onopentag with a minimal node object.
					if (this.onopentag) {
						const node: SaxNode = { name: tagName, attributes: {} };
						this.onopentag(node);
					}
					// If the tag is self-closing, immediately emit the closing tag event.
					if (selfClosing && this.onclosetag) {
						this.onclosetag(tagName);
					}
				}
				// Move the cursor past the current tag.
				cursor = gtIndex + 1;
			}

			// Remove any content already processed from the buffer.
			buffer = buffer.slice(cursor);
		}

	};

	return parser;
}
