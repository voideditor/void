/**
 * mcp-response-types.ts
 * --------------------------------------------------
 * **Pure** TypeScript interfaces (no external imports)
 * describing the JSON-RPC response shapes for:
 *
 *   1. tools/list      -> ToolsListResponse
 *   2. prompts/list    -> PromptsListResponse
 *   3. tools/call      -> ToolCallResponse
 *
 * They are distilled directly from the official MCP
 * 2025‑03‑26 specification:
 *   • Tools list response examples
 *   • Prompts list response examples
 *   • Tool call response examples
 *
 * Use them to get full IntelliSense when working with
 * @modelcontextprotocol/inspector‑cli responses.
 */


/* -------------------------------------------------- */
/* Core JSON‑RPC envelope                              */
/* -------------------------------------------------- */

export interface JsonRpcSuccess<T> {
	/** JSON‑RPC version – always '2.0' */
	jsonrpc: '2.0';
	/** Request identifier echoed back by the server */
	id: string | number | null;
	/** The successful result payload */
	result: T;
}

/* -------------------------------------------------- */
/* Utility: pagination                                 */
/* -------------------------------------------------- */

export interface Paginated {
	/** Opaque cursor for fetching the next page */
	nextCursor?: string;
}

/* -------------------------------------------------- */
/* 1. tools/list                                       */
/* -------------------------------------------------- */

/** Minimal JSON‑Schema placeholder – adapt if you need stricter typing */
export type JsonSchema = Record<string, unknown>;

export interface Tool {
	/** Unique tool identifier */
	name: string;
	/** Human‑readable description */
	description?: string;
	/** JSON schema describing expected arguments */
	inputSchema?: JsonSchema;
	/** Free‑form annotations describing behaviour, security, etc. */
	annotations?: Record<string, unknown>;
}

export interface ToolsListResult extends Paginated {
	tools: Tool[];
}

export type ToolsListResponse = JsonRpcSuccess<ToolsListResult>;

/* -------------------------------------------------- */
/* 2. prompts/list                                     */
/* -------------------------------------------------- */

export interface PromptArgument {
	name: string;
	description?: string;
	/** Whether the argument is required */
	required?: boolean;
}

export interface Prompt {
	name: string;
	description?: string;
	arguments?: PromptArgument[];
}

export interface PromptsListResult extends Paginated {
	prompts: Prompt[];
}

export type PromptsListResponse = JsonRpcSuccess<PromptsListResult>;

/* -------------------------------------------------- */
/* 3. tools/call                                       */
/* -------------------------------------------------- */

/** Additional resource structure that can be embedded in tool results */
export interface Resource {
	uri: string;
	mimeType: string;
	/** Either plain‑text or base64‑encoded binary data */
	text?: string;
	data?: string;
}

/** Individual content items returned by a tool */
export type ToolContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string }
	| { type: 'audio'; data: string; mimeType: string }
	| { type: 'resource'; resource: Resource };

export interface ToolCallResult {
	/** List of content parts (text, images, resources, etc.) */
	content: ToolContent[];
	/** True if the tool itself encountered a domain‑level error */
	isError?: boolean;
}

export type ToolCallResponse = JsonRpcSuccess<ToolCallResult>;

// MCP SERVER CONFIG FILE TYPES -----------------------------

export interface MCPServerConfig {
	// Command-based server properties
	command?: string;
	args?: string[];
	env?: Record<string, string>;

	// URL-based server properties
	url?: URL;
	headers?: Record<string, string>;
}

export interface MCPConfig {
	mcpServers: Record<string, MCPServerConfig>;
}

export interface MCPConfigParseError {
	// Error message
	response: {
		event: 'config-error';
		error: string | null;
	}
}

// SERVER EVENT TYPES ------------------------------------------

export interface MCPServerObject {
	// Command-based server properties
	tools: Tool[],
	status: 'loading' | 'error' | 'success' | 'offline',
	isOn: boolean,
	command?: string,
	error?: string,
}

export interface MCPServers {
	[serverName: string]: MCPServerObject;
}

// Create separate types for success and error cases
export type MCPServerSuccessModel = MCPServerObject;
export type MCPServerErrorModel = Omit<MCPServerObject, 'error'> & { error: string };


export type MCPServerSetupParams<serverResponse> = {
	serverName: string;
	onSuccess: (param: { model: MCPServerSuccessModel & { serverName: string } }) => void;
	onError: (param: { model: MCPServerErrorModel & { serverName: string } }) => void;
}

// Listener event types
export type EventMCPServerSetupOnSuccess<serverResponse> = Parameters<MCPServerSetupParams<serverResponse>['onSuccess']>[0]
export type EventMCPServerSetupOnError<serverResponse> = Parameters<MCPServerSetupParams<serverResponse>['onError']>[0]

type MCPServerEventType = 'add' | 'update' | 'delete' | 'loading';

export type MCPServerModel = MCPServerSuccessModel | MCPServerErrorModel;

interface MCPServerResponseBase {
	name: string;
	event: MCPServerEventType;
	newServer?: MCPServerModel;
	prevServer?: MCPServerModel;
}

type EventTypeConstraints = {
	'add': {
		prevServer?: never;
		newServer: MCPServerModel;
	};
	'update': {
		prevServer: MCPServerModel;
		newServer: MCPServerModel;
	};
	'delete': {
		newServer?: never;
		prevServer: MCPServerModel;
	};
	'loading': {
		prevServer?: never;
		newServer: MCPServerModel;
	}
}

type MCPEventResponse<T extends MCPServerEventType> = Omit<MCPServerResponseBase, 'event' | keyof EventTypeConstraints> & EventTypeConstraints[T] & { event: T };

// Response types
export type MCPAddResponse = MCPEventResponse<'add'>;
export type MCPUpdateResponse = MCPEventResponse<'update'>;
export type MCPDeleteResponse = MCPEventResponse<'delete'>;
export type MCPLoadingResponse = MCPEventResponse<'loading'>;

export type MCPServerResponse = MCPAddResponse | MCPUpdateResponse | MCPDeleteResponse | MCPLoadingResponse;

// Event parameter types
export type MCPServerEventAddParam = { response: MCPAddResponse };
export type MCPServerEventUpdateParam = { response: MCPUpdateResponse };
export type MCPServerEventDeleteParam = { response: MCPDeleteResponse };
export type MCPServerEventLoadingParam = { response: MCPLoadingResponse };

// Event Param union type
export type MCPServerEventParam = MCPServerEventAddParam | MCPServerEventUpdateParam | MCPServerEventDeleteParam | MCPServerEventLoadingParam;


