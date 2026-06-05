/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Request parameters that should be excluded from UI override template
export const EXCLUDED_REQUEST_PARAMS = new Set<string>([
    'tools',
    'tool_choice',
    'response_format',
    'structured_outputs',
    'reasoning',
    'include_reasoning',
    // Provider routing is configured separately as a top-level `provider` object
    'provider'
]);

export function isExcluded(key: string): boolean {
    return EXCLUDED_REQUEST_PARAMS.has(String(key));
}

export function coerceFallbackForKey(key: string): any {
    const k = String(key);
    if (k === 'temperature') return 0.2;
    if (k === 'max_tokens' || k === 'max_completion_tokens') return 6000;
    if (k === 'top_p') return 1;
    if (k === 'top_k') return 40;
    if (k === 'presence_penalty' || k === 'frequency_penalty' || k === 'repetition_penalty') return 0;
    if (k === 'logprobs' || k === 'top_logprobs') return 0;
    if (k === 'logit_bias') return {};
    if (k === 'seed') return 0;
    if (k === 'stop') return [];
    if (k === 'min_p') return 0;
    return '';
}

export function filterSupportedParams(supported: readonly string[] | null | undefined): string[] {
    const list = Array.isArray(supported) ? supported : [];
    return list.filter(k => !isExcluded(String(k)));
}

export function computeRequestParamsTemplate(
    supportedParams: readonly string[] | null | undefined,
    defaultParams?: Record<string, any> | null
): Record<string, any> {
    const defs = defaultParams && typeof defaultParams === 'object' ? defaultParams : {};
    const filtered = filterSupportedParams(supportedParams);
    const entries = filtered.map(rawKey => {
        const k = String(rawKey);
        const hasDefault = Object.prototype.hasOwnProperty.call(defs, k) && defs[k] !== null;
        return [k, hasDefault ? defs[k] : coerceFallbackForKey(k)];
    });
    return Object.fromEntries(entries);
}

