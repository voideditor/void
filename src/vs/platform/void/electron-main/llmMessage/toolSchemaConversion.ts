/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';

import type { AdditionalToolInfo } from '../../common/sendLLMMessageTypes.js';
import type { ToolCallParams } from '../../common/toolsServiceTypes.js';
import { voidTools, type InternalToolInfo } from '../../common/toolsRegistry.js';
import type { ILogService } from '../../../log/common/log.js';

const require = createRequire(import.meta.url);

type ZodModule = typeof import('zod');
const { z } = require('zod') as ZodModule;

type ZodNumber = import('zod').ZodNumber;
type ZodBoolean = import('zod').ZodBoolean;
type ZodTypeAny = import('zod').ZodTypeAny;
type AnyZodObject = import('zod').ZodObject<any>;

type ZodToJsonSchemaModule = typeof import('zod-to-json-schema');
const { zodToJsonSchema } = require('zod-to-json-schema') as ZodToJsonSchemaModule;

type GoogleGenAIModule = typeof import('@google/genai');
const googleGenAIModule = require('@google/genai') as GoogleGenAIModule;
const { Type } = googleGenAIModule;

type FunctionDeclaration = import('@google/genai').FunctionDeclaration;
type Schema = import('@google/genai').Schema;
type GeminiType = (typeof Type)[keyof typeof Type];

type OpenAIChatCompletionTool = import('openai/resources/chat/completions/completions.js').ChatCompletionTool;
type AnthropicTool = import('@anthropic-ai/sdk').Anthropic.Tool;

export const ToolSchemas = {
	read_file: z.object({
		uri: z.string().describe('URI of the file'),
		start_line: z.number().int().optional().describe('1-based start line (optional)'),
		end_line: z.number().int().optional().describe('1-based end line (optional)'),
		lines_count: z.number().int().optional().describe('Number of lines to read from start_line (optional)'),
		page_number: z.number().int().optional().describe('Page number (optional)'),
	}),
	ls_dir: z.object({
		uri: z.string().optional().describe('Directory URI (optional)'),
		page_number: z.number().int().optional().describe('Page number (optional)'),
	}),
	get_dir_tree: z.object({
		uri: z.string().describe('Directory URI'),
	}),
	search_pathnames_only: z.object({
		query: z.string().describe('Search query'),
		include_pattern: z.string().nullable().optional().describe('File pattern to include (optional)'),
		page_number: z.number().int().optional().describe('Page number (optional)'),
	}),
	search_for_files: z.object({
		query: z.string().describe('Search query'),
		is_regex: z.boolean().optional().describe('Whether the query is a regex (optional)'),
		search_in_folder: z.string().nullable().optional().describe('Folder to search in (optional)'),
		page_number: z.number().int().optional().describe('Page number (optional)'),
	}),
	search_in_file: z.object({
		uri: z.string().describe('File URI'),
		query: z.string().describe('Search query'),
		is_regex: z.boolean().optional().describe('Whether the query is a regex (optional)'),
	}),
	read_lint_errors: z.object({
		uri: z.string().describe('File URI'),
	}),
	rewrite_file: z.object({
		uri: z.string().describe('File URI'),
		new_content: z.string().describe('New content of the file'),
	}),
	edit_file: z.object({
		uri: z.string().describe('File URI'),
		original_snippet: z.string().describe('Exact snippet to find (copy verbatim from file)'),
		updated_snippet: z.string().describe('Replacement content'),
		occurrence: z.number().int().nullable().optional().describe('1-based occurrence index to replace (optional)'),
		replace_all: z.boolean().optional().describe('If true, replace all occurrences'),
		location_hint: z.object({
			line: z.number().int().optional().describe('Approx 1-based line number (optional)'),
			anchor_before: z.string().optional().describe('Short unique line before snippet (optional)'),
			anchor_after: z.string().optional().describe('Short unique line after snippet (optional)'),
		}).nullable().optional().describe('Optional disambiguation hints'),
		encoding: z.string().nullable().optional().describe('File encoding (default utf8)'),
		newline: z.string().nullable().optional().describe('newline handling: preserve|lf|crlf'),
	}),
	create_file_or_folder: z.object({
		uri: z.string().describe('URI of the file or folder'),
	}),
	delete_file_or_folder: z.object({
		uri: z.string().describe('URI of the file or folder'),
		is_recursive: z.boolean().optional().describe('Whether to delete recursively (optional)'),
	}),
	run_command: z.object({
		command: z.string().describe('Command to execute'),
		cwd: z.string().nullable().optional().describe('Working directory (optional)'),
	}),
	open_persistent_terminal: z.object({
		cwd: z.string().nullable().optional().describe('Working directory (optional)'),
	}),
	run_persistent_command: z.object({
		command: z.string().describe('Command to run'),
		persistent_terminal_id: z.string().describe('Persistent terminal ID'),
	}),
	kill_persistent_terminal: z.object({
		persistent_terminal_id: z.string().describe('Persistent terminal ID to kill'),
	}),
} satisfies { [K in keyof ToolCallParams]: AnyZodObject };

type AnyToolInfo = InternalToolInfo | AdditionalToolInfo;

const dbg = (logService: ILogService | undefined, msg: string, data?: unknown) => {
	if (!logService?.debug) return;
	logService.debug(`[toolSchemaConversion] ${msg}`, data);
};

const warn = (logService: ILogService | undefined, msg: string, data?: unknown) => {
	if (!logService?.warn) return;
	logService.warn(`[toolSchemaConversion] ${msg}`, data);
};

const safeJson = (obj: any) => {
	try {
		return JSON.stringify(obj, null, 2);
	} catch {
		return String(obj);
	}
};

const isOptionalParam = (paramInfo: any): boolean => {
	if (paramInfo?.required === false) return true;
	const desc = String(paramInfo?.description || '').toLowerCase();
	return /\boptional\b/.test(desc);
};

const normalizeType = (raw?: string): 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' => {
	const t = String(raw || 'string').toLowerCase();
	if (['int', 'integer', 'int32', 'int64'].includes(t)) return 'integer';
	if (['number', 'float', 'double'].includes(t)) return 'number';
	if (['boolean', 'bool'].includes(t)) return 'boolean';
	if (t === 'array') return 'array';
	if (t === 'object') return 'object';
	if (t === 'string') return 'string';
	return 'string';
};

const tryNumber = (val: any) => {
	if (typeof val === 'string' && val.trim() !== '') {
		const n = Number(val);
		if (!isNaN(n)) return n;
	}
	return val;
};

const preprocessedNumber = (schema: ZodNumber) =>
	z.preprocess(tryNumber, schema);

const preprocessedBoolean = (schema: ZodBoolean) =>
	z.preprocess((val) => {
		if (typeof val === 'string') {
			const v = val.toLowerCase();
			if (v === 'true') return true;
			if (v === 'false') return false;
		}
		return val;
	}, schema);

const preprocessedArray = (itemSchema: ZodTypeAny) =>
	z.preprocess((val) => {
		if (typeof val === 'string') {
			try {
				const parsed = JSON.parse(val);
				return parsed;
			} catch { /* noop */ }
		}
		return val;
	}, z.array(itemSchema));

const preprocessedObject = (objSchema: AnyZodObject) =>
	z.preprocess((val) => {
		if (typeof val === 'string') {
			try {
				const parsed = JSON.parse(val);
				return parsed;
			} catch { /* noop */ }
		}
		return val;
	}, objSchema);

const isBuiltInTool = (name: string): name is keyof ToolCallParams => {
	return name in ToolSchemas;
};

export const paramInfoToZod = (paramInfo: any, logService?: ILogService): ZodTypeAny => {
	if (!paramInfo || typeof paramInfo !== 'object') return z.string();

	dbg(logService, 'paramInfoToZod called with', paramInfo);

	const t = normalizeType(paramInfo.type);


	if (Array.isArray(paramInfo.enum) && paramInfo.enum.length > 0) {
		const values = paramInfo.enum;

		const allNumbers = values.every(
			(v: any) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))
		);
		const allBooleans = values.every(
			(v: any) => typeof v === 'boolean' || (typeof v === 'string' && ['true', 'false'].includes(v.toLowerCase()))
		);

		if (allNumbers || t === 'number' || t === 'integer') {
			const nums = values.map((v: any) => Number(v));
			const base =
				t === 'integer'
					? preprocessedNumber(z.number().int())
					: preprocessedNumber(z.number());
			return base
				.refine((v) => nums.includes(v), paramInfo.description || 'Must be one of enum values')
				.describe(paramInfo.description || '');
		}

		if (allBooleans || t === 'boolean') {
			const bools = values.map((v: any) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));
			return preprocessedBoolean(z.boolean())
				.refine((v) => bools.includes(v), paramInfo.description || 'Must be one of enum values')
				.describe(paramInfo.description || '');
		}

		return z.enum(values.map(String) as [string, ...string[]]).describe(paramInfo.description || '');
	}

	switch (t) {
		case 'number': {
			return preprocessedNumber(z.number()).describe(paramInfo.description || '');
		}
		case 'integer': {
			return preprocessedNumber(z.number().int()).describe(paramInfo.description || '');
		}
		case 'boolean': {
			return preprocessedBoolean(z.boolean()).describe(paramInfo.description || '');
		}
		case 'array': {
			const items = paramInfo.items || { type: 'string' };
			return preprocessedArray(paramInfoToZod(items, logService)).describe(paramInfo.description || '');
		}
		case 'object': {
			const shape: Record<string, ZodTypeAny> = {};
			const props = paramInfo.properties || {};
			for (const [k, v] of Object.entries(props)) {
				let child = paramInfoToZod(v, logService);
				if (isOptionalParam(v)) child = child.optional();
				shape[k] = child;
			}
			if (Array.isArray(paramInfo.required) && paramInfo.required.length > 0) {
				for (const key of Object.keys(shape)) {
					if (!paramInfo.required.includes(key)) {
						shape[key] = shape[key].optional();
					}
				}
			}
			return preprocessedObject(z.object(shape)).describe(paramInfo.description || '');
		}
		case 'string':
		default: {
			return z.string().describe(paramInfo.description || '');
		}
	}
};

export const buildZodSchemaForTool = (toolInfo: AnyToolInfo, logService?: ILogService): AnyZodObject => {
	const name = toolInfo.name as keyof ToolCallParams;

	if (name in ToolSchemas) {
		return ToolSchemas[name];
	}

	const dynamicParams = (toolInfo as AdditionalToolInfo).params || {};
	dbg(logService, 'MCP tool received', {
		name: toolInfo.name,
		description: (toolInfo as any).description,
		params: dynamicParams,
	});

	const zodProps: Record<string, ZodTypeAny> = {};

	for (const [paramName, paramInfo] of Object.entries(dynamicParams)) {
		const rawType = (paramInfo as any)?.type;
		const normType = normalizeType(rawType);

		dbg(logService, 'MCP param mapping', {
			tool: toolInfo.name,
			param: paramName,
			rawType,
			normType,
			enum: (paramInfo as any)?.enum,
			optional: isOptionalParam(paramInfo),
			description: (paramInfo as any)?.description,
		});

		let zodType = paramInfoToZod(paramInfo, logService);
		if (isOptionalParam(paramInfo)) zodType = zodType.optional();
		zodProps[paramName] = zodType;
	}

	const schema = z.object(zodProps);
	try {
		const json = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
		dbg(logService, 'Generated JSON schema from MCP (pre-provider)', json);
	} catch (e) {
		warn(logService, 'Failed to generate JSON schema for debug', e);
	}

	return schema;
};

const applyVoidToolsDescriptionOverrides = (toolName: string, jsonSchema: any) => {
	if (!jsonSchema?.properties) return;
	const vt = (voidTools as any)[toolName];
	if (!vt?.params) return;

	for (const key of Object.keys(jsonSchema.properties)) {
		const overrideDesc = vt.params?.[key]?.description;
		if (overrideDesc) {
			jsonSchema.properties[key] = jsonSchema.properties[key] || {};
			jsonSchema.properties[key].description = overrideDesc;
		}
	}
};


const jsonSchemaToGeminiSchema = (js: any): Schema => {
	const toType = (t?: string): GeminiType => {
		switch ((t || '').toLowerCase()) {
			case 'object': return Type.OBJECT;
			case 'array': return Type.ARRAY;
			case 'number': return Type.NUMBER;
			case 'integer': return Type.NUMBER;
			case 'boolean': return Type.BOOLEAN;
			case 'string':
			default: return Type.STRING;
		}
	};

	const recurse = (node: any): Schema => {
		if (!node || typeof node !== 'object') {
			return { type: Type.STRING };
		}

		if (Array.isArray(node.enum) && node.enum.length > 0) {
			return {
				type: toType(node.type),
				description: node.description,
				enum: node.enum,
			};
		}

		const t = toType(node.type);

		if (t === Type.OBJECT) {
			const out: Schema = {
				type: t,
				description: node.description,
				properties: {},
				required: Array.isArray(node.required) ? node.required : [],
			};
			if (node.properties && typeof node.properties === 'object') {
				for (const [k, v] of Object.entries(node.properties)) {
					(out.properties as any)[k] = recurse(v);
				}
			}
			return out;
		}

		if (t === Type.ARRAY) {
			return {
				type: t,
				description: node.description,
				items: recurse(node.items || { type: 'string' }),
			};
		}

		return {
			type: t,
			description: node.description,
		};
	};

	return recurse(js);
};

const getZodSchemaForTool = (toolInfo: AnyToolInfo, logService?: ILogService): AnyZodObject => {
	const name = (toolInfo as any).name as string;
	if (isBuiltInTool(name)) {
		return ToolSchemas[name as keyof ToolCallParams];
	}
	return buildZodSchemaForTool(toolInfo as AdditionalToolInfo, logService);
};

export const toOpenAICompatibleTool = (
	toolInfo: AnyToolInfo,
	logService?: ILogService
): OpenAIChatCompletionTool => {
	const { name, description } = toolInfo as { name: string; description: string };

	const zodSchema = getZodSchemaForTool(toolInfo, logService);
	const parameters = {
		...zodToJsonSchema(zodSchema, { target: 'openApi3', $refStrategy: 'none' }),
		additionalProperties: false,
	};

	applyVoidToolsDescriptionOverrides(name, parameters);

	return {
		type: 'function',
		function: {
			name,
			description,
			parameters,
			strict: false,
		},
	};
};

export const toAnthropicTool = (toolInfo: AnyToolInfo, logService?: ILogService): AnthropicTool => {
	const { name, description } = toolInfo as { name: string; description: string };

	const zodSchema = getZodSchemaForTool(toolInfo, logService);
	const input_schema = {
		...zodToJsonSchema(zodSchema, { $refStrategy: 'none' }),
		additionalProperties: false,
	};

	dbg(logService, `Anthropic tool.input_schema for ${name}`, input_schema);

	return {
		name,
		description,
		input_schema,
	} as AnthropicTool;
};

export const toGeminiTool = (toolInfo: AnyToolInfo, logService?: ILogService): FunctionDeclaration => {
	const { name, description } = toolInfo as { name: string; description: string };

	const zodSchema = getZodSchemaForTool(toolInfo, logService);
	const parametersJson = zodToJsonSchema(zodSchema, { $refStrategy: 'none' });
	const parameters = jsonSchemaToGeminiSchema(parametersJson);
	const finalParams: Schema =
		parameters.type === (Type as any).OBJECT
			? parameters
			: { type: (Type as any).OBJECT, properties: {} };

	dbg(logService, `Gemini tool.parameters for ${name}`, finalParams);

	return { name, description, parameters: finalParams };
};
