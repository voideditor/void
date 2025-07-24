import * as vscode from 'vscode';

export class SmartPaste {
    private pastePatterns = [
        // TensorFlow patterns
        { pattern: /model\.fit\(/g, imports: ['import tensorflow as tf'], framework: 'tensorflow' },
        { pattern: /tf\./g, imports: ['import tensorflow as tf'], framework: 'tensorflow' },
        { pattern: /keras\./g, imports: ['from tensorflow import keras'], framework: 'tensorflow' },
        
        // PyTorch patterns
        { pattern: /torch\./g, imports: ['import torch'], framework: 'pytorch' },
        { pattern: /nn\./g, imports: ['import torch.nn as nn'], framework: 'pytorch' },
        { pattern: /F\./g, imports: ['import torch.nn.functional as F'], framework: 'pytorch' },
        { pattern: /optim\./g, imports: ['import torch.optim as optim'], framework: 'pytorch' },
        
        // NumPy patterns
        { pattern: /np\./g, imports: ['import numpy as np'], framework: 'numpy' },
        
        // Pandas patterns
        { pattern: /pd\./g, imports: ['import pandas as pd'], framework: 'pandas' },
        { pattern: /pd\.read_csv/g, imports: ['import pandas as pd'], framework: 'pandas' },
        
        // Matplotlib patterns
        { pattern: /plt\./g, imports: ['import matplotlib.pyplot as plt'], framework: 'matplotlib' },
        
        // Scikit-learn patterns
        { pattern: /from sklearn/g, imports: [], framework: 'sklearn' },
        
        // Hugging Face patterns
        { pattern: /from transformers/g, imports: [], framework: 'transformers' },
        { pattern: /AutoModel|AutoTokenizer/g, imports: ['from transformers import AutoModel, AutoTokenizer'], framework: 'transformers' }
    ];

    private colabPatterns = [
        /!pip install/g,
        /!apt-get/g,
        /from google\.colab/g,
        /drive\.mount/g,
        /%matplotlib inline/g,
        /%load_ext/g
    ];

    async handlePaste(text: string) {
        if (!vscode.workspace.getConfiguration('mlTools').get('enableSmartPaste')) {
            await vscode.commands.executeCommand('default:type', { text });
            return;
        }

        let processedText = text;
        const detectedImports: string[] = [];
        const warnings: string[] = [];

        // Clean Colab-specific code
        if (this.isColabCode(processedText)) {
            processedText = this.sanitizeColabCode(processedText);
            warnings.push('Removed Colab-specific commands');
        }

        // Detect required imports
        const requiredImports = this.detectRequiredImports(processedText);
        detectedImports.push(...requiredImports);

        // Fix file paths
        const pathFixResult = await this.fixFilePaths(processedText);
        processedText = pathFixResult.text;
        if (pathFixResult.fixed) {
            warnings.push('Updated file paths to project structure');
        }

        // Check for dimension mismatches
        if (vscode.workspace.getConfiguration('mlTools').get('enableShapeMatching')) {
            const shapeWarnings = this.checkShapeMismatches(processedText);
            warnings.push(...shapeWarnings);
        }

        // Check for version conflicts
        const versionWarnings = await this.checkVersionConflicts(processedText);
        warnings.push(...versionWarnings);

        // Insert the processed text
        await vscode.commands.executeCommand('default:type', { text: processedText });

        // Add missing imports
        if (detectedImports.length > 0) {
            await this.addMissingImports(detectedImports);
        }

        // Show warnings if any
        if (warnings.length > 0) {
            const message = `📋 Smart Paste: ${warnings.join(', ')}`;
            vscode.window.showWarningMessage(message, { modal: false });
        } else if (detectedImports.length > 0) {
            vscode.window.showInformationMessage(
                `📋 Smart Paste: Added ${detectedImports.length} import${detectedImports.length > 1 ? 's' : ''}`,
                { modal: false }
            );
        }
    }

    private isColabCode(text: string): boolean {
        return this.colabPatterns.some(pattern => pattern.test(text));
    }

    private sanitizeColabCode(text: string): string {
        let sanitized = text;

        // Remove pip install commands
        sanitized = sanitized.replace(/!pip install[^\n]*/g, '# Removed: pip install command');
        
        // Remove apt-get commands
        sanitized = sanitized.replace(/!apt-get[^\n]*/g, '# Removed: apt-get command');
        
        // Remove Google Colab imports
        sanitized = sanitized.replace(/from google\.colab[^\n]*/g, '# Removed: Google Colab import');
        
        // Remove drive mount
        sanitized = sanitized.replace(/drive\.mount[^\n]*/g, '# Removed: Drive mount');
        
        // Remove magic commands
        sanitized = sanitized.replace(/%matplotlib inline/g, '# Removed: matplotlib inline magic');
        sanitized = sanitized.replace(/%load_ext[^\n]*/g, '# Removed: load_ext magic');

        return sanitized;
    }

    private detectRequiredImports(text: string): string[] {
        const requiredImports = new Set<string>();
        const existingImports = this.getExistingImports();

        this.pastePatterns.forEach(({ pattern, imports }) => {
            if (pattern.test(text)) {
                imports.forEach(importStatement => {
                    if (!existingImports.includes(importStatement)) {
                        requiredImports.add(importStatement);
                    }
                });
            }
        });

        return Array.from(requiredImports);
    }

    private getExistingImports(): string[] {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return [];
        }

        const document = editor.document;
        const text = document.getText();
        const lines = text.split('\n');
        
        return lines.filter(line => {
            const trimmed = line.trim();
            return trimmed.startsWith('import ') || trimmed.startsWith('from ');
        });
    }

    private async fixFilePaths(text: string): Promise<{ text: string, fixed: boolean }> {
        let fixedText = text;
        let hasFixed = false;

        // Common file path patterns
        const pathPatterns = [
            /pd\.read_csv\(['"]([^'"]+)['"]\)/g,
            /pd\.read_excel\(['"]([^'"]+)['"]\)/g,
            /np\.load\(['"]([^'"]+)['"]\)/g,
            /cv2\.imread\(['"]([^'"]+)['"]\)/g,
            /Image\.open\(['"]([^'"]+)['"]\)/g,
            /open\(['"]([^'"]+)['"]/g
        ];

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { text: fixedText, fixed: hasFixed };
        }

        for (const pattern of pathPatterns) {
            fixedText = fixedText.replace(pattern, (match, filePath) => {
                // Skip if already looks like a project-relative path
                if (filePath.startsWith('./') || filePath.startsWith('../') || filePath.startsWith('/workspace/')) {
                    return match;
                }

                // Try to find the file in common data directories
                const commonDataDirs = ['data', 'datasets', 'input', 'assets', 'resources'];
                const fileName = filePath.split('/').pop() || filePath;
                
                // Suggest a project-relative path
                const suggestedPath = `./data/${fileName}`;
                hasFixed = true;
                
                return match.replace(filePath, suggestedPath);
            });
        }

        return { text: fixedText, fixed: hasFixed };
    }

    private checkShapeMismatches(text: string): string[] {
        const warnings: string[] = [];
        
        // Look for potential shape mismatches in layer definitions
        const layerPatterns = [
            /nn\.Linear\((\d+),\s*(\d+)\)/g,
            /Dense\((\d+)\)/g,
            /Conv2d\((\d+),\s*(\d+)/g
        ];

        // This is a simplified check - in a real implementation,
        // you'd want to do more sophisticated shape analysis
        const lines = text.split('\n');
        const layerInfo: Array<{type: string, input: number, output: number, line: number}> = [];

        lines.forEach((line, index) => {
            layerPatterns.forEach(pattern => {
                const matches = pattern.exec(line);
                if (matches) {
                    if (pattern.source.includes('Linear')) {
                        layerInfo.push({
                            type: 'Linear',
                            input: parseInt(matches[1]),
                            output: parseInt(matches[2]),
                            line: index + 1
                        });
                    }
                }
            });
        });

        // Check for sequential layer mismatches
        for (let i = 0; i < layerInfo.length - 1; i++) {
            const current = layerInfo[i];
            const next = layerInfo[i + 1];
            
            if (current.output !== next.input) {
                warnings.push(`Potential shape mismatch between line ${current.line} and ${next.line}`);
            }
        }

        return warnings;
    }

    private async checkVersionConflicts(text: string): Promise<string[]> {
        const warnings: string[] = [];
        
        // Check for common version conflicts
        const conflictPatterns = [
            { pattern: /tensorflow.*2\./g, conflict: 'keras', message: 'TensorFlow 2.x includes Keras - separate keras import may conflict' },
            { pattern: /torch.*1\.1[0-9]/g, conflict: 'torchvision', message: 'Check PyTorch/torchvision version compatibility' }
        ];

        conflictPatterns.forEach(({ pattern, conflict, message }) => {
            if (pattern.test(text) && text.includes(conflict)) {
                warnings.push(message);
            }
        });

        return warnings;
    }

    private async addMissingImports(imports: string[]) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const text = document.getText();
        const lines = text.split('\n');
        
        // Find the best position to insert imports
        let insertPosition = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('import ') || line.startsWith('from ') || line.startsWith('#') || line === '') {
                insertPosition = i + 1;
            } else {
                break;
            }
        }

        const importsText = imports.join('\n') + '\n';
        const position = new vscode.Position(insertPosition, 0);
        
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, position, importsText);
        await vscode.workspace.applyEdit(edit);
    }

    // Data preview functionality
    async showDataPreview() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        
        // Check if selection looks like a data loading operation
        if (this.isDataLoadingOperation(selectedText)) {
            const preview = await this.generateDataPreview(selectedText);
            if (preview) {
                this.showPreviewPanel(preview);
            }
        }
    }

    private isDataLoadingOperation(text: string): boolean {
        const dataPatterns = [
            /pd\.read_csv/g,
            /pd\.read_excel/g,
            /np\.load/g,
            /X_train|X_test|y_train|y_test/g
        ];

        return dataPatterns.some(pattern => pattern.test(text));
    }

    private async generateDataPreview(text: string): Promise<string | null> {
        // In a real implementation, this would execute the code safely
        // and return actual data preview. For now, return a mock preview.
        return `
# Data Preview (Mock)
Shape: (1000, 10)
Columns: ['feature1', 'feature2', 'feature3', ...]
First 3 rows:
   feature1  feature2  feature3
0      1.23      4.56      7.89
1      2.34      5.67      8.90
2      3.45      6.78      9.01
        `.trim();
    }

    private showPreviewPanel(preview: string) {
        const panel = vscode.window.createWebviewPanel(
            'dataPreview',
            'Data Preview',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: monospace; padding: 20px; }
                    pre { background: #f5f5f5; padding: 10px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <h2>📊 Data Preview</h2>
                <pre>${preview}</pre>
            </body>
            </html>
        `;
    }
}