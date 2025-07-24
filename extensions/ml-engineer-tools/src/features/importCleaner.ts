import * as vscode from 'vscode';

export class ImportCleaner {
    private commonMLImports = [
        'numpy', 'pandas', 'matplotlib', 'seaborn', 'sklearn', 'scipy',
        'torch', 'torchvision', 'tensorflow', 'keras', 'transformers',
        'cv2', 'PIL', 'plotly', 'joblib', 'pickle'
    ];

    async cleanUnused() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'python') {
            return;
        }

        if (!vscode.workspace.getConfiguration('mlTools').get('enableAutoImportClean')) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        
        const { cleanedText, removedImports } = this.removeUnusedImports(text);
        
        if (cleanedText !== text && removedImports.length > 0) {
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            edit.replace(document.uri, fullRange, cleanedText);
            await vscode.workspace.applyEdit(edit);

            // Show notification with removed imports
            const message = `🧹 Cleaned ${removedImports.length} unused import${removedImports.length > 1 ? 's' : ''}`;
            vscode.window.showInformationMessage(message, { modal: false });
        }
    }

    private removeUnusedImports(text: string): { cleanedText: string, removedImports: string[] } {
        const lines = text.split('\n');
        const imports = this.extractImports(lines);
        const usedImports = this.findUsedImports(text, imports);
        const removedImports: string[] = [];
        
        // Filter out unused imports
        const cleanedLines = lines.filter((line, index) => {
            const importInfo = imports.find(imp => imp.lineIndex === index);
            if (importInfo && !usedImports.has(importInfo.name)) {
                removedImports.push(importInfo.name);
                return false;
            }
            return true;
        });

        // Remove empty lines that were left after import removal
        const finalLines = this.removeExcessiveEmptyLines(cleanedLines);
        
        return {
            cleanedText: finalLines.join('\n'),
            removedImports
        };
    }

    private extractImports(lines: string[]): Array<{name: string, alias?: string, lineIndex: number, fullLine: string}> {
        const imports: Array<{name: string, alias?: string, lineIndex: number, fullLine: string}> = [];
        
        lines.forEach((line, index) => {
            const trimmed = line.trim();
            
            // Handle "import module" or "import module as alias"
            const importMatch = /^import\s+([a-zA-Z_][a-zA-Z0-9_.]*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/.exec(trimmed);
            if (importMatch) {
                imports.push({
                    name: importMatch[1],
                    alias: importMatch[2],
                    lineIndex: index,
                    fullLine: line
                });
                return;
            }

            // Handle "from module import ..."
            const fromImportMatch = /^from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+import\s+(.+)/.exec(trimmed);
            if (fromImportMatch) {
                const module = fromImportMatch[1];
                const importedItems = fromImportMatch[2];
                
                // Parse imported items (handle aliases and multiple imports)
                const items = this.parseImportedItems(importedItems);
                items.forEach(item => {
                    imports.push({
                        name: `${module}.${item.name}`,
                        alias: item.alias || item.name,
                        lineIndex: index,
                        fullLine: line
                    });
                });
            }
        });

        return imports;
    }

    private parseImportedItems(importedItems: string): Array<{name: string, alias?: string}> {
        const items: Array<{name: string, alias?: string}> = [];
        
        // Handle parentheses for multi-line imports
        const cleaned = importedItems.replace(/[()]/g, '').trim();
        
        // Split by comma and parse each item
        const parts = cleaned.split(',').map(part => part.trim()).filter(part => part.length > 0);
        
        parts.forEach(part => {
            const aliasMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(part);
            if (aliasMatch) {
                items.push({
                    name: aliasMatch[1],
                    alias: aliasMatch[2]
                });
            } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part)) {
                items.push({
                    name: part
                });
            }
        });

        return items;
    }

    private findUsedImports(text: string, imports: Array<{name: string, alias?: string}>): Set<string> {
        const used = new Set<string>();
        
        imports.forEach(importInfo => {
            const searchName = importInfo.alias || importInfo.name.split('.').pop() || importInfo.name;
            
            // Create regex to find usage of the import
            const usagePatterns = [
                new RegExp(`\\b${this.escapeRegex(searchName)}\\b`, 'g'),
                new RegExp(`\\b${this.escapeRegex(searchName)}\\.`, 'g'),
                new RegExp(`\\b${this.escapeRegex(searchName)}\\(`, 'g')
            ];

            // Check if any pattern matches in the text (excluding import lines)
            const textWithoutImports = this.removeImportLines(text);
            
            for (const pattern of usagePatterns) {
                if (pattern.test(textWithoutImports)) {
                    used.add(importInfo.name);
                    break;
                }
            }
        });

        return used;
    }

    private removeImportLines(text: string): string {
        const lines = text.split('\n');
        return lines.filter(line => {
            const trimmed = line.trim();
            return !trimmed.startsWith('import ') && !trimmed.startsWith('from ');
        }).join('\n');
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private removeExcessiveEmptyLines(lines: string[]): string[] {
        const result: string[] = [];
        let consecutiveEmpty = 0;
        
        for (const line of lines) {
            if (line.trim() === '') {
                consecutiveEmpty++;
                if (consecutiveEmpty <= 2) { // Allow max 2 consecutive empty lines
                    result.push(line);
                }
            } else {
                consecutiveEmpty = 0;
                result.push(line);
            }
        }

        return result;
    }

    // Smart import suggestions
    async suggestImports() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'python') {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const suggestions = this.analyzeForMissingImports(text);

        if (suggestions.length > 0) {
            const items = suggestions.map(suggestion => ({
                label: suggestion.importStatement,
                description: suggestion.reason,
                detail: suggestion.module
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select imports to add',
                canPickMany: true
            });

            if (selected && selected.length > 0) {
                await this.addImports(selected.map(s => s.label));
            }
        } else {
            vscode.window.showInformationMessage('No missing imports detected');
        }
    }

    private analyzeForMissingImports(text: string): Array<{importStatement: string, reason: string, module: string}> {
        const suggestions: Array<{importStatement: string, reason: string, module: string}> = [];
        
        // Common patterns that suggest missing imports
        const patterns = [
            { pattern: /\bnp\./g, import: 'import numpy as np', reason: 'numpy usage detected', module: 'numpy' },
            { pattern: /\bpd\./g, import: 'import pandas as pd', reason: 'pandas usage detected', module: 'pandas' },
            { pattern: /\bplt\./g, import: 'import matplotlib.pyplot as plt', reason: 'matplotlib usage detected', module: 'matplotlib' },
            { pattern: /\btorch\./g, import: 'import torch', reason: 'PyTorch usage detected', module: 'torch' },
            { pattern: /\btf\./g, import: 'import tensorflow as tf', reason: 'TensorFlow usage detected', module: 'tensorflow' },
            { pattern: /\bnn\./g, import: 'import torch.nn as nn', reason: 'PyTorch nn usage detected', module: 'torch' },
            { pattern: /\bF\./g, import: 'import torch.nn.functional as F', reason: 'PyTorch functional usage detected', module: 'torch' },
        ];

        const existingImports = this.getExistingImports(text);

        patterns.forEach(({ pattern, import: importStatement, reason, module }) => {
            if (pattern.test(text) && !existingImports.includes(importStatement)) {
                suggestions.push({ importStatement, reason, module });
            }
        });

        return suggestions;
    }

    private getExistingImports(text: string): string[] {
        const lines = text.split('\n');
        return lines.filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('import ') || trimmed.startsWith('from ');
        });
    }

    private async addImports(importStatements: string[]) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const lines = text.split('\n');
        
        // Find the best position to insert imports (after existing imports or at the top)
        let insertPosition = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('import ') || line.startsWith('from ') || line.startsWith('#') || line === '') {
                insertPosition = i + 1;
            } else {
                break;
            }
        }

        const importsText = importStatements.join('\n') + '\n';
        const position = new vscode.Position(insertPosition, 0);
        
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, position, importsText);
        await vscode.workspace.applyEdit(edit);

        vscode.window.showInformationMessage(`✅ Added ${importStatements.length} import${importStatements.length > 1 ? 's' : ''}`);
    }
}