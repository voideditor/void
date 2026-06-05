import { createRequire as __createRequire } from 'node:module';

const require = __createRequire(import.meta.url);
const ws = require('ws');

export const WebSocket = ws.WebSocket || ws;
export const WebSocketServer = ws.WebSocketServer || ws.Server;
