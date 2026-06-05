export const SENSITIVE_KEY_RE = /(^|_)(key|token|secret|password|passwd|pwd|authorization|bearer|cookie|session)(_|$)/i;

export function redactEnvForLog(env: any): any {
	if (!env || typeof env !== 'object') return env;
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(env)) {
		out[k] = SENSITIVE_KEY_RE.test(k) ? '<redacted>' : v;
	}
	return out;
}

export function sanitizeAcpSendOptionsForLog<T extends { env?: any }>(opts?: T): T | undefined {
	if (!opts) return opts;
	return { ...(opts as any), env: redactEnvForLog((opts as any).env) };
}
