export type Stream = any;
export function ndJsonStream(writable: any, readable: any): Stream;

export type Client = any;

export class ClientSideConnection {
	constructor(createClient: (agent: any) => any, stream: Stream);
	initialize(opts: any): Promise<any>;
	newSession(params: any): Promise<any>;
	prompt(params: any): Promise<any>;
	cancel(params: any): Promise<any>;
	setSessionModel?(params: any): Promise<any>;
}

export class AgentSideConnection {
	constructor(createAgent: (conn: any) => any, stream: Stream);
}

