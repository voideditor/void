import * as vscode from 'vscode';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

interface Definition {
    file: string;
    node: Parser.SyntaxNode;
}

interface DefnUse {
    parent: Parser.SyntaxNode;
    file: string;
}

interface ImportInfo {
    source: string;
    imported: string;
}

class ProjectAnalyzer {
    private parser: Parser;
    private graph: Map<string, Set<string>>;
    private visited: Set<string>;
    private parsedFiles: Map<string, Parser.Tree>;
    private imports: Map<string, Map<string, ImportInfo>>;
    private definitions: Map<string, Definition>;
    private fileStack: Set<string>;

    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(JavaScript);
        this.graph = new Map();
        this.visited = new Set();
        this.parsedFiles = new Map();
        this.imports = new Map();
        this.definitions = new Map();
        this.fileStack = new Set();
    }

    async parseFile(filePath: string): Promise<Parser.Tree | null> {
        if (this.parsedFiles.has(filePath)) {
            return this.parsedFiles.get(filePath)!;
        }

        if (this.fileStack.has(filePath)) {
            return null; // Circular import
        }

        this.fileStack.add(filePath);

        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const code = document.getText();
            const tree = this.parser.parse(code);

            this.parsedFiles.set(filePath, tree);
            this.collectImports(filePath, tree);
            this.collectDefinitions(filePath, tree);

            return tree;
        } catch (error) {
            console.error(`Error parsing ${filePath}:`, error);
            return null;
        } finally {
            this.fileStack.delete(filePath);
        }
    }

    private collectImports(filePath: string, tree: Parser.Tree): void {
        const fileImports = new Map<string, ImportInfo>();

        const visit = (node: Parser.SyntaxNode): void => {
            if (node.type === 'import_declaration') {
                const source = node.childForFieldName('source')?.text.slice(1, -1) ?? '';
                const specifiers = node.childForFieldName('specifiers');

                specifiers?.children.forEach(spec => {
                    if (spec.type === 'import_specifier') {
                        const local = spec.childForFieldName('local')?.text ?? '';
                        const imported = spec.childForFieldName('imported')?.text ?? '';
                        fileImports.set(local, { source, imported });
                    }
                });
            }
            node.children.forEach(visit);
        };

        visit(tree.rootNode);
        this.imports.set(filePath, fileImports);
    }

    private collectDefinitions(filePath: string, tree: Parser.Tree): void {
        const visit = (node: Parser.SyntaxNode): void => {
            if (node.type === 'function_declaration') {
                const name = node.childForFieldName('name')?.text ?? '';
                this.definitions.set(name, { file: filePath, node });
            }
            else if (node.type === 'variable_declarator') {
                const name = node.childForFieldName('name')?.text;
                const value = node.childForFieldName('value');
                if (name && (value?.type === 'arrow_function' || value?.type === 'function')) {
                    this.definitions.set(name, { file: filePath, node: value });
                }
            }
            node.children.forEach(visit);
        };

        visit(tree.rootNode);
    }

    private async getTypeFromPosition(uri: vscode.Uri, position: vscode.Position): Promise<string | null> {
        const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider',
            uri,
            position
        );

        if (hover?.[0]?.contents.length) {
            for (const content of hover[0].contents) {
                let hoverText = typeof content === 'string' ?
                    content :
                    ('value' in content ? content.value : '');

                // Remove typescript backticks if present
                hoverText = hoverText.replace(/```typescript\s*/, '').replace(/```\s*$/, '');
                console.log('Processing hover text:', hoverText);

                // Extract the type information - look for the type after the colon
                const typeMatches = [
                    /:\s*([\w<>]+)(?:\[\])?/,  // matches "foo: Type" or "foo: Type[]"
                    /var\s+\w+:\s*([\w<>]+)/,  // matches "var foo: Type"
                    /\(type\)\s+[\w<>]+:\s*([\w<>]+)/,  // matches "(type) foo: Type"
                    /\(method\)\s*([\w<>]+)\./  // matches "(method) Type.method"
                ];

                for (const pattern of typeMatches) {
                    const match = pattern.exec(hoverText);
                    if (match) {
                        let type = match[1];
                        // Handle array types
                        if (hoverText.includes('[]')) {
                            return 'Array';
                        }
                        // Extract base type from generics
                        if (type.includes('<')) {
                            type = type.split('<')[0];
                        }
                        return type;
                    }
                }
            }
        }
        return null;
    }

    private async getCallsInDefn(defnNode: Parser.SyntaxNode, currentFile: string): Promise<Set<string>> {
        const calls = new Set<string>();
        const fileImports = this.imports.get(currentFile) ?? new Map();
        const uri = vscode.Uri.file(currentFile);

        const visit = async (node: Parser.SyntaxNode): Promise<void> => {
            if (node.type === 'call_expression') {
                const callee = node.childForFieldName('function');
                if (callee?.type === 'identifier') {
                    const name = callee.text;
                    const importInfo = fileImports.get(name);
                    if (importInfo) {
                        calls.add(`${importInfo.source}:${importInfo.imported}`);
                    } else {
                        calls.add(name);
                    }
                }
                else if (callee?.type === 'member_expression') {
                    const method = callee.childForFieldName('property')?.text;
                    const object = callee.childForFieldName('object');

                    if (method && object) {
                        const position = new vscode.Position(
                            object.startPosition.row,
                            object.startPosition.column
                        );

                        const type = await this.getTypeFromPosition(uri, position);
                        if (type) {
                            calls.add(`${type}.${method}`);
                        } else {
                            calls.add(`method:${method}`);
                        }
                    }
                }
            }

            for (const child of node.children) {
                await visit(child);
            }
        };

        await visit(defnNode);
        return calls;
    }

    private gotoDefn(name: string): Definition | null {
        if (name.includes(':')) {
            const [file, funcName] = name.split(':');
            const def = this.definitions.get(funcName);
            return def ?? null;
        }

        return this.definitions.get(name) ?? null;
    }

    private getUses(defnNode: Parser.SyntaxNode, currentFile: string): DefnUse[] {
        const uses: DefnUse[] = [];

        let fnName: string | undefined;
        if (defnNode.type === 'function_declaration') {
            fnName = defnNode.childForFieldName('name')?.text;
        } else if (defnNode.type === 'arrow_function' || defnNode.type === 'function') {
            const parent = defnNode.parent;
            if (parent?.type === 'variable_declarator') {
                fnName = parent.childForFieldName('name')?.text;
            }
        }

        if (!fnName) return uses;

        for (const [file, tree] of this.parsedFiles) {
            const visit = (node: Parser.SyntaxNode): void => {
                if (node.type === 'call_expression') {
                    const callee = node.childForFieldName('function');
                    if (callee?.type === 'identifier' && callee.text === fnName) {
                        let current: Parser.SyntaxNode | null = node;
                        while (current) {
                            if (current.type === 'function_declaration' ||
                                current.type === 'arrow_function' ||
                                current.type === 'function') {
                                uses.push({ parent: current, file });
                                break;
                            }
                            current = current.parent;
                        }
                    }
                }
                node.children.forEach(visit);
            };

            visit(tree.rootNode);
        }

        return uses;
    }

    private async visitAllNodesInGraphFromDefinition(defn: Parser.SyntaxNode, currentFile: string): Promise<void> {
        let defnName: string | undefined;
        if (defn.type === 'function_declaration') {
            defnName = defn.childForFieldName('name')?.text;
        } else if (defn.type === 'arrow_function' || defn.type === 'function') {
            const parent = defn.parent;
            if (parent?.type === 'variable_declarator') {
                defnName = parent.childForFieldName('name')?.text;
            }
        }

        if (!defnName) return;

        const fullName = `${currentFile}:${defnName}`;
        if (this.visited.has(fullName)) return;

        const calls = await this.getCallsInDefn(defn, currentFile);
        this.graph.set(fullName, calls);
        this.visited.add(fullName);

        const callDefns = Array.from(calls).map(call => this.gotoDefn(call));
        for (const callDefn of callDefns) {
            if (callDefn) {
                await this.visitAllNodesInGraphFromDefinition(callDefn.node, callDefn.file);
            }
        }

        const defnUses = this.getUses(defn, currentFile);
        for (const defnUse of defnUses) {
            await this.visitAllNodesInGraphFromDefinition(defnUse.parent, defnUse.file);
        }
    }

    async analyze(entryFile: string): Promise<Map<string, Set<string>>> {
        const tree = await this.parseFile(entryFile);
        if (!tree) return new Map();

        const visit = async (node: Parser.SyntaxNode): Promise<void> => {
            if (node.type === 'function_declaration') {
                await this.visitAllNodesInGraphFromDefinition(node, entryFile);
            }
            else if (node.type === 'variable_declarator') {
                const value = node.childForFieldName('value');
                if (value?.type === 'arrow_function' || value?.type === 'function') {
                    await this.visitAllNodesInGraphFromDefinition(value, entryFile);
                }
            }
            for (const child of node.children) {
                await visit(child);
            }
        };

        await visit(tree.rootNode);
        return this.graph;
    }
}

export async function runTreeSitter(filePath?: string): Promise<Map<string, Set<string>> | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor && !filePath) {
        vscode.window.showWarningMessage('No active editor found');
        return null;
    }

    try {
        const targetPath = filePath ?? editor!.document.uri.fsPath;
        const analyzer = new ProjectAnalyzer();
        const graph = await analyzer.analyze(targetPath);

        for (const [defn, calls] of graph) {
            console.log(`${defn} calls: ${[...calls].join(', ')}`);
        }

        return graph;
    } catch (error) {
        console.error('Error analyzing file:', error);
        vscode.window.showErrorMessage('Error analyzing file');
        return null;
    }
}