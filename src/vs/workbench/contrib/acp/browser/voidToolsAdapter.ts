import type { IFileService } from '../../../../platform/files/common/files.js';
import { IToolsService } from '../../void/common/toolsService.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export interface IAcpToolCall {
	id: string;
	name: string;
	args: any;
}

export interface IAcpToolResult {
	id: string;      // toolCallId
	name: string;
	result?: any;
	error?: string;
}

export class VoidToolsAdapter {
	constructor(
		private readonly fileService: IFileService,
		private readonly toolsService: IToolsService
	) { }

	
	async readTextFile(path: string): Promise<string> {
		
		try {
			const validate = (this.toolsService.validateParams as any)?.read_file as ((p: any) => any) | undefined;
			const caller = (this.toolsService.callTool as any)?.read_file as ((p: any) => Promise<{ result: any }>) | undefined;
			if (validate && caller) {
				const validated = validate({ uri: path });
				const { result } = await caller(validated);
				const resolved = await result;
				const text: string = resolved?.fileContents ?? '';
				return text;
			}
		} catch {
			
		}

		
		const uri = URI.parse(path);
		const content = await this.fileService.readFile(uri);
		return content.value.toString();
	}

	
	async writeTextFile(path: string, text: string): Promise<void> {
		
		try {
			const validate = (this.toolsService.validateParams as any)?.rewrite_file as ((p: any) => any) | undefined;
			const caller = (this.toolsService.callTool as any)?.rewrite_file as ((p: any) => Promise<{ result: any }>) | undefined;
			if (validate && caller) {
				const validated = validate({ uri: path, new_content: text });
				const { result } = await caller(validated);
				await result;
				return;
			}
		} catch {
			
		}

		
		const uri = URI.parse(path);
		await this.fileService.writeFile(uri, VSBuffer.fromString(text));
	}

	
	async dispatchToolCall(call: IAcpToolCall): Promise<IAcpToolResult> {
		try {
			if (call.name === 'readTextFile') {
				const text = await this.readTextFile(call.args?.path);
				return { id: call.id, name: call.name, result: { text } };
			}
			if (call.name === 'writeTextFile') {
				await this.writeTextFile(call.args?.path, call.args?.text ?? '');
				return { id: call.id, name: call.name, result: { ok: true } };
			}

			
			const validate = (this.toolsService.validateParams as any)?.[call.name] as ((p: any) => any) | undefined;
			const caller = (this.toolsService.callTool as any)?.[call.name] as ((p: any) => Promise<{ result: any }>) | undefined;
			if (!validate || !caller) {
				throw new Error(`Unknown tool: ${call.name}`);
			}
			const validated = validate(call.args ?? {});
			const { result } = await caller(validated);
			const resolved = await result;

			return { id: call.id, name: call.name, result: resolved };
		} catch (e: any) {
			return { id: call.id, name: call.name, error: e?.message ?? String(e) };
		}
	}
}