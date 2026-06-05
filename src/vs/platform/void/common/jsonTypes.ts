export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type ToolOutputInput = string | JsonValue;

export function isJsonObject(v: unknown): v is JsonObject {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function toJsonObject(v: unknown): JsonObject {
	return isJsonObject(v) ? v : {};
}

export function getStringField(o: JsonObject | null | undefined, key: string): string | undefined {
	if (!o) return undefined;
	const v = o[key];
	return typeof v === 'string' ? v : undefined;
}

export function stringifyUnknown(e: unknown): string {
	if (e instanceof Error) return e.message;
	return String(e);
}
