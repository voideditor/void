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

			let cursor = 0;
			// Flag to indicate if an incomplete tag was found.
			let incompleteTagFound = false;
			// This will mark the position in the buffer where the incomplete tag starts.
			let incompleteStart = 0;

			while (cursor < buffer.length) {
				// Look for the next opening '<' character.
				const ltIndex = buffer.indexOf('<', cursor);
				if (ltIndex === -1) {
					// No more tags found in the current buffer.
					if (cursor < buffer.length && this.ontext) {
						this.ontext(buffer.substring(cursor));
					}
					// All content is processed.
					buffer = '';
					cursor = buffer.length;
					break;
				}

				// Emit any text between the current cursor and the opening tag.
				if (ltIndex > cursor && this.ontext) {
					this.ontext(buffer.substring(cursor, ltIndex));
				}

				// Look for the closing '>' character starting from the found '<'.
				const gtIndex = buffer.indexOf('>', ltIndex);
				if (gtIndex === -1) {
					// Incomplete tag detected.
					incompleteTagFound = true;
					// Save the starting point of the incomplete tag.
					incompleteStart = ltIndex;
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
					// Handle self-closing tags (ending with '/').
					let selfClosing = false;
					if (tagContent[tagContent.length - 1] === '/') {
						selfClosing = true;
						tagContent = tagContent.slice(0, -1).trim();
					}
					// Determine the tag name (first word before any whitespace).
					const spaceIndex = tagContent.indexOf(' ');
					let tagName =
						spaceIndex !== -1
							? tagContent.substring(0, spaceIndex).trim()
							: tagContent;
					if (options.lowercase && tagName) {
						tagName = tagName.toLowerCase();
					}
					// Emit an open tag event.
					if (this.onopentag) {
						const node: SaxNode = { name: tagName, attributes: {} };
						this.onopentag(node);
					}
					// If it’s a self-closing tag, immediately emit a close tag event.
					if (selfClosing && this.onclosetag) {
						this.onclosetag(tagName);
					}
				}
				// Move the cursor past the current tag.
				cursor = gtIndex + 1;
			}

			// If an incomplete tag was detected, preserve it.
			if (incompleteTagFound) {
				// Keep the incomplete portion starting from the '<'
				buffer = buffer.substring(incompleteStart);
			} else {
				// Otherwise, remove all processed content.
				buffer = buffer.substring(cursor);
			}
		},
	};

	return parser;
}
