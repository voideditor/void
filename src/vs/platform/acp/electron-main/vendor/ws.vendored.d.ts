export class WebSocket {
	constructor(url: string, protocols?: string | string[]);
	send(data: any): void;
	close(): void;
	on(event: 'open' | 'message' | 'close' | 'error', listener: (...args: any[]) => void): void;
	once(event: 'open' | 'message' | 'close' | 'error', listener: (...args: any[]) => void): void;
}

export class WebSocketServer {
	constructor(opts: any);
	on(event: 'connection' | 'listening' | 'error' | 'close', listener: (...args: any[]) => void): void;
	close(cb?: (err?: Error) => void): void;
}
