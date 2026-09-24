
export interface MCPTool {
	/** Unique tool identifier */
	name: string;
	/** Human‑readable description */
	description?: string;
	/** JSON schema describing expected arguments */
	inputSchema?: Record<string, unknown>;
	/** Free‑form annotations describing behaviour, security, etc. */
	annotations?: Record<string, unknown>;
}

export interface MCPConfigFileEntryJSON {
	// Command-based server properties
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	/** Optional list of MCP tool names to exclude for this server. */
	excludeTools?: string[];

	// URL-based server properties
	url?: URL;
	headers?: Record<string, string>;
}

export interface MCPConfigFileJSON {
	mcpServers: Record<string, MCPConfigFileEntryJSON>;
}


export type MCPServer = {
	// Command-based server properties
	tools: MCPTool[],
	status: 'loading' | 'success' | 'offline',
	command?: string,
	error?: string,
} | {
	tools?: undefined,
	status: 'error',
	command?: string,
	error: string,
}

export interface MCPServerOfName {
	[serverName: string]: MCPServer;
}

export type MCPServerEvent = {
	name: string;
	prevServer?: MCPServer;
	newServer?: MCPServer;
}
export type MCPServerEventResponse = { response: MCPServerEvent }

export interface MCPConfigFileParseErrorResponse {
	response: {
		type: 'config-file-error';
		error: string | null;
	}
}


type MCPToolResponseType = 'text' | 'image' | 'audio' | 'resource' | 'error';

type ResponseImageTypes = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml' | 'image/bmp' | 'image/tiff' | 'image/vnd.microsoft.icon';

interface ImageData {
	data: string;
	mimeType: ResponseImageTypes;
}

interface MCPToolResponseBase {
	toolName: string;
	serverName?: string;
	event: MCPToolResponseType;
	text?: string;
	image?: ImageData;
}

type MCPToolResponseConstraints = {
	'text': {
		image?: never;
		text: string;
	};
	'error': {
		image?: never;
		text: string;
	};
	'image': {
		text?: never;
		image: ImageData;
	};
	'audio': {
		text?: never;
		image?: never;
	};
	'resource': {
		text?: never;
		image?: never;
	}
}

type MCPToolEventResponse<T extends MCPToolResponseType> = Omit<MCPToolResponseBase, 'event' | keyof MCPToolResponseConstraints> & MCPToolResponseConstraints[T] & { event: T };

// Response types
export type MCPToolTextResponse = MCPToolEventResponse<'text'>;
export type MCPToolErrorResponse = MCPToolEventResponse<'error'>;
export type MCPToolImageResponse = MCPToolEventResponse<'image'>;
export type MCPToolAudioResponse = MCPToolEventResponse<'audio'>;
export type MCPToolResourceResponse = MCPToolEventResponse<'resource'>;
export type RawMCPToolCall = MCPToolTextResponse | MCPToolErrorResponse | MCPToolImageResponse | MCPToolAudioResponse | MCPToolResourceResponse;

export interface MCPToolCallParams {
	serverName: string;
	toolName: string;
	params: Record<string, unknown>;
}



const _sanitizeMcpToolPrefix = (serverName: string): string => {
	// Avoid delimiter collisions and invalid chars in tool names
	let s = (serverName ?? '').trim();

	// Prevent "__" inside prefix (since it's our delimiter)
	s = s.replace(/__+/g, '_');

	// OpenAI-compatible function names are typically limited to [a-zA-Z0-9_-]
	s = s.replace(/[^a-zA-Z0-9_-]/g, '_');

	// Ensure it starts with a letter or underscore (more broadly compatible)
	if (!/^[a-zA-Z_]/.test(s)) {
		s = `mcp_${s}`;
	}

	// Never return empty
	return s || 'mcp';
};

export const addMCPToolNamePrefix = (serverName: string, toolName: string) => {
	// Format: "server_name__tool_name"
	return `${_sanitizeMcpToolPrefix(serverName)}__${toolName}`;
};

export const removeMCPToolNamePrefix = (name: string) => {
	// Remove server name prefix with __ separator
	// Format: "server_name__tool_name" -> "tool_name"
	const parts = name.split('__');
	if (parts.length > 1) {
		return parts.slice(1).join('__');
	}
	return name;
};
