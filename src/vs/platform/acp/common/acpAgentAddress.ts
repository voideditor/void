/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type AcpAgentAddressSource = 'cli' | 'env' | 'default';

export interface AcpAgentAddress {
	readonly host: string;
	readonly port: number;
	readonly wsUrl: string;
	readonly source: AcpAgentAddressSource;
}

export interface AcpAgentAddressEnv {
	readonly VOID_ACP_AGENT_HOST?: string;
	readonly VOID_ACP_AGENT_PORT?: string;
	readonly [key: string]: string | undefined;
}

export interface ResolveAcpAgentAddressInput {
	readonly cliAddr?: string;
	readonly env?: AcpAgentAddressEnv;
}

const DEFAULT_ACP_AGENT_HOST = '127.0.0.1';
const DEFAULT_ACP_AGENT_PORT = 8719;

export const DEFAULT_ACP_AGENT_ADDR = `${DEFAULT_ACP_AGENT_HOST}:${DEFAULT_ACP_AGENT_PORT}`;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export class AcpAgentAddressError extends Error {
	constructor(
		readonly source: AcpAgentAddressSource,
		readonly value: string | undefined,
		message: string
	) {
		super(message);
		this.name = 'AcpAgentAddressError';
		Object.setPrototypeOf(this, AcpAgentAddressError.prototype);
	}
}

export function resolveAcpAgentAddress(input: ResolveAcpAgentAddressInput = {}): AcpAgentAddress {
	if (typeof input.cliAddr === 'string') {
		return toAddress(parseAddress(input.cliAddr, 'cli'), 'cli');
	}

	const envHost = input.env?.VOID_ACP_AGENT_HOST;
	const envPort = input.env?.VOID_ACP_AGENT_PORT;
	if (hasText(envHost) || hasText(envPort)) {
		const host = hasText(envHost) ? envHost.trim() : DEFAULT_ACP_AGENT_HOST;
		const port = hasText(envPort) ? parsePort(envPort.trim(), 'env', envPort) : DEFAULT_ACP_AGENT_PORT;
		return toAddress({ host: normalizeHost(host, 'env', envHost), port }, 'env');
	}

	return toAddress({ host: DEFAULT_ACP_AGENT_HOST, port: DEFAULT_ACP_AGENT_PORT }, 'default');
}

function hasText(value: string | undefined): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function parseAddress(value: string, source: AcpAgentAddressSource): { host: string; port: number } {
	const raw = value.trim();
	let host = '';
	let portText = '';

	if (raw.startsWith('[')) {
		const bracketEnd = raw.indexOf(']');
		if (bracketEnd < 0 || raw[bracketEnd + 1] !== ':') {
			throw formatError(source, value);
		}
		host = raw.slice(1, bracketEnd);
		portText = raw.slice(bracketEnd + 2);
	} else {
		const portSeparator = raw.lastIndexOf(':');
		if (portSeparator < 0 || portSeparator === raw.length - 1) {
			throw formatError(source, value);
		}
		host = raw.slice(0, portSeparator);
		portText = raw.slice(portSeparator + 1);
	}

	return {
		host: normalizeHost(host, source, value),
		port: parsePort(portText, source, value)
	};
}

function normalizeHost(rawHost: string, source: AcpAgentAddressSource, value: string | undefined): string {
	const host = rawHost.trim().replace(/^\[(.*)\]$/, '$1');
	if (!host) {
		throw new AcpAgentAddressError(source, value, `${sourceLabel(source)} must include a host in <host>:<port>.`);
	}
	if (!LOOPBACK_HOSTS.has(host)) {
		throw new AcpAgentAddressError(source, value, `Builtin ACP agent address must use a loopback host (127.0.0.1, localhost, or ::1). Received "${host}" from ${sourceLabel(source)}.`);
	}
	return host;
}

function parsePort(rawPort: string, source: AcpAgentAddressSource, value: string | undefined): number {
	const portText = rawPort.trim();
	if (!/^\d+$/.test(portText)) {
		throw new AcpAgentAddressError(source, value, `ACP agent port in ${sourceLabel(source)} must be an integer from 1 through 65535.`);
	}

	const port = Number(portText);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new AcpAgentAddressError(source, value, `ACP agent port in ${sourceLabel(source)} must be an integer from 1 through 65535.`);
	}
	return port;
}

function toAddress(parsed: { host: string; port: number }, source: AcpAgentAddressSource): AcpAgentAddress {
	return {
		host: parsed.host,
		port: parsed.port,
		wsUrl: `ws://${formatUrlHost(parsed.host)}:${parsed.port}`,
		source
	};
}

function formatUrlHost(host: string): string {
	return host === '::1' ? '[::1]' : host;
}

function formatError(source: AcpAgentAddressSource, value: string | undefined): AcpAgentAddressError {
	return new AcpAgentAddressError(source, value, `${sourceLabel(source)} must use <host>:<port>; for example --acp-agent-addr=127.0.0.1:8720.`);
}

function sourceLabel(source: AcpAgentAddressSource): string {
	if (source === 'cli') {
		return '--acp-agent-addr';
	}
	if (source === 'env') {
		return 'VOID_ACP_AGENT_HOST/VOID_ACP_AGENT_PORT';
	}
	return 'the default ACP agent address';
}
